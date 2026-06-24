// resource/js/system-camera.js --> camera

"use strict";

let cameraStream = null;
let capturedImageData = null;
let rawCaptureDataUrl = null;
let availableCameras = [];
let currentCameraId = null;
let currentCameraLabel = null;
let cropperInstance = null;

// ─────────────────────────────────────────────────────────────
//  DISCOVER CAMERAS
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
//  OPEN / CLOSE MODAL
// ─────────────────────────────────────────────────────────────
function openCameraModal() {
  const modal = document.getElementById("cameraModal");
  if (!modal) return;

  if (typeof _teardownModalSuggestions === "function") {
    _teardownModalSuggestions();
  }

  modal.style.display = "flex";
  initializeCamera();
}

function closeCameraModal() {
  const modal = document.getElementById("cameraModal");
  if (!modal) return;
  modal.style.display = "none";
  stopCamera();
  destroyCropper();
  resetCameraUI();

  const employeeModal = document.getElementById("employeeModal");
  if (
    employeeModal &&
    employeeModal.style.display === "block" &&
    typeof setupModalSuggestions === "function"
  ) {
    setupModalSuggestions();
  }
}

// ─────────────────────────────────────────────────────────────
//  INITIALIZE CAMERA
// ─────────────────────────────────────────────────────────────
async function initializeCamera() {
  const video = document.getElementById("cameraStream");
  const captureBtn = document.getElementById("captureBtn");
  if (!video) return;

  if (!window.isSecureContext) {
    updateCameraStatus(
      "❌ Camera requires HTTPS. Ask your admin to enable SSL or access via localhost.",
      "error",
    );
    if (captureBtn) captureBtn.disabled = true;
    return;
  }

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
//  SWITCH CAMERA
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
//  CAPTURE
// ─────────────────────────────────────────────────────────────
function capturePhoto() {
  const video = document.getElementById("cameraStream");

  if (!video || !video.videoWidth) {
    updateCameraStatus("❌ Camera not ready — please wait.", "error");
    return;
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = video.videoWidth;
  offscreen.height = video.videoHeight;
  const ctx = offscreen.getContext("2d");

  ctx.save();
  ctx.translate(offscreen.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
  ctx.restore();

  rawCaptureDataUrl = offscreen.toDataURL("image/jpeg", 0.95);
  showCropInterface(rawCaptureDataUrl);
}

// ─────────────────────────────────────────────────────────────
//  CROP INTERFACE
// ─────────────────────────────────────────────────────────────
const ASPECT_RATIO_PRESETS = [
  { label: "Free", value: NaN },
  { label: "1:1", value: 1 / 1 },
];

let currentAspectRatio = NaN;

function injectAspectRatioToolbar(cropWrap) {
  const existing = document.querySelector(".aspect-ratio-toolbar");
  if (existing) existing.remove();

  const toolbar = document.createElement("div");
  toolbar.className = "aspect-ratio-toolbar";
  toolbar.style.cssText = [
    "display:flex",
    "flex-wrap:wrap",
    "gap:6px",
    "padding:8px 10px",
    "align-items:center",
    "flex-shrink:0",
  ].join(";");

  const lbl = document.createElement("span");
  lbl.textContent = "Aspect Ratio:";
  lbl.style.cssText =
    "font-size:11px;font-weight:700;letter-spacing:.4px;" +
    "margin-right:2px;white-space:nowrap;text-transform:uppercase;";
  toolbar.appendChild(lbl);

  ASPECT_RATIO_PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = preset.label;
    btn.dataset.ratio = isNaN(preset.value) ? "free" : String(preset.value);

    btn.style.cssText = [
      "padding:4px 10px",
      "font-size:11px",
      "font-weight:600",
      "border-radius:5px",
      "border:1px solid rgba(0,0,0,0.18)",
      "background:rgba(0,0,0,0.06)",
      "color:#444",
      "cursor:pointer",
      "transition:background .15s,border-color .15s,color .15s",
      "white-space:nowrap",
      "line-height:1.4",
    ].join(";");

    btn.addEventListener("mouseenter", () => {
      if (!btn.classList.contains("ar-active")) {
        btn.style.background = "rgba(0,0,0,0.12)";
        btn.style.borderColor = "rgba(0,0,0,0.3)";
      }
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.classList.contains("ar-active")) {
        btn.style.background = "rgba(0,0,0,0.06)";
        btn.style.borderColor = "rgba(0,0,0,0.18)";
      }
    });

    btn.addEventListener("click", () => setAspectRatio(preset.value, toolbar));
    toolbar.appendChild(btn);
  });

  const controls = document.querySelector(".camera-controls");
  if (controls) {
    controls.insertAdjacentElement("afterend", toolbar);
  } else {
    cropWrap.insertAdjacentElement("afterend", toolbar);
  }

  _highlightRatioBtn(toolbar, NaN);
}

/**
 * Apply a new aspect ratio to the live Cropper instance and update the UI.
 * @param {number} ratioValue  Numeric ratio (NaN = free crop).
 * @param {HTMLElement|null} toolbar  Optional direct reference; falls back to DOM query.
 */
function setAspectRatio(ratioValue, toolbar) {
  currentAspectRatio = ratioValue;

  if (cropperInstance) {
    cropperInstance.setAspectRatio(isNaN(ratioValue) ? NaN : ratioValue);
  }

  const tb = toolbar || document.querySelector(".aspect-ratio-toolbar");
  if (tb) _highlightRatioBtn(tb, ratioValue);

  const preset = ASPECT_RATIO_PRESETS.find(
    (p) => (isNaN(p.value) && isNaN(ratioValue)) || p.value === ratioValue,
  );
  const name = preset ? preset.label : "Custom";

  updateCameraStatus(
    isNaN(ratioValue)
      ? "✂️  Free crop — drag handles to any shape."
      : `🔒 Locked to ${name} — resize handles to adjust crop area.`,
    "success",
  );
}

function _highlightRatioBtn(toolbar, ratioValue) {
  toolbar.querySelectorAll("button").forEach((btn) => {
    const isActive =
      (btn.dataset.ratio === "free" && isNaN(ratioValue)) ||
      btn.dataset.ratio === String(ratioValue);

    btn.classList.toggle("ar-active", isActive);

    if (isActive) {
      btn.style.background = "rgba(56,161,255,0.42)";
      btn.style.borderColor = "rgba(56,161,255,0.95)";
      btn.style.color = "#fff";
    } else {
      btn.style.background = "rgba(255,255,255,0.07)";
      btn.style.borderColor = "rgba(255,255,255,0.28)";
      btn.style.color = "#ddd";
    }
  });
}

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
  currentAspectRatio = NaN;
  injectAspectRatioToolbar(cropWrap);

  cropImg.src = dataUrl;

  cropImg.onload = () => {
    if (typeof Cropper === "undefined") {
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
      '✂️  Drag to reposition · Resize handles to crop · "Apply Crop" when done.',
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
  const existingToolbar = document.querySelector(".aspect-ratio-toolbar");
  if (existingToolbar) existingToolbar.remove();

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
//  RETAKE
// ─────────────────────────────────────────────────────────────
function retakePhoto() {
  destroyCropper();

  const existingToolbar = document.querySelector(".aspect-ratio-toolbar");
  if (existingToolbar) existingToolbar.remove();

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
  currentAspectRatio = NaN;

  updateCameraStatus("✓ Camera ready — tap Capture.", "success");
}

// ─────────────────────────────────────────────────────────────
//  UPLOAD TO FORM  (converts captured JPEG → WebP via Canvas)
// ─────────────────────────────────────────────────────────────
function uploadCameraPhoto() {
  if (!capturedImageData) {
    updateCameraStatus("❌ No photo captured. Please try again.", "error");
    return;
  }

  updateCameraStatus("🔄 Converting to WebP…", "info");

  try {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            fallbackJpegUpload();
            return;
          }

          const webpFile = new File([blob], `camera-${Date.now()}.webp`, {
            type: "image/webp",
          });

          const dt = new DataTransfer();
          dt.items.add(webpFile);

          const fileInput = document.getElementById("image");
          if (!fileInput) {
            updateCameraStatus("❌ Form input not found.", "error");
            return;
          }

          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event("change", { bubbles: true }));

          updateCameraStatus(
            `✓ Converted to WebP (${(webpFile.size / 1024).toFixed(0)} KB) — added to form!`,
            "success",
          );
          setTimeout(closeCameraModal, 800);
        },
        "image/webp",
        0.85,
      );
    };

    img.onerror = () => {
      fallbackJpegUpload();
    };

    img.src = capturedImageData;
  } catch (err) {
    console.error("Camera upload error:", err);
    fallbackJpegUpload();
  }
}

function fallbackJpegUpload() {
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

    updateCameraStatus("✓ Photo added (JPEG fallback).", "success");
    setTimeout(closeCameraModal, 800);
  } catch (err) {
    console.error("Fallback JPEG upload error:", err);
    updateCameraStatus("❌ Upload failed — try again.", "error");
  }
}

// ─────────────────────────────────────────────────────────────
//  UTILITIES
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
  currentAspectRatio = NaN;
}

function resetCameraUI() {
  destroyCropper();
  resetCaptureUI();
  updateCameraStatus("Initializing camera…", "");
}

// ─────────────────────────────────────────────────────────────
//  EVENT LISTENERS
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
