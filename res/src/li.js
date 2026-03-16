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
document.addEventListener("DOMContentLoaded", function () {
  const passwordField = document.getElementById("password");
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
