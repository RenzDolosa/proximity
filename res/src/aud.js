// Enhanced Audio Settings JavaScript Functions

// Store mute states for different audio types
let audioStates = {
    success: true,
    not_found: true,
    inactive: true,
    violations: true,
};

// Initialize audio settings on page load
document.addEventListener("DOMContentLoaded", function () {
    initializeAudioSettings();
    setupFileUploadHandlers();
});

function initializeAudioSettings() {
    // Load saved settings from localStorage or set defaults
    const savedStates = localStorage.getItem("audioSettings");
    if (savedStates) {
        try {
            audioStates = JSON.parse(savedStates);
        } catch (error) {
            console.log('Error parsing saved audio states:', error);
            // Reset to defaults if parsing fails
            audioStates = {
                success: true,
                not_found: true,
                inactive: true,
                violations: true,
            };
        }
    }

    // Apply saved states to toggle switches
    updateAllToggles();
}

function toggleMute(audioType) {
    // If no specific audio type is provided, determine from the clicked element
    if (!audioType) {
        const clickedElement = event.target.closest(".audio-group");
        if (!clickedElement) return;
        
        const label = clickedElement.querySelector("label");
        if (!label) return;
        
        const labelText = label.textContent.trim();

        switch (labelText) {
            case "Success Sound":
                audioType = "success";
                break;
            case "Not Found Sound":
                audioType = "not_found";
                break;
            case "Inactive Sound":
                audioType = "inactive";
                break;
            case "Violations Sound":
                audioType = "violations";
                break;
            default:
                return;
        }
    }

    // Toggle the state
    audioStates[audioType] = !audioStates[audioType];

    // Update the visual toggle
    updateToggle(audioType);

    // Save to localStorage
    saveAudioSettings();

    // Optional: Play a test sound if unmuted
    if (audioStates[audioType]) {
        playTestSound(audioType);
    }
}

function updateToggle(audioType) {
    const audioGroups = document.querySelectorAll(".audio-group");

    audioGroups.forEach((group) => {
        const label = group.querySelector("label");
        if (!label) return;
        
        const labelText = label.textContent.trim();
        let currentType = null;

        switch (labelText) {
            case "Success Sound":
                currentType = "success";
                break;
            case "Not Found Sound":
                currentType = "not_found";
                break;
            case "Inactive Sound":
                currentType = "inactive";
                break;
            case "Violations Sound":
                currentType = "violations";
                break;
        }

        if (currentType === audioType) {
            const toggleSwitch = group.querySelector(".toggle-switch");
            const toggleSlider = group.querySelector(".toggle-slider");

            if (toggleSwitch && toggleSlider) {
                if (audioStates[audioType]) {
                    toggleSwitch.classList.add("active");
                    toggleSlider.style.transform = "translateX(26px)";
                } else {
                    toggleSwitch.classList.remove("active");
                    toggleSlider.style.transform = "translateX(0px)";
                }
            }
        }
    });
}

function updateAllToggles() {
    Object.keys(audioStates).forEach((audioType) => {
        updateToggle(audioType);
    });
}

function saveAudioSettings() {
    localStorage.setItem("audioSettings", JSON.stringify(audioStates));
    
    // Also sync with any other pages that might be open
    window.dispatchEvent(new CustomEvent('audioSettingsChanged', {
        detail: audioStates
    }));
}

function playTestSound(audioType) {
    // Create a simple beep sound for testing
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Different frequencies for different sound types
        const frequencies = {
            success: 800,
            not_found: 400,
            inactive: 300,
            violations: 600,
        };

        oscillator.frequency.setValueAtTime(
            frequencies[audioType] || 500,
            audioContext.currentTime
        );
        oscillator.type = "sine";

        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
            0.01,
            audioContext.currentTime + 0.3
        );

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
        console.error('Audio context error:', error);
    }
}

function setupFileUploadHandlers() {
    const fileInputs = document.querySelectorAll('input[type="file"][accept="audio/*"]');

    fileInputs.forEach((input, index) => {
        // Make each input unique
        if (!input.id) {
            input.id = `audio-${index}`;
        }
        
        const label = input.nextElementSibling;
        if (label) {
            label.setAttribute("for", input.id);
        }

        input.addEventListener("change", function (e) {
            handleAudioUpload(e, index);
        });
    });
}

function handleAudioUpload(event, index) {
    const file = event.target.files[0];
    const label = event.target.nextElementSibling;
    
    if (!label) return;
    
    const originalText = label.innerHTML;

    if (file) {
        // Validate file type
        if (!file.type.startsWith("audio/")) {
            alert("Please select a valid audio file.");
            event.target.value = "";
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert("File size must be less than 5MB.");
            event.target.value = "";
            return;
        }

        // Update label to show selected file
        label.innerHTML = `<i class="fas fa-check-circle"></i> ${file.name}`;
        label.style.color = "#28a745";

        // Preview the audio
        previewAudio(file, index);

        // Reset label after 3 seconds
        setTimeout(() => {
            if (event.target.value) {
                label.innerHTML = `<i class="fas fa-file-audio"></i> ${file.name} selected`;
            } else {
                label.innerHTML = originalText;
                label.style.color = "";
            }
        }, 3000);
    }
}

function previewAudio(file, index) {
    const audio = new Audio();
    const url = URL.createObjectURL(file);

    audio.src = url;
    audio.volume = 0.3; // Lower volume for preview

    // Play a short preview
    audio.addEventListener("loadeddata", function () {
        if (confirm("Would you like to preview this audio file?")) {
            audio.play().catch((e) => {
                console.log("Audio preview failed:", e);
            });

            // Stop after 2 seconds
            setTimeout(() => {
                audio.pause();
                audio.currentTime = 0;
                URL.revokeObjectURL(url);
            }, 2000);
        } else {
            URL.revokeObjectURL(url);
        }
    });

    audio.addEventListener("error", function () {
        alert("Error loading audio file. Please try a different file.");
        URL.revokeObjectURL(url);
    });
}

// Form submission handler
document.addEventListener("DOMContentLoaded", function () {
    const form = document.querySelector("form[method='POST']");
    if (form) {
        form.addEventListener("submit", function (e) {
            const fileInputs = form.querySelectorAll('input[type="file"]');
            let hasFiles = false;

            fileInputs.forEach((input) => {
                if (input.files.length > 0) {
                    hasFiles = true;
                }
            });

            if (!hasFiles) {
                e.preventDefault();
                alert("Please select at least one audio file to upload.");
                return false;
            }

            // Show loading state
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
                submitBtn.disabled = true;
            }
        });
    }
});

// Listen for audio settings changes from other tabs/pages
window.addEventListener('audioSettingsChanged', function(e) {
    audioStates = e.detail;
    updateAllToggles();
});

// Global functions to check audio state (for use by other scripts)
window.isAudioMuted = function(audioType) {
    return !audioStates[audioType];
};

window.getAudioStates = function() {
    return {...audioStates};
};

// Global function to play system audio (to be used by other parts of the application)
window.playSystemAudio = function(audioType) {
    if (audioStates[audioType]) {
        playTestSound(audioType);
    }
};