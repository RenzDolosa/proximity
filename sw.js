// sw.js — Offline scan queue service worker
// Place this file at: /sw.js  (web root, same level as portal.php)
//
// Intercepts POST requests to:
//   /app/services/qr_search_backend.php  (NFC card scans via qr proximity.php)
//   /app/http/middleware/add_to_log.php  (manual input IN/OUT buttons)
//
// When offline: saves payload to IndexedDB and returns a fake success
//   so the UI doesn't break mid-scan.
// When back online: sync.js drains the queue via /app/http/middleware/sync_queue.php

const SW_VERSION = "v1";
const DB_NAME = "scan_queue_db";
const DB_VERSION = 1;
const STORE_NAME = "pending_scans";

// ── Endpoints to intercept ────────────────────────────────────────────────────
const SCAN_ENDPOINTS = [
  "/app/services/qr_search_backend.php",
  "/app/http/middleware/add_to_log.php",
];

// ── Install & activate ────────────────────────────────────────────────────────
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

// ── IndexedDB helper (service workers can't use async/await on IDBOpenDBRequest
//   directly in all browsers, so we wrap in Promises) ─────────────────────────
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

function dbAdd(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ── Determine if a request is one we should intercept ────────────────────────
function isScanRequest(request) {
  if (request.method !== "POST") return false;
  const url = new URL(request.url);
  return SCAN_ENDPOINTS.some((ep) => url.pathname === ep);
}

// ── Fetch interceptor ─────────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  if (!isScanRequest(e.request)) return;

  e.respondWith(handleScanRequest(e.request.clone()));
});

async function handleScanRequest(request) {
  // ── Try the network first ─────────────────────────────────────────────────
  try {
    const response = await fetch(request.clone());

    // Network succeeded — pass through normally
    return response;
  } catch (networkError) {
    // ── Network failed (server unreachable) — queue the scan ─────────────────
    try {
      const body = await request.text();
      const url = new URL(request.url);
      const endpoint = url.pathname;

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        // Form-encoded fallback (shouldn't happen for these endpoints, but safe)
        payload = Object.fromEntries(new URLSearchParams(body));
      }

      const db = await openDB();
      await dbAdd(db, {
        endpoint: endpoint,
        payload: payload,
        queued_at: Date.now(),
        attempts: 0,
      });

      // Notify all open tabs that the queue has new items
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((client) => {
        client.postMessage({
          type: "SCAN_QUEUED",
          endpoint,
          queued_at: Date.now(),
        });
      });

      // Return a synthetic success so the UI doesn't break
      // The scan will be committed to MySQL when connectivity returns
      return new Response(
        JSON.stringify({
          success: true,
          offline: true,
          message: "Scan saved offline. Will sync when connection is restored.",
          data: { queued: true },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (queueError) {
      // Even the queue failed — return a real error
      return new Response(
        JSON.stringify({
          success: false,
          offline: true,
          message: "Server unreachable and offline queue unavailable.",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }
}
