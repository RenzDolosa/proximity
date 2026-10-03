# proximity-scan

Deployed Edge Function — source lives in the Supabase project, not this
repo (pull it with `supabase functions download proximity-scan`, see
`../README.md`). Documented here so the contract the app depends on is
version-controlled even before the source is.

**Request**
```
POST https://kjwttqmbcjvkivgmwuev.supabase.co/functions/v1/proximity-scan
Authorization: Bearer <user's access_token>
Content-Type: application/json

{ "proximity_code": "PRX-00021", "scanner_id": "front-door-01" }
```

Calls the `scan_proximity_code(p_proximity_code, p_scanner_id)` RPC
server-side. The in-app scanner now uses the compact
`scan_proximity_code_compact(...)` wrapper instead. This deployed Edge
Function's source is not in the repo, so its current response still uses
the legacy RPC result shape until the source is downloaded and updated.
This function exists so hardware/kiosk readers that can only POST JSON (no
Supabase JS SDK) can still log a scan.

**Response** — the RPC's result shape:
`{ result: 'matched' | 'unmatched' | 'inactive_card' | 'inactive_employee', employee?, direction? }`
— matches what `JS/Components/ScanResultCard.js#renderScanResult` expects.
The legacy result can include the full employee row (including scan and
remark history). If this endpoint is active, it remains a possible egress
source; capture its deployed source and switch it to the compact wrapper
before considering scanner egress fully addressed.
