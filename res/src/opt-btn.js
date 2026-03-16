let isDropdownAddOpen = false;
let isDropdownExportOpen = false;

// Add Options
function toggleAddOptions() {
  const menu = document.getElementById("addOptionsMenu");
  const trigger = document.getElementById("addTrigger");

  if (isDropdownAddOpen) {
    hideAddOptions();
  } else {
    showAddOptions();
    hideExportOptions();
  }
}

function showAddOptions() {
  const menu = document.getElementById("addOptionsMenu");
  const trigger = document.getElementById("addTrigger");

  menu.classList.add("show");
  trigger.classList.add("active");
  isDropdownAddOpen = true;

  // Add click outside listener
  setTimeout(() => {
    document.addEventListener("click", addClickOutside);
  }, 0);
}

function hideAddOptions() {
  const menu = document.getElementById("addOptionsMenu");
  const trigger = document.getElementById("addTrigger");

  menu.classList.remove("show");
  trigger.classList.remove("active");
  isDropdownAddOpen = false;

  // Remove click outside listener
  document.removeEventListener("click", addClickOutside);
}

function addClickOutside(event) {
  const container = document.querySelector(".dropdown");
  if (!container.contains(event.target)) {
    hideAddOptions();
  }
}

// Export Options
function toggleExportOptions() {
  const menu = document.getElementById("exportOptionsMenu");
  const trigger = document.getElementById("exportTrigger");

  if (isDropdownExportOpen) {
    hideExportOptions();
  } else {
    showExportOptions();
  }
}

function showExportOptions() {
  const menu = document.getElementById("exportOptionsMenu");
  const trigger = document.getElementById("exportTrigger");

  menu.classList.add("show");
  trigger.classList.add("active");
  isDropdownExportOpen = true;

  // Add click outside listener
  setTimeout(() => {
    document.addEventListener("click", exportClickOutside);
  }, 0);
}

function hideExportOptions() {
  const menu = document.getElementById("exportOptionsMenu");
  const trigger = document.getElementById("exportTrigger");

  menu.classList.remove("show");
  trigger.classList.remove("active");
  isDropdownExportOpen = false;

  // Remove click outside listener
  document.removeEventListener("click", exportClickOutside);
}

function exportClickOutside(event) {
  const container = document.querySelector(".dropdown");
  if (!container.contains(event.target)) {
    hideExportOptions();
  }
}