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
// Single record, key 'photos': { byEmployeeId, fileIdsByEmployeeId, syncedAt }.
// Kept in its own store, refreshed on its own (much longer) interval —
// see Models/OfflineScanModel.js's refreshPhotoCache() and
// Supabase/README.md's change log entry on incremental photo updates.
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

// Depth at which the kiosk starts saying so. This is the useful half of
// bounding the queue: 500 unsent scans means this kiosk has been unable to
// reach the server for a long time, and somebody should know that long
// before anything is at risk. The ceiling below is a backstop, not a plan.
export const QUEUE_WARN_AT = 500;

// Hard ceiling. An entry is four short strings — call it ~120 bytes — so
// 10,000 of them is ~1.2 MB, which is small next to the photo cache that
// shares this origin's storage. That is the honest proportion: the queue is
// not what gets a kiosk evicted. What it was, before this, is unbounded,
// and "grows forever at a kiosk nobody checks" is the kind of thing that is
// cheap to bound now and expensive to discover later.
//
// WHY OLDEST-FIRST, given that dropping a scan loses attendance data. The
// alternative to dropping the oldest is refusing the newest, which means the
// person standing at the door right now does not get recorded — and at
// 10,000 deep the oldest entries are days old and already reconstructable
// from the archive, while the newest are the shift that is happening. Either
// way something is lost; this loses the less useful end, counts it, and
// tells the operator rather than discarding in silence.
export const QUEUE_MAX = 10000;

/**
 * Drop the oldest entries until at most `max` remain. Returns how many went.
 *
 * Cursor order is the autoIncrement key, which for this store is insertion
 * order, so walking forward from the start is oldest-first by construction —
 * no timestamp parsing, and no dependence on scanned_at being well-formed on
 * a row that may have been written by an older client.
 */
export async function idbTrimQueue(max = QUEUE_MAX) {
  const db = await openDB();
  const count = await run(db, STORE_QUEUE, 'readonly', (s) => s.count());
  const over = (count || 0) - Math.max(0, max);
  if (over <= 0) return 0;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const req = tx.objectStore(STORE_QUEUE).openCursor();
    let dropped = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || dropped >= over) return; // stop advancing; tx.oncomplete resolves
      cursor.delete();
      dropped += 1;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    // Resolve on the TRANSACTION, not on the last cursor step: the deletes
    // are only durable once the transaction commits.
    tx.oncomplete = () => resolve(dropped);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Append a scan, trimming first so the store can never exceed QUEUE_MAX.
 *
 * Resolves with `{ id, dropped }` rather than the bare id — a caller that
 * ignores `dropped` is choosing not to report data loss, and that should
 * look like a choice in the code rather than something the API hid.
 */
export async function idbEnqueue(entry) {
  const dropped = await idbTrimQueue(QUEUE_MAX - 1).catch(() => 0);
  const db = await openDB();
  const id = await run(db, STORE_QUEUE, 'readwrite', (s) => s.add(entry));
  return { id, dropped };
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