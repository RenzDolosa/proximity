// Enhanced reg.js with password toggle functionality
document.addEventListener('DOMContentLoaded', function() {
    // Add password toggle functionality
    addPasswordToggle();
    
    // Form validation enhancement
    enhanceFormValidation();
    
    // Auto-hide alerts after 5 seconds
    autoHideAlerts();
    
    // Add form submission handling
    handleFormSubmission();
});

function addPasswordToggle() {
    const passwordFields = [
        'password',
        'confirm_password'
    ];
    
    passwordFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            // Find existing toggle button or create one
            let toggleBtn = field.parentNode.querySelector('.password-toggle-btn');
            
            if (!toggleBtn) {
                // Create toggle button if it doesn't exist
                toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'password-toggle-btn';
                toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
                toggleBtn.setAttribute('aria-label', 'Toggle password visibility');
                
                // Check if wrapper exists, if not create it
                if (!field.parentNode.classList.contains('password-input-wrapper')) {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'password-input-wrapper';
                    field.parentNode.insertBefore(wrapper, field);
                    wrapper.appendChild(field);
                }
                
                field.parentNode.appendChild(toggleBtn);
            }
            
            // Add click event listener (remove existing to avoid duplicates)
            toggleBtn.replaceWith(toggleBtn.cloneNode(true));
            toggleBtn = field.parentNode.querySelector('.password-toggle-btn');
            
            toggleBtn.addEventListener('click', function() {
                togglePasswordVisibility(field, toggleBtn);
            });
        }
    });
}

function togglePasswordVisibility(field, button) {
    const icon = button.querySelector('i');
    
    if (field.type === 'password') {
        field.type = 'text';
        icon.className = 'fas fa-eye-slash';
        button.setAttribute('aria-label', 'Hide password');
    } else {
        field.type = 'password';
        icon.className = 'fas fa-eye';
        button.setAttribute('aria-label', 'Show password');
    }
}

function enhanceFormValidation() {
    const form = document.getElementById('registerForm');
    const passwordField = document.getElementById('password');
    const confirmPasswordField = document.getElementById('confirm_password');
    
    if (passwordField) {
        // Add real-time password strength indicator
        passwordField.addEventListener('input', function() {
            validatePasswordStrength(this.value);
        });
    }
    
    if (confirmPasswordField) {
        // Add real-time password match validation
        confirmPasswordField.addEventListener('input', function() {
            validatePasswordMatch(passwordField.value, this.value);
        });
    }
    
    // Enhanced form validation on submit
    if (form) {
        form.addEventListener('submit', function(e) {
            const password = passwordField.value;
            const confirmPassword = confirmPasswordField.value;
            
            // Check password match
            if (password !== confirmPassword) {
                e.preventDefault();
                showError('Passwords do not match!');
                return false;
            }
            
            // Check password strength
            if (!isValidPassword(password)) {
                e.preventDefault();
                showError('Password must be at least 8 characters and contain uppercase, lowercase, and number.');
                return false;
            }
            
            // Show loading state
            showLoadingState(true);
        });
    }
}

function validatePasswordStrength(password) {
    const strengthIndicator = document.querySelector('.password-strength') || createPasswordStrengthIndicator();
    const requirements = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /\d/.test(password)
    };
    
    const score = Object.values(requirements).filter(Boolean).length;
    const strengthLevels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['#ff4444', '#ff8800', '#ffbb33', '#00C851', '#007E33'];
    
    const strength = strengthLevels[Math.min(score, 4)];
    const color = colors[Math.min(score, 4)];
    
    strengthIndicator.textContent = `Password Strength: ${strength}`;
    strengthIndicator.style.color = color;
    strengthIndicator.style.display = password.length > 0 ? 'block' : 'none';
    
    // Show detailed requirements
    updatePasswordRequirements(requirements);
}

function createPasswordStrengthIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'password-strength';
    indicator.style.fontSize = '0.85rem';
    indicator.style.marginTop = '5px';
    indicator.style.display = 'none';
    
    const passwordField = document.getElementById('password');
    const wrapper = passwordField.closest('.password-input-wrapper') || passwordField.parentNode;
    wrapper.insertAdjacentElement('afterend', indicator);
    
    return indicator;
}

function updatePasswordRequirements(requirements) {
    let requirementsDiv = document.querySelector('.password-requirements');
    
    if (!requirementsDiv) {
        requirementsDiv = document.createElement('div');
        requirementsDiv.className = 'password-requirements';
        requirementsDiv.style.fontSize = '0.8rem';
        requirementsDiv.style.marginTop = '5px';
        
        const strengthIndicator = document.querySelector('.password-strength');
        strengthIndicator.insertAdjacentElement('afterend', requirementsDiv);
    }
    
    const reqText = [
        `${requirements.length ? '✓' : '✗'} At least 8 characters`,
        `${requirements.uppercase ? '✓' : '✗'} One uppercase letter`,
        `${requirements.lowercase ? '✓' : '✗'} One lowercase letter`,
        `${requirements.number ? '✓' : '✗'} One number`
    ];
    
    requirementsDiv.innerHTML = reqText.map(req => 
        `<div style="color: ${req.startsWith('✓') ? '#00C851' : '#ff4444'}">${req}</div>`
    ).join('');
    
    const passwordField = document.getElementById('password');
    requirementsDiv.style.display = passwordField.value.length > 0 ? 'block' : 'none';
}

function validatePasswordMatch(password, confirmPassword) {
    const matchIndicator = document.querySelector('.password-match') || createPasswordMatchIndicator();
    
    if (confirmPassword.length === 0) {
        matchIndicator.style.display = 'none';
        return;
    }
    
    if (password === confirmPassword) {
        matchIndicator.textContent = '✓ Passwords match';
        matchIndicator.style.color = '#00C851';
    } else {
        matchIndicator.textContent = '✗ Passwords do not match';
        matchIndicator.style.color = '#ff4444';
    }
    
    matchIndicator.style.display = 'block';
}

function createPasswordMatchIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'password-match';
    indicator.style.fontSize = '0.85rem';
    indicator.style.marginTop = '5px';
    indicator.style.display = 'none';
    
    const confirmPasswordField = document.getElementById('confirm_password');
    const wrapper = confirmPasswordField.closest('.password-input-wrapper') || confirmPasswordField.parentNode;
    wrapper.insertAdjacentElement('afterend', indicator);
    
    return indicator;
}

function isValidPassword(password) {
    return password.length >= 8 &&
           /[A-Z]/.test(password) &&
           /[a-z]/.test(password) &&
           /\d/.test(password);
}

function showError(message) {
    // Remove existing error alerts
    const existingErrors = document.querySelectorAll('.error-alert');
    existingErrors.forEach(error => error.remove());
    
    // Create new error alert
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error error-alert';
    errorDiv.textContent = message;
    errorDiv.style.marginBottom = '15px';
    
    const form = document.getElementById('registerForm');
    form.insertAdjacentElement('beforebegin', errorDiv);
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        errorDiv.style.opacity = '0';
        errorDiv.style.transition = 'opacity 0.5s ease';
        setTimeout(() => errorDiv.remove(), 500);
    }, 5000);
}

function showLoadingState(show) {
    const submitBtn = document.getElementById('submitBtn');
    const loadingSpan = submitBtn.querySelector('.loading');
    
    if (show) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
        if (loadingSpan) {
            loadingSpan.style.display = 'inline-block';
        }
    } else {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        if (loadingSpan) {
            loadingSpan.style.display = 'none';
        }
    }
}

function handleFormSubmission() {
    const form = document.getElementById('registerForm');
    
    // Reset loading state when page loads (in case of form resubmission)
    showLoadingState(false);
    
    // Handle back button or page reload
    window.addEventListener('pageshow', function() {
        showLoadingState(false);
    });
}

function autoHideAlerts() {
    const alerts = document.querySelectorAll('.error, .success');
    alerts.forEach(alert => {
        if (!alert.classList.contains('error-alert')) { // Don't auto-hide our custom error alerts
            setTimeout(() => {
                alert.style.opacity = '0';
                alert.style.transition = 'opacity 0.5s ease';
                setTimeout(() => {
                    alert.style.display = 'none';
                }, 500);
            }, 5000);
        }
    });
}