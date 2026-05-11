// resource/js/notifications.js
// Real-time alert engine for the portal topbar notification bell.
// Polls app/services/notifications_backend.php on a configurable interval,
// renders live Late Check-In / Anomaly / Incident alerts into the dropdown,
// and manages the unread red pip independently of the "What's New" changelog.

;(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  const POLL_MS       = 30_000;   // poll every 30 s
  const MAX_DISPLAY   = 8;        // max alerts shown in the dropdown list
  const SEEN_KEY      = 'ntf_seen_ids_v1';  // localStorage key for seen alert ids
  const ENDPOINT      = 'app/services/notifications_backend.php';

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const notifBtn      = document.getElementById('notifBtn');
  const notifPip      = document.getElementById('notifPip');
  const notifDropdown = document.getElementById('notifDropdown');
  const ndBadge       = document.getElementById('ndBadge');

  if (!notifBtn || !notifDropdown) return; // guard — portal only

  // ── State ─────────────────────────────────────────────────────────────────
  let lastServerTime  = null;   // cursor for ?since= incremental fetch
  let liveAlerts      = [];     // current alert list
  let seenIds         = loadSeen();
  let pollTimer       = null;

  // ── Seen-set helpers (persisted in localStorage) ──────────────────────────
  function loadSeen () {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function saveSeen () {
    try {
      // only persist last 500 ids to cap storage growth
      const arr = [...seenIds].slice(-500);
      localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
    } catch {}
  }
  function markAllSeen () {
    liveAlerts.forEach(a => seenIds.add(a.id));
    saveSeen();
    updatePip();
  }

  // ── Pip / badge counter ───────────────────────────────────────────────────
  function updatePip () {
    const unseen = liveAlerts.filter(a => !seenIds.has(a.id)).length;

    // Live-alert pip is a separate element we inject so it doesn't clash with
    // the existing changelog pip (which has its own NOTIF_KEY logic).
    let livePip = document.getElementById('notifLivePip');
    if (!livePip) {
      livePip = document.createElement('span');
      livePip.id = 'notifLivePip';
      livePip.style.cssText =
        'position:absolute;top:5px;left:5px;width:8px;height:8px;' +
        'border-radius:50%;background:#ef4444;border:1.5px solid #fff;display:none;';
      notifBtn.style.position = 'relative';
      notifBtn.appendChild(livePip);
    }
    livePip.style.display = unseen > 0 ? 'block' : 'none';

    // Also update nd-badge if dropdown is open
    renderBadge(unseen);
  }

  function renderBadge (unseen) {
    const liveSection = document.getElementById('nd-live-badge');
    if (liveSection) {
      liveSection.textContent = unseen > 0 ? unseen + ' alert' + (unseen > 1 ? 's' : '') : '0 alerts';
      liveSection.style.display = 'inline-block';
    }
  }

  // ── Color/icon map ────────────────────────────────────────────────────────
  const COLOR_MAP = {
    red:    { dot: '#dc2626', tag: 'background:#fee2e2;color:#991b1b;border:1px solid #fecaca;' },
    amber:  { dot: '#d97706', tag: 'background:#fffbeb;color:#92400e;border:1px solid #fde68a;' },
    purple: { dot: '#7c3aed', tag: 'background:#faf5ff;color:#6d28d9;border:1px solid #e9d5ff;' },
    blue:   { dot: '#2563eb', tag: 'background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;' },
    green:  { dot: '#16a34a', tag: 'background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;' },
    gray:   { dot: '#94a3b8', tag: 'background:#f8fafc;color:#475569;border:1px solid #e2e8f0;' },
  };

  function escHtml (s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function buildAlertItem (alert) {
    const isNew   = !seenIds.has(alert.id);
    const cm      = COLOR_MAP[alert.color] || COLOR_MAP.gray;
    const itemDiv = document.createElement('div');
    itemDiv.className = 'nd-item' + (isNew ? ' nd-new' : '');
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
  // We prepend a "Live Alerts" section inside #ndScrollBody, above the
  // static changelog nd-items.  The scroll body is the flex-child that
  // scrolls; .nd-head and .nd-footer stay pinned as siblings.
  function ensureLiveSection () {
    let section = document.getElementById('nd-live-section');
    if (section) return section;

    // Target: the scrollable body introduced in portal.php
    const scrollBody = document.getElementById('ndScrollBody');
    const insertTarget = scrollBody || notifDropdown;

    section = document.createElement('div');
    section.id = 'nd-live-section';

    const sectionHead = document.createElement('div');
    sectionHead.id = 'nd-live-head';
    sectionHead.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:8px 14px;background:#f8fafc;border-bottom:1px solid var(--border,#e2e8f0);' +
      'position:sticky;top:0;z-index:1;';
    sectionHead.innerHTML = `
      <span style="font-size:11px;font-weight:600;color:var(--text-muted,#64748b);display:flex;align-items:center;gap:5px;">
        <i class="fas fa-satellite-dish" style="color:#2563eb;font-size:10px;"></i>
        LIVE ALERTS
        <span id="nd-live-badge" style="display:none;font-size:9.5px;font-weight:700;padding:1px 7px;border-radius:20px;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;">0</span>
      </span>
      <span id="nd-live-status" style="font-size:10px;color:#94a3b8;">connecting…</span>`;

    const itemsContainer = document.createElement('div');
    itemsContainer.id = 'nd-live-items';

    section.appendChild(sectionHead);
    section.appendChild(itemsContainer);

    // Prepend live section at the TOP of the scroll body
    insertTarget.prepend(section);

    // "What's New" divider below the live section
    const divider = document.createElement('div');
    divider.id = 'nd-live-divider';
    divider.style.cssText =
      'padding:6px 14px 4px;font-size:10px;font-weight:600;text-transform:uppercase;' +
      'letter-spacing:.06em;color:#94a3b8;background:#f8fafc;border-bottom:1px solid var(--border,#e2e8f0);';
    divider.textContent = "What's New";
    section.insertAdjacentElement('afterend', divider);

    return section;
  }

  function renderAlerts () {
    const section = ensureLiveSection();
    const container = document.getElementById('nd-live-items');
    if (!container) return;

    container.innerHTML = '';

    if (liveAlerts.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText =
        'padding:14px;text-align:center;font-size:12px;color:#94a3b8;';
      empty.innerHTML = '<i class="fas fa-check-circle" style="color:#16a34a;margin-right:5px;"></i>No alerts right now.';
      container.appendChild(empty);
      return;
    }

    const shown = liveAlerts.slice(0, MAX_DISPLAY);
    shown.forEach(alert => container.appendChild(buildAlertItem(alert)));

    if (liveAlerts.length > MAX_DISPLAY) {
      const more = document.createElement('div');
      more.style.cssText =
        'padding:8px 14px;font-size:11.5px;text-align:center;color:var(--accent,#2563eb);cursor:pointer;';
      more.innerHTML = `<i class="fas fa-plus-circle" style="font-size:10px;"></i> ${liveAlerts.length - MAX_DISPLAY} more alert(s)`;
      more.onclick = () => {
        if (typeof document.querySelector === 'function') {
          const frames = document.querySelector('.frames');
          if (frames) frames.src = 'resource/views/iframe/main.php?page=admin panel';
        }
        closeNotifDropdown();
      };
      container.appendChild(more);
    }
  }

  function setStatus (msg, isError) {
    const el = document.getElementById('nd-live-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#ef4444' : '#94a3b8';
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function fetchAlerts () {
    try {
      let url = ENDPOINT;
      if (lastServerTime) url += '?since=' + encodeURIComponent(lastServerTime);

      const resp = await fetch(url, { credentials: 'same-origin' });
      if (resp.status === 401) { clearInterval(pollTimer); return; }
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const data = await resp.json();
      if (!data.success) throw new Error(data.message || 'Backend error');

      if (data.server_time) lastServerTime = data.server_time;

      if (data.alerts && data.alerts.length > 0) {
        // Merge new alerts (de-dupe by id), keep newest first
        const existingIds = new Set(liveAlerts.map(a => a.id));
        const incoming    = data.alerts.filter(a => !existingIds.has(a.id));
        liveAlerts = [...incoming, ...liveAlerts].slice(0, 100);
        renderAlerts();
        updatePip();
      } else if (liveAlerts.length === 0) {
        renderAlerts(); // show empty state
      }

      setStatus('updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), false);
    } catch (err) {
      console.warn('[notifications]', err.message);
      setStatus('retry…', true);
    }
  }

  // ── Dropdown open/close hooks ─────────────────────────────────────────────
  // The bell toggle (open/close + markSeen) is handled by portal.php's inline
  // script.  notifications.js only needs to re-render when the dropdown opens.
  // We expose a hook the portal script calls after openNotif().
  function closeNotifDropdown () {
    if (notifDropdown) notifDropdown.classList.remove('open');
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  ensureLiveSection();
  fetchAlerts();                             // immediate first fetch
  pollTimer = setInterval(fetchAlerts, POLL_MS);

  // Expose hooks for portal.php's openNotif / closeNotif
  window.__ntfRender   = () => { ensureLiveSection(); renderAlerts(); updatePip(); };
  window.__ntfMarkSeen = markAllSeen;

  // Pause polling when tab is hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(pollTimer);
    } else {
      fetchAlerts();
      pollTimer = setInterval(fetchAlerts, POLL_MS);
    }
  });

})();
