// resource/js/portal.js --> portal iframe

// ── User dropdown ──
const userPill = document.getElementById("userPill");
const userDropdown = document.getElementById("userDropdown");
const userChevron = document.getElementById("userChevron");

function openDropdown() {
  userDropdown.classList.add("open");
  userChevron.classList.add("open");
  setOverlay(true);
}

function closeDropdown() {
  userDropdown.classList.remove("open");
  userChevron.classList.remove("open");
  if (!notifDropdown.classList.contains("open")) setOverlay(false);
}

userPill.addEventListener("mouseenter", openDropdown);
document
  .getElementById("userWrapper")
  .addEventListener("mouseleave", function () {
    setTimeout(function () {
      if (!document.getElementById("userWrapper").matches(":hover"))
        closeDropdown();
    }, 100);
  });

userPill.addEventListener("click", function (e) {
  e.stopPropagation();
  openDropdown();
});

document.addEventListener("click", closeDropdown);

// ── Notification bell ──
const iframeOverlay = document.getElementById("iframeOverlay");

function setOverlay(active) {
  iframeOverlay.style.display = active ? "block" : "none";
}

const notifWrapper = document.getElementById("notifWrapper");
const notifBtn = document.getElementById("notifBtn");
const notifDropdown = document.getElementById("notifDropdown");
const notifPip = document.getElementById("notifPip");
const ndBadge = document.getElementById("ndBadge");

const NOTIF_KEY = "notif_seen_v2313";

function openNotif() {
  notifDropdown.classList.add("open");
  setOverlay(true);
  if (typeof window.__ntfRender === "function") window.__ntfRender();
}

function closeNotif() {
  notifDropdown.classList.remove("open");
  if (!userDropdown.classList.contains("open")) setOverlay(false);
  if (typeof window.__ntfMarkSeen === "function") window.__ntfMarkSeen();
}

function markSeen() {
  try {
    localStorage.setItem(NOTIF_KEY, "1");
  } catch (e) {}
  notifPip.classList.remove("visible");
  notifBtn.classList.remove("has-new");
  if (ndBadge) ndBadge.style.display = "none";
}

try {
  if (localStorage.getItem(NOTIF_KEY) === "1") {
    notifPip.classList.remove("visible");
    notifBtn.classList.remove("has-new");
    if (ndBadge) ndBadge.style.display = "none";
  }
} catch (e) {}

notifBtn.addEventListener("click", function (e) {
  e.stopPropagation();
  const isOpen = notifDropdown.classList.contains("open");
  if (isOpen) {
    closeNotif();
  } else {
    openNotif();
    markSeen();
  }
});

iframeOverlay.addEventListener("click", function () {
  closeNotif();
  closeDropdown();
});

notifDropdown.addEventListener("click", function (e) {
  e.stopPropagation();
});

document.addEventListener("click", function (e) {
  if (!notifWrapper.contains(e.target)) closeNotif();
});

notifBtn.addEventListener("click", closeDropdown);
userPill.addEventListener("click", closeNotif);
