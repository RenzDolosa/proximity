#!/usr/bin/env node
// AI PR review — see .github/AI_REVIEW.md for the full writeup of what
// this does and how to configure it. Short version: gathers the PR's
// diff + full content of changed files, asks Claude for an
// architecture-level review (not a linter — see the system prompt below),
// posts inline comments + a summary on the PR, and exits non-zero if any
// finding is "critical" — that non-zero exit is what makes this job's
// GitHub status check fail, which is the actual merge-blocking mechanism
// once it's set as a required status check (see AI_REVIEW.md — that part
// can't be done from a workflow file, it's a repo settings change).

import { execSync } from 'node:child_process';

const {
  ANTHROPIC_API_KEY,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  BASE_SHA,
  HEAD_SHA,
  AI_REVIEW_MODEL = 'claude-opus-5',
} = process.env;

for (const [name, val] of Object.entries({ ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, BASE_SHA, HEAD_SHA })) {
  if (!val) { console.error(`Missing required env var: ${name}`); process.exit(1); }
}

const [OWNER, REPO] = GITHUB_REPOSITORY.split('/');

// Budgets — keep a single very large PR from either blowing the model's
// context or the API bill. If truncation happens, that's disclosed in the
// posted summary rather than silently reviewing a partial diff.
const MAX_DIFF_CHARS = 150_000;
const MAX_FILE_CONTENT_CHARS = 20_000; // per changed file, when including full post-change content
const MAX_TOTAL_CONTEXT_CHARS = 300_000; // across all included full files combined

// ---------------------------------------------------------------------
// 1. Gather the diff, plus full post-change content of changed files for
//    context a diff hunk alone can't give (e.g. the rest of a function
//    a changed line lives in).
// ---------------------------------------------------------------------

function sh(cmd) {
  return execSync(cmd, { maxBuffer: 1024 * 1024 * 50 }).toString();
}

const changedFiles = sh(`git diff --name-only ${BASE_SHA} ${HEAD_SHA}`)
  .split('\n').map((s) => s.trim()).filter(Boolean);

if (!changedFiles.length) {
  console.log('No changed files — nothing to review.');
  process.exit(0);
}

let diff = sh(`git diff ${BASE_SHA} ${HEAD_SHA}`);
let diffTruncated = false;
if (diff.length > MAX_DIFF_CHARS) {
  diff = diff.slice(0, MAX_DIFF_CHARS);
  diffTruncated = true;
}

let fileContext = '';
let contextTruncated = false;
let budget = MAX_TOTAL_CONTEXT_CHARS;
for (const file of changedFiles) {
  if (budget <= 0) { contextTruncated = true; break; }
  let content;
  try {
    content = sh(`git show ${HEAD_SHA}:"${file}"`);
  } catch {
    continue; // deleted, binary, or otherwise unreadable — the diff hunk alone is fine for these
  }
  if (content.length > MAX_FILE_CONTENT_CHARS) {
    content = content.slice(0, MAX_FILE_CONTENT_CHARS);
    contextTruncated = true;
  }
  const block = `\n\n---- FULL FILE (post-change): ${file} ----\n${content}`;
  if (block.length > budget) { contextTruncated = true; break; }
  fileContext += block;
  budget -= block.length;
}

// ---------------------------------------------------------------------
// 2. Ask Claude for a structured review. Forced tool use (tool_choice)
//    instead of "please respond in JSON" prose — reliable parsing, no
//    fragile markdown-fence stripping or retry-on-malformed-JSON logic
//    needed.
// ---------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior staff engineer performing an architecture-level code review of a pull request diff. You are NOT a linter — completely ignore code style, formatting, naming conventions, import ordering, whitespace, comment style, and other cosmetic concerns, even if you notice them. Never create a finding about any of those.

Focus exclusively on things that would actually break in production or cause harm:

1. SQL injection vectors — any raw string concatenation/interpolation used to build a SQL query, or to build arguments passed into one, especially in database migrations/functions or backend/edge-function code. Parameterized queries and query-builder methods that bind values (rather than interpolating them into a string) are safe; string-built SQL is not — flag it even if the current inputs happen to be trusted, since that trust boundary can move.
2. Business logic correctness — does the code actually do what it's supposed to? Off-by-one errors, inverted or incomplete conditionals, race conditions, state that can get out of sync between related records, permission checks that can be bypassed or that check the wrong condition.
3. Unhandled edge cases — null/undefined, empty collections, a failed network/API call, concurrent modification, partial failure of a multi-step operation (e.g. one write succeeds and a related write fails, leaving inconsistent state), integer overflow on realistic inputs.
4. N+1 query patterns — a loop that issues one database/API call per item instead of a single batched call. Flag both newly introduced ones and any the diff had an opportunity to fix but didn't.
5. Performance issues with realistic production impact — not micro-optimizations, but unbounded result sets, missing pagination on something that will grow, O(n^2)+ behavior on data that can be large, or work repeated unnecessarily on every render/request that should be cached or done once.

Extra scrutiny — ALWAYS create a finding with category "sensitive-area" for any change that touches:
- Authentication or authorization (sign-in/sign-up, session/token handling, role or permission checks, row-level-security policies, anything gating who can see or do what)
- Payment or billing code, if any exists in this diff
- Data deletion, single-row or bulk, including cascading deletes and anything that could end up deleting more than the user intended
Create this finding even if the code looks correct — these areas warrant a human's explicit sign-off regardless, so say so plainly and note specifically what to double-check.

Severity:
- "critical": will break in production, is exploitable, can corrupt or delete data incorrectly, or bypasses/weakens an auth or permission check. Blocks the PR from merging.
- "warning": worth knowing but not launch-blocking — a real but lower-impact issue, an edge case that's unlikely but possible, a performance concern that isn't urgent. Informational only, does not block merging.

For every finding, reference the specific file and, where the diff makes it possible, a specific line number in the post-change (new) version of the file. Be concrete and actionable: say what's wrong, why it matters, and briefly what a fix looks like. Don't pad the review with restated context, praise, or a change-by-change narration — if the diff is clean, say so briefly and return an empty findings array.

You'll receive the unified diff for this PR, plus the full post-change content of each changed file for additional context a diff hunk alone can't provide. Use that full-file context to understand the surrounding logic, but only raise findings about what changed or is directly affected by what changed — don't audit the rest of a file's pre-existing code as though it were new in this PR.

Respond only by calling the submit_code_review tool.`;

const REVIEW_TOOL = {
  name: 'submit_code_review',
  description: 'Submit the architecture-level code review findings for this pull request diff.',
  input_schema: {
    type: 'object',
    required: ['summary', 'findings', 'verdict'],
    properties: {
      summary: { type: 'string', description: '2-4 sentence overview of what the PR does and the overall review outcome.' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['file', 'severity', 'category', 'message'],
          properties: {
            file: { type: 'string', description: 'Path to the affected file, exactly as it appears in the diff.' },
            line: { type: 'integer', description: 'Line number in the NEW (post-change) version of the file this finding applies to. Omit if the finding is not tied to one specific line.' },
            severity: { type: 'string', enum: ['critical', 'warning'] },
            category: { type: 'string', enum: ['security', 'performance', 'logic', 'sensitive-area'] },
            message: { type: 'string', description: 'Specific, actionable explanation of the issue, why it matters, and what a fix looks like.' },
          },
        },
      },
      verdict: { type: 'string', enum: ['approve', 'request_changes'] },
    },
  },
};

let userContent = `PR #${PR_NUMBER} diff (base ${BASE_SHA.slice(0, 7)} -> head ${HEAD_SHA.slice(0, 7)}):\n\n${diff}`;
if (diffTruncated) userContent += '\n\n[diff truncated — this PR is large enough that part of it was cut off before review]';
userContent += `\n${fileContext}`;
if (contextTruncated) userContent += '\n\n[full-file context truncated for size — some changed files are only reflected in the diff above, not shown in full]';

const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: AI_REVIEW_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [REVIEW_TOOL],
    tool_choice: { type: 'tool', name: 'submit_code_review' },
    messages: [{ role: 'user', content: userContent }],
  }),
});

if (!anthropicRes.ok) {
  const body = await anthropicRes.text();
  console.error(`Anthropic API error (${anthropicRes.status}): ${body}`);
  process.exit(1);
}

const anthropicData = await anthropicRes.json();
const toolUse = anthropicData.content?.find((b) => b.type === 'tool_use' && b.name === 'submit_code_review');
if (!toolUse) {
  console.error('Claude did not return a submit_code_review tool call. Raw response:', JSON.stringify(anthropicData));
  process.exit(1);
}
const review = toolUse.input;
const findings = Array.isArray(review.findings) ? review.findings : [];
const criticalCount = findings.filter((f) => f.severity === 'critical').length;
const warningCount = findings.length - criticalCount;

// ---------------------------------------------------------------------
// 3. Post to the PR: inline comments per finding (best-effort — a
//    finding on a line outside the diff's hunks can't be attached inline,
//    GitHub's API will reject that specific comment) + one summary review
//    that also restates every finding, so nothing is lost even if some
//    inline placements fail.
// ---------------------------------------------------------------------

const GH_API = 'https://api.github.com';
const ghHeaders = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': `${REPO}-ai-review`,
};

async function gh(method, path, body) {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: { ...ghHeaders, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

const inlineFailed = [];
for (const f of findings) {
  if (f.line == null) continue; // no specific line — goes in the summary only
  const { ok } = await gh('POST', `/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/comments`, {
    commit_id: HEAD_SHA,
    path: f.file,
    line: f.line,
    side: 'RIGHT',
    body: `**[${f.severity.toUpperCase()} · ${f.category}]** ${f.message}`,
  });
  if (!ok) inlineFailed.push(f); // most likely: that line isn't part of this PR's diff hunks
}

function severityEmoji(s) { return s === 'critical' ? '🔴' : '🟡'; }

const lines = [
  `## 🤖 AI Code Review`,
  '',
  review.summary || '_(no summary provided)_',
  '',
  `**${criticalCount} critical, ${warningCount} warning${warningCount === 1 ? '' : 's'}.** Critical findings block merge (see \`.github/AI_REVIEW.md\`); warnings are informational.`,
];
if (diffTruncated || contextTruncated) {
  lines.push('', '> ⚠️ This PR was large enough that some content was truncated before review — treat this as a partial review and consider a manual pass too.');
}
if (findings.length) {
  lines.push('', '### Findings', '');
  for (const f of findings) {
    const loc = f.line != null ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``;
    const inlineNote = f.line != null && !inlineFailed.includes(f) ? '' : f.line != null ? ' _(could not attach inline — line outside this PR\'s diff)_' : '';
    lines.push(`- ${severityEmoji(f.severity)} **[${f.category}]** ${loc}${inlineNote}: ${f.message}`);
  }
}

const summaryBody = lines.join('\n');
const reviewEvent = criticalCount > 0 ? 'REQUEST_CHANGES' : 'COMMENT';
// Note: this posts as a real PR review (so the inline comments render
// correctly grouped under it), but the event is deliberately COMMENT/
// REQUEST_CHANGES rather than relying on GitHub's separate "required
// reviewers" gate — the actual merge gate is this job's exit code below,
// via required status checks. Two different GitHub features; see
// .github/AI_REVIEW.md for why that split is intentional.
const reviewPost = await gh('POST', `/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/reviews`, {
  commit_id: HEAD_SHA,
  event: reviewEvent,
  body: summaryBody,
});
if (!reviewPost.ok) {
  console.error('Failed to post PR review:', JSON.stringify(reviewPost.data));
  // Fall back to a plain issue comment so feedback isn't lost entirely.
  await gh('POST', `/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`, { body: summaryBody });
}

console.log(`Review posted. ${criticalCount} critical, ${warningCount} warning(s).`);
if (criticalCount > 0) {
  console.error(`Failing this check: ${criticalCount} critical finding(s) must be resolved before merge.`);
  process.exit(1);
}
process.exit(0);
