// system-camera.js - Camera Capture Functionality

let cameraStream = null;
let capturedCanvas = null;
let capturedImageData = null;

// Open camera modal
function openCameraModal() {
  const cameraModal = document.getElementById("cameraModal");
  if (!cameraModal) return;

  cameraModal.style.display = "block";
  initializeCamera();
}

// Close camera modal
function closeCameraModal() {
  const cameraModal = document.getElementById("cameraModal");
  if (!cameraModal) return;

  cameraModal.style.display = "none";
  stopCamera();
  resetCameraUI();
}

// Initialize camera access
async function initializeCamera() {
  const cameraStream = document.getElementById("cameraStream");
  const cameraStatus = document.getElementById("cameraStatus");
  const captureBtn = document.getElementById("captureBtn");

  if (!cameraStream || !cameraStatus) return;

  try {
    // Request camera access with specific constraints for better compatibility
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    cameraStream.srcObject = stream;
    cameraStream.onloadedmetadata = () => {
      cameraStream.play();
      updateCameraStatus("Camera ready. Tap Capture to take photo.", "success");
      captureBtn.disabled = false;
    };
  } catch (error) {
    console.error("Camera error:", error);
    handleCameraError(error, cameraStatus);
    captureBtn.disabled = true;
  }
}

// Handle camera errors with user-friendly messages
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

// Update camera status message
function updateCameraStatus(message, type = "info") {
  const statusElement = document.getElementById("cameraStatus");
  if (!statusElement) return;

  statusElement.textContent = message;
  statusElement.className = `camera-status ${type}`;
}

// Capture photo from video stream
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
        "error",
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
      "success",
    );
  } catch (error) {
    console.error("Capture error:", error);
    updateCameraStatus(
      "❌ Failed to capture photo. Please try again.",
      "error",
    );
  }
}

// Retake photo
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
    "Camera ready. Tap Capture to take another photo.",
    "success",
  );
}

// Upload captured photo to form
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

// Stop camera stream
function stopCamera() {
  const video = document.getElementById("cameraStream");
  if (!video || !video.srcObject) return;

  const tracks = video.srcObject.getTracks();
  tracks.forEach((track) => track.stop());
  video.srcObject = null;
}

// Reset camera UI to initial state
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

// Close camera modal when clicking outside
window.addEventListener("click", function (event) {
  const cameraModal = document.getElementById("cameraModal");
  if (event.target === cameraModal) {
    closeCameraModal();
  }
});

// Cleanup camera on page unload
window.addEventListener("beforeunload", function () {
  stopCamera();
});

// Handle browser back button while camera is open
window.addEventListener("popstate", function () {
  stopCamera();
});
