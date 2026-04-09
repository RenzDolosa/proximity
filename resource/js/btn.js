// resource/js/btn.js --> buttons

window.addEventListener("load", () => window.focus());
document.addEventListener("click", () => window.focus());

// Debounce flag to prevent rapid Escape presses
let escapeProcessing = false;

document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape" || escapeProcessing) return;

  const employeeModal = document.getElementById("employeeModal");
  const deleteModal = document.getElementById("deleteModal");
  const importModal = document.getElementById("importModal");
  const cameraModal = document.getElementById("cameraModal");
  const logsModal = document.getElementById("logsModal");
  const cpOverlay = document.getElementById("cpOverlay");

  // Check if any modal is currently visible using computed styles
  const isAnyModalOpen = [
    employeeModal,
    deleteModal,
    importModal,
    cameraModal,
    logsModal,
    cpOverlay
  ].some(modal => {
    if (!modal) return false;
    const display = window.getComputedStyle(modal).display;
    const visibility = window.getComputedStyle(modal).visibility;
    return display !== "none" && visibility !== "hidden";
  });

  // If a modal is open, close it
  if (isAnyModalOpen) {
    // Determine which modal to close and call appropriate close function
    if (
      cameraModal &&
      (window.getComputedStyle(cameraModal).display === "flex" ||
        window.getComputedStyle(cameraModal).display === "block")
    ) {
      if (typeof closeCameraModal === "function") closeCameraModal();
    } else if (
      employeeModal &&
      window.getComputedStyle(employeeModal).display === "block"
    ) {
      if (typeof closeModal === "function") closeModal();
    } else if (
      deleteModal &&
      window.getComputedStyle(deleteModal).display === "flex"
    ) {
      if (typeof closeModal === "function") closeModal();
    } else if (
      importModal &&
      window.getComputedStyle(importModal).display === "block"
    ) {
      if (typeof closeModal === "function") closeModal();
    } else if (
      logsModal &&
      window.getComputedStyle(logsModal).display === "block"
    ) {
      if (typeof closeModal === "function") closeModal();
    } else if (
      cpOverlay &&
      cpOverlay.classList.contains("open")
    ) {
      cpOverlay.classList.remove("open");
    }
    return;
  }

  // No modals open, navigate back
  escapeProcessing = true;

  if (window.self !== window.top) {
    window.top.history.back();
  } else {
    window.history.back();
  }

  // Reset flag after navigation or timeout
  setTimeout(() => {
    escapeProcessing = false;
  }, 500);
});