document.getElementById("closeButton").addEventListener("click", function () {
  window.location.href = "../iframe/ptl.php";
});

// Allow closing with Enter or Space keys for accessibility
document
  .getElementById("closeButton")
  .addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      window.location.href = "../iframe/ptl.php";
    }
  });
