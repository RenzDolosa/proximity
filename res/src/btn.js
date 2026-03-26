const closeBtn = document.getElementById('closeButton')

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && closeBtn) {
    window.location = "../iframe/ptl.php";
  }
});

const portalBtn = document.getElementById('portalButton');

document.addEventListener("keydown", function(e) {
  if (e.ctrlKey && e.shiftKey && e.altKey && e.key === "P" && portalBtn) {
    window.location.href = "portal.php";
  }
});