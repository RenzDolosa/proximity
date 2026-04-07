// resource/js/btn.js --> buttons

document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;

  const employeeModal     = document.getElementById("employeeModal");
  const deleteModal       = document.getElementById("deleteModal");
  const importModal       = document.getElementById("importModal");
  const cameraModal       = document.getElementById("cameraModal");
  const logsModal         = document.getElementById("logsModal");

  // Layer 1: Camera modal (innermost)
  if (cameraModal?.style.display === "flex" || cameraModal?.style.display === "block") {
    closeCameraModal();
    return;
  }
  if (employeeModal?.style.display === "block") { closeModal(); return; }
  if (deleteModal?.style.display === "flex")    { closeModal(); return; }
  if (importModal?.style.display === "block")   { closeModal(); return; }
  if (logsModal?.style.display === "block")     { closeModal(); return; }

  window.history.back();
});