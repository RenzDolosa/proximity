import { supabase } from './Core/supabaseClient.js';
import { appState, isStandaloneScanner, isScannerOnlyAccount, loadProfile } from './Core/state.js';
import { showAuth, showShell, showStandaloneScanner } from './Core/screens.js';
import { initRouter } from './Core/router.js';
import { initAuthScreen } from './Features/Auth/AuthScreen.js';
import { toast } from './Utils/toast.js';

initAuthScreen();
initRouter();

// Lets the app shell itself (not just scan handling — see
// Models/OfflineScanModel.js) load with no network at all. Registered
// unconditionally at boot rather than only for the standalone scanner
// route: both the kiosk and the admin shell share this one index.html, so
// there's no separate entry point to scope it to. Registered from the
// ABSOLUTE root path /sw.js (not a relative './sw.js') deliberately: a
// Service Worker's default scope is its own directory and everything
// below it, and this repo serves index.html from Public/ while JS/ and
// CSS/ are *siblings* of Public/, not children — a worker registered
// from inside Public/ could never see fetches for /JS/* or /CSS/* at
// all, which are exactly the files that matter most to cache. sw.js
// therefore lives at the repo root (see file tree in README.md), not
// inside Public/. Requires a secure context in production (HTTPS) —
// http://localhost and http://127.0.0.1 are exempt for local dev, but a
// bare LAN IP (http://10.x.x.x:5500, http://192.168.x.x:5500, the kind
// of URL Five Server/Live Server show you alongside localhost) is NOT
// exempt and silently fails registration, even on your own network. This
// bit real testing once already — see README.md's change log — because
// the failure used to be swallowed with zero console output, making
// "the whole offline photo cache doesn't work" look like a photo bug
// instead of a five-minute wrong-URL problem.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    // Offline-first is a resilience feature, not a hard requirement — a
    // registration failure (unsupported browser, non-secure-context
    // deployment) should degrade to "just doesn't survive an outage",
    // not break the rest of the app. But it should NEVER fail silently —
    // a swallowed rejection here previously looked identical, from the
    // console, to every actual photo-caching bug this session chased.
    console.warn(
      'Service Worker registration failed — offline mode (including cached employee photos) will not work on this page load. ' +
      'If you\'re on a LAN IP (not localhost/127.0.0.1) without HTTPS, that\'s expected: browsers only allow Service Workers on secure contexts. ' +
      'Open this page via http://localhost or http://127.0.0.1 instead, or serve over HTTPS.',
      err,
    );
  });
}

// Single source of truth for "what should be on screen right now", used by
// every real auth transition. Previously the initial getSession() bootstrap
// below always called showShell() unconditionally, while onAuthStateChange
// separately (and correctly) routed scanner-only accounts to the standalone
// scanner. Both ran concurrently on page load, so whichever loadProfile()
// resolved last decided the screen — a scanner-only account (like Renzio)
// could end up seeing the admin shell/Test Scan depending on timing.
// Routing every path through this one function removes that race.
async function boot(session) {
  appState.session = session;
  if (!session) {
    appState.profile = null;
    showAuth();
    return;
  }
  await loadProfile();
  // A still-valid JWT doesn't mean the account is still valid — deleting a
  // user (or a still-open tab) doesn't invalidate their already-issued
  // access token, it just deletes their profiles row (or flips is_active).
  // Without this check, a deleted/disabled account that refreshes the page
  // lands on a confusing, permission-less shell (every nav item hidden,
  // "Admins only." on whatever route it defaults to) instead of being
  // signed out. Catch that here, once, for every entry point.
  if (!appState.profile || appState.profile.is_active === false) {
    appState.profile = null;
    toast('This account is no longer available. Please contact an administrator.', 'error');
    await supabase.auth.signOut();
    return;
  }
  if (isStandaloneScanner || isScannerOnlyAccount()) showStandaloneScanner();
  else showShell();
}

supabase.auth.onAuthStateChange((event, session) => {
  // supabase-js emits INITIAL_SESSION as soon as this listener is
  // registered, racing the explicit getSession() call below. We only want
  // one bootstrap call, so the initial state is handled exclusively by that
  // getSession() call and this listener only reacts to real transitions
  // (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, ...).
  if (event === 'INITIAL_SESSION') return;
  if (event === 'TOKEN_REFRESHED') {
    // A silent background token renewal — supabase-js does this
    // automatically, including right after the tab regains focus, since
    // it checks the session on visibility change. Only the JWT string
    // changed, not who's signed in, so just keep it current for future API
    // calls. This used to fall through to the same boot() as a real
    // sign-in below, which re-fetched and fully re-rendered whatever page
    // was open — the "table is loading" flash on every Alt-Tab back into
    // the app.
    appState.session = session;
    return;
  }
  // SIGNED_IN can ALSO fire as that same focus-regain re-affirmation, not
  // just on an actual new sign-in — which is exactly the case
  // TOKEN_REFRESHED above was already filtering, just under a different
  // event name depending on which check supabase-js's visibility-driven
  // session validation happens to take. Left unguarded, this was the
  // remaining path to the same full re-render — Alt-Tab into the
  // standalone Scanner still reset Recent Activity to "Loading…" and
  // refetched everything from scratch, even with the TOKEN_REFRESHED fix
  // in place. A same-user SIGNED_IN is just the SDK re-confirming a
  // session that never actually changed, so treat it exactly like
  // TOKEN_REFRESHED: keep the session reference current, skip boot().
  // Only a REAL transition — no prior session, or a different user
  // entirely — is worth resetting the whole screen for.
  if (event === 'SIGNED_IN' && appState.session?.user?.id && appState.session.user.id === session?.user?.id) {
    appState.session = session;
    return;
  }
  boot(session);
});

(async () => {
  const { data } = await supabase.auth.getSession();
  await boot(data.session);
})();