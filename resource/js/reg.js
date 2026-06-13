// resource/js/reg.js --> register

function testServerConnection() {
  fetch(window.location.pathname, { method: "HEAD" }).catch((err) => {
    console.error("Server connection issue:", err);
    showAlert(
      "Connection issue detected. Please check your internet connection.",
      "error",
    );
  });
}

function addPasswordToggle() {
  const passwordFields = ["password", "confirm_password"];

  passwordFields.forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (!field) return;

    let toggleBtn = field.parentNode.querySelector(".password-toggle-btn");

    if (!toggleBtn) {
      const wrapper = document.createElement("div");
      wrapper.className = "password-input-wrapper";
      field.parentNode.insertBefore(wrapper, field);
      wrapper.appendChild(field);

      toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "password-toggle-btn";
      toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
      toggleBtn.setAttribute("aria-label", "Toggle password visibility");
      wrapper.appendChild(toggleBtn);
    }

    const newToggleBtn = toggleBtn.cloneNode(true);
    toggleBtn.parentNode.replaceChild(newToggleBtn, toggleBtn);

    newToggleBtn.addEventListener("click", function (e) {
      e.preventDefault();
      togglePasswordVisibility(field, newToggleBtn);
    });
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
  const form = document.getElementById("registerForm");
  const passwordField = document.getElementById("password");
  const confirmPasswordField = document.getElementById("confirm_password");

  if (passwordField) {
    passwordField.addEventListener("input", function () {
      validatePasswordStrength(this.value);
    });
  }

  if (confirmPasswordField) {
    confirmPasswordField.addEventListener("input", function () {
      validatePasswordMatch(passwordField.value, this.value);
    });
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      if (!validateFormBeforeSubmit(e)) {
        return false;
      }
    });
  }
}

function validateFormBeforeSubmit(e) {
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirm_password").value;
  const username = document.getElementById("username").value;
  const email = document.getElementById("email").value;
  const firstName = document.getElementById("first_name").value;
  const lastName = document.getElementById("last_name").value;

  if (!username || username.length < 3) {
    e.preventDefault();
    showAlert("Username must be at least 3 characters long.", "error");
    return false;
  }

  if (!email || !isValidEmailFormat(email)) {
    e.preventDefault();
    showAlert("Please enter a valid email address.", "error");
    return false;
  }

  if (!firstName || !lastName) {
    e.preventDefault();
    showAlert("First name and last name are required.", "error");
    return false;
  }

  if (!password || password.length < 8) {
    e.preventDefault();
    showAlert("Password must be at least 8 characters long.", "error");
    return false;
  }

  if (!isValidPassword(password)) {
    e.preventDefault();
    showAlert(
      "Password must contain uppercase, lowercase, and number.",
      "error",
    );
    return false;
  }

  if (password !== confirmPassword) {
    e.preventDefault();
    showAlert("Passwords do not match!", "error");
    return false;
  }

  showLoadingState(true);
  return true;
}

function isValidEmailFormat(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
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
  const strengthLevels = ["Very Weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["#ff4444", "#ff8800", "#ffbb33", "#00C851", "#007E33"];

  const strength = strengthLevels[Math.min(score, 4)];
  const color = colors[Math.min(score, 4)];

  strengthIndicator.textContent = `Password Strength: ${strength}`;
  strengthIndicator.style.color = color;
  strengthIndicator.style.display = password.length > 0 ? "block" : "none";

  updatePasswordRequirements(requirements);
}

function createPasswordStrengthIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "password-strength";
  indicator.style.fontSize = "0.85rem";
  indicator.style.marginTop = "5px";
  indicator.style.display = "none";

  const passwordField = document.getElementById("password");
  const wrapper =
    passwordField.closest(".password-input-wrapper") ||
    passwordField.parentNode;
  wrapper.insertAdjacentElement("afterend", indicator);

  return indicator;
}

function updatePasswordRequirements(requirements) {
  let requirementsDiv = document.querySelector(".password-requirements");

  if (!requirementsDiv) {
    requirementsDiv = document.createElement("div");
    requirementsDiv.className = "password-requirements";
    requirementsDiv.style.fontSize = "0.8rem";
    requirementsDiv.style.marginTop = "5px";

    const strengthIndicator = document.querySelector(".password-strength");
    strengthIndicator.insertAdjacentElement("afterend", requirementsDiv);
  }

  const reqText = [
    `${requirements.length ? "✓" : "✗"} At least 8 characters`,
    `${requirements.uppercase ? "✓" : "✗"} One uppercase letter`,
    `${requirements.lowercase ? "✓" : "✗"} One lowercase letter`,
    `${requirements.number ? "✓" : "✗"} One number`,
  ];

  requirementsDiv.innerHTML = reqText
    .map(
      (req) =>
        `<div style="color: ${req.startsWith("✓") ? "#00C851" : "#ff4444"}">${req}</div>`,
    )
    .join("");

  const passwordField = document.getElementById("password");
  requirementsDiv.style.display =
    passwordField.value.length > 0 ? "block" : "none";
}

function validatePasswordMatch(password, confirmPassword) {
  const matchIndicator =
    document.querySelector(".password-match") || createPasswordMatchIndicator();

  if (confirmPassword.length === 0) {
    matchIndicator.style.display = "none";
    return;
  }

  if (password === confirmPassword) {
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
  const wrapper =
    confirmPasswordField.closest(".password-input-wrapper") ||
    confirmPasswordField.parentNode;
  wrapper.insertAdjacentElement("afterend", indicator);

  return indicator;
}

function isValidPassword(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}

function showAlert(message, type = "error") {
  removeExistingAlerts();

  const alertDiv = document.createElement("div");
  alertDiv.className = `${type} alert-box`;
  alertDiv.innerHTML = `<div>${message}</div>`;
  alertDiv.style.marginBottom = "15px";
  alertDiv.style.padding = "12px 15px";
  alertDiv.style.borderRadius = "4px";
  alertDiv.style.display = "block";

  const form = document.getElementById("registerForm");
  form.insertAdjacentElement("beforebegin", alertDiv);

  setTimeout(() => {
    fadeOut(alertDiv);
  }, 8000);
}

function removeExistingAlerts() {
  const existingAlerts = document.querySelectorAll(".alert-box");
  existingAlerts.forEach((alert) => alert.remove());
}

function fadeOut(element) {
  element.style.opacity = "0";
  element.style.transition = "opacity 0.5s ease";
  setTimeout(() => {
    if (element.parentNode) {
      element.remove();
    }
  }, 500);
}

function showLoadingState(show) {
  const submitBtn = document.getElementById("submitBtn");
  const loadingSpan = submitBtn.querySelector(".loading");

  if (show) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = "0.7";
    submitBtn.textContent = "Creating Account...";
  } else {
    submitBtn.disabled = false;
    submitBtn.style.opacity = "1";
    submitBtn.textContent = "Create Account";
  }
}

function handleFormSubmission() {
  const form = document.getElementById("registerForm");

  showLoadingState(false);

  window.addEventListener("pageshow", function () {
    showLoadingState(false);
  });

  if (form) {
    form.addEventListener("submit", function () {
      const timeoutId = setTimeout(() => {
        showLoadingState(false);
        showAlert(
          "Request took too long. Please check your connection and try again.",
          "error",
        );
      }, 15000);

      const observer = new MutationObserver(() => {
        clearTimeout(timeoutId);
        observer.disconnect();
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
}

function autoHideAlerts() {
  const alerts = document.querySelectorAll(".error, .success");
  alerts.forEach((alert) => {
    if (!alert.classList.contains("alert-box")) {
      setTimeout(() => {
        fadeOut(alert);
      }, 5000);
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function () {
  addPasswordToggle();
  enhanceFormValidation();
  autoHideAlerts();
  handleFormSubmission();
  testServerConnection();
});
