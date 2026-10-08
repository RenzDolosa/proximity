import { supabase } from './Core/supabaseClient.js';
import { appState, isStandaloneScanner, isScannerOnlyAccount, loadProfile } from './Core/state.js';
import { showAuth, showShell, showStandaloneScanner } from './Core/screens.js';
import { initRouter } from './Core/router.js';
import { initAuthScreen } from './Features/Auth/AuthScreen.js';
import { toast } from './Utils/toast.js';
import { initAppUpdates } from './Utils/appUpdate.js';

initAuthScreen();
initRouter();
// Kiosk tabs stay open for weeks; without this they keep running the JS they
// booted with. See JS/Utils/appUpdate.js.
initAppUpdates();

// Registered from the ABSOLUTE root path, not './sw.js': a Service Worker's scope
// is its own directory downwards, and index.html lives in Public/ while JS/ and
// CSS/ are its SIBLINGS — a worker registered from inside Public/ would never see
// fetches for the files that matter most. Hence sw.js at the repo root.
//
// Needs a secure context. localhost and 127.0.0.1 are exempt; a bare LAN IP
// (http://192.168.x.x:5500, what Live Server shows alongside localhost) is NOT,
// and silently fails. That cost real debugging time once, which is why the
// failure below is loud.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    // Offline support is resilience, not a requirement — degrade, don't break.
    // But never silently: a swallowed rejection here looks exactly like a
    // photo-caching bug from the console.
    console.warn(
      'Service Worker registration failed — offline mode (including cached employee photos) will not work on this page load. ' +
      'If you\'re on a LAN IP (not localhost/127.0.0.1) without HTTPS, that\'s expected: browsers only allow Service Workers on secure contexts. ' +
      'Open this page via http://localhost or http://127.0.0.1 instead, or serve over HTTPS.',
      err,
    );
  });
}

// Single source of truth for what should be on screen. The bootstrap below and
// onAuthStateChange used to decide independently and ran concurrently, so
// whichever loadProfile() resolved last won — a scanner-only account could land
// on the admin shell purely by timing.
async function boot(session) {
  appState.session = session;
  if (!session) {
    appState.profile = null;
    showAuth();
    return;
  }
  await loadProfile();
  // A valid JWT does not mean a valid account: deleting a user does not revoke
  // their already-issued token, it only removes their profiles row. Without this,
  // a deleted account that reloads lands on a permission-less shell instead of
  // being signed out.
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
  // INITIAL_SESSION fires as soon as this listener registers, racing the
  // getSession() below. Only one bootstrap should run, and that one owns it.
  if (event === 'INITIAL_SESSION') return;

  // TOKEN_REFRESHED and a same-user SIGNED_IN are both the SDK re-confirming a
  // session that never changed — supabase-js revalidates on visibility change, and
  // which of the two events it emits varies. Either one falling through to boot()
  // fully re-rendered the open page, which is what made every Alt-Tab back into
  // the app flash "Loading…" and refetch everything. Only a real transition (no
  // prior session, or a different user) is worth resetting the screen for.
  const sameUser = appState.session?.user?.id && appState.session.user.id === session?.user?.id;
  if (event === 'TOKEN_REFRESHED' || (event === 'SIGNED_IN' && sameUser)) {
    appState.session = session;
    return;
  }
  boot(session);
});

(async () => {
  const { data } = await supabase.auth.getSession();
  await boot(data.session);
})();
