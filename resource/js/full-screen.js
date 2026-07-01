// resource/js/full-screen.js --> web full-screen

// ─────────────────────────────────────────────────────────────────
//  FULLSCREEN BUTTON (tablet / mobile only)
// ─────────────────────────────────────────────────────────────────
function setupFullscreenButton() {
  const ua = navigator.userAgent;
  const isMobileUA =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(
      ua,
    );
  const isIpadOS = navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua);
  if (!isMobileUA && !isIpadOS) return;

  const fsBtn = document.createElement("button");
  fsBtn.id = "fullscreenBtn";
  fsBtn.setAttribute("aria-label", "Toggle fullscreen");
  fsBtn.innerHTML =
    '<span class="fs-icon fs-icon-expand">⛶</span><span class="fs-icon fs-icon-exit" style="display:none;">✕</span>';
  fsBtn.classList.add("fs-visible");
  document.body.appendChild(fsBtn);

  function updateIcon() {
    const isFs = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement
    );
    fsBtn.querySelector(".fs-icon-expand").style.display = isFs
      ? "none"
      : "inline";
    fsBtn.querySelector(".fs-icon-exit").style.display = isFs
      ? "inline"
      : "none";
    fsBtn.setAttribute(
      "aria-label",
      isFs ? "Exit fullscreen" : "Enter fullscreen",
    );
  }

  fsBtn.addEventListener("click", () => {
    const el = document.documentElement;
    const isFs = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement
    );

    if (!isFs) {
      const req =
        el.requestFullscreen ||
        el.webkitRequestFullscreen ||
        el.mozRequestFullScreen;
      if (req) req.call(el).catch(() => {});
    } else {
      const exit =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.mozCancelFullScreen;
      if (exit) exit.call(document).catch(() => {});
    }
  });

  document.addEventListener("fullscreenchange", updateIcon);
  document.addEventListener("webkitfullscreenchange", updateIcon);
  document.addEventListener("mozfullscreenchange", updateIcon);
}

// ─────────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async function () {
  const ready = await resolveEndpoints();
  if (!ready) return;

  setupFullscreenButton();
});
