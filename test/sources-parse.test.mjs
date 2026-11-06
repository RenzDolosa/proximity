// Every browser module must actually parse.
//
// THE BUG THIS EXISTS FOR (2026-11-06). An HTML comment written *inside* a
// template literal contained backticks:
//
//     content.innerHTML = `
//       <!-- Bound to the variable, not hardcoded. `commissioning` lives at
//            module scope ... -->
//
// The first backtick closed the template literal, and the file stopped being
// valid JavaScript. The whole app failed to load — router.js imports the
// page — and the full suite still passed, because every source assertion in
// this project reads files as TEXT with readFileSync and greps them. Text
// does not care whether it parses.
//
// Nothing else catches this either: there is no build step and no bundler, so
// the browser is the first thing that ever parses these files. That made a
// syntax error a runtime discovery on a page nobody loads until they test it.
//
// Run in ONE child process rather than `node --check` per file: 108 modules
// is ~0.6s this way and ~13s as 108 spawns, and a guard slow enough to be
// skipped is not a guard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Parses without evaluating. `await import()` is not an option — these are
// browser modules, and several touch window/indexedDB at import time, which
// is why the health-drawer test reads StandaloneScanner.js as text rather
// than importing it.
const CHECKER = `
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(process.cwd(), 'JS');
  const files = fs.readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('JS', f));
  const bad = [];
  for (const f of files) {
    try {
      new vm.SourceTextModule(fs.readFileSync(path.join(process.cwd(), f), 'utf8'),
        { identifier: f });
    } catch (e) {
      bad.push(f + ' — ' + e.message);
    }
  }
  process.stdout.write(JSON.stringify({ count: files.length, bad }));
`;

test('every module under JS/ is syntactically valid JavaScript', () => {
  const out = execFileSync(
    process.execPath,
    ['--experimental-vm-modules', '--no-warnings', '-e', CHECKER],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const { count, bad } = JSON.parse(out);
  assert.ok(count > 50, `expected to find the module tree, found ${count} files`);
  assert.deepEqual(bad, [],
    'these do not parse, so the browser cannot load them:\n' + bad.join('\n'));
});
