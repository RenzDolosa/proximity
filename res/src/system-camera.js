// system-camera-enhanced.js - Camera Capture with Multi-Camera Support
// FEATURES:
// - Discovers all available cameras on the device
// - Allows users to switch between cameras during active session
// - Clean UI with camera selector dropdown
// - Proper error handling and status messages

let cameraStream = null;
let capturedCanvas = null;
let capturedImageData = null;
let availableCameras = [];
let currentCameraId = null;
let currentCameraLabel = null;

// ============================================
// STEP 1: DISCOVER AVAILABLE CAMERAS
// ============================================

/**
 * Enumerate and store all available video input devices
 * This function discovers what cameras are connected to the device
 */
async function discoverAvailableCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    availableCameras = [];

    // Filter only video input devices (cameras)
    devices.forEach((device) => {
      if (device.kind === "videoinput") {
        availableCameras.push({
          id: device.deviceId,
          label: device.label || `Camera ${availableCameras.length + 1}`,
        });
      }
    });

    console.log("Available cameras:", availableCameras);
    return availableCameras;
  } catch (error) {
    console.error("Error discovering cameras:", error);
    return [];
  }
}

/**
 * Populate the camera selector dropdown with available cameras
 */
function populateCameraSelector() {
  const cameraSelect = document.getElementById("cameraSelector");
  if (!cameraSelect) return;

  cameraSelect.innerHTML = "";

  if (availableCameras.length === 0) {
    cameraSelect.innerHTML =
      '<option value="">No cameras found</option>';
    cameraSelect.disabled = true;
    return;
  }

  availableCameras.forEach((camera) => {
    const option = document.createElement("option");
    option.value = camera.id;
    option.textContent = camera.label;
    cameraSelect.appendChild(option);
  });

  // Set the first camera as default
  if (availableCameras.length > 0) {
    cameraSelect.value = availableCameras[0].id;
    currentCameraId = availableCameras[0].id;
    currentCameraLabel = availableCameras[0].label;
    cameraSelect.disabled = availableCameras.length <= 1;
  }
}

// ============================================
// STEP 2: REQUEST PERMISSION AND INITIALIZE CAMERA
// ============================================

/**
 * Open camera modal and initialize camera discovery
 */
function openCameraModal() {
  const cameraModal = document.getElementById("cameraModal");
  if (!cameraModal) return;

  cameraModal.style.display = "block";
  initializeCamera();
}

/**
 * Close camera modal and clean up
 */
function closeCameraModal() {
  const cameraModal = document.getElementById("cameraModal");
  if (!cameraModal) return;

  cameraModal.style.display = "none";
  stopCamera();
  resetCameraUI();
}

/**
 * Initialize camera access with selected camera or default
 */
async function initializeCamera() {
  const videoElement = document.getElementById("cameraStream");
  const cameraStatus = document.getElementById("cameraStatus");
  const captureBtn = document.getElementById("captureBtn");

  if (!videoElement || !cameraStatus) return;

  try {
    // First, discover available cameras
    await discoverAvailableCameras();
    populateCameraSelector();

    // If no cameras found, show error
    if (availableCameras.length === 0) {
      handleCameraError(
        { name: "NotFoundError" },
        cameraStatus
      );
      captureBtn.disabled = true;
      return;
    }

    // Request camera access with the selected or default camera
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: currentCameraId ? { exact: currentCameraId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    cameraStream = stream;
    videoElement.srcObject = stream;

    videoElement.onloadedmetadata = () => {
      videoElement.play();
      updateCameraStatus(
        `✓ ${currentCameraLabel} ready. Tap Capture to take photo.`,
        "success"
      );
      captureBtn.disabled = false;
    };
  } catch (error) {
    console.error("Camera error:", error);
    handleCameraError(error, cameraStatus);
    captureBtn.disabled = true;
  }
}

// ============================================
// STEP 3: SWITCH CAMERAS DURING SESSION
// ============================================

/**
 * Switch to a different camera during an active session
 * This stops the current camera stream and starts a new one
 */
async function switchCamera() {
  const cameraSelect = document.getElementById("cameraSelector");
  const cameraStatus = document.getElementById("cameraStatus");
  const videoElement = document.getElementById("cameraStream");

  if (!cameraSelect || !videoElement) return;

  const selectedCameraId = cameraSelect.value;
  if (!selectedCameraId || selectedCameraId === currentCameraId) return;

  try {
    updateCameraStatus("Switching camera...", "info");

    // Stop the current stream
    stopCamera();

    // Update current camera info
    currentCameraId = selectedCameraId;
    const selectedCamera = availableCameras.find(
      (cam) => cam.id === selectedCameraId
    );
    currentCameraLabel = selectedCamera ? selectedCamera.label : "Camera";

    // Request new camera stream
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: selectedCameraId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    cameraStream = stream;
    videoElement.srcObject = stream;

    videoElement.onloadedmetadata = () => {
      videoElement.play();
      updateCameraStatus(
        `✓ Switched to ${currentCameraLabel}. Ready to capture.`,
        "success"
      );
    };

    // Reset capture UI when switching cameras
    resetCaptureUI();
  } catch (error) {
    console.error("Camera switch error:", error);
    updateCameraStatus(
      `❌ Failed to switch to ${currentCameraLabel}. Please try again.`,
      "error"
    );
  }
}

/**
 * Reset capture UI (used when switching cameras)
 */
function resetCaptureUI() {
  const video = document.getElementById("cameraStream");
  const canvas = document.getElementById("cameraPreview");
  const captureBtn = document.getElementById("captureBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const uploadBtn = document.getElementById("uploadCameraBtn");

  if (video) video.style.display = "block";
  if (canvas) canvas.style.display = "none";
  if (captureBtn) captureBtn.style.display = "inline-flex";
  if (retakeBtn) retakeBtn.style.display = "none";
  if (uploadBtn) uploadBtn.style.display = "none";

  capturedCanvas = null;
  capturedImageData = null;
}

// ============================================
// STEP 4: CAPTURE PHOTO
// ============================================

/**
 * Capture photo from current video stream
 */
function capturePhoto() {
  const video = document.getElementById("cameraStream");
  const canvas = document.getElementById("cameraPreview");
  const captureBtn = document.getElementById("captureBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const uploadBtn = document.getElementById("uploadCameraBtn");

  if (!video || !canvas) return;

  try {
    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      updateCameraStatus(
        "❌ Unable to capture image. Please try again.",
        "error"
      );
      return;
    }

    // Mirror the image (flip horizontally) to match video preview
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    context.restore();

    // Store the captured image data
    capturedCanvas = canvas;
    capturedImageData = canvas.toDataURL("image/jpeg", 0.95);

    // Update UI
    video.style.display = "none";
    canvas.style.display = "block";
    captureBtn.style.display = "none";
    retakeBtn.style.display = "inline-flex";
    uploadBtn.style.display = "inline-flex";

    updateCameraStatus(
      '✓ Photo captured! Review and click "Use Photo" to proceed.',
      "success"
    );
  } catch (error) {
    console.error("Capture error:", error);
    updateCameraStatus(
      "❌ Failed to capture photo. Please try again.",
      "error"
    );
  }
}

// ============================================
// STEP 5: RETAKE PHOTO
// ============================================

/**
 * Retake a photo by returning to live camera view
 */
function retakePhoto() {
  const video = document.getElementById("cameraStream");
  const canvas = document.getElementById("cameraPreview");
  const captureBtn = document.getElementById("captureBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const uploadBtn = document.getElementById("uploadCameraBtn");

  if (!video || !canvas) return;

  video.style.display = "block";
  canvas.style.display = "none";
  captureBtn.style.display = "inline-flex";
  retakeBtn.style.display = "none";
  uploadBtn.style.display = "none";

  capturedCanvas = null;
  capturedImageData = null;

  updateCameraStatus(
    `Camera ready. Tap Capture to take another photo.`,
    "success"
  );
}

// ============================================
// STEP 6: UPLOAD PHOTO TO FORM
// ============================================

/**
 * Upload captured photo to the image input field
 */
function uploadCameraPhoto() {
  if (!capturedImageData) {
    updateCameraStatus("❌ No photo captured. Please try again.", "error");
    return;
  }

  try {
    // Convert data URL to Blob
    const blobBin = atob(capturedImageData.split(",")[1]);
    const array = [];
    for (let i = 0; i < blobBin.length; i++) {
      array.push(blobBin.charCodeAt(i));
    }
    const blob = new Blob([new Uint8Array(array)], { type: "image/jpeg" });

    // Create a File object
    const file = new File([blob], `camera-photo-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });

    // Create a DataTransfer object and add the file
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Set the file to the input
    const fileInput = document.getElementById("image");
    if (fileInput) {
      fileInput.files = dataTransfer.files;

      // Trigger change event to update preview
      const event = new Event("change", { bubbles: true });
      fileInput.dispatchEvent(event);

      updateCameraStatus("✓ Photo uploaded to form successfully!", "success");

      // Close modal after brief delay
      setTimeout(() => {
        closeCameraModal();
      }, 800);
    } else {
      updateCameraStatus("❌ Form error. Please try again.", "error");
    }
  } catch (error) {
    console.error("Upload error:", error);
    updateCameraStatus("❌ Failed to upload photo. Please try again.", "error");
  }
}

// ============================================
// STEP 7: UTILITY FUNCTIONS
// ============================================

/**
 * Stop the current camera stream
 */
function stopCamera() {
  const video = document.getElementById("cameraStream");
  if (!video || !video.srcObject) return;

  const tracks = video.srcObject.getTracks();
  tracks.forEach((track) => track.stop());
  video.srcObject = null;
  cameraStream = null;
}

/**
 * Update camera status message
 */
function updateCameraStatus(message, type = "info") {
  const statusElement = document.getElementById("cameraStatus");
  if (!statusElement) return;

  statusElement.textContent = message;
  statusElement.className = `camera-status ${type}`;
}

/**
 * Handle camera errors with user-friendly messages
 */
function handleCameraError(error, statusElement) {
  let message = "Unable to access camera";

  if (error.name === "NotAllowedError") {
    message =
      "❌ Camera access denied. Please allow camera permissions in your browser settings.";
  } else if (error.name === "NotFoundError") {
    message = "❌ No camera found on this device.";
  } else if (error.name === "NotReadableError") {
    message =
      "❌ Camera is being used by another application. Please close it and try again.";
  } else if (error.name === "SecurityError") {
    message =
      "❌ Camera access is not allowed on insecure connections (HTTPS required).";
  } else if (error.name === "TypeError") {
    message = "❌ Camera API not supported in your browser.";
  }

  updateCameraStatus(message, "error");
}

/**
 * Reset camera UI to initial state
 */
function resetCameraUI() {
  const video = document.getElementById("cameraStream");
  const canvas = document.getElementById("cameraPreview");
  const captureBtn = document.getElementById("captureBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const uploadBtn = document.getElementById("uploadCameraBtn");
  const statusElement = document.getElementById("cameraStatus");

  if (video) video.style.display = "block";
  if (canvas) canvas.style.display = "none";
  if (captureBtn) captureBtn.style.display = "inline-flex";
  if (retakeBtn) retakeBtn.style.display = "none";
  if (uploadBtn) uploadBtn.style.display = "none";
  if (statusElement) {
    statusElement.textContent = "Initializing camera...";
    statusElement.className = "camera-status";
  }

  capturedCanvas = null;
  capturedImageData = null;
}

// ============================================
// STEP 8: EVENT LISTENERS
// ============================================

/**
 * Handle camera selection change
 */
document.addEventListener("DOMContentLoaded", () => {
  const cameraSelector = document.getElementById("cameraSelector");
  if (cameraSelector) {
    cameraSelector.addEventListener("change", switchCamera);
  }
});

/**
 * Close camera modal when clicking outside
 */
window.addEventListener("click", function (event) {
  const cameraModal = document.getElementById("cameraModal");
  if (event.target === cameraModal) {
    closeCameraModal();
  }
});

/**
 * Cleanup camera on page unload
 */
window.addEventListener("beforeunload", function () {
  stopCamera();
});

/**
 * Handle browser back button while camera is open
 */
window.addEventListener("popstate", function () {
  stopCamera();
});