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
  clearInterval(timer);
  if (!isAdminOrManager()) return;
  refreshAlertsBadge();
  timer = setInterval(refreshAlertsBadge, POLL_MS);
}

export function stopAlertsBadge() {
  clearInterval(timer);
  timer = null;
}
