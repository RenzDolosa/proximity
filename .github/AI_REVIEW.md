# AI Code Review

Every pull request gets an automated architecture-level review from Claude:
inline comments on specific lines, a summary comment, and — once the branch
protection step below is enabled — critical findings block the merge
button.

## What it reviews (and what it deliberately ignores)

The prompt (`.github/scripts/ai-review.mjs`, `SYSTEM_PROMPT`) is scoped
specifically to what breaks in production, not what breaks a linter:

- SQL injection vectors (string-built queries vs. parameterized/query-builder calls)
- Business logic correctness (off-by-ones, inverted conditionals, race conditions, state that can drift out of sync)
- Unhandled edge cases (null/empty/failed-request/partial-failure paths)
- N+1 query patterns
- Performance issues with realistic production impact (unbounded result sets, missing pagination, O(n²)+ on data that can be large)
- **Anything touching auth, payments, or data deletion** always gets flagged for a human's explicit sign-off, even when the code looks correct

It's explicitly told to ignore style, formatting, naming, import order, and
other cosmetic concerns — those are what a linter/formatter is for, not
this.

## Severity and what it means for merging

- **critical** — exploitable, will break in production, can corrupt/delete
  data incorrectly, or bypasses/weakens a permission check. **Fails the
  check, blocks merge** (once required, see below).
- **warning** — real but non-blocking. Shown for visibility; doesn't fail
  the check.

## One-time setup

### 1. Add the `ANTHROPIC_API_KEY` secret
Repo → **Settings → Secrets and variables → Actions → New repository
secret** → name `ANTHROPIC_API_KEY`, value your Anthropic API key
([console.anthropic.com](https://console.anthropic.com)). `GITHUB_TOKEN`
needs nothing — Actions provides it automatically with the
`pull-requests: write` scope the workflow already declares.

### 2. Merge the workflow to your default branch
`pull_request`-triggered workflows only run using the version of the
workflow file **already on the base branch** — a PR that only adds/edits
`.github/workflows/ai-review.yml` won't run itself. Merge this once
(directly, or via a PR reviewed by hand) before it starts applying to
future PRs.

### 3. Require it as a status check (this is the actual merge gate)
Repo → **Settings → Branches → Branch protection rules** → add a rule for
your default branch (e.g. `main`) → check **"Require status checks to pass
before merging"** → search for and select **"AI Code Review"** (open at
least one PR first — a status check has to have run once before it's
selectable here) → **Save**.

That's the whole gate: this job exits non-zero when there's a critical
finding, GitHub shows that as a failed required check, and the merge
button is disabled until it's resolved (new commit fixing the issue, or a
maintainer overrides branch protection if they have permission to).

Optional in the same screen, not required for the gate to work:
- **"Require branches to be up to date before merging"** — re-runs the
  check against the latest base branch state before allowing merge.
- **"Require a pull request before merging"** — if you don't already have
  this, direct pushes to the base branch skip review entirely.

**Prefer to script step 3 instead of clicking through it?**
`.github/scripts/setup-branch-protection.sh` does the same thing via the
GitHub API — see the comment at the top of that file for usage. Needs a
personal access token with `repo` scope; nothing in this repo can call it
for you since it requires your own GitHub credentials.

## How it decides what to review

The script (`.github/scripts/ai-review.mjs`) diffs the PR's base and head
commits locally in the runner (not the GitHub API's PR-files endpoint,
which truncates for large diffs/PRs) and sends Claude:
- the full unified diff
- the full post-change content of every changed file, for context a diff
  hunk alone doesn't give (e.g. the rest of a function a changed line
  lives in)

Both are capped (150K chars for the diff, 300K combined for full-file
context) so one huge PR can't blow the budget — if truncation happens,
the posted summary says so explicitly, since that means the review may be
partial and worth a manual look too.

Findings come back via a forced tool call (`tool_choice`), not
"please reply in JSON" prose — this is what makes parsing the response
reliable instead of occasionally breaking on stray markdown fences or
malformed JSON.

## Inline comments vs. the summary

Each finding with a line number gets posted as an inline PR comment. If
GitHub rejects a specific one (its line isn't part of this PR's diff
hunks — this happens when a finding is about code adjacent to, but not
literally inside, the changed lines), that finding still appears in the
summary comment with a note that it couldn't be attached inline. Nothing
found is ever silently dropped.

## Why the merge gate is a status check, not a "required review"

GitHub has two separate gating mechanisms: **required status checks**
(what step 3 above sets up — gates on a CI job's pass/fail) and **required
reviews** (gates on a human, or an app acting as a reviewer, formally
approving/requesting changes). This pipeline deliberately uses only the
first. The script does post a real PR review (`REQUEST_CHANGES` when
there's a critical finding, `COMMENT` otherwise) so the inline comments
render grouped and readable — but that review is for visibility, not
enforcement. Tying merge-blocking to "required reviews" instead would mean
a stale bot review could need to be manually dismissed to unblock a PR
even after the underlying issue's fixed and a fresh run passed; a status
check just reflects the latest run's result automatically.

## Tuning

- **Model**: set via `AI_REVIEW_MODEL` in `.github/workflows/ai-review.yml`
  (defaults to `claude-opus-5`). Swap to `claude-sonnet-5` for lower
  cost/latency if review quality is holding up fine for your PR sizes.
- **What counts as "sensitive"**: edit the auth/payment/deletion list in
  the system prompt in `ai-review.mjs` if your definition of "sensitive
  area" should be narrower, broader, or project-specific (e.g. naming
  specific files/tables).
- **Severity bar**: if `critical` is firing on things you'd rather treat
  as advisory, tighten the severity guidance in the system prompt rather
  than changing the gating logic — the gating logic just trusts whatever
  severity Claude assigns.
