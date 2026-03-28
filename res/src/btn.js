const closeBtn = document.getElementById('closeButton')

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && closeBtn) {
    window.history.back();
  }
});