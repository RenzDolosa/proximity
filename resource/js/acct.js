// Form validation
document.addEventListener("DOMContentLoaded", function () {
  const passwordForm = document.querySelector(
    'form[method="POST"]:has([name="change_password"])'
  );
  if (passwordForm) {
    passwordForm.addEventListener("submit", function (e) {
      const newPassword = document.getElementById("new_password").value;
      const confirmPassword = document.getElementById("confirm_password").value;

      if (newPassword !== confirmPassword) {
        e.preventDefault();
        showAlert("New passwords do not match!", "error");
        return false;
      }
    });
  }

  // Auto-hide alerts after 5 seconds
  const alerts = document.querySelectorAll(".alert");
  alerts.forEach((alert) => {
    setTimeout(() => {
      alert.style.opacity = "0";
      alert.style.transition = "opacity 0.5s ease";
      setTimeout(() => alert.remove(), 500);
    }, 5000);
  });
});

// Enhanced acct.js with password toggle functionality

document.addEventListener("DOMContentLoaded", function () {
  // Add password toggle functionality
  addPasswordToggle();

  // Form validation enhancement
  enhanceFormValidation();

  // Auto-hide alerts after 5 seconds
  autoHideAlerts();
});

function addPasswordToggle() {
  const passwordFields = [
    "current_password",
    "new_password",
    "confirm_password",
  ];

  passwordFields.forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (field) {
      // Create toggle button
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "password-toggle-btn";
      toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
      toggleBtn.setAttribute("aria-label", "Toggle password visibility");

      // Wrap the input in a container
      const wrapper = document.createElement("div");
      wrapper.className = "password-input-wrapper";
      field.parentNode.insertBefore(wrapper, field);
      wrapper.appendChild(field);
      wrapper.appendChild(toggleBtn);

      // Add click event listener
      toggleBtn.addEventListener("click", function () {
        togglePasswordVisibility(field, toggleBtn);
      });
    }
  });
}

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

function enhanceFormValidation() {
  const newPasswordField = document.getElementById("new_password");
  const confirmPasswordField = document.getElementById("confirm_password");

  if (newPasswordField && confirmPasswordField) {
    // Add real-time password strength indicator
    newPasswordField.addEventListener("input", function () {
      validatePasswordStrength(this.value);
    });

    // Add real-time password match validation
    confirmPasswordField.addEventListener("input", function () {
      validatePasswordMatch(newPasswordField.value, this.value);
    });
  }
}

function validatePasswordStrength(password) {
  const strengthIndicator =
    document.querySelector(".password-strength") ||
    createPasswordStrengthIndicator();
  const requirements = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
  };

  const score = Object.values(requirements).filter(Boolean).length;
  const strength = ["Very Weak", "Weak", "Fair", "Good", "Strong"][
    Math.min(score, 4)
  ];
  const colors = ["#ff4444", "#ff8800", "#ffbb33", "#00C851", "#007E33"];

  strengthIndicator.textContent = `Password Strength: ${strength}`;
  strengthIndicator.style.color = colors[Math.min(score, 4)];
  strengthIndicator.style.display = password.length > 0 ? "block" : "none";
}

function createPasswordStrengthIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "password-strength";
  indicator.style.fontSize = "0.85rem";
  indicator.style.marginTop = "5px";
  indicator.style.display = "none";

  const newPasswordField = document.getElementById("new_password");
  newPasswordField.parentNode.insertBefore(
    indicator,
    newPasswordField.nextSibling
  );

  return indicator;
}

function validatePasswordMatch(newPassword, confirmPassword) {
  const matchIndicator =
    document.querySelector(".password-match") || createPasswordMatchIndicator();

  if (confirmPassword.length === 0) {
    matchIndicator.style.display = "none";
    return;
  }

  if (newPassword === confirmPassword) {
    matchIndicator.textContent = "✓ Passwords match";
    matchIndicator.style.color = "#00C851";
  } else {
    matchIndicator.textContent = "✗ Passwords do not match";
    matchIndicator.style.color = "#ff4444";
  }

  matchIndicator.style.display = "block";
}

function createPasswordMatchIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "password-match";
  indicator.style.fontSize = "0.85rem";
  indicator.style.marginTop = "5px";
  indicator.style.display = "none";

  const confirmPasswordField = document.getElementById("confirm_password");
  confirmPasswordField.parentNode.insertBefore(
    indicator,
    confirmPasswordField.nextSibling
  );

  return indicator;
}

function autoHideAlerts() {
  const alerts = document.querySelectorAll(".alert");
  alerts.forEach((alert) => {
    setTimeout(() => {
      alert.style.opacity = "0";
      alert.style.transition = "opacity 0.5s ease";
      setTimeout(() => {
        alert.style.display = "none";
      }, 500);
    }, 5000);
  });
}

// Show alert message
function showAlert(message, type = "info") {
  const existingAlerts = document.querySelectorAll(".alert");
  existingAlerts.forEach((alert) => alert.remove());

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;
  alert.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; font-size: 18px; cursor: pointer; margin-left: 5px;"><i class="fas fa-times"></i></button>
  `;

  document.body.insertBefore(alert, document.body.firstChild);

  setTimeout(() => {
    if (alert.parentElement) alert.remove();
  }, 5000);
}
