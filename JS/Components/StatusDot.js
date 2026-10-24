// A leading table column that is one coloured dot, with a blank header.
//
// Two tables asked for the same thing on the same day (Users & Roles, Scanner
// Analytics), which is the point at which it stops being markup and becomes a
// component. The header is intentionally empty: the dot means "is this thing
// reachable right now", and a column title would take more width than the
// thing it labels.
//
// The dot alone is never the whole story -- colour is not available to every
// reader, and a grey dot and a green one are the same shape. Every cell
// carries a `title` saying it in words, and an aria-label, so the column is
// legible without seeing the colour at all. Callers pass that text; this does
// not invent it.

/** `state` is one of: online | offline | disabled | unknown. */
export const STATUS_DOT_STATES = ['online', 'offline', 'disabled', 'unknown'];

// `data-label` carries the words, not a fixed "Status": stacked into a card
// on a phone, .table-as-cards' generic `td::before{content:attr(data-label)}`
// is what renders a cell's label, so putting the real text there is what makes
// the dot legible without colour. An earlier version set the label from
// `attr(title)` in CSS instead and silently rendered the literal "Status" --
// the title lives on the inner <span>, and attr() only reads the element it is
// applied to.
export function statusDotHTML(state, label) {
  const safe = STATUS_DOT_STATES.includes(state) ? state : 'unknown';
  const text = label || safe;
  return `<td class="col-dot" data-label="${text}">`
    + `<span class="status-dot status-dot-${safe}" title="${text}" role="img" aria-label="${text}"></span>`
    + `</td>`;
}

/** The matching blank <th>. Kept here so the two can never drift apart. */
export const STATUS_DOT_HEADER = '<th class="col-dot" aria-label="Status"></th>';

// Users & Roles has no live presence: `profiles` carries only is_active, and
// nothing writes a heartbeat. Rather than invent one -- a recurring write per
// signed-in user, which is exactly the log-ingestion cost this project is
// trying to come down from -- the dot reads last_sign_in_at, mirrored from
// auth.users by a trigger so it costs no request at all.
//
// So it answers "has this account been used recently", not "is this person
// looking at the app". The window is one working day: inside it the account is
// in active use, outside it the account is dormant. The title text says the
// real elapsed time, so nobody has to infer precision the dot does not have.
export const ACCOUNT_ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000;

export function accountState(user, now = Date.now(), windowMs = ACCOUNT_ACTIVE_WINDOW_MS) {
  if (!user) return 'unknown';
  if (user.is_active === false) return 'disabled';
  const seen = Date.parse(user.last_sign_in_at);
  if (!Number.isFinite(seen)) return 'unknown';
  return now - seen <= windowMs ? 'online' : 'offline';
}

export function accountStateLabel(user, now = Date.now()) {
  const state = accountState(user, now);
  if (state === 'disabled') return 'Account disabled';
  if (state === 'unknown') return 'Never signed in';
  // floor, not round, throughout: rounding reported 30 seconds as "1 min ago"
  // (and would report 8m59s as 9 minutes). Whole units elapsed never overstate
  // how old the signal is, which is the safer direction for a staleness
  // indicator.
  const mins = Math.max(0, Math.floor((now - Date.parse(user.last_sign_in_at)) / 60000));
  if (mins < 1) return 'Signed in just now';
  if (mins < 60) return `Signed in ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Signed in ${hours}h ago`;
  return `Signed in ${Math.floor(hours / 24)}d ago`;
}
