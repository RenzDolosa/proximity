// resource/js/notifications.js

(function () {
  "use strict";

  // ── Config ────────────────────────────────────────────────────────────────
  const POLL_MS = 30_000;
  const MAX_DISPLAY = 8;
  const SEEN_KEY = "ntf_seen_ids_v2";

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const notifBtn = document.getElementById("notifBtn");
  const notifPip = document.getElementById("notifPip");
  const notifDropdown = document.getElementById("notifDropdown");
  const ndBadge = document.getElementById("ndBadge");

  if (!notifBtn || !notifDropdown) return;

  // ── State ─────────────────────────────────────────────────────────────────
  let lastServerTime = null;
  let liveAlerts = [];
  let seenIds = loadSeen();
  let pollTimer = null;

  // ── Seen-set helpers (persisted in localStorage) ──────────────────────────
  function loadSeen() {
    try {
      return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }
  function saveSeen() {
    try {
      const arr = [...seenIds].slice(-500);
      localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
    } catch {}
  }
  function markAllSeen() {
    liveAlerts.forEach((a) => seenIds.add(a.id));
    saveSeen();
    updatePip();
  }

  // ── Pip / badge counter ───────────────────────────────────────────────────
  function updatePip() {
    const unseen = liveAlerts.filter((a) => !seenIds.has(a.id)).length;

    let livePip = document.getElementById("notifLivePip");
    if (!livePip) {
      livePip = document.createElement("span");
      livePip.id = "notifLivePip";
      livePip.style.cssText =
        "position:absolute;top:5px;left:5px;width:8px;height:8px;" +
        "border-radius:50%;background:#ef4444;border:1.5px solid #fff;display:none;";
      notifBtn.style.position = "relative";
      notifBtn.appendChild(livePip);
    }
    livePip.style.display = unseen > 0 ? "block" : "none";

    renderBadge(unseen);
  }

  function renderBadge(unseen) {
    const liveSection = document.getElementById("nd-live-badge");
    if (liveSection) {
      liveSection.textContent =
        unseen > 0 ? unseen + " alert" + (unseen > 1 ? "s" : "") : "0 alerts";
      liveSection.style.display = "inline-block";
    }
  }

  // ── Color/icon map ────────────────────────────────────────────────────────
  const COLOR_MAP = {
    red: {
      dot: "#dc2626",
      tag: "background:#fee2e2;color:#991b1b;border:1px solid #fecaca;",
    },
    amber: {
      dot: "#d97706",
      tag: "background:#fffbeb;color:#92400e;border:1px solid #fde68a;",
    },
    purple: {
      dot: "#7c3aed",
      tag: "background:#faf5ff;color:#6d28d9;border:1px solid #e9d5ff;",
    },
    blue: {
      dot: "#2563eb",
      tag: "background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;",
    },
    green: {
      dot: "#16a34a",
      tag: "background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;",
    },
    gray: {
      dot: "#94a3b8",
      tag: "background:#f8fafc;color:#475569;border:1px solid #e2e8f0;",
    },
    indigo: {
      dot: "#4f46e5",
      tag: "background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;",
    },
  };

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildAlertItem(alert) {
    const isNew = !seenIds.has(alert.id);
    const cm = COLOR_MAP[alert.color] || COLOR_MAP.gray;
    const itemDiv = document.createElement("div");
    itemDiv.className = "nd-item" + (isNew ? " nd-new" : "");
    itemDiv.dataset.alertId = alert.id;
    itemDiv.innerHTML = `
      <div class="nd-dot" style="background:${cm.dot};width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:5px;"></div>
      <div class="nd-content" style="flex:1;min-width:0;">
        <div class="nd-row" style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap;">
          <span class="nd-tag" style="${cm.tag}font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:20px;text-transform:uppercase;letter-spacing:.05em;">
            <i class="fas ${escHtml(alert.icon)}" style="margin-right:3px;font-size:8px;"></i>${escHtml(alert.tag)}
          </span>
          <span class="nd-date" style="font-size:10.5px;color:var(--text-muted,#64748b);margin-left:auto;">${escHtml(alert.time)}</span>
        </div>
        <div class="nd-title-text" style="font-size:12px;font-weight:600;color:var(--text,#1e293b);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(alert.title)}</div>
        <div class="nd-desc" style="font-size:11.5px;color:var(--text-muted,#64748b);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escHtml(alert.desc)}</div>
      </div>`;
    return itemDiv;
  }

  // ── Section injection ─────────────────────────────────────────────────────
  function ensureLiveSection() {
    let section = document.getElementById("nd-live-section");
    if (section) return section;

    const scrollBody = document.getElementById("ndScrollBody");
    const insertTarget = scrollBody || notifDropdown;

    section = document.createElement("div");
    section.id = "nd-live-section";

    const sectionHead = document.createElement("div");
    sectionHead.id = "nd-live-head";
    sectionHead.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;" +
      "padding:8px 14px;background:#f8fafc;border-bottom:1px solid var(--border,#e2e8f0);" +
      "position:sticky;top:0;z-index:1;";
    sectionHead.innerHTML = `
      <span style="font-size:11px;font-weight:600;color:var(--text-muted,#64748b);display:flex;align-items:center;gap:5px;">
        <i class="fas fa-satellite-dish" style="color:#2563eb;font-size:10px;"></i>
        LIVE ALERTS
        <span id="nd-live-badge" style="display:none;font-size:9.5px;font-weight:700;padding:1px 7px;border-radius:20px;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;">0</span>
      </span>
      <span id="nd-live-status" style="font-size:10px;color:#94a3b8;">connecting…</span>`;

    const itemsContainer = document.createElement("div");
    itemsContainer.id = "nd-live-items";

    section.appendChild(sectionHead);
    section.appendChild(itemsContainer);

    insertTarget.prepend(section);

    const divider = document.createElement("div");
    divider.id = "nd-live-divider";
    divider.style.cssText =
      "padding:6px 14px 4px;font-size:10px;font-weight:600;text-transform:uppercase;" +
      "letter-spacing:.06em;color:#94a3b8;background:#f8fafc;border-bottom:1px solid var(--border,#e2e8f0);";
    divider.textContent = "";
    section.insertAdjacentElement("afterend", divider);

    return section;
  }

  function renderAlerts() {
    const section = ensureLiveSection();
    const container = document.getElementById("nd-live-items");
    if (!container) return;

    container.innerHTML = "";

    if (liveAlerts.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText =
        "padding:14px;text-align:center;font-size:12px;color:#94a3b8;";
      empty.innerHTML =
        '<i class="fas fa-check-circle" style="color:#16a34a;margin-right:5px;"></i>No alerts right now.';
      container.appendChild(empty);
      return;
    }

    const shown = liveAlerts.slice(0, MAX_DISPLAY);
    shown.forEach((alert) => container.appendChild(buildAlertItem(alert)));

    if (liveAlerts.length > MAX_DISPLAY) {
      const more = document.createElement("div");
      more.style.cssText =
        "padding:8px 14px;font-size:11.5px;text-align:center;color:var(--accent,#2563eb);cursor:pointer;";
      more.innerHTML = `<i class="fas fa-plus-circle" style="font-size:10px;"></i> ${liveAlerts.length - MAX_DISPLAY} more alert(s)`;
      more.onclick = () => {
        const token = window.__ROUTES?.["portal-adminPanel"];
        if (token) {
          fetch("/config/resolve.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          })
            .then((r) => {
              if (r.status === 403) {
                window.top.location.href = "/index.php";
                return null;
              }
              return r.json();
            })
            .then((data) => {
              if (data?.url) document.querySelector(".frames").src = data.url;
            });
        }
        closeNotifDropdown();
      };
      container.appendChild(more);
    }
  }

  function setStatus(msg, isError) {
    const el = document.getElementById("nd-live-status");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "#ef4444" : "#94a3b8";
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function fetchAlerts() {
    const backend = window.__NotificationBackend;
    if (!backend) return;

    try {
      let url = backend;
      if (lastServerTime) url += "?since=" + encodeURIComponent(lastServerTime);

      const resp = await fetch(url, { credentials: "same-origin" });
      if (resp.status === 401) {
        clearInterval(pollTimer);
        return;
      }
      if (!resp.ok) throw new Error("HTTP " + resp.status);

      const data = await resp.json();
      if (!data.success) throw new Error(data.message || "Backend error");

      if (data.server_time) lastServerTime = data.server_time;

      if (data.alerts && data.alerts.length > 0) {
        const existingIds = new Set(liveAlerts.map((a) => a.id));
        const incoming = data.alerts.filter((a) => !existingIds.has(a.id));
        liveAlerts = [...incoming, ...liveAlerts].slice(0, 100);
        renderAlerts();
        updatePip();
      } else if (liveAlerts.length === 0) {
        renderAlerts();
      }

      setStatus(
        "updated " +
          new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        false,
      );
    } catch (err) {
      console.warn("[notifications]", err.message);
      setStatus("retry…", true);
    }
  }

  // ── Dropdown open/close hooks ─────────────────────────────────────────────
  function closeNotifDropdown() {
    if (notifDropdown) notifDropdown.classList.remove("open");
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  ensureLiveSection();
  (async () => {
    await (window.__endpointsReady || Promise.resolve());
    fetchAlerts();
    pollTimer = setInterval(fetchAlerts, POLL_MS);
  })();

  window.__ntfRender = () => {
    ensureLiveSection();
    renderAlerts();
    updatePip();
  };
  window.__ntfMarkSeen = markAllSeen;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(pollTimer);
    } else {
      fetchAlerts();
      pollTimer = setInterval(fetchAlerts, POLL_MS);
    }
  });
})();
