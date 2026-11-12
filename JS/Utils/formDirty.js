// Has anything in this dialog actually been typed into?
//
// WHY IT IS NEEDED. openModal() closes on any click that lands on the
// backdrop, and there was no dirty check anywhere in the app — so a click
// aimed at a field and landing an inch outside discarded a half-filled
// employee record with no warning and no way back.
//
// A SNAPSHOT COMPARISON, not per-field change listeners. Listeners have to
// be attached to every control, which means every new field is a chance to
// forget one, and a forgotten field is a silent return to the old
// behaviour. Reading every control at open and again at close cannot miss
// one, because it never had a list to begin with.
//
// COMPARED PER KEY, AGAINST AN EMPTY BASELINE — not as one serialized
// string. Several dialogs render their fields after the modal is already
// open: RemarksModal paints its textarea into the body once the remarks
// have loaded, and a whole-string comparison called that a change, so
// closing a dialog you had only looked at asked whether you wanted to
// discard your work. A control that did not exist at snapshot time is
// measured against '' instead: still empty means clean, typed into means
// dirty. Both cases come out right, and neither needs the dialog to tell
// this module when it finished rendering.
//
// The reading half touches the DOM; the comparison half does not, so the
// rules that decide whether someone loses work are testable.

/**
 * Every value-bearing control inside a root, as [key, value] pairs.
 *
 * Keyed by id, then name, then position among controls of the same shape.
 * Every dialog in this app gives its fields ids, so the positional fallback
 * is for a control somebody forgot to name — it is deliberately last,
 * because indices shift when a field is inserted later.
 */
export function fieldValues(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const nodes = root.querySelectorAll('input, textarea, select');
  const seen = new Map();
  return [...nodes].map((el) => {
    const shape = `${el.tagName || ''}:${el.type || ''}`.toLowerCase();
    const n = (seen.get(shape) || 0) + 1;
    seen.set(shape, n);
    const key = el.id || el.name || `${shape}#${n}`;
    // A checkbox's `value` is its payload, not its state — an untouched
    // checkbox and a ticked one both report "on" unless `checked` is read.
    const value = (el.type === 'checkbox' || el.type === 'radio')
      ? String(el.checked)
      : String(el.value ?? '');
    return [key, value];
  });
}

/** Pairs to a lookup, so a comparison can ask about one key at a time. */
export function fieldMap(pairs) {
  return new Map(Array.isArray(pairs) ? pairs : []);
}

/**
 * Did anything change?
 *
 * Only what is on screen NOW is examined. A control that has since been
 * removed cannot have unsaved work in it, and a control that has since
 * appeared is compared against '' — see the header.
 *
 * @param {Map<string,string>} before
 * @param {Array<[string,string]>} after
 */
export function isDirty(before, after) {
  const base = before instanceof Map ? before : fieldMap(before);
  for (const [key, value] of Array.isArray(after) ? after : []) {
    if (String(value ?? '') !== String(base.get(key) ?? '')) return true;
  }
  return false;
}

/**
 * Convenience: snapshot now, and get back a function that says whether
 * anything has changed since.
 *
 * Returns a function rather than a value so the caller holds no state and
 * cannot compare against a snapshot taken at the wrong moment.
 */
export function watchFields(root) {
  const before = fieldMap(fieldValues(root));
  return () => isDirty(before, fieldValues(root));
}
