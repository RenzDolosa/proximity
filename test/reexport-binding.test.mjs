// `export { X } from './m.js'` forwards X to importers and creates NO local
// binding. Using X in the same file is then a ReferenceError at call time.
//
// This shipped on 2026-11-03 in Models/ScanSoundsModel.js and broke scan-sound
// preview, upload and remove — every method that touched SOUND_KEYS. Nothing
// caught it: `node --check` sees valid syntax, and the unit tests import the
// catalogue from its own pure module, so the broken file was never loaded.
// Only clicking the button in a browser found it.
//
// Same family as the TDZ bug in ExportScanLogsModal (2026-10-09): a scope
// error that is invisible to every check short of executing the line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// `export { a, b as c } from '…'` — the forwarding form. The plain
// `export { a }` form (no `from`) DOES have a local binding and is fine.
// `[^'"]*` not `+`: stripCommentsAndStrings empties string bodies while
// keeping their quotes, so the module path arrives here as `''`.
const REEXPORT_RE = /export\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"]/g;

// Comments and string bodies are not code. Without this the check fires on a
// comment that merely *describes* the pattern — which it did on its first run,
// against both this project's existing `export { showStandaloneScanner } from`
// (explained in a comment directly above it) and the warning comment added to
// ScanSoundsModel.js. A guard that cries wolf gets switched off.
//
// A character scanner rather than regexes: `'https://x'` contains `//`, so
// stripping line comments with a regex truncates real code.
export function stripCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== '*/') i++;
      i += 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += quote; // keep the delimiters so the re-export regex still matches
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++; // skip the escaped character
        i++;
      }
      out += quote;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function reexportedButUsedLocally(rawSource) {
  const source = stripCommentsAndStrings(rawSource);
  const findings = [];
  for (const match of source.matchAll(REEXPORT_RE)) {
    const names = match[1].split(',').map((part) => {
      // `a as b` forwards b; the name that would need a local binding is a.
      const [original] = part.trim().split(/\s+as\s+/);
      return original.trim();
    }).filter(Boolean);

    // Everything except the re-export statement itself, so the names inside
    // it do not count as uses of themselves.
    const rest = source.replace(match[0], '');
    for (const name of names) {
      if (new RegExp(`\\b${name}\\b`).test(rest)) findings.push(name);
    }
  }
  return [...new Set(findings)].sort();
}

test('the check recognises the shape that shipped broken', () => {
  const broken = `
    export { SOUND_KEYS } from '../Utils/scanSoundKeys.js';
    export const Model = { url(k) { return SOUND_KEYS[k]; } };
  `;
  assert.deepEqual(reexportedButUsedLocally(broken), ['SOUND_KEYS']);

  // Import-then-export is the fix, and must not be flagged.
  const fixed = `
    import { SOUND_KEYS } from '../Utils/scanSoundKeys.js';
    export { SOUND_KEYS };
    export const Model = { url(k) { return SOUND_KEYS[k]; } };
  `;
  assert.deepEqual(reexportedButUsedLocally(fixed), []);

  // A pure pass-through with no local use is perfectly fine.
  assert.deepEqual(reexportedButUsedLocally(`export { A, B } from './x.js';`), []);

  // Renaming still points at the name that lacks a binding.
  const renamed = `
    export { inner as outer } from './x.js';
    const v = inner + 1;
  `;
  assert.deepEqual(reexportedButUsedLocally(renamed), ['inner']);
});

test('a name mentioned only in a comment is not a use', () => {
  // Both of this project's real re-exports are explained in a comment that
  // names the thing — which is exactly how a naive check produces two false
  // positives and gets ignored.
  const commented = `
    // showStandaloneScanner is wired up elsewhere and re-exported here.
    export { showStandaloneScanner } from './StandaloneScanner.js';
  `;
  assert.deepEqual(reexportedButUsedLocally(commented), []);

  const blockCommented = `
    /* Do not write: export { A } from './x.js'; then use A below. */
    export { B } from './y.js';
  `;
  assert.deepEqual(reexportedButUsedLocally(blockCommented), []);

  // A URL inside a string must not swallow the rest of the line.
  const withUrl = `
    const u = 'https://example.com/x';
    export { Z } from './z.js';
    const v = Z;
  `;
  assert.deepEqual(reexportedButUsedLocally(withUrl), ['Z']);
});

test('no module uses a name it only re-exports', () => {
  const offenders = [];
  for (const file of walk(join(ROOT, 'JS')).filter((f) => f.endsWith('.js'))) {
    const names = reexportedButUsedLocally(readFileSync(file, 'utf8'));
    if (names.length) offenders.push(`${file.replace(ROOT, '').slice(1)}: ${names.join(', ')}`);
  }
  assert.deepEqual(
    offenders, [],
    "`export { X } from '…'` creates no local binding, so using X in the same "
      + 'file is a ReferenceError the moment that line runs. Import it first, '
      + 'then re-export: `import { X } from …; export { X };`',
  );
});
