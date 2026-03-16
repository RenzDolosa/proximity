// Security: Add protection against common bypass attempts
(function () {
  "use strict";

  // Disable right-click context menu
  document.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    return false;
  });

  // Disable F12, Ctrl+Shift+I, Ctrl+U, etc.
  document.addEventListener("keydown", function (e) {
    // F12
    if (e.keyCode === 123) {
      e.preventDefault();
      return false;
    }
    // Ctrl+Shift+I
    if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
      e.preventDefault();
      return false;
    }
    // Ctrl+U
    if (e.ctrlKey && e.keyCode === 85) {
      e.preventDefault();
      return false;
    }
    // Ctrl+Shift+J
    if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
      e.preventDefault();
      return false;
    }
  });

  // Detect developer tools
  let devtools = {
    open: false,
    orientation: null,
  };
  const threshold = 160;

  setInterval(function () {
    if (
      window.outerHeight - window.innerHeight > threshold ||
      window.outerWidth - window.innerWidth > threshold
    ) {
      if (!devtools.open) {
        devtools.open = true;
        console.clear();
      }
    } else {
      devtools.open = false;
    }
  }, 500);
})();

// Password toggle functionality
document.addEventListener("DOMContentLoaded", function () {
  const passwordField = document.getElementById("portal_password");
  const toggleBtn = document.getElementById("togglePassword");

  if (passwordField && toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      togglePasswordVisibility(passwordField, toggleBtn);
    });
  }
});

function togglePasswordVisibility(field, button) {
  const icon = button.querySelector("i");

  if (field.type === "password") {
    field.type = "text";
    icon.className = "fas fa-eye-slash";
    button.setAttribute("aria-label", "Hide password");
  } else {
    field.type = "password";
    icon.className = "fas fa-eye";
    button.setAttribute("aria-label", "Show password");
  }
}
