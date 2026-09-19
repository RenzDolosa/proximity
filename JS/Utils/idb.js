// Minimal Promise wrapper around IndexedDB — just the handful of
// operations the offline scanner needs (see Models/OfflineScanModel.js).
// Deliberately hand-rolled rather than pulling in a real idb library:
// this would be the first external runtime dependency in a repo that's
// stayed plain ES modules on purpose (see README.md's "No build step").
const DB_NAME = 'proximity-offline';
// v2 added photoCache (see idbGetPhotoCache/idbSetPhotoCache below) — the
// lookup cache and queue stores from v1 are untouched, so this is a pure
// additive upgrade; onupgradeneeded's "if not already there" guards
// already handle it with no explicit migration step needed.
const DB_VERSION = 2;
const STORE_CACHE = 'lookupCache'; // single record, key 'lookup': { rows, syncedAt }
const STORE_QUEUE = 'scanQueue'; // one record per queued offline scan attempt
// Single record, key 'photos': { byEmployeeId: { [employee_id]: photo_thumb_b64 }, syncedAt }.
// Kept in its own store, refreshed on its own (much longer) interval —
// see Models/OfflineScanModel.js's refreshPhotoCache() and
// Supabase/README.md's change log entry on splitting
// get_scanner_offline_cache() from get_scanner_offline_photos().
const STORE_PHOTOS = 'photoCache';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const store = db.transaction(storeName, mode).objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetCache() {
  const db = await openDB();
  const result = await run(db, STORE_CACHE, 'readonly', (s) => s.get('lookup'));
  return result || null;
}

export async function idbSetCache(value) {
  const db = await openDB();
  await run(db, STORE_CACHE, 'readwrite', (s) => s.put(value, 'lookup'));
}

export async function idbEnqueue(entry) {
  const db = await openDB();
  return run(db, STORE_QUEUE, 'readwrite', (s) => s.add(entry)); // resolves with the new auto id
}

export async function idbGetQueue() {
  const db = await openDB();
  const result = await run(db, STORE_QUEUE, 'readonly', (s) => s.getAll());
  return result || [];
}

export async function idbRemoveFromQueue(id) {
  const db = await openDB();
  await run(db, STORE_QUEUE, 'readwrite', (s) => s.delete(id));
}

export async function idbCountQueue() {
  const db = await openDB();
  const result = await run(db, STORE_QUEUE, 'readonly', (s) => s.count());
  return result || 0;
}

export async function idbGetPhotoCache() {
  const db = await openDB();
  const result = await run(db, STORE_PHOTOS, 'readonly', (s) => s.get('photos'));
  return result || null;
}

export async function idbSetPhotoCache(value) {
  const db = await openDB();
  await run(db, STORE_PHOTOS, 'readwrite', (s) => s.put(value, 'photos'));
}