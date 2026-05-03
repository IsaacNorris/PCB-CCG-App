/**
 * PCB fabrication preview: artwork is reduced to four luminance bands that map
 * to physical layers (bright → dark): silkscreen, exposed copper, bare
 * soldermask, soldermask over copper. Smoothed luminance + mild histogram stretch
 * (no error-diffusion dither) reduce speckle while keeping separation readable.
 */

// RGB for each band (ordered brightest → darkest). Tune to match your fab colors.
const PCB_LAYER_RGB = [
  [248, 248, 242], // silkscreen
  [210, 148, 68], // exposed copper (ENIG-ish)
  [44, 98, 68], // bare soldermask (green)
  [14, 36, 24], // soldermask over copper (darkest)
];

function pcbLayerLuminance(rgb) {
  const [r, g, b] = rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const PCB_LAYER_L_TARGETS = PCB_LAYER_RGB.map(pcbLayerLuminance);

const BG_LUM_THRESHOLD = 246;
const BG_CHROMA_MAX = 20;

/** Foreground mask at processed bitmap size (aligned with preview PNG cover mapping). */
let pcbArtForegroundMask = null;
let pcbArtMaskW = 0;
let pcbArtMaskH = 0;

/** Composite onto white for alpha so luminance matches what prints on a panel. */
function blendRgbOntoWhite(r, g, b, a) {
  const al = a / 255;
  return [
    r * al + 255 * (1 - al),
    g * al + 255 * (1 - al),
    b * al + 255 * (1 - al),
  ];
}

/** Light, low-chroma areas (typical paper/backdrop); excluded from all PCB layers. */
function isImageBackgroundPixel(r, g, b, a) {
  if (a < 14) return true;
  const [R, G, B] = blendRgbOntoWhite(r, g, b, a);
  const lum = pcbLayerLuminance([R, G, B]);
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const chroma = mx - mn;
  if (lum >= 252) return true;
  if (lum >= BG_LUM_THRESHOLD && chroma <= BG_CHROMA_MAX) return true;
  return false;
}

function buildForegroundMask(imageData) {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    mask[i] = isImageBackgroundPixel(data[p], data[p + 1], data[p + 2], data[p + 3])
      ? 0
      : 1;
  }
  return mask;
}

/** Map a point in destination (inner image rect at export res) to source (processed bitmap cw×ch); same geometry as object-fit: cover. */
function mapCoverDestToSource(dx, dy, destW, destH, srcW, srcH) {
  if (destW <= 0 || destH <= 0 || srcW <= 0 || srcH <= 0) {
    return { sx: -1, sy: -1 };
  }
  const scale = Math.max(destW / srcW, destH / srcH);
  const scaledW = srcW * scale;
  const scaledH = srcH * scale;
  const ox = (destW - scaledW) / 2;
  const oy = (destH - scaledH) / 2;
  const sx = (dx - ox) / scale;
  const sy = (dy - oy) / scale;
  return { sx, sy };
}

function sampleForegroundMaskBilinear(
  mask,
  srcW,
  srcH,
  sx,
  sy,
) {
  if (sx < -0.5 || sy < -0.5 || sx >= srcW - 0.5 || sy >= srcH - 0.5) {
    return 0;
  }
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, srcW - 1);
  const y1 = Math.min(y0 + 1, srcH - 1);
  const wx = sx - x0;
  const wy = sy - y0;
  const v00 = mask[y0 * srcW + x0];
  const v10 = mask[y0 * srcW + x1];
  const v01 = mask[y1 * srcW + x0];
  const v11 = mask[y1 * srcW + x1];
  const v =
    v00 * (1 - wx) * (1 - wy) +
    v10 * wx * (1 - wy) +
    v01 * (1 - wx) * wy +
    v11 * wx * wy;
  return v >= 0.5 ? 1 : 0;
}

function foregroundAtInnerExportPixel(px, py, innerIx0, innerIy0, innerIx1, innerIy1) {
  if (!pcbArtForegroundMask || pcbArtMaskW === 0) return 0;
  const dx = px - innerIx0;
  const dy = py - innerIy0;
  const destW = innerIx1 - innerIx0;
  const destH = innerIy1 - innerIy0;
  if (dx < 0 || dy < 0 || dx >= destW || dy >= destH) return 0;
  const { sx, sy } = mapCoverDestToSource(
    dx,
    dy,
    destW,
    destH,
    pcbArtMaskW,
    pcbArtMaskH,
  );
  return sampleForegroundMaskBilinear(
    pcbArtForegroundMask,
    pcbArtMaskW,
    pcbArtMaskH,
    sx,
    sy,
  );
}

function histogramEqualizeLuma(floatLuma, width, height) {
  const size = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < size; i++) {
    const v = Math.min(255, Math.max(0, Math.round(floatLuma[i])));
    hist[v]++;
  }
  const cdf = new Uint32Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
  let cdfMin = 0;
  for (let i = 0; i < 256; i++) {
    if (hist[i] !== 0) {
      cdfMin = cdf[i] - hist[i];
      break;
    }
  }
  const denom = size - cdfMin;
  const out = new Float32Array(size);
  if (denom <= 0) {
    out.set(floatLuma);
    return out;
  }
  for (let i = 0; i < size; i++) {
    const v = Math.min(255, Math.max(0, Math.round(floatLuma[i])));
    out[i] = ((cdf[v] - cdfMin) / denom) * 255;
  }
  return out;
}

function nearestPcbLevel(value, targets) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const d = Math.abs(value - targets[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** 3×3 box blur on luminance; ignores transparent pixels in the average. Reduces input grain. */
function boxBlurLuma(lum, alphaOut, width, height) {
  const out = new Float32Array(lum.length);
  const size = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (alphaOut[i] < 8) {
        out[i] = lum[i];
        continue;
      }
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (alphaOut[j] < 8) continue;
          sum += lum[j];
          count++;
        }
      }
      out[i] = count > 0 ? sum / count : lum[i];
    }
  }
  return out;
}

/**
 * Quantize to PCB_LAYER_RGB: smoothed luminance, mild histogram spread (no error diffusion —
 * dither was the main source of export speckle).
 */
function applyPcbLayerQuantize(imageData, foregroundMask) {
  const { data, width, height } = imageData;
  const size = width * height;
  let lum = new Float32Array(size);
  const alphaOut = new Uint8Array(size);

  for (let i = 0, p = 0; i < size; i++, p += 4) {
    const a = data[p + 3];
    if (foregroundMask && !foregroundMask[i]) {
      alphaOut[i] = 0;
      lum[i] = 255;
      continue;
    }
    alphaOut[i] = a;
    if (a < 8) {
      lum[i] = 255;
      continue;
    }
    const [r, g, b] = blendRgbOntoWhite(data[p], data[p + 1], data[p + 2], a);
    lum[i] = pcbLayerLuminance([r, g, b]);
  }

  lum = boxBlurLuma(lum, alphaOut, width, height);

  // Mild S-curve on luminance before equalization: lifts shadows and highlights a bit.
  for (let i = 0; i < size; i++) {
    const x = lum[i] / 255;
    const s = x * x * (3 - 2 * x);
    lum[i] = s * 255;
  }

  const eq = histogramEqualizeLuma(lum, width, height);
  const HE_BLEND = 0.55;
  const buf = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    buf[i] = eq[i] * HE_BLEND + lum[i] * (1 - HE_BLEND);
  }

  const targets = PCB_LAYER_L_TARGETS;
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    if (alphaOut[i] < 8) continue;
    const level = nearestPcbLevel(buf[i], targets);
    const [pr, pg, pb] = PCB_LAYER_RGB[level];
    data[p] = pr;
    data[p + 1] = pg;
    data[p + 2] = pb;
    data[p + 3] = alphaOut[i];
  }

  // Transparent pixels: clear
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    if (alphaOut[i] < 8) {
      data[p + 3] = 0;
    }
  }

  return imageData;
}

function renderImageToPcbCanvas(img, maxSide = 1600) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;

  let cw = w;
  let ch = h;
  const scale = maxSide / Math.max(w, h);
  if (scale < 1) {
    cw = Math.round(w * scale);
    ch = Math.round(h * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, cw, ch);

  const imageData = ctx.getImageData(0, 0, cw, ch);
  pcbArtForegroundMask = buildForegroundMask(imageData);
  pcbArtMaskW = cw;
  pcbArtMaskH = ch;
  applyPcbLayerQuantize(imageData, pcbArtForegroundMask);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Classify a pixel from the 4-color PCB preview (after dither, colors are near PCB_LAYER_RGB). */
function nearestPcbBandFromRgb(r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < PCB_LAYER_RGB.length; k++) {
    const [R, G, B] = PCB_LAYER_RGB[k];
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Dark pixels on the chrome-only render: titles, rules text, frame lines (goes on silk). */
function isSilkscreenInkPixel(r, g, b, a) {
  if (a < 40) return false;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 250;
}

function computeScaledImageRect(cardElement, imageContainer, scale) {
  const c = cardElement.getBoundingClientRect();
  const i = imageContainer.getBoundingClientRect();
  const x = Math.round((i.left - c.left) * scale);
  const y = Math.round((i.top - c.top) * scale);
  const w = Math.round(i.width * scale);
  const h = Math.round(i.height * scale);
  return { x, y, w, h, scale };
}

function stripCardShadowOnClone(doc) {
  const clonedCard = doc.querySelector(".card-preview");
  if (clonedCard) clonedCard.style.boxShadow = "none";
}

/** Same artwork box as user sees, but no photo — white inner area for chrome / ink detection. */
function hideArtworkShowPlaceholderOnClone(doc) {
  stripCardShadowOnClone(doc);
  const img = doc.getElementById("preview-image");
  const ph = doc.getElementById("image-placeholder");
  if (img) img.style.display = "none";
  if (ph) {
    ph.style.display = "flex";
    ph.style.background = "#ffffff";
    ph.style.width = "100%";
    ph.style.height = "100%";
  }
}

function getCardExportScale() {
  return Math.min(window.devicePixelRatio * 4, 8);
}

function createRoundedClippedCanvas(sourceCanvas, scaledRadius) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = w;
  outputCanvas.height = h;
  const ctx = outputCanvas.getContext("2d");
  const r = scaledRadius;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(sourceCanvas, 0, 0);
  return outputCanvas;
}

function imageDataToCanvas(imageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  return canvas;
}

/** Median of 3×3 band indices inside the inner rect; pads window with center (reduces layer salt-and-pepper). */
function medianFilterBands3x3(bandMap, width, height, x0, y0, x1, y1) {
  const src = new Uint8Array(bandMap);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const vals = [];
      const c0 = src[y * width + x];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const v =
            nx < x0 || nx >= x1 || ny < y0 || ny >= y1 ? c0 : src[ny * width + nx];
          if (v < 4) vals.push(v);
        }
      }
      if (vals.length === 0) continue;
      vals.sort((a, b) => a - b);
      bandMap[y * width + x] = vals[(vals.length - 1) >> 1];
    }
  }
}

/**
 * Silk = chrome ink (from chrome canvas) ∪ artwork band 0 (inner image only) ∪
 *       `.card-image` border ring (always silk so it is not classified as PCB copper/mask).
 * Metal layers = bands 1–3 inside the inner rect only (excludes the 1px border ring).
 */
function buildPcbLayerMasks(fullCanvas, chromeCanvas, imageRect) {
  const W = fullCanvas.width;
  const H = fullCanvas.height;
  const fullData = fullCanvas
    .getContext("2d")
    .getImageData(0, 0, W, H).data;
  const chromeData = chromeCanvas
    .getContext("2d")
    .getImageData(0, 0, W, H).data;

  const ix0 = Math.max(0, imageRect.x);
  const iy0 = Math.max(0, imageRect.y);
  const ix1 = Math.min(W, imageRect.x + imageRect.w);
  const iy1 = Math.min(H, imageRect.y + imageRect.h);

  // 1 CSS px border scales with html2canvas; inset so #222 frame is not mistaken for artwork bands.
  const borderInsetPx = Math.max(1, Math.round(1 * (imageRect.scale ?? 1)));
  let innerIx0 = ix0 + borderInsetPx;
  let innerIy0 = iy0 + borderInsetPx;
  let innerIx1 = ix1 - borderInsetPx;
  let innerIy1 = iy1 - borderInsetPx;
  if (innerIx1 <= innerIx0 || innerIy1 <= innerIy0) {
    innerIx0 = ix0;
    innerIy0 = iy0;
    innerIx1 = ix1;
    innerIy1 = iy1;
  }

  const silk = new ImageData(W, H);
  const copper = new ImageData(W, H);
  const mask = new ImageData(W, H);
  const maskCu = new ImageData(W, H);

  const innerW = innerIx1 - innerIx0;
  const innerH = innerIy1 - innerIy0;
  const fgInner = new Uint8Array(Math.max(0, innerW * innerH));
  for (let iy = 0; iy < innerH; iy++) {
    for (let ix = 0; ix < innerW; ix++) {
      fgInner[iy * innerW + ix] = foregroundAtInnerExportPixel(
        innerIx0 + ix,
        innerIy0 + iy,
        innerIx0,
        innerIy0,
        innerIx1,
        innerIy1,
      );
    }
  }

  const bandMap = new Uint8Array(W * H);
  bandMap.fill(255);
  for (let py = innerIy0; py < innerIy1; py++) {
    for (let px = innerIx0; px < innerIx1; px++) {
      const i = py * W + px;
      const p = i * 4;
      const fg = fgInner[(py - innerIy0) * innerW + (px - innerIx0)];
      if (!fg) {
        bandMap[i] = 255;
        continue;
      }
      const fr = fullData[p];
      const fgCol = fullData[p + 1];
      const fb = fullData[p + 2];
      bandMap[i] = nearestPcbBandFromRgb(fr, fgCol, fb);
    }
  }
  medianFilterBands3x3(bandMap, W, H, innerIx0, innerIy0, innerIx1, innerIy1);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const p = (py * W + px) * 4;
      const cr = chromeData[p];
      const cg = chromeData[p + 1];
      const cb = chromeData[p + 2];
      const ca = chromeData[p + 3];
      const ink = isSilkscreenInkPixel(cr, cg, cb, ca);

      const fr = fullData[p];
      const fg = fullData[p + 1];
      const fb = fullData[p + 2];

      const insideFrame =
        px >= ix0 && px < ix1 && py >= iy0 && py < iy1;
      const insideInner =
        px >= innerIx0 &&
        px < innerIx1 &&
        py >= innerIy0 &&
        py < innerIy1;
      const onImageBorderRing = insideFrame && !insideInner;

      const band = insideInner ? bandMap[py * W + px] & 3 : 0;
      const artFg = insideInner
        ? fgInner[(py - innerIy0) * innerW + (px - innerIx0)]
        : 0;

      const chromeNonWhite = 255 - Math.min(cr, cg, cb) > 12;
      const fullNonWhite = 255 - Math.min(fr, fg, fb) > 12;
      const frameSilk = onImageBorderRing && (chromeNonWhite || fullNonWhite);

      const silkOn =
        ink || frameSilk || (insideInner && artFg && band === 0);
      const c = insideInner && artFg && band === 1 ? 255 : 0;
      const m = insideInner && artFg && band === 2 ? 255 : 0;
      const mc = insideInner && artFg && band === 3 ? 255 : 0;

      silk.data[p] = silk.data[p + 1] = silk.data[p + 2] = silkOn ? 255 : 0;
      silk.data[p + 3] = 255;
      copper.data[p] = copper.data[p + 1] = copper.data[p + 2] = c;
      copper.data[p + 3] = 255;
      mask.data[p] = mask.data[p + 1] = mask.data[p + 2] = m;
      mask.data[p + 3] = 255;
      maskCu.data[p] = maskCu.data[p + 1] = maskCu.data[p + 2] = mc;
      maskCu.data[p + 3] = 255;
    }
  }

  return { silk, copper, mask, maskCu };
}

/** Invert RGB (grayscale mask: white ↔ black). Used for bare-soldermask export only. */
function invertGrayscaleImageData(imageData) {
  const d = imageData.data;
  for (let p = 0; p < d.length; p += 4) {
    d[p] = 255 - d[p];
    d[p + 1] = 255 - d[p + 1];
    d[p + 2] = 255 - d[p + 2];
  }
}

function triggerDownload(url, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
}

function downloadLayersSequentially(entries, i = 0) {
  if (i >= entries.length) return;
  const { canvas, filename } = entries[i];
  triggerDownload(canvas.toDataURL("image/png"), filename);
  setTimeout(() => downloadLayersSequentially(entries, i + 1), 250);
}

// Get DOM elements
const cardNameInput = document.getElementById("card-name");
const abilitiesInputList = document.getElementById("abilities-input-list");
const addAbilityBtn = document.getElementById("add-ability-btn");
const cardDescriptionSmall1Input = document.getElementById(
  "card-description-small-1",
);
const cardDescriptionSmall2Input = document.getElementById(
  "card-description-small-2",
);
const cardImageInput = document.getElementById("card-image");

const previewName = document.getElementById("preview-name");
const previewAbilitiesList = document.getElementById("preview-abilities-list");
const previewDescriptionSmall1 = document.getElementById(
  "preview-description-small-1",
);
const previewDescriptionSmall2 = document.getElementById(
  "preview-description-small-2",
);
const previewImage = document.getElementById("preview-image");
const imagePlaceholder = document.getElementById("image-placeholder");

function addAbilityInput(labelValue = "", descriptionValue = "") {
  const row = document.createElement("div");
  row.className = "ability-row";

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "ability-label-input";
  labelInput.placeholder = "Ability label";
  labelInput.value = labelValue;
  labelInput.addEventListener("input", updatePreview);

  const descriptionInput = document.createElement("input");
  descriptionInput.type = "text";
  descriptionInput.className = "ability-description-input";
  descriptionInput.placeholder = "Ability description";
  descriptionInput.value = descriptionValue;
  descriptionInput.addEventListener("input", updatePreview);

  row.appendChild(labelInput);
  row.appendChild(descriptionInput);
  abilitiesInputList.appendChild(row);
}

// Function to update preview
function updatePreview() {
  previewName.textContent = cardNameInput.value || "Card Name";

  const abilityRows = Array.from(document.querySelectorAll(".ability-row"));
  const abilities = abilityRows
    .map((row) => {
      const label = row.querySelector(".ability-label-input").value.trim();
      const description = row
        .querySelector(".ability-description-input")
        .value.trim();
      return { label, description };
    })
    .filter((ability) => ability.label || ability.description);

  if (abilities.length === 0) {
    previewAbilitiesList.innerHTML = "<li>No abilities set</li>";
  } else {
    previewAbilitiesList.innerHTML = "";
    abilities.forEach((ability) => {
      const listItem = document.createElement("li");
      const abilityLabel = ability.label || "Ability";
      const abilityDescription = ability.description || "";

      const majorLabel = document.createElement("span");
      majorLabel.className = "ability-major-label";
      majorLabel.textContent = abilityLabel;
      listItem.appendChild(majorLabel);

      if (abilityDescription) {
        const minorDescription = document.createElement("span");
        minorDescription.className = "ability-minor-description";
        minorDescription.textContent = abilityDescription;
        listItem.appendChild(minorDescription);
      }

      previewAbilitiesList.appendChild(listItem);
    });
  }

  previewDescriptionSmall1.textContent = cardDescriptionSmall1Input.value || "";
  previewDescriptionSmall2.textContent = cardDescriptionSmall2Input.value || "";
}

// Function to handle image upload — artwork → 4 PCB layers (preview matches export)
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const url = e.target.result;
      const loader = new Image();
      loader.crossOrigin = "anonymous";
      loader.onload = function () {
        const pcbCanvas = renderImageToPcbCanvas(loader);
        if (pcbCanvas) {
          previewImage.src = pcbCanvas.toDataURL("image/png");
        } else {
          pcbArtForegroundMask = null;
          pcbArtMaskW = 0;
          pcbArtMaskH = 0;
          previewImage.src = url;
        }
        previewImage.style.display = "block";
        imagePlaceholder.style.display = "none";
      };
      loader.onerror = function () {
        pcbArtForegroundMask = null;
        pcbArtMaskW = 0;
        pcbArtMaskH = 0;
        previewImage.src = url;
        previewImage.style.display = "block";
        imagePlaceholder.style.display = "none";
      };
      loader.src = url;
    };
    reader.readAsDataURL(file);
  } else {
    previewImage.style.display = "none";
    imagePlaceholder.style.display = "flex";
    pcbArtForegroundMask = null;
    pcbArtMaskW = 0;
    pcbArtMaskH = 0;
  }
}

// Add event listeners
cardNameInput.addEventListener("input", updatePreview);
cardDescriptionSmall1Input.addEventListener("input", updatePreview);
cardDescriptionSmall2Input.addEventListener("input", updatePreview);
cardImageInput.addEventListener("change", handleImageUpload);
document
  .querySelectorAll(".ability-label-input, .ability-description-input")
  .forEach((input) => input.addEventListener("input", updatePreview));
addAbilityBtn.addEventListener("click", () => addAbilityInput());

// Initialize preview
updatePreview();

// Download functionality
const downloadBtn = document.getElementById("download-btn");

downloadBtn.addEventListener("click", function () {
  const cardElement = document.querySelector(".card-preview");
  const exportScale = getCardExportScale();
  const computedCardStyle = window.getComputedStyle(cardElement);
  const borderRadiusPx = parseFloat(computedCardStyle.borderTopLeftRadius) || 0;
  const scaledRadius = borderRadiusPx * exportScale;

  html2canvas(cardElement, {
    backgroundColor: null,
    scale: exportScale,
    useCORS: true,
    onclone: stripCardShadowOnClone,
  })
    .then(function (canvas) {
      const outputCanvas = createRoundedClippedCanvas(canvas, scaledRadius);
      triggerDownload(outputCanvas.toDataURL("image/png"), "tcg-card.png");
    })
    .catch(function (error) {
      console.error("Error generating PNG:", error);
      alert("Error generating PNG. Please try again.");
    });
});

const downloadLayersBtn = document.getElementById("download-layers-btn");

downloadLayersBtn.addEventListener("click", function () {
  const cardElement = document.querySelector(".card-preview");
  const imageContainer = document.querySelector(".card-image");
  if (!cardElement || !imageContainer) return;

  const exportScale = getCardExportScale();
  const computedCardStyle = window.getComputedStyle(cardElement);
  const borderRadiusPx = parseFloat(computedCardStyle.borderTopLeftRadius) || 0;
  const scaledRadius = borderRadiusPx * exportScale;
  const imageRect = computeScaledImageRect(
    cardElement,
    imageContainer,
    exportScale,
  );

  const baseOpts = {
    backgroundColor: null,
    scale: exportScale,
    useCORS: true,
  };

  Promise.all([
    html2canvas(cardElement, {
      ...baseOpts,
      onclone: stripCardShadowOnClone,
    }),
    html2canvas(cardElement, {
      ...baseOpts,
      onclone: hideArtworkShowPlaceholderOnClone,
    }),
  ])
    .then(function (results) {
      const fullCanvas = results[0];
      const chromeCanvas = results[1];
      if (
        fullCanvas.width !== chromeCanvas.width ||
        fullCanvas.height !== chromeCanvas.height
      ) {
        throw new Error("Layer render size mismatch");
      }

      const { silk, copper, mask, maskCu } = buildPcbLayerMasks(
        fullCanvas,
        chromeCanvas,
        imageRect,
      );

      // Bare soldermask (no copper): fab tools often expect the opposite polarity vs other layers.
      invertGrayscaleImageData(mask);

      downloadLayersSequentially([
        {
          canvas: createRoundedClippedCanvas(
            imageDataToCanvas(silk),
            scaledRadius,
          ),
          filename: "tcg-pcb-silkscreen.png",
        },
        {
          canvas: createRoundedClippedCanvas(
            imageDataToCanvas(copper),
            scaledRadius,
          ),
          filename: "tcg-pcb-copper.png",
        },
        {
          canvas: createRoundedClippedCanvas(
            imageDataToCanvas(mask),
            scaledRadius,
          ),
          filename: "tcg-pcb-soldermask.png",
        },
        {
          canvas: createRoundedClippedCanvas(
            imageDataToCanvas(maskCu),
            scaledRadius,
          ),
          filename: "tcg-pcb-soldermask-copper.png",
        },
      ]);
    })
    .catch(function (error) {
      console.error("Error exporting PCB layers:", error);
      alert("Error exporting PCB layers. Please try again.");
    });
});
