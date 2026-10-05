// Keeps the unread-alerts count on the sidebar's Alerts button current.
// get_unread_alert_count() returns 0 for anyone who isn't admin/manager, so
// polling it is harmless for other accounts — but it is only started for
// admins/managers anyway (see startAlertsBadge()).
import { $ } from '../Utils/dom.js';
import { fmtBadgeCount } from '../Utils/dashboard.js';
import { AlertsModel } from '../Models/AlertsModel.js';
import { isAdminOrManager } from './state.js';

const POLL_MS = 60000;
let timer = null;
let visibilityHandler = null;

export async function refreshAlertsBadge() {
  const el = $('#alerts-badge');
  if (!el) return;
  const { data, error } = await AlertsModel.unreadCount();
  if (error) return; // a badge that can't refresh just keeps its last value
  const text = fmtBadgeCount(Number(data));
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

export function startAlertsBadge() {
  stopAlertsBadge();
  if (!isAdminOrManager()) return;
  refreshAlertsBadge();
  // Skipped while the tab is hidden, same reasoning as DashboardPage's
  // refresh: a badge nobody can see is worth no round trips at all, and a
  // backgrounded admin tab left open overnight was otherwise polling this
  // every minute until the browser was closed. The visibility handler catches
  // up the moment the tab is looked at again, so it's never stale on screen.
  timer = setInterval(() => {
    if (document.hidden) return;
    refreshAlertsBadge();
  }, POLL_MS);
  visibilityHandler = () => { if (!document.hidden) refreshAlertsBadge(); };
  document.addEventListener('visibilitychange', visibilityHandler);
}

export function stopAlertsBadge() {
  clearInterval(timer);
  timer = null;
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
}
