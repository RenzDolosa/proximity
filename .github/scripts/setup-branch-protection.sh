#!/usr/bin/env bash
# One-time convenience script for AI_REVIEW.md step 3 — requires "AI Code
# Review" as a status check on your default branch via the GitHub API,
# instead of clicking through Settings > Branches.
#
# Nothing in the repo/CI can run this for you: it needs a personal access
# token with `repo` scope (classic) or `Administration: write` (fine-grained)
# for THIS repository, which only you can provide.
#
# Usage:
#   GITHUB_TOKEN=ghp_xxx ./.github/scripts/setup-branch-protection.sh [branch]
# `branch` defaults to `main`.
#
# This only ADDS "AI Code Review" to the required-checks list; it fetches
# your branch's current protection settings first and merges into them, so
# it won't clobber other rules (required reviews, force-push restrictions,
# etc.) you already have set up.

set -euo pipefail

# Handles https/ssh remotes with or without a trailing .git or slash — the
# previous pattern required ".git" and, on a plain https://github.com/o/r
# remote, matched nothing and passed the whole URL through as the "slug".
REPO_SLUG="$(git config --get remote.origin.url | sed -E 's#^.*github\.com[:/]##; s#/$##; s#\.git$##')"
BRANCH="${1:-main}"
: "${GITHUB_TOKEN:?Set GITHUB_TOKEN to a personal access token with repo admin access first.}"

API="https://api.github.com/repos/${REPO_SLUG}/branches/${BRANCH}/protection"
AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "Repo: ${REPO_SLUG}, branch: ${BRANCH}"

existing="$(curl -s "${AUTH[@]}" "${API}" || true)"
if echo "${existing}" | grep -q '"message": *"Branch not protected"'; then
  existing_contexts="[]"
else
  existing_contexts="$(echo "${existing}" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try{const j=JSON.parse(d);const c=j.required_status_checks?.contexts||[];console.log(JSON.stringify(c));}
      catch{console.log("[]");}
    });
  ')"
fi

new_contexts="$(node -e "
  const existing = ${existing_contexts};
  const merged = Array.from(new Set([...existing, 'AI Code Review']));
  console.log(JSON.stringify(merged));
")"

echo "Required status checks will be: ${new_contexts}"

# PUT replaces the whole protection object — GitHub has no PATCH for this
# endpoint, so pull the required fields (or reasonable defaults) forward
# rather than dropping everything else that was set.
payload="$(node -e "
  const d = process.argv[1] ? JSON.parse(process.argv[1]) : {};
  const isProtected = !(d && d.message === 'Branch not protected');
  const out = {
    required_status_checks: { strict: true, contexts: ${new_contexts} },
    enforce_admins: isProtected ? !!d.enforce_admins?.enabled : false,
    required_pull_request_reviews: isProtected ? (d.required_pull_request_reviews || null) : null,
    restrictions: isProtected ? (d.restrictions || null) : null,
  };
  console.log(JSON.stringify(out));
" "${existing}")"

curl -s -X PUT "${AUTH[@]}" -H "Content-Type: application/json" -d "${payload}" "${API}" | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    try {
      const j = JSON.parse(d);
      if (j.message) { console.error("GitHub API error:", j.message, j.documentation_url || ""); process.exit(1); }
      console.log("Done — required status checks:", (j.required_status_checks?.contexts || []).join(", "));
    } catch (e) { console.error("Unexpected response:", d); process.exit(1); }
  });
'
