// resource/js/opt-btn.js --> options button

let isDropdownAddOpen = false;
let isDropdownExportOpen = false;

function toggleAddOptions() {
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
  if (!menu || !trigger) return;

  menu.classList.add("show");
  trigger.classList.add("active");
  isDropdownAddOpen = true;

  setTimeout(() => {
    document.addEventListener("click", addClickOutside);
  }, 0);
}

function hideAddOptions() {
  const menu = document.getElementById("addOptionsMenu");
  const trigger = document.getElementById("addTrigger");
  if (!menu || !trigger) return;

  menu.classList.remove("show");
  trigger.classList.remove("active");
  isDropdownAddOpen = false;

  document.removeEventListener("click", addClickOutside);
}

function addClickOutside(event) {
  const container = document.querySelector(".dropdown");
  if (!container || !container.contains(event.target)) {
    hideAddOptions();
  }
}

function toggleExportOptions() {
  if (isDropdownExportOpen) {
    hideExportOptions();
  } else {
    showExportOptions();
  }
}

function showExportOptions() {
  const menu = document.getElementById("exportOptionsMenu");
  const trigger = document.getElementById("exportTrigger");
  if (!menu || !trigger) return;

  menu.classList.add("show");
  trigger.classList.add("active");
  isDropdownExportOpen = true;

  setTimeout(() => {
    document.addEventListener("click", exportClickOutside);
  }, 0);
}

function hideExportOptions() {
  const menu = document.getElementById("exportOptionsMenu");
  const trigger = document.getElementById("exportTrigger");
  if (!menu || !trigger) return;

  menu.classList.remove("show");
  trigger.classList.remove("active");
  isDropdownExportOpen = false;

  document.removeEventListener("click", exportClickOutside);
}

function exportClickOutside(event) {
  const container = document.querySelector(".dropdown");
  if (!container || !container.contains(event.target)) {
    hideExportOptions();
  }
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.actions-toggle-btn') && !e.target.closest('.actions-panel')) {
    document.querySelectorAll('.actions-panel').forEach(p => p.classList.remove('actions-open'));
    document.querySelectorAll('.actions-toggle-btn').forEach(b => b.classList.remove('actions-active'));
  }
});