import { supabase } from './Core/supabaseClient.js';
import { appState, isStandaloneScanner, isScannerOnlyAccount, loadProfile } from './Core/state.js';
import { showAuth, showShell, showStandaloneScanner } from './Core/screens.js';
import { initRouter } from './Core/router.js';
import { initAuthScreen } from './Features/Auth/AuthScreen.js';
import { toast } from './Utils/toast.js';

initAuthScreen();
initRouter();

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
  boot(session);
});

(async () => {
  const { data } = await supabase.auth.getSession();
  await boot(data.session);
})();
