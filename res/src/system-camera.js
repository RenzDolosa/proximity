// system-camera.js

"use strict";

let cameraStream = null;
let capturedImageData = null; // final (possibly cropped) JPEG data-URL
let rawCaptureDataUrl = null; // pre-crop data-URL kept for retake
let availableCameras = [];
let currentCameraId = null;
let currentCameraLabel = null;
let cropperInstance = null;

// ─────────────────────────────────────────────────────────────
// 1. DISCOVER CAMERAS
// ─────────────────────────────────────────────────────────────
async function discoverAvailableCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    availableCameras = devices
      .filter((d) => d.kind === "videoinput")
      .map((d, i) => ({
        id: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      }));
    return availableCameras;
  } catch (err) {
    console.error("Camera discovery error:", err);
    return [];
  }
}

function populateCameraSelector() {
  const sel = document.getElementById("cameraSelector");
  if (!sel) return;

  sel.innerHTML = "";

  if (!availableCameras.length) {
    sel.innerHTML = '<option value="">No cameras found</option>';
    sel.disabled = true;
    return;
  }

  availableCameras.forEach((cam) => {
    const opt = document.createElement("option");
    opt.value = cam.id;
    opt.textContent = cam.label;
    sel.appendChild(opt);
  });

  sel.value = availableCameras[0].id;
  currentCameraId = availableCameras[0].id;
  currentCameraLabel = availableCameras[0].label;
  sel.disabled = availableCameras.length <= 1;
}

// ─────────────────────────────────────────────────────────────
// 2. OPEN / CLOSE MODAL
// ─────────────────────────────────────────────────────────────
function openCameraModal() {
  const modal = document.getElementById("cameraModal");
  if (!modal) return;
  modal.style.display = "flex"; // flex → proper centering
  initializeCamera();
}

function closeCameraModal() {
  const modal = document.getElementById("cameraModal");
  if (!modal) return;
  modal.style.display = "none";
  stopCamera();
  destroyCropper();
  resetCameraUI();
}

// ─────────────────────────────────────────────────────────────
// 3. INITIALIZE CAMERA
// ─────────────────────────────────────────────────────────────
async function initializeCamera() {
  const video = document.getElementById("cameraStream");
  const captureBtn = document.getElementById("captureBtn");
  if (!video) return;

  updateCameraStatus("Requesting camera access…", "info");

  try {
    await discoverAvailableCameras();
    populateCameraSelector();

    if (!availableCameras.length) {
      handleCameraError({ name: "NotFoundError" });
      if (captureBtn) captureBtn.disabled = true;
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: currentCameraId ? { exact: currentCameraId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    cameraStream = stream;
    video.srcObject = stream;

    video.onloadedmetadata = () => {
      video.play();
      updateCameraStatus(
        `✓ ${currentCameraLabel} ready — tap Capture.`,
        "success",
      );
      if (captureBtn) captureBtn.disabled = false;
    };
  } catch (err) {
    console.error("Camera init error:", err);
    handleCameraError(err);
    if (captureBtn) captureBtn.disabled = true;
  }
}

// ─────────────────────────────────────────────────────────────
// 4. SWITCH CAMERA
// ─────────────────────────────────────────────────────────────
async function switchCamera() {
  const sel = document.getElementById("cameraSelector");
  const video = document.getElementById("cameraStream");
  if (!sel || !video) return;

  const id = sel.value;
  if (!id || id === currentCameraId) return;

  updateCameraStatus("Switching camera…", "info");
  stopCamera();
  destroyCropper();
  resetCaptureUI();

  currentCameraId = id;
  const cam = availableCameras.find((c) => c.id === id);
  currentCameraLabel = cam ? cam.label : "Camera";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: id },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    cameraStream = stream;
    video.srcObject = stream;

    video.onloadedmetadata = () => {
      video.play();
      updateCameraStatus(`✓ Switched to ${currentCameraLabel}.`, "success");
    };
  } catch (err) {
    console.error("Camera switch error:", err);
    updateCameraStatus(
      `❌ Failed to switch to ${currentCameraLabel}.`,
      "error",
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 5. CAPTURE  (BUG FIX: context.save() added before transform)
// ─────────────────────────────────────────────────────────────
function capturePhoto() {
  const video = document.getElementById("cameraStream");

  if (!video || !video.videoWidth) {
    updateCameraStatus("❌ Camera not ready — please wait.", "error");
    return;
  }

  // Offscreen canvas — never attached to DOM
  const offscreen = document.createElement("canvas");
  offscreen.width = video.videoWidth;
  offscreen.height = video.videoHeight;
  const ctx = offscreen.getContext("2d");

  // FIX: save() MUST precede translate+scale so restore() works correctly
  ctx.save();
  ctx.translate(offscreen.width, 0);
  ctx.scale(-1, 1); // un-mirror CSS scaleX(-1)
  ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
  ctx.restore();

  rawCaptureDataUrl = offscreen.toDataURL("image/jpeg", 0.95);
  showCropInterface(rawCaptureDataUrl);
}

// ─────────────────────────────────────────────────────────────
// 6. CROP INTERFACE  (Cropper.js)
// ─────────────────────────────────────────────────────────────
function showCropInterface(dataUrl) {
  const video = document.getElementById("cameraStream");
  const cropWrap = document.getElementById("cropContainer");
  const cropImg = document.getElementById("cropImage");
  const captureBtn = document.getElementById("captureBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const applyCropBtn = document.getElementById("applyCropBtn");
  const uploadBtn = document.getElementById("uploadCameraBtn");
  const previewCanvas = document.getElementById("cameraPreview");
  const cameraContainer = document.querySelector(".camera-container");
  if (cameraContainer) cameraContainer.style.display = "none";

  if (!cropWrap || !cropImg) {
    // Fallback if HTML not updated yet — skip crop step
    capturedImageData = dataUrl;
    finalizeCapture(dataUrl);
    return;
  }

  if (video) video.style.display = "none";
  if (previewCanvas) previewCanvas.style.display = "none";
  cropWrap.style.display = "flex";

  if (captureBtn) captureBtn.style.display = "none";
  if (retakeBtn) retakeBtn.style.display = "inline-flex";
  if (applyCropBtn) applyCropBtn.style.display = "inline-flex";
  if (uploadBtn) uploadBtn.style.display = "none";

  destroyCropper();
  cropImg.src = dataUrl;

  cropImg.onload = () => {
    if (typeof Cropper === "undefined") {
      // Cropper.js not loaded — skip crop, go straight to preview
      capturedImageData = dataUrl;
      if (applyCropBtn) applyCropBtn.style.display = "none";
      if (uploadBtn) uploadBtn.style.display = "inline-flex";
      updateCameraStatus(
        '✓ Photo captured! Click "Use Photo" to proceed.',
        "success",
      );
      return;
    }

    cropperInstance = new Cropper(cropImg, {
      aspectRatio: NaN,
      viewMode: 2,
      autoCropArea: 0.85,
      movable: true,
      zoomable: true,
      rotatable: false,
      scalable: false,
      responsive: true,
      restore: true,
      background: true,
      guides: true,
      center: true,
      highlight: true,
      cropBoxMovable: true,
      cropBoxResizable: true,
      minContainerWidth: 0,
      minContainerHeight: 0,
    });

    updateCameraStatus(
      '✂️  Drag to reposition · Resize handles to crop · Click "Apply Crop" when done.',
      "success",
    );
  };
}

function applyCrop() {
  if (!cropperInstance) {
    capturedImageData = rawCaptureDataUrl;
    finalizeCapture(capturedImageData);
    return;
  }

  const cropped = cropperInstance.getCroppedCanvas({
    maxWidth: 2048,
    maxHeight: 2048,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
  });

  if (!cropped) {
    updateCameraStatus("❌ Crop failed — try again.", "error");
    return;
  }

  capturedImageData = cropped.toDataURL("image/jpeg", 0.95);
  destroyCropper();
  finalizeCapture(capturedImageData);
}

function finalizeCapture(dataUrl) {
  const cropWrap = document.getElementById("cropContainer");
  const previewCanvas = document.getElementById("cameraPreview");
  const applyCropBtn = document.getElementById("applyCropBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const uploadBtn = document.getElementById("uploadCameraBtn");
  const cameraContainer = document.querySelector(".camera-container");
  if (cameraContainer) cameraContainer.style.display = "flex";

  if (cropWrap) cropWrap.style.display = "none";

  if (previewCanvas && dataUrl) {
    const img = new Image();
    img.onload = () => {
      previewCanvas.width = img.width;
      previewCanvas.height = img.height;
      previewCanvas.getContext("2d").drawImage(img, 0, 0);
    };
    img.src = dataUrl;
    previewCanvas.style.display = "block";
  }

  if (applyCropBtn) applyCropBtn.style.display = "none";
  if (retakeBtn) retakeBtn.style.display = "inline-flex";
  if (uploadBtn) uploadBtn.style.display = "inline-flex";

  updateCameraStatus(
    '✓ Crop applied! Review below, then click "Use Photo".',
    "success",
  );
}

// ─────────────────────────────────────────────────────────────
// 7. RETAKE
// ─────────────────────────────────────────────────────────────
function retakePhoto() {
  destroyCropper();

  const video = document.getElementById("cameraStream");
  const cropWrap = document.getElementById("cropContainer");
  const previewCanvas = document.getElementById("cameraPreview");
  const captureBtn = document.getElementById("captureBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const applyCropBtn = document.getElementById("applyCropBtn");
  const uploadBtn = document.getElementById("uploadCameraBtn");
  const cameraContainer = document.querySelector(".camera-container");
  if (cameraContainer) cameraContainer.style.display = "flex";

  if (video) {
    video.style.display = "block";
  }
  if (cropWrap) cropWrap.style.display = "none";
  if (previewCanvas) previewCanvas.style.display = "none";

  if (captureBtn) {
    captureBtn.style.display = "inline-flex";
    captureBtn.disabled = false;
  }
  if (retakeBtn) retakeBtn.style.display = "none";
  if (applyCropBtn) applyCropBtn.style.display = "none";
  if (uploadBtn) uploadBtn.style.display = "none";

  capturedImageData = null;
  rawCaptureDataUrl = null;

  updateCameraStatus("✓ Camera ready — tap Capture.", "success");
}

// ─────────────────────────────────────────────────────────────
// 8. UPLOAD TO FORM
// ─────────────────────────────────────────────────────────────
function uploadCameraPhoto() {
  if (!capturedImageData) {
    updateCameraStatus("❌ No photo captured. Please try again.", "error");
    return;
  }

  try {
    const byteStr = atob(capturedImageData.split(",")[1]);
    const arr = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);

    const blob = new Blob([arr], { type: "image/jpeg" });
    const file = new File([blob], `camera-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });

    const dt = new DataTransfer();
    dt.items.add(file);

    const fileInput = document.getElementById("image");
    if (!fileInput) {
      updateCameraStatus("❌ Form input not found.", "error");
      return;
    }

    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    updateCameraStatus("✓ Photo added to form!", "success");
    setTimeout(closeCameraModal, 700);
  } catch (err) {
    console.error("Upload error:", err);
    updateCameraStatus("❌ Upload failed — try again.", "error");
  }
}

// ─────────────────────────────────────────────────────────────
// 9. UTILITIES
// ─────────────────────────────────────────────────────────────
function destroyCropper() {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
}

function stopCamera() {
  const video = document.getElementById("cameraStream");
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  cameraStream = null;
}

function updateCameraStatus(msg, type = "info") {
  const el = document.getElementById("cameraStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = `camera-status ${type}`;
}

function handleCameraError(err) {
  const map = {
    NotAllowedError:
      "❌ Camera access denied. Allow permissions in your browser settings.",
    NotFoundError: "❌ No camera found on this device.",
    NotReadableError:
      "❌ Camera in use by another app — close it and try again.",
    SecurityError: "❌ Camera requires a secure connection (HTTPS).",
    TypeError: "❌ Camera API not supported in this browser.",
  };
  updateCameraStatus(map[err.name] || "❌ Camera unavailable.", "error");
}

function resetCaptureUI() {
  const video = document.getElementById("cameraStream");
  const cropWrap = document.getElementById("cropContainer");
  const previewCanvas = document.getElementById("cameraPreview");
  const captureBtn = document.getElementById("captureBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const applyCropBtn = document.getElementById("applyCropBtn");
  const uploadBtn = document.getElementById("uploadCameraBtn");
  const cameraContainer = document.querySelector(".camera-container");
  if (cameraContainer) cameraContainer.style.display = "flex";

  if (video) video.style.display = "block";
  if (cropWrap) cropWrap.style.display = "none";
  if (previewCanvas) previewCanvas.style.display = "none";
  if (captureBtn) captureBtn.style.display = "inline-flex";
  if (retakeBtn) retakeBtn.style.display = "none";
  if (applyCropBtn) applyCropBtn.style.display = "none";
  if (uploadBtn) uploadBtn.style.display = "none";

  capturedImageData = null;
  rawCaptureDataUrl = null;
}

function resetCameraUI() {
  destroyCropper();
  resetCaptureUI();
  updateCameraStatus("Initializing camera…", "");
}

// ─────────────────────────────────────────────────────────────
// 10. EVENT LISTENERS
// ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("cameraSelector");
  if (sel) sel.addEventListener("change", switchCamera);
});

window.addEventListener("click", (e) => {
  const modal = document.getElementById("cameraModal");
  if (e.target === modal) closeCameraModal();
});

window.addEventListener("beforeunload", stopCamera);
window.addEventListener("popstate", stopCamera);
