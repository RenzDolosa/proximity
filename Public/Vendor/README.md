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
