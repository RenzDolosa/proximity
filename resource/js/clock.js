// resource/js/clock.js

// ── Live clock ──────────────────────────────────────────────────────────────
function updateTime() {
  const now = new Date();
  document.getElementById("wb-time").textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  document.getElementById("wb-date").textContent = now.toLocaleDateString([], {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

updateTime();
setInterval(updateTime, 1000);
