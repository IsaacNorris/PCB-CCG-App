// Get DOM elements
const imageInput = document.getElementById("imageInput");
const previewImage = document.getElementById("previewImage");
const previewSection = document.getElementById("previewSection");
const layersSection = document.getElementById("layersSection");
const layersContainer = document.getElementById("layersContainer");
const controlsSection = document.getElementById("controlsSection");
const downloadBtn = document.getElementById("downloadBtn");
const resetBtn = document.getElementById("resetBtn");
const noiseButtons = document.querySelectorAll(".noise-btn");
const cumulativeLayersBtn = document.getElementById("cumulativeLayersBtn");

let originalImage = null;
let layerCanvases = [];
let noiseReductionStrength = 0;
let cumulativeLayersEnabled = false;

// Event listeners
imageInput.addEventListener("change", handleImageUpload);
downloadBtn.addEventListener("click", downloadAllLayers);
resetBtn.addEventListener("click", resetApp);
noiseButtons.forEach((btn) => {
  btn.addEventListener("click", setNoiseReduction);
});
cumulativeLayersBtn.addEventListener("click", toggleCumulativeLayers);

// Handle image upload
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      displayPreview();
      generateMonochromeLayers();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// Display preview of original image
function displayPreview() {
  previewImage.src = originalImage.src;
  previewSection.style.display = "block";
}

// Generate 5 monochrome layers based on brightness levels
function generateMonochromeLayers() {
  layerCanvases = [];
  layersContainer.innerHTML = "";

  // Create a temporary canvas to get image data
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = originalImage.width;
  tempCanvas.height = originalImage.height;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.drawImage(originalImage, 0, 0);
  let imageData = tempCtx.getImageData(
    0,
    0,
    tempCanvas.width,
    tempCanvas.height,
  );

  // Apply noise reduction if enabled
  if (noiseReductionStrength > 0) {
    imageData = applyNoiseReduction(imageData, noiseReductionStrength);
  }

  const data = imageData.data;

  // Define 5 layers with different brightness thresholds
  let layers;
  if (cumulativeLayersEnabled) {
    // Cumulative mode: each layer includes all pixels at or below its threshold
    layers = [
      {
        name: "Layer 1 (≤20%)",
        threshold: 51,
        description: "All pixels ≤20% brightness",
      },
      {
        name: "Layer 2 (≤40%)",
        threshold: 102,
        description: "All pixels ≤40% brightness",
      },
      {
        name: "Layer 3 (≤60%)",
        threshold: 153,
        description: "All pixels ≤60% brightness",
      },
      {
        name: "Layer 4 (≤80%)",
        threshold: 204,
        description: "All pixels ≤80% brightness",
      },
      {
        name: "Layer 5 (≤100%)",
        threshold: 255,
        description: "All pixels (full image)",
      },
    ];
  } else {
    // Exclusive mode: each layer has a specific brightness range
    layers = [
      {
        name: "Layer 1 (0-20%)",
        min: 0,
        max: 51,
        description: "Darkest areas",
      },
      {
        name: "Layer 2 (20-40%)",
        min: 51,
        max: 102,
        description: "Dark areas",
      },
      {
        name: "Layer 3 (40-60%)",
        min: 102,
        max: 153,
        description: "Mid tones",
      },
      {
        name: "Layer 4 (60-90%)",
        min: 153,
        max: 230,
        description: "Light areas",
      },
      {
        name: "Layer 5 (90-100%)",
        min: 230,
        max: 255,
        description: "Brightest areas",
      },
    ];
  }

  layers.forEach((layer, index) => {
    const canvas = createMonochromeLayer(
      originalImage.width,
      originalImage.height,
      data,
      layer,
      cumulativeLayersEnabled,
    );
    layerCanvases.push({ canvas, name: layer.name });

    // Create layer item
    const layerItem = document.createElement("div");
    layerItem.className = "layer-item";
    layerItem.innerHTML = `
      <div class="layer-title">${layer.name}</div>
      <canvas class="layer-canvas"></canvas>
      <div class="layer-description">${layer.description}</div>
      <button class="layer-download" onclick="downloadLayer(${index}, '${layer.name}')">Download</button>
    `;
    layersContainer.appendChild(layerItem);

    // Draw the canvas in the DOM
    const domCanvas = layerItem.querySelector("canvas");
    domCanvas.width = canvas.width;
    domCanvas.height = canvas.height;
    const domCtx = domCanvas.getContext("2d");
    domCtx.drawImage(canvas, 0, 0);
  });

  layersSection.style.display = "block";
  controlsSection.style.display = "block";
}

// Create a monochrome layer for a specific brightness range
function createMonochromeLayer(width, height, imageData, layer, isCumulative) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  // Create new image data for this layer
  const layerImageData = ctx.createImageData(width, height);
  const layerData = layerImageData.data;

  // Process each pixel
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];

    // Calculate brightness (grayscale value)
    const brightness = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

    let shouldInclude = false;

    if (isCumulative) {
      // Cumulative mode: include pixels at or below the threshold
      shouldInclude = brightness <= layer.threshold;
    } else {
      // Exclusive mode: include pixels within the range
      shouldInclude = brightness >= layer.min && brightness <= layer.max;
    }

    // Check if this pixel is in the range for this layer
    if (shouldInclude) {
      // Set to white for pixels in range
      layerData[i] = 255;
      layerData[i + 1] = 255;
      layerData[i + 2] = 255;
      layerData[i + 3] = 255;
    } else {
      // Set to black for pixels outside range
      layerData[i] = 0;
      layerData[i + 1] = 0;
      layerData[i + 2] = 0;
      layerData[i + 3] = 255;
    }
  }

  ctx.putImageData(layerImageData, 0, 0);
  return canvas;
}

// Download a single layer
function downloadLayer(index, layerName) {
  const canvas = layerCanvases[index].canvas;
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${layerName.replace(/\s+/g, "_")}.png`;
  link.click();
}

// Download all layers as a zip
function downloadAllLayers() {
  layerCanvases.forEach((layer, index) => {
    const link = document.createElement("a");
    link.href = layer.canvas.toDataURL("image/png");
    link.download = `layer_${index + 1}_${layer.name.replace(/\s+/g, "_")}.png`;

    // Stagger downloads slightly to avoid browser issues
    setTimeout(() => {
      link.click();
    }, index * 200);
  });
}
function applyNoiseReduction(imageData, strength = 1) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const output = new Uint8ClampedArray(data.length);

  // Kernel size based on strength: 3, 5, 7, 9, 11 for strength 1-5
  const kernelSize = 2 * strength + 1;
  const halfKernel = Math.floor(kernelSize / 2);

  for (let y = halfKernel; y < height - halfKernel; y++) {
    for (let x = halfKernel; x < width - halfKernel; x++) {
      const neighbors = [];

      // Collect neighborhood for each color channel
      for (let dy = -halfKernel; dy <= halfKernel; dy++) {
        for (let dx = -halfKernel; dx <= halfKernel; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 4;
          neighbors.push(data[idx]); // R
          neighbors.push(data[idx + 1]); // G
          neighbors.push(data[idx + 2]); // B
        }
      }

      // Sort and get median for each channel
      const rValues = neighbors
        .filter((_, i) => i % 3 === 0)
        .sort((a, b) => a - b);
      const gValues = neighbors
        .filter((_, i) => i % 3 === 1)
        .sort((a, b) => a - b);
      const bValues = neighbors
        .filter((_, i) => i % 3 === 2)
        .sort((a, b) => a - b);

      const mid = Math.floor(rValues.length / 2);
      const outputIdx = (y * width + x) * 4;

      output[outputIdx] = rValues[mid]; // R
      output[outputIdx + 1] = gValues[mid]; // G
      output[outputIdx + 2] = bValues[mid]; // B
      output[outputIdx + 3] = data[outputIdx + 3]; // Alpha (unchanged)
    }
  }

  // Copy edges unchanged
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        y < halfKernel ||
        y >= height - halfKernel ||
        x < halfKernel ||
        x >= width - halfKernel
      ) {
        const idx = (y * width + x) * 4;
        output[idx] = data[idx];
        output[idx + 1] = data[idx + 1];
        output[idx + 2] = data[idx + 2];
        output[idx + 3] = data[idx + 3];
      }
    }
  }

  return new ImageData(output, width, height);
}

// Update noise reduction strength
// Set noise reduction level
function setNoiseReduction(e) {
  const level = parseInt(e.target.dataset.level);
  noiseReductionStrength = level;

  // Update button active states
  noiseButtons.forEach((btn) => {
    btn.classList.remove("active");
    if (parseInt(btn.dataset.level) === level) {
      btn.classList.add("active");
    }
  });

  // Regenerate layers with new filter setting
  if (originalImage) {
    generateMonochromeLayers();
  }
}

// Toggle cumulative layers mode
function toggleCumulativeLayers() {
  cumulativeLayersEnabled = !cumulativeLayersEnabled;
  cumulativeLayersBtn.textContent = `Cumulative Layers: ${cumulativeLayersEnabled ? "ON" : "OFF"}`;
  cumulativeLayersBtn.classList.toggle("active", cumulativeLayersEnabled);

  // Regenerate layers with new mode
  if (originalImage) {
    generateMonochromeLayers();
  }
}

// Reset the app
function resetApp() {
  imageInput.value = "";
  previewImage.src = "";
  previewSection.style.display = "none";
  layersSection.style.display = "none";
  controlsSection.style.display = "none";
  layersContainer.innerHTML = "";
  layerCanvases = [];
  originalImage = null;
  noiseReductionStrength = 0;

  // Reset noise reduction buttons
  noiseButtons.forEach((btn) => {
    btn.classList.remove("active");
    if (parseInt(btn.dataset.level) === 0) {
      btn.classList.add("active");
    }
  });

  cumulativeLayersEnabled = false;
  cumulativeLayersBtn.textContent = "Cumulative Layers: OFF";
  cumulativeLayersBtn.classList.remove("active");
}

// Initialize first noise button as active
if (noiseButtons.length > 0) {
  noiseButtons[0].classList.add("active");
}
