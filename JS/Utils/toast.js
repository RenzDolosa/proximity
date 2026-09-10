// Fire-and-forget toast notifications. Reused by every feature/component
// that needs to report a success or an error after an action.
export function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
