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

## One-time setup

### 1. Secrets
Repo → **Settings → Secrets and variables → Actions**:
- `SUPABASE_ACCESS_TOKEN` — a personal access token from
  [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
- `SUPABASE_PROJECT_REF` — your project ref (the subdomain in your
  project's API URL, `https://<this-part>.supabase.co`)

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
