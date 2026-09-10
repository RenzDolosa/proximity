import { $ } from '../../Utils/dom.js';
import { toast } from '../../Utils/toast.js';
import { supabase } from '../../Core/supabaseClient.js';

export function initAuthScreen() {
  $('#tab-login').addEventListener('click', () => {
    $('#tab-login').classList.add('active'); $('#tab-signup').classList.remove('active');
    $('#login-form').classList.remove('hidden'); $('#signup-form').classList.add('hidden');
  });
  $('#tab-signup').addEventListener('click', () => {
    $('#tab-signup').classList.add('active'); $('#tab-login').classList.remove('active');
    $('#signup-form').classList.remove('hidden'); $('#login-form').classList.add('hidden');
  });

  $('#login-submit').addEventListener('click', async () => {
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    $('#login-error').classList.add('hidden');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { $('#login-error').textContent = error.message; $('#login-error').classList.remove('hidden'); }
  });

  $('#signup-submit').addEventListener('click', async () => {
    const full_name = $('#signup-name').value.trim();
    const email = $('#signup-email').value.trim();
    const password = $('#signup-password').value;
    $('#signup-error').classList.add('hidden');
    if (!full_name || !email || password.length < 6) {
      $('#signup-error').textContent = 'Fill in name, email and a password of at least 6 characters.';
      $('#signup-error').classList.remove('hidden');
      return;
    }
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name } } });
    if (error) { $('#signup-error').textContent = error.message; $('#signup-error').classList.remove('hidden'); }
    else toast('Account created. Signing you in…');
  });

  $('#btn-signout').addEventListener('click', async () => { await supabase.auth.signOut(); });
}
