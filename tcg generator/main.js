// Get DOM elements
const cardNameInput = document.getElementById("card-name");
const cardHealthInput = document.getElementById("card-health");
const cardAbilitiesInput = document.getElementById("card-abilities");
const cardDescriptionInput = document.getElementById("card-description");
const cardImageInput = document.getElementById("card-image");

const previewName = document.getElementById("preview-name");
const previewHealth = document.getElementById("preview-health");
const previewAbilities = document.getElementById("preview-abilities");
const previewDescription = document.getElementById("preview-description");
const previewImage = document.getElementById("preview-image");
const imagePlaceholder = document.getElementById("image-placeholder");

// Function to update preview
function updatePreview() {
  previewName.textContent = cardNameInput.value || "Card Name";
  previewHealth.textContent = "Health: " + (cardHealthInput.value || "0");
  previewAbilities.textContent = cardAbilitiesInput.value || "No abilities set";
  previewDescription.textContent =
    cardDescriptionInput.value || "No description set";
}

// Function to handle image upload
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      previewImage.src = e.target.result;
      previewImage.style.display = "block";
      imagePlaceholder.style.display = "none";
    };
    reader.readAsDataURL(file);
  } else {
    previewImage.style.display = "none";
    imagePlaceholder.style.display = "flex";
  }
}

// Add event listeners
cardNameInput.addEventListener("input", updatePreview);
cardHealthInput.addEventListener("input", updatePreview);
cardAbilitiesInput.addEventListener("input", updatePreview);
cardDescriptionInput.addEventListener("input", updatePreview);
cardImageInput.addEventListener("change", handleImageUpload);

// Initialize preview
updatePreview();

// Download functionality
const downloadBtn = document.getElementById("download-btn");

downloadBtn.addEventListener("click", function () {
  const cardElement = document.querySelector(".card-preview");

  html2canvas(cardElement, {
    backgroundColor: null,
    scale: 2, // Higher resolution
    useCORS: true,
  })
    .then(function (canvas) {
      // Create download link
      const link = document.createElement("a");
      link.download = "tcg-card.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    })
    .catch(function (error) {
      console.error("Error generating PNG:", error);
      alert("Error generating PNG. Please try again.");
    });
});
