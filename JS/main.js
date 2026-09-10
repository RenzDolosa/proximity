import { supabase } from './Core/supabaseClient.js';
import { appState, isStandaloneScanner, isScannerOnlyAccount, loadProfile } from './Core/state.js';
import { showAuth, showShell, showStandaloneScanner } from './Core/screens.js';
import { initRouter } from './Core/router.js';
import { initAuthScreen } from './Features/Auth/AuthScreen.js';

initAuthScreen();
initRouter();

supabase.auth.onAuthStateChange(async (_event, s) => {
  appState.session = s;
  if (appState.session) {
    await loadProfile();
    if (isStandaloneScanner || isScannerOnlyAccount()) showStandaloneScanner(); else showShell();
  } else {
    appState.profile = null;
    showAuth();
  }
});

(async () => {
  const { data } = await supabase.auth.getSession();
  appState.session = data.session;
  if (appState.session) { await loadProfile(); showShell(); } else { showAuth(); }
})();
