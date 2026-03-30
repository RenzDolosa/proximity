document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;

  const employeeModal     = document.getElementById("employeeModal");
  const deleteModal       = document.getElementById("deleteModal");
  const importModal       = document.getElementById("importModal");
  const cameraModal       = document.getElementById("cameraModal");

  // Layer 1: Camera modal (innermost)
  if (cameraModal?.style.display === "flex" || cameraModal?.style.display === "block") {
    closeCameraModal();
    return;
  }

  // Layer 2: Employee form modal
  if (employeeModal?.style.display === "block") {
    closeModal();
    return;
  }

  // Layer 3: Delete confirmation modal
  if (deleteModal?.style.display === "flex") {
    closeModal();
    return;
  }

  // Layer 4: Import modal
  if (importModal?.style.display === "block") {
    closeModal();
    return;
  }

  window.history.back();
});