// resource/js/sync.js — Offline scan queue manager
// Loaded by qr proximity.php and manual input.php (after req.js)
//
// Responsibilities:
//   1. Register sw.js on page load
//   2. Listen for online/offline events and show a status banner
//   3. Drain the IndexedDB queue via sync_queue.php when connectivity returns
//   4. Listen for SCAN_QUEUED messages from the service worker
//      and update the offline banner badge count

(function () {
  "use strict";

  let SYNC_URL = null;

  async function resolveSyncUrl() {
    const token = window.__SYNC_ROUTES?.["sync-queue"];
    if (!token) return false;
    const res = await fetch(RESOLVE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.status === 403) {
      window.top.location.href = ROUTE_LOGIN;
      return false;
    }
    const data = await res.json();
    SYNC_URL = data.url;
    return true;
  }

  const SW_PATH = "/sw.js";
  const DB_NAME = "scan_queue_db";
  const DB_VERSION = 1;
  const STORE_NAME = "pending_scans";
  const MAX_ATTEMPTS = 5;

  // ── Offline banner ──────────────────────────────────────────────────────────
  let bannerEl = null;
  let badgeEl = null;
  let syncingEl = null;

  function createBanner() {
    if (bannerEl) return;

    const style = document.createElement("style");
    style.textContent = `
      #__offline_banner__ {
        position: fixed; top: 0; left: 0; width: 100%; z-index: 999998;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; font-weight: 500;
        padding: 10px 16px;
        display: flex; align-items: center; gap: 10px;
        transition: transform .3s ease, opacity .3s ease;
      }
      #__offline_banner__.offline {
        background: #dc2626; color: #fff;
      }
      #__offline_banner__.online {
        background: #16a34a; color: #fff;
      }
      #__offline_banner__.hidden {
        transform: translateY(-110%); opacity: 0; pointer-events: none;
      }
      #__offline_banner__ .ob-badge {
        background: rgba(255,255,255,.25); color: #fff;
        font-size: 11px; font-weight: 700;
        padding: 1px 8px; border-radius: 20px;
      }
      #__offline_banner__ .ob-spin {
        width: 14px; height: 14px;
        border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
        border-radius: 50%; animation: __ob_spin__ .7s linear infinite;
      }
      @keyframes __ob_spin__ { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

    bannerEl = document.createElement("div");
    bannerEl.id = "__offline_banner__";
    bannerEl.className = "hidden";

    const icon = document.createElement("span");
    icon.textContent = "📡";

    const text = document.createElement("span");
    text.id = "__ob_text__";

    badgeEl = document.createElement("span");
    badgeEl.className = "ob-badge";
    badgeEl.style.display = "none";

    syncingEl = document.createElement("span");
    syncingEl.className = "ob-spin";
    syncingEl.style.display = "none";

    bannerEl.appendChild(icon);
    bannerEl.appendChild(text);
    bannerEl.appendChild(badgeEl);
    bannerEl.appendChild(syncingEl);
    document.body.appendChild(bannerEl);
  }

  function showBanner(type, message, pendingCount) {
    createBanner();
    const text = document.getElementById("__ob_text__");
    bannerEl.className = type;
    if (text) text.textContent = message;

    if (pendingCount > 0) {
      badgeEl.textContent = pendingCount + " pending";
      badgeEl.style.display = "";
    } else {
      badgeEl.style.display = "none";
    }
    syncingEl.style.display = "none";
  }

  function showSyncing() {
    createBanner();
    const text = document.getElementById("__ob_text__");
    bannerEl.className = "online";
    if (text) text.textContent = "Syncing offline scans…";
    syncingEl.style.display = "";
    badgeEl.style.display = "none";
  }

  function hideBanner(delay = 3000) {
    setTimeout(() => {
      if (bannerEl) bannerEl.className = "hidden";
    }, delay);
  }

  // ── IndexedDB helpers ───────────────────────────────────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("queued_at", "queued_at", { unique: false });
          store.createIndex("endpoint", "endpoint", { unique: false });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function getAllPending(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function deleteRecord(db, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function updateAttempts(db, id, attempts) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) {
          resolve();
          return;
        }
        record.attempts = attempts;
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  }

  async function getPendingCount() {
    try {
      const db = await openDB();
      const records = await getAllPending(db);
      return records.length;
    } catch {
      return 0;
    }
  }

  // ── Sync drain ──────────────────────────────────────────────────────────────
  // Groups pending scans by endpoint and sends them in a single bulk request
  // to sync_queue.php, which reuses the existing EmployeeLogManager logic.
  let isSyncing = false;

  async function drainQueue() {
    if (isSyncing) return;
    if (!SYNC_URL) {
      const ok = await resolveSyncUrl();
      if (!ok) return;
    }
    
    isSyncing = true;

    try {
      const db = await openDB();
      const records = await getAllPending(db);
      if (records.length === 0) {
        isSyncing = false;
        return;
      }

      showSyncing();

      // Sort by queued_at to preserve chronological order
      records.sort((a, b) => a.queued_at - b.queued_at);

      const scans = records.map((r) => ({
        _queue_id: r.id,
        _endpoint: r.endpoint,
        _queued_at: r.queued_at,
        ...r.payload,
      }));

      let response;
      try {
        response = await fetch(SYNC_URL, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ scans }),
        });
      } catch (networkError) {
        // Still offline — bail out silently
        isSyncing = false;
        return;
      }

      if (!response.ok && response.status !== 207) {
        // Server error — leave queue intact, try again next time online
        isSyncing = false;
        showBanner("offline", "Sync failed — will retry.", records.length);
        hideBanner(4000);
        return;
      }

      const result = await response.json();

      // result.results is an array indexed by position in scans[]
      // Each entry: { queue_id, success, message }
      const synced = [];
      const failed = [];

      if (Array.isArray(result.results)) {
        result.results.forEach((r) => {
          if (r.success) {
            synced.push(r.queue_id);
          } else {
            failed.push(r.queue_id);
          }
        });
      } else {
        // Bulk success fallback
        records.forEach((r) => synced.push(r.id));
      }

      // Remove synced records
      for (const id of synced) {
        await deleteRecord(db, id);
      }

      // Increment attempt counter for failed records
      for (const id of failed) {
        const rec = records.find((r) => r.id === id);
        if (rec) {
          const newAttempts = (rec.attempts || 0) + 1;
          if (newAttempts >= MAX_ATTEMPTS) {
            // Permanently discard after MAX_ATTEMPTS
            await deleteRecord(db, id);
          } else {
            await updateAttempts(db, id, newAttempts);
          }
        }
      }

      const remaining = await getPendingCount();
      if (remaining === 0) {
        showBanner("online", "All offline scans synced ✓", 0);
        hideBanner(3000);
      } else {
        showBanner("online", "Partially synced.", remaining);
        hideBanner(4000);
      }
    } catch (err) {
      console.error("[sync.js] drainQueue error:", err);
    } finally {
      isSyncing = false;
    }
  }

  // ── Online / offline events ─────────────────────────────────────────────────
  async function handleOnline() {
    const count = await getPendingCount();
    if (count > 0) {
      drainQueue();
    } else {
      showBanner("online", "Connection restored.", 0);
      hideBanner(2500);
    }
  }

  function handleOffline() {
    getPendingCount().then((count) => {
      showBanner(
        "offline",
        "No connection — scans will be saved offline.",
        count,
      );
    });
  }

  // ── Service worker messages ─────────────────────────────────────────────────
  function handleSWMessage(event) {
    if (!event.data) return;
    if (event.data.type === "SCAN_QUEUED") {
      getPendingCount().then((count) => {
        showBanner("offline", "No connection — scans saved offline.", count);
      });
    }
  }

  // ── Service worker registration ─────────────────────────────────────────────
  async function registerSW() {
    if (!("serviceWorker" in navigator)) {
      console.warn("[sync.js] Service workers not supported in this browser.");
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register(SW_PATH, {
        scope: "/",
      });

      navigator.serviceWorker.addEventListener("message", handleSWMessage);

      // If there are queued scans from a previous offline session, drain now
      if (navigator.onLine) {
        const count = await getPendingCount();
        if (count > 0) {
          showBanner("online", "Reconnected — syncing saved scans…", count);
          drainQueue();
        }
      }

      console.log("[sync.js] Service worker registered:", reg.scope);
    } catch (err) {
      console.error("[sync.js] Service worker registration failed:", err);
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", registerSW);
  } else {
    registerSW();
  }

  // Expose drainQueue globally so you can call it manually from the console
  window.__syncQueue = drainQueue;
})();
