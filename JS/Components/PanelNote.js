// A panel's explanatory text, as a visible lead sentence plus the rest
// behind a disclosure.
//
// Settings' panels each carried one to three full paragraphs of prose in a
// <p class="sub">. On a desktop that reads as a margin note you skim past;
// at 375px the same text is ten or twelve lines and you scroll past the
// explanation to reach the thing you came for. "Offline scanner thumbnails"
// was the worst of them at three paragraphs.
//
// The text is worth keeping -- these panels run nightly jobs and overwrite
// stored photos, and the paragraph explaining that nothing is deleted is the
// reason an admin is willing to press the button. So this splits rather than
// cuts: the lead answers "what is this", the detail answers "what exactly
// happens, and why".
//
// Collapsed on every screen size, not just narrow ones. Markup that depends
// on the viewport goes stale the moment someone resizes, and this page is
// already built out of disclosures -- the three intent groups are <details>
// too -- so a note that opens the same way is the consistent choice rather
// than the lazy one.
//
// Both arguments are markup, not text: callers interpolate values that are
// already escaped, and several details contain <strong>. Nothing here
// escapes anything, exactly as the sibling panelHTML() builders don't.
export function panelNote(lead, detail = '') {
  if (!detail.trim()) return `<p class="sub panel-note-lead">${lead}</p>`;
  return `<div class="panel-note">
    <p class="sub panel-note-lead">${lead}</p>
    <details class="panel-note-more">
      <summary>Details</summary>
      <div class="sub panel-note-body">${detail}</div>
    </details>
  </div>`;
}
