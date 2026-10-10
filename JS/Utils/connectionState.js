// What the kiosk's connectivity pill should say.
//
// It used to read `navigator.onLine` alone, which answers a narrower question
// than anyone assumes: "does this device have a network interface?" — not
// "can it reach the server?". A captive portal, a dead backend, expired DNS
// or a Supabase outage all leave it `true`. So the pill read **Online** while
// scans were falling into the offline queue beside it, which is the one
// moment it needed to be right.
//
// The scanner already knows better: doScan() catches the timeout/network
// failure and queues the scan. That knowledge is now the input here.
//
// `syncing` is its own state rather than a flavour of online: scans exist
// that the server has not acknowledged, and someone walking away at that
// moment should see that there is still work in flight.
export function connectionState({ online = true, queued = 0, lastRequestFailed = false } = {}) {
  if (!online || lastRequestFailed) return 'offline';
  if (queued > 0) return 'syncing';
  return 'online';
}

export const CONNECTION_LABEL = Object.freeze({
  online: '● Online',
  syncing: '◍ Syncing',
  offline: '◌ Offline',
});

// Reuses the existing badge palette: green / amber / grey-red.
export const CONNECTION_BADGE = Object.freeze({
  online: 'active',
  syncing: 'unassigned_card',
  offline: 'suspended',
});
