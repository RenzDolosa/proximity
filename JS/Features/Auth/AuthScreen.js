import { $ } from '../../Utils/dom.js';
import { supabase } from '../../Core/supabaseClient.js';

// Sign-in only — self-service account creation was removed deliberately
// (2026-09-19): new accounts are created by an admin under Users & Roles
// instead. Removing this UI is only half the story though — see
// README.md's matching change log entry for the Supabase Dashboard
// setting that actually closes the door at the API level, since a
// removed button alone doesn't stop someone from calling
// supabase.auth.signUp() directly (e.g. from the browser console).
export function initAuthScreen() {
  const emailInput = $('#login-email');
  const passwordInput = $('#login-password');

  async function doSignIn() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    $('#login-error').classList.add('hidden');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { $('#login-error').textContent = error.message; $('#login-error').classList.remove('hidden'); }
  }

  $('#login-submit').addEventListener('click', doSignIn);

  // Enter submits from either field — matches how a plain HTML <form>
  // would behave natively, which this markup deliberately isn't (no
  // <form> tag, to avoid a real page navigation/reload on submit — see
  // ProximityPage.js and friends for the same reasoning on other
  // in-app forms). Shift+Enter/other modifiers are left alone since
  // there's nothing here that needs a newline or otherwise cares.
  const onEnter = (e) => { if (e.key === 'Enter') doSignIn(); };
  emailInput.addEventListener('keydown', onEnter);
  passwordInput.addEventListener('keydown', onEnter);

  $('#btn-signout').addEventListener('click', async () => { await supabase.auth.signOut(); });
}