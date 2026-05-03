/**
 * PCB fabrication preview: artwork is reduced to four luminance bands that map
 * to physical layers (bright → dark): silkscreen, exposed copper, bare
 * soldermask, soldermask over copper. Histogram spread + error diffusion keep
 * subjects readable under this harsh palette.
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

/** Composite onto white for alpha so luminance matches what prints on a panel. */
function blendRgbOntoWhite(r, g, b, a) {
  const al = a / 255;
  return [
    r * al + 255 * (1 - al),
    g * al + 255 * (1 - al),
    b * al + 255 * (1 - al),
  ];
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

/**
 * Floyd–Steinberg dithering in luminance space, then map to PCB_LAYER_RGB.
 */
function applyPcbLayerQuantize(imageData) {
  const { data, width, height } = imageData;
  const size = width * height;
  const lum = new Float32Array(size);
  const alphaOut = new Uint8Array(size);

  for (let i = 0, p = 0; i < size; i++, p += 4) {
    const a = data[p + 3];
    alphaOut[i] = a;
    if (a < 8) {
      lum[i] = 255;
      continue;
    }
    const [r, g, b] = blendRgbOntoWhite(data[p], data[p + 1], data[p + 2], a);
    lum[i] = pcbLayerLuminance([r, g, b]);
  }

  // Mild S-curve on luminance before equalization: lifts shadows and highlights a bit.
  for (let i = 0; i < size; i++) {
    const x = lum[i] / 255;
    const s = x * x * (3 - 2 * x);
    lum[i] = s * 255;
  }

  const eq = histogramEqualizeLuma(lum, width, height);
  const buf = new Float32Array(eq);

  const targets = PCB_LAYER_L_TARGETS;
  for (let y = 0; y < height; y++) {
    const forward = y % 2 === 0;
    const xStart = forward ? 0 : width - 1;
    const xEnd = forward ? width : -1;
    const step = forward ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += step) {
      const i = y * width + x;
      if (alphaOut[i] < 8) continue;

      const oldPixel = buf[i];
      const level = nearestPcbLevel(oldPixel, targets);
      const newL = targets[level];
      const err = oldPixel - newL;

      if (forward) {
        if (x + 1 < width) buf[i + 1] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) buf[i + width - 1] += (err * 3) / 16;
          buf[i + width] += (err * 5) / 16;
          if (x + 1 < width) buf[i + width + 1] += err / 16;
        }
      } else {
        if (x > 0) buf[i - 1] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x + 1 < width) buf[i + width + 1] += (err * 3) / 16;
          buf[i + width] += (err * 5) / 16;
          if (x > 0) buf[i + width - 1] += err / 16;
        }
      }

      const [pr, pg, pb] = PCB_LAYER_RGB[level];
      const p = i * 4;
      data[p] = pr;
      data[p + 1] = pg;
      data[p + 2] = pb;
      data[p + 3] = alphaOut[i];
    }
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
  applyPcbLayerQuantize(imageData);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
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
          previewImage.src = url;
        }
        previewImage.style.display = "block";
        imagePlaceholder.style.display = "none";
      };
      loader.onerror = function () {
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
  const exportScale = Math.min(window.devicePixelRatio * 4, 8);
  const computedCardStyle = window.getComputedStyle(cardElement);
  const borderRadiusPx = parseFloat(computedCardStyle.borderTopLeftRadius) || 0;
  const scaledRadius = borderRadiusPx * exportScale;

  html2canvas(cardElement, {
    backgroundColor: null,
    scale: exportScale,
    useCORS: true,
    onclone: (clonedDocument) => {
      const clonedCard = clonedDocument.querySelector(".card-preview");
      if (clonedCard) {
        // Avoid shadow pixels leaking into transparent export corners.
        clonedCard.style.boxShadow = "none";
      }
    },
  })
    .then(function (canvas) {
      // Card chrome and text stay as designed; artwork was already converted to 4 PCB layers on upload.

      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = canvas.width;
      outputCanvas.height = canvas.height;
      const outputContext = outputCanvas.getContext("2d");

      outputContext.beginPath();
      outputContext.moveTo(scaledRadius, 0);
      outputContext.lineTo(outputCanvas.width - scaledRadius, 0);
      outputContext.quadraticCurveTo(
        outputCanvas.width,
        0,
        outputCanvas.width,
        scaledRadius,
      );
      outputContext.lineTo(
        outputCanvas.width,
        outputCanvas.height - scaledRadius,
      );
      outputContext.quadraticCurveTo(
        outputCanvas.width,
        outputCanvas.height,
        outputCanvas.width - scaledRadius,
        outputCanvas.height,
      );
      outputContext.lineTo(scaledRadius, outputCanvas.height);
      outputContext.quadraticCurveTo(
        0,
        outputCanvas.height,
        0,
        outputCanvas.height - scaledRadius,
      );
      outputContext.lineTo(0, scaledRadius);
      outputContext.quadraticCurveTo(0, 0, scaledRadius, 0);
      outputContext.closePath();
      outputContext.clip();
      outputContext.drawImage(canvas, 0, 0);

      // Create download link
      const link = document.createElement("a");
      link.download = "tcg-card.png";
      link.href = outputCanvas.toDataURL("image/png");
      link.click();
    })
    .catch(function (error) {
      console.error("Error generating PNG:", error);
      alert("Error generating PNG. Please try again.");
    });
});
