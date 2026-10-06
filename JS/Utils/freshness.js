// Suppresses refetches of data this session already has and that nothing has
// invalidated.
//
// Every page's render function refetches unconditionally, because the router
// calls it on every nav click. Flicking between sidebar items therefore
// re-downloads the same rows repeatedly — the Employee Manager roster is ~220 KB
// a visit. That is the "uncached" complaint, and a timestamp per data set is
// enough to fix it: paint from the cache that is already in memory, and only go
// to the network once it is actually old.
//
// Keys are plain strings chosen by the caller. Include anything the response
// depends on, so changing it misses naturally rather than needing an explicit
// invalidate — e.g. 'attendance:2026-10-01..2026-10-06'.
//
// Not a cache. It stores no data, only when a key was last fetched; the page
// keeps its own rows. That separation is why this can stay pure and tested while
// the pages keep whatever shape they already had.
const fetchedAt = new Map();

export function isFresh(key, maxAgeMs, now = Date.now()) {
  const at = fetchedAt.get(key);
  if (at === undefined) return false;
  // A non-positive window means "always refetch", which is the safe reading of a
  // caller passing 0 — never "fresh forever".
  if (!(maxAgeMs > 0)) return false;
  // Guards a clock that moved backwards (NTP correction, a laptop resuming):
  // a future timestamp would otherwise read as fresh for as long as the skew.
  const age = now - at;
  return age >= 0 && age < maxAgeMs;
}

export function markFetched(key, now = Date.now()) {
  fetchedAt.set(key, now);
}

// Call after a mutation, so the next render refetches even within the window.
// Mutations are the one case a timestamp cannot detect on its own.
export function invalidate(key) {
  fetchedAt.delete(key);
}

export function invalidateAll() {
  fetchedAt.clear();
}
