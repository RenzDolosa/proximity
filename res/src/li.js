// Auto-focus username on page load
document.addEventListener("DOMContentLoaded", function () {
  const usernameField = document.getElementById("username");
  if (usernameField) {
    usernameField.focus();
  }

  const passwordField = document.getElementById("password");
  const toggleBtn = document.getElementById("togglePassword");

  if (passwordField && toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      togglePasswordVisibility(passwordField, toggleBtn);
    });
  }
});

// Auto-focus username on ANY keypress
document.addEventListener("keydown", function (e) {
  const usernameField = document.getElementById("username");
  const activeElement = document.activeElement;

  // Focus username unless user is typing in password field or submit button
  if (activeElement.id !== "password" && activeElement.id !== "submitBtn") {
    if (usernameField) {
      usernameField.focus();
    }
  }
});

// Auto-focus username on ANY click (except on password field or buttons)
document.addEventListener("click", function (e) {
  const usernameField = document.getElementById("username");
  const clickedElement = e.target;

  // Don't refocus if clicking on password field, toggle button, or submit button
  if (
    clickedElement.id !== "password" &&
    clickedElement.id !== "togglePassword" &&
    clickedElement.id !== "submitBtn" &&
    !clickedElement.closest("#togglePassword") &&
    !clickedElement.closest("button")
  ) {
    if (usernameField) {
      usernameField.focus();
    }
  }
});

document.getElementById("loginForm").addEventListener("submit", function (e) {
  const submitBtn = document.getElementById("submitBtn");
  submitBtn.classList.add("loading");
  submitBtn.disabled = true;

  // Re-enable button after 10 seconds as fallback
  setTimeout(() => {
    submitBtn.classList.remove("loading");
    submitBtn.disabled = false;
  }, 10000);
});

// Simple form validation
document.getElementById("username").addEventListener("input", function () {
  const username = this.value;
  if (username.length > 0) {
    this.style.borderColor = "#51cf66";
  }
});

document.getElementById("password").addEventListener("input", function () {
  const password = this.value;
  if (password.length > 0) {
    this.style.borderColor = "#51cf66";
  }
});

// Password toggle functionality
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