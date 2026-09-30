// Hover preview for Employee Manager's small (44px) row avatars: shows the
// same photo at 100x100px in a floating element appended straight to
// <body> — never inside the table's own layout — so hovering can never
// change the row's height or the Employee column's width. That also means
// position:fixed rather than position:absolute: .table-scroll itself is
// overflow:auto (see CSS/layout.css), and anything position:absolute
// nested inside a scrolling ancestor gets clipped at the scroller's edge
// exactly like an <img> would — fixed positioning escapes that entirely
// and is placed relative to the viewport instead, which is also why it's
// repositioned on window resize and hidden on scroll (see wire() below)
// rather than trying to track the row's position some other way.
//
// Reuses the row's own already-loaded <img src> rather than re-requesting
// it, so hovering never triggers a second network fetch of the photo —
// same "don't make the browser redo work it already did" reasoning as the
// 2026-09-29 Directory repaint fix (see README.md's change log).
//
// Delegated on the table's wrapper element (call once per full page
// render, same pattern as wireCopyableCodes()) rather than wired on each
// individual <img>, so it keeps working after paintDirectoryTable()
// rebuilds the table body — a plain repaint of #dir-table-wrap's children
// never needs this rewired, since a listener on the stable parent catches
// bubbled events from whatever its current children happen to be.

const SIZE = 300;
const GAP = 10;
const EDGE = 8;

let previewEl = null;

function ensurePreview() {
  if (previewEl) return previewEl;
  previewEl = document.createElement('div');
  previewEl.className = 'avatar-preview hidden';
  previewEl.innerHTML = '<img alt="" />';
  document.body.appendChild(previewEl);
  return previewEl;
}

// Prefers the right side of the hovered avatar; flips to the left if that
// would run off the right edge of the viewport; vertically centered on the
// avatar and clamped so the preview never renders partly off-screen top or
// bottom (a very short window, or hovering a row right at the table's edge).
function position(rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = rect.right + GAP;
  if (left + SIZE + EDGE > vw) left = rect.left - SIZE - GAP;
  left = Math.max(EDGE, Math.min(vw - SIZE - EDGE, left));
  let top = rect.top + rect.height / 2 - SIZE / 2;
  top = Math.max(EDGE, Math.min(vh - SIZE - EDGE, top));
  previewEl.style.left = `${left}px`;
  previewEl.style.top = `${top}px`;
}

function show(img) {
  const el = ensurePreview();
  el.querySelector('img').src = img.src;
  position(img.getBoundingClientRect());
  el.classList.remove('hidden');
}

function hide() {
  if (previewEl) previewEl.classList.add('hidden');
}

/**
 * Wire hover-to-preview for every real photo avatar (`.avatar-photo`, not
 * the plain-initials fallback) inside `container`. Safe to call more than
 * once for the same `container` node — re-wiring is a no-op — but must be
 * called again for a *new* container node (e.g. after renderDirectory()'s
 * full toolbar/table rebuild recreates #dir-table-wrap from scratch).
 */
export function wireAvatarPreview(container, scrollContainer) {
  if (!container || container.dataset.avatarPreviewWired) return;
  container.dataset.avatarPreviewWired = '1';
  container.addEventListener('mouseover', (e) => {
    const img = e.target.closest('.avatar-photo');
    if (img && container.contains(img)) show(img);
  });
  container.addEventListener('mouseout', (e) => {
    if (e.target.closest('.avatar-photo')) hide();
  });
  // A fixed-position element has no natural way to track a row that's
  // scrolled out from under it, so just hide it rather than let it drift.
  (scrollContainer || container).addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide);
}
