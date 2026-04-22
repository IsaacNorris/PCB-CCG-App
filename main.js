// Get DOM elements
const imageInput = document.getElementById("imageInput");
const previewImage = document.getElementById("previewImage");
const previewSection = document.getElementById("previewSection");
const layersSection = document.getElementById("layersSection");
const layersContainer = document.getElementById("layersContainer");
const controlsSection = document.getElementById("controlsSection");
const downloadBtn = document.getElementById("downloadBtn");
const resetBtn = document.getElementById("resetBtn");
const noiseFilterBtn = document.getElementById("noiseFilterBtn");

let originalImage = null;
let layerCanvases = [];
let noiseReductionEnabled = false;

// Event listeners
imageInput.addEventListener("change", handleImageUpload);
downloadBtn.addEventListener("click", downloadAllLayers);
resetBtn.addEventListener("click", resetApp);
noiseFilterBtn.addEventListener("click", toggleNoiseReduction);

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
  if (noiseReductionEnabled) {
    imageData = applyNoiseReduction(imageData);
  }

  const data = imageData.data;

  // Define 5 layers with different brightness thresholds
  const layers = [
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
      name: "Layer 4 (60-80%)",
      min: 153,
      max: 204,
      description: "Light areas",
    },
    {
      name: "Layer 5 (80-100%)",
      min: 204,
      max: 255,
      description: "Brightest areas",
    },
  ];

  layers.forEach((layer, index) => {
    const canvas = createMonochromeLayer(
      originalImage.width,
      originalImage.height,
      data,
      layer.min,
      layer.max,
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
function createMonochromeLayer(
  width,
  height,
  imageData,
  minBrightness,
  maxBrightness,
) {
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

    // Check if this pixel is in the range for this layer
    if (brightness >= minBrightness && brightness <= maxBrightness) {
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
function applyNoiseReduction(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const output = new Uint8ClampedArray(data.length);

  // 3x3 median filter
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const neighbors = [];

      // Collect 3x3 neighborhood for each color channel
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
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
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
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

// Toggle noise reduction filter
function toggleNoiseReduction() {
  noiseReductionEnabled = !noiseReductionEnabled;
  noiseFilterBtn.textContent = `Noise Reduction: ${noiseReductionEnabled ? "ON" : "OFF"}`;
  noiseFilterBtn.classList.toggle("active", noiseReductionEnabled);

  // Regenerate layers with new filter setting
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
  noiseReductionEnabled = false;
  noiseFilterBtn.textContent = "Noise Reduction: OFF";
  noiseFilterBtn.classList.remove("active");
}
