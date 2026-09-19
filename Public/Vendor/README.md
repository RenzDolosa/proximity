# Vendor

Third-party, pre-built browser bundles that ship as plain `<script>` tags
(no bundler/build step required — consistent with the rest of this project).

- **supabase-js.umd.js** — `@supabase/supabase-js@2.116.0`, official UMD
  build. Exposes a `window.supabase` global with `.createClient(...)`.
  `JS/Core/supabaseClient.js` calls that to construct the app's client.

  To upgrade: download a newer version's UMD bundle from
  `https://unpkg.com/@supabase/supabase-js@<version>/dist/umd/supabase.js`
  (or run `npm pack @supabase/supabase-js` and pull it from
  `dist/umd/supabase.js`) and replace this file.

- **xlsx.mini.min.js** — SheetJS `xlsx@0.18.5`, the **mini** browser build
  (250KB) rather than the full build (881KB) — deliberately, since this app
  already cares about bundle size for kiosk/offline use (see `sw.js`'s
  precache list) and the mini build's only real omission vs. full is
  legacy-format support (XLS/XLSB/Lotus 1-2-3/SpreadsheetML 2003) this app
  will never read or write; XLSX read/write and CSV both work fine. Exposes
  a `window.XLSX` global. Used by `JS/Utils/xlsxExport.js` for every
  "Export .xlsx" button (Employee Manager, Proximity Cards, Scan Log).
  License: Apache-2.0 — full text vendored alongside it as
  `xlsx.LICENSE.txt`, per the license's own attribution requirement (see
  its "APPENDIX: How to apply the Apache License").

  To upgrade: SheetJS no longer publishes new versions to npm/unpkg/cdnjs
  as of mid-2024 (ongoing dispute with npm — see
  `github.com/SheetJS/sheetjs/issues/2822`); 0.18.5 is the last npm
  release and was fetched via `npm pack xlsx` (`registry.npmjs.org`,
  already an allowed egress domain for this environment — `unpkg.com` and
  `cdn.sheetjs.com` are not). A future upgrade needs `dist/xlsx.mini.min.js`
  from SheetJS's new home at `git.sheetjs.com/sheetjs/sheetjs`, fetched
  through whatever channel is available at the time, plus a refreshed
  `xlsx.LICENSE.txt` if the license text itself changed.
