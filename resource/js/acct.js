// resource/js/acct.js --> account

document.addEventListener("DOMContentLoaded", function () {
  // ── Auto-hide server-rendered alerts ───────────────────────────
  document.querySelectorAll("#alertContainer .alert").forEach((alert) => {
    setTimeout(() => {
      alert.style.transition = "opacity 0.5s ease";
      alert.style.opacity = "0";
      setTimeout(() => alert.remove(), 500);
    }, 5000);
  });

  // ── Password form validation ────────────────────────────────────
  const passwordForm = document.querySelector(
    'form[method="POST"]:has([name="change_password"])',
  );
  if (passwordForm) {
    passwordForm.addEventListener("submit", function (e) {
      const newPassword = document.getElementById("new_password").value;
      const confirmPassword = document.getElementById("confirm_password").value;
      if (newPassword !== confirmPassword) {
        e.preventDefault();
        showAlert("New passwords do not match!", "error");
      }
    });
  }

  // ── Live password strength + match indicators ───────────────────
  enhanceFormValidation();
});

function enhanceFormValidation() {
  const newPasswordField = document.getElementById("new_password");
  const confirmPasswordField = document.getElementById("confirm_password");
  if (!newPasswordField || !confirmPasswordField) return;

  newPasswordField.addEventListener("input", function () {
    validatePasswordStrength(this.value);
  });
  confirmPasswordField.addEventListener("input", function () {
    validatePasswordMatch(newPasswordField.value, this.value);
  });
}

function validatePasswordStrength(password) {
  const indicator =
    document.querySelector(".password-strength") ||
    createPasswordStrengthIndicator();
  const score = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
  ].filter(Boolean).length;
  const labels = ["Very Weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["#ff4444", "#ff8800", "#ffbb33", "#00C851", "#007E33"];
  indicator.textContent = `Password Strength: ${labels[Math.min(score, 4)]}`;
  indicator.style.color = colors[Math.min(score, 4)];
  indicator.style.display = password.length > 0 ? "block" : "none";
}

function createPasswordStrengthIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "password-strength";
  indicator.style.cssText = "font-size:0.85rem;margin-top:5px;display:none;";
  const field = document.getElementById("new_password");
  field.parentNode.insertBefore(indicator, field.nextSibling);
  return indicator;
}

function validatePasswordMatch(newPassword, confirmPassword) {
  const indicator =
    document.querySelector(".password-match") || createPasswordMatchIndicator();
  if (!confirmPassword.length) {
    indicator.style.display = "none";
    return;
  }
  const matches = newPassword === confirmPassword;
  indicator.textContent = matches
    ? "✓ Passwords match"
    : "✗ Passwords do not match";
  indicator.style.color = matches ? "#00C851" : "#ff4444";
  indicator.style.display = "block";
}

function createPasswordMatchIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "password-match";
  indicator.style.cssText = "font-size:0.85rem;margin-top:5px;display:none;";
  const field = document.getElementById("confirm_password");
  field.parentNode.insertBefore(indicator, field.nextSibling);
  return indicator;
}

document.querySelectorAll("#alertContainer .alert").forEach((alert) => {
  alert.style.opacity = "1";
  setTimeout(() => {
    alert.style.transition = "opacity 0.5s ease";
    alert.style.opacity = "0";
    setTimeout(() => alert.remove(), 500);
  }, 1000);
});

function showAlert(message, type = "info") {
  const container = document.getElementById("alertContainer");
  if (!container) return;

  container.querySelectorAll(".alert").forEach((el) => el.remove());

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText =
    "float:right;background:none;border:none;font-size:18px;cursor:pointer;margin-left:5px;";
  closeBtn.innerHTML = `<i class="fas fa-times"></i>`;
  closeBtn.onclick = () => alert.remove();

  alert.appendChild(msgSpan);
  alert.appendChild(closeBtn);
  container.appendChild(alert);

  setTimeout(() => {
    alert.style.transition = "opacity 0.5s ease";
    alert.style.opacity = "0";
    setTimeout(() => {
      if (alert.parentElement) alert.remove();
    }, 500);
  }, 5000);
}
