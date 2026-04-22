// Get DOM elements
const cardNameInput = document.getElementById("card-name");
const cardHealthInput = document.getElementById("card-health");
const abilitiesInputList = document.getElementById("abilities-input-list");
const addAbilityBtn = document.getElementById("add-ability-btn");
const cardDescriptionSmall1Input = document.getElementById("card-description-small-1");
const cardDescriptionSmall2Input = document.getElementById("card-description-small-2");
const cardImageInput = document.getElementById("card-image");

const previewName = document.getElementById("preview-name");
const previewHealth = document.getElementById("preview-health");
const previewAbilitiesList = document.getElementById("preview-abilities-list");
const previewDescriptionSmall1 = document.getElementById("preview-description-small-1");
const previewDescriptionSmall2 = document.getElementById("preview-description-small-2");
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
  previewHealth.textContent = (cardHealthInput.value || "0") + "HP";

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
