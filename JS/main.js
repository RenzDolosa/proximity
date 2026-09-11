import { supabase } from './Core/supabaseClient.js';
import { appState, isStandaloneScanner, isScannerOnlyAccount, loadProfile } from './Core/state.js';
import { showAuth, showShell, showStandaloneScanner } from './Core/screens.js';
import { initRouter } from './Core/router.js';
import { initAuthScreen } from './Features/Auth/AuthScreen.js';

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
