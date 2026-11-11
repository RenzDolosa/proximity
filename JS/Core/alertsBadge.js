// Keeps the unread-alerts count on the sidebar's Alerts button current.
// get_unread_alert_count() returns 0 for anyone who isn't admin/manager, so
// polling it is harmless for other accounts — but it is only started for
// admins/managers anyway (see startAlertsBadge()).
import { $ } from '../Utils/dom.js';
import { fmtBadgeCount } from '../Utils/dashboard.js';
import { AlertsModel } from '../Models/AlertsModel.js';
import { isAdminOrManager } from './state.js';

// 10 minutes. Was 60s until 2026-10-21, then 180s, now this.
//
// Every poll writes an API-gateway log event, and this one runs on every open
// admin/manager tab on every page — ~340 of the ~6,700 lines a day the
// project produced before this change, second only to the Dashboard timer.
//
// WHAT CHANGED THE ANSWER: alerts now push to Telegram the moment they are
// recorded (migration 20261110092000 → the notify-alert function). The badge
// has stopped being how anyone finds out something is wrong, so the interval
// only governs how stale a number looks on a tab somebody is already staring
// at. Nothing upstream is faster anyway — scanner-silence is raised by a cron
// running every 15 minutes — and the badge still catches up instantly on
// visibilitychange.
//
// This was chosen over the obvious alternative of a Realtime subscription on
// alerts INSERT. Realtime removes the poll entirely, but replaces a measured
// ~340 log lines a day with a WebSocket whose heartbeat cost on this plan
// could not be measured (the Supabase log API was unreachable at the time).
// Trading a known cost for an unknown one is a bad trade on a project already
// past its billing grace period. Revisit when query_logs can confirm what
// realtime heartbeats actually cost; this constant is the whole rollback.
const POLL_MS = 600000;
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
