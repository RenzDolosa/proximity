// resource/js/li.js --> login logic

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

document.addEventListener("keydown", function (e) {
  const activeElement = document.activeElement;
  const tag = activeElement.tagName.toLowerCase();

  if (!["input", "textarea", "button", "select"].includes(tag)) {
    const usernameField = document.getElementById("username");
    if (usernameField) usernameField.focus();
  }
});

document.addEventListener("click", function (e) {
  const usernameField = document.getElementById("username");
  const clickedElement = e.target;

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

  setTimeout(() => {
    submitBtn.classList.remove("loading");
    submitBtn.disabled = false;
  }, 5000);
});

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
