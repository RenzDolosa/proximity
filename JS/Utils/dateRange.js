// Shared "from / to" date-input behaviour. Values are the yyyy-mm-dd strings
// an <input type="date"> gives back, which sort correctly as plain strings.
//
// Used by every from/to pair in the app (Attendance, Export scan logs, the
// per-employee Scan log) so they all react the same way to an inverted range.

// Returns [from, to] in chronological order. If either end is empty there is
// no range to invert, so both come back untouched.
export function orderDateRange(from, to) {
  if (from && to && from > to) return [to, from];
  return [from, to];
}

// When the person picks a "from" later than the "to" (or a "to" earlier than
// the "from"), SWAP the two values — e.g. from 28/09/2026 then to 21/09/2026
// becomes from 21/09/2026, to 28/09/2026 — instead of overwriting one end
// and silently discarding a date they chose. `onChange` runs after any change
// (swapped or not) so callers can repaint / re-validate.
export function wireDateRangeOrdering(fromEl, toEl, onChange) {
  if (!fromEl || !toEl) return;
  const reorder = () => {
    const [from, to] = orderDateRange(fromEl.value, toEl.value);
    if (from !== fromEl.value) fromEl.value = from;
    if (to !== toEl.value) toEl.value = to;
    if (onChange) onChange();
  };
  fromEl.addEventListener('change', reorder);
  toEl.addEventListener('change', reorder);
}
