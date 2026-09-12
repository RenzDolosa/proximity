# Task for Proximity — Scanner & Test Scanner: stop revealing proximity codes via remarks

## Project context
- Repo: https://github.com/RenzDolosa/proximity (branch: `main`)
- Supabase project: `proximity`, ref `kjwttqmbcjvkivgmwuev`
- Stack: vanilla modular JS + Supabase (Postgres/Auth/RPC), no build step
- This app is a Proximity/ID card management system with roles (admin, manager, viewer) and a kiosk-style Scanner screen used at a physical door reader. The Scanner and Test Scanner pages are operator-facing screens meant to be watched by people standing at a door — nothing sensitive like a raw proximity code should ever render on them.

## Root cause (already diagnosed — don't re-investigate)
There is exactly **one** place a proximity code can currently leak onto the Scanner or Test Scanner screen:

1. `JS/Components/RevokeCardModal.js` — when an admin/manager revokes a card that's assigned to an employee, it calls:
   ```js
   await EmployeesModel.addRemark(employee.id, `Proximity card ${card.proximity_code} revoked: ${reason}`);
   ```
   This embeds the literal proximity code text into the employee's `remarks_log` (a jsonb array on the `employees` table).

2. `JS/Components/ScanResultCard.js` — every **matched** scan (`scan_proximity_code()` / `test_scan_proximity_code()` RPCs both return `to_jsonb(employee)`, which includes `remarks_log`) renders any unresolved remarks directly onto the result card shown on the Scanner/Test Scanner screen:
   ```js
   const unresolved = (e.remarks_log || []).filter((r) => !r.resolved);
   ...
   ${unresolved.map((r) => `<div class="remark-flag-item">${esc(r.remark)}</div>`).join('')}
   ```
   So if a revoke reason (or any other remark an admin types) contains a proximity code, it gets printed right on the kiosk screen the next time that employee scans a *different, currently-active* card (this can legitimately happen — a revoked card's remark stays on the employee's profile even after they're issued a new one).

Confirmed via the live schema: the `employees` table itself does **not** store `proximity_code` (that column lives on `proximity_cards`), and neither RPC joins it in — so this remark-text path is the only leak. No other change is needed to satisfy "do not reveal proximity code/card" on these two screens.

## Required changes

### 1. Stop putting the proximity code into revoke remarks
In `JS/Components/RevokeCardModal.js`, change the remark text so it no longer embeds `card.proximity_code`. Just describe the event and the reason, e.g.:
```js
await EmployeesModel.addRemark(employee.id, `Proximity card revoked: ${reason}`);
```
(The `Employee Manager` UI where admins review remarks already shows which card was revoked via the revoke history/table elsewhere, so the code isn't needed inside the remark text itself. If there's ever a need to cross-reference, use the card's `id`, not its `proximity_code`.)

### 2. Don't render raw remark text on the Scanner/Test Scanner result card
Even after fix #1, remarks are freeform text — any admin could still manually type a proximity code (or any other sensitive detail) into a remark via the Remarks modal (`JS/Components/RemarksModal.js`), and it would still get echoed onto the door-facing kiosk screen. Harden `JS/Components/ScanResultCard.js` so the Scanner/Test Scanner **never prints remark content**, only a flag/count:

Replace:
```js
${unresolved.map((r) => `<div class="remark-flag-item">${esc(r.remark)}</div>`).join('')}
```
with something that shows only the fact that unresolved remarks exist, e.g.:
```js
<div class="remark-flag-item">See Employee Manager for details.</div>
```
Keep the count/title (`⚠ Unresolved remark(s) (N)`) — that part is fine and useful to the operator. Just remove the loop that prints each remark's actual text.

This one change in `ScanResultCard.js` covers both the Scanner (`StandaloneScanner.js`) and Test Scanner (`TestScanPage.js`), since both import and reuse `renderScanResult()` from that same file — no changes needed in either of those two files themselves.

## Out of scope / do not touch
- `RemarksModal.js` (the admin-facing Remarks list on Employee Manager) should **keep** showing full remark text as-is — that's an authenticated back-office view, not the kiosk. Only the Scanner/Test Scanner result card needs redacting.
- Don't change the `input type="password"` masking on the scan code fields — that's already correct and unrelated.
- Don't touch `ScanFeed.js` ("Recent activity") — it already only shows employee name, scanner id, result badge, and time; no code exposure there.

## Verification checklist
1. Revoke a card that's assigned to an employee with a reason like "Lost card" → confirm the new remark on that employee's profile (Employee Manager → Remarks) reads `Proximity card revoked: Lost card` with no code in it.
2. Issue that employee a new active card, then scan it at the Test Scanner (`?scanner=1` is the *live* one — Test Scan is the in-shell one) → confirm the result card shows "⚠ Unresolved remark (1)" but does **not** print the remark text itself.
3. Resolve the remark in Employee Manager, scan again → confirm the flag disappears entirely (existing behavior, shouldn't have changed).
4. Manually add a remark containing a fake proximity-looking code (e.g. "PRX-99999 found on floor") via the Remarks modal, then scan that employee → confirm it still only shows the generic flag, not the text.

## Tools available
- GitHub repo is clonable directly: `git clone https://github.com/RenzDolosa/proximity.git`
- Supabase MCP tools are connected under project id `kjwttqmbcjvkivgmwuev` if any schema verification is needed (shouldn't be, for this task — it's front-end only).
