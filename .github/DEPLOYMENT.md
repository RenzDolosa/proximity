# Deployment

`.github/workflows/deploy-supabase.yml` deploys Edge Function changes to
Supabase on every merge to `main` that touches `Supabase/functions/**`.

## Why this isn't a "real" canary deploy, and what it is instead

A textbook canary deploy splits live traffic between the old and new
version by percentage and watches error rates before shifting the rest
over. That requires something in front of your backend that can route
traffic that way — a load balancer, a service mesh, a platform like
Kubernetes/ECS with weighted routing. **Supabase Edge Functions don't have
that**: deploying a function replaces the live version outright, for
100% of traffic, immediately. There's no partial-rollout primitive to
plug into here, and pretending otherwise would just be a workflow file
that says "canary" without doing anything a real canary does.

What this pipeline does instead, and why it's a reasonable stand-in for
this stack:

1. **Typecheck first** (`deno check` on every function) — catches broken
   code before it ever reaches Supabase, for free.
2. **Manual approval gate** (`environment: production`, see setup below) —
   the deploy job pauses and waits for a human to click approve before
   touching the live project. This is the actual checkpoint: nothing ships
   automatically just because a PR merged.
3. **Post-deploy smoke test** — an `OPTIONS` request to each deployed
   function confirms it's actually up and responding, not just that the
   CLI reported success.

This gets you "nothing ships without eyes on it, and if it's clearly
broken it's caught immediately" — which is the property people usually
actually want from "canary" in a setup this size. It's a deliberately
honest substitute, not the real thing.

## Things that make the pipeline quietly do nothing

- **A failing `typecheck` job skips `deploy` entirely** (`needs: typecheck`).
  The repo can then sit ahead of the live function with no deploy ever
  attempted — the failed-run notification is the only signal. `typecheck` uses
  `deno-version: v2.x`, i.e. the newest 2.x, so a Deno/TypeScript upgrade can
  break a function that compiled last month (this happened with
  `Uint8Array` → `fetch()` body typing; see `Supabase/README.md`'s
  2026-09-21 entry). If a merged function change isn't live, check the
  Actions tab before assuming it deployed.
- **The `production` approval gate waits indefinitely** for a reviewer; an
  unapproved run is just a pending job.
- **It deploys every function that has an `index.ts`, not only the changed
  one.** Today that is only `upload-employee-photo` (`proximity-scan` and
  `admin-users` are docs-only stubs deployed by hand, so their source isn't
  version-controlled here). Adding an `index.ts` for another function means
  the next merge touching *any* function redeploys it too — make sure the
  committed source matches what's live first (`supabase functions download
  <slug>`).
- **The smoke test is an `OPTIONS` request**: it proves the function boots,
  not that its Google/Drive credentials still work.
- **Verify a deploy landed**: `Supabase:list_edge_functions` should show the
  version incremented and a fresh `updated_at`.

## What a deploy actually touches

Only the functions whose source changed in the push being deployed, worked out
by diffing `github.event.before..github.sha` over `Supabase/functions/**`.

This matters because the step used to loop over every directory with an
`index.ts` regardless of what changed. A one-line edit to one function
redeployed *all* of them — including `upload-employee-photo`, whose live copy
may have been updated by hand outside this repo (`Supabase/README.md` records
that some functions were deployed that way). A deploy would then silently
revert work nobody asked it to touch.

Fallbacks, deliberately biased toward over-deploying rather than under-:

| Situation | Deploys |
|---|---|
| normal push | only functions changed in that push |
| `workflow_dispatch` with a slug | just that one |
| `workflow_dispatch` with `all` (default) | everything with committed source |
| first push to a branch, force-push, or unavailable history | everything with committed source |

Under-deploying leaves a function silently stale, which is far harder to notice
than an unnecessary redeploy. The smoke test is scoped to the same list, so a
green check means "what I just shipped is up", not "something is up somewhere".

Functions without a committed `index.ts` are never deployed — they are
documentation-only stubs maintained by hand.

## One-time setup

### 1. Secrets
Repo → **Settings → Secrets and variables → Actions**:
- `SUPABASE_ACCESS_TOKEN` — a personal access token from
  [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
- `SUPABASE_PROJECT_REF` — your project ref (the subdomain in your
  project's API URL, `https://<this-part>.supabase.co`)

Without them the deploy step fails with *"Access token not provided. Supply an
access token by running `supabase login` or setting the SUPABASE_ACCESS_TOKEN
environment variable."* — which reads like a CLI problem but is just an empty
repo secret.

**Set the secrets after a run already failed?** Use **Actions → Deploy Edge
Functions → Run workflow** (the `workflow_dispatch` trigger), optionally naming
a single function slug. That exists precisely for this: the `paths:` filter
means a fix that changes no file under `Supabase/functions/**` never triggers
a new run, so without it the failure is a dead end.

**Re-running a failed run is not equivalent, and for some failures cannot
work.** A re-run replays the workflow file *as it was at the original commit*.
That is fine when only a secret was missing — secrets are read at run time —
but useless when the fix is to this workflow itself, because the re-run still
executes the broken version. Both cases came up during the 2026-10-05 rollout.
When in doubt, dispatch rather than re-run.

**One Supabase token is needed, in GitHub:**

| Stored in | Name | Used by | Needs |
|---|---|---|---|
| **GitHub** Actions secrets | `SUPABASE_ACCESS_TOKEN` | this workflow, at deploy time | **write** — deploy Edge Functions |

There used to be a second, `MANAGEMENT_API_TOKEN`, held as a Supabase Edge
Function secret for the `project-usage` function. Both were deleted on
2026-10-05: Supabase publishes no usage or billing API, so that function could
never work (see `README.md`'s change log for the probe output). If that secret
or its access token still exist, remove them — a stored account credential that
grants nothing you use is pure liability.

Supabase access tokens are scoped per project and per permission. The deploy
token needs **Edge Functions read *and* write** on this project — `read`
because the CLI lists existing functions before deploying, `write` to deploy.
A token scoped only for reading usage has neither, and fails specifically:

```
unexpected list functions status 403:
{"message":"Missing required permission(s): edge_functions_read",
 "error":{"missing_permissions":["edge_functions_read"]}}
```

The useful property of these errors is that they name the exact permission in
`missing_permissions`. On a 403, read that array and tick precisely those
boxes rather than guessing at the permission matrix.

Note the prefix asymmetry, which is a real trap: the `SUPABASE_` prefix is
**fine for GitHub Actions secrets** but **rejected for Supabase Edge Function
secrets**, where it is reserved for platform-injected variables. That is why
the names above look inconsistent; they are stored in two different systems
with different rules.

### 2. The approval gate
Repo → **Settings → Environments → New environment** → name it exactly
`production` (matches `environment: production` in the workflow) →
**Required reviewers** → add yourself/your team.

Once set, a merge to `main` that touches Edge Function source will run
the typecheck, then **pause** — you'll get a notification to review and
approve the deploy from the Actions tab (or the PR's checks) before it
actually runs.

Skip this step if you'd rather it deploy automatically with no manual
step — the workflow still works, it just won't pause.

## If you want an actual pre-merge preview instead

Supabase's **database branching** feature creates a real, isolated preview
environment (database + Edge Functions) per branch/PR — genuinely closer
to a canary in spirit, since you can validate against it *before*
merging, not just gate the deploy after. It requires a **paid plan
(Pro or above)** and bills per branch-hour (check current pricing before
turning this on — it's easy to leave branches running and rack up cost
without noticing). Not wired up here since it's an infra/billing decision
worth making deliberately, but this repo already has Supabase MCP tooling
capable of driving branch create/merge if you want to add it later.

## Frontend deployment

There's no deploy pipeline here for the static frontend
(`Public/`, `CSS/`, `JS/`) because there's no hosting target configured
yet — it's been tested locally so far (`npx serve .` from the repo root and
open `/Public/index.html`, per the main README §3 — *not* `npx serve Public`:
`index.html` references `../CSS` and `../JS`, and `sw.js` lives at the repo
root, so serving only `Public/` 404s all three). Once you pick a host (GitHub Pages, Vercel, Netlify, etc.), a
`deploy-frontend.yml` workflow following the same shape (typecheck/lint →
approval gate → deploy → smoke test) can be added — happy to build that
once the target's decided.

## Database migrations are not deployed by CI

Nothing in `.github/workflows/` applies `Supabase/migrations/*.sql`; the
Edge Function workflow deploys functions only. Migrations have been applied
to the live project by hand (Supabase MCP / dashboard) and the files here
are the reviewed record of what was applied. Two consequences worth knowing
before you trust the folder as a source of truth:

- **The live migration history and this folder don't line up.** Some files
  here use version numbers different from the live
  `supabase_migrations.schema_migrations` rows, and at least two
  (`20261003025504_reduce_scan_rpc_payloads`,
  `20261003060125_revoke_card_employee_status`) are live but absent from that
  table. Running `supabase db push` today would try to re-apply them. Use
  `supabase migration repair` to reconcile before adding a migration deploy
  job.
- **A green AI review doesn't cover a live-only change.** A migration applied
  before its PR is reviewed bypasses `.github/workflows/ai-review.yml`
  entirely (see `.github/AI_REVIEW.md` → Limitations). When a change has to be
  applied live first (urgent security fix, backward-compatible additive
  change), commit the identical SQL under the live version number in the same
  PR so review still happens, just after the fact.
- **After every function `DROP`/`CREATE`, run the security advisor.** A
  re-created function gets Supabase's default grants again, and
  `REVOKE ... FROM PUBLIC` does not remove the direct `anon` grant — revoke
  from `anon` explicitly (this is how `revoke_proximity_card()` ended up
  anon-executable on 2026-10-03).
