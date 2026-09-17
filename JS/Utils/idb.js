// Minimal Promise wrapper around IndexedDB — just the handful of
// operations the offline scanner needs (see Models/OfflineScanModel.js).
// Deliberately hand-rolled rather than pulling in a real idb library:
// this would be the first external runtime dependency in a repo that's
// stayed plain ES modules on purpose (see README.md's "No build step").
const DB_NAME = 'proximity-offline';
const DB_VERSION = 1;
const STORE_CACHE = 'lookupCache'; // single record, key 'lookup': { rows, syncedAt }
const STORE_QUEUE = 'scanQueue'; // one record per queued offline scan attempt

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
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