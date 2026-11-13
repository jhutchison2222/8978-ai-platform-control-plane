# Stage 1 governance proof (Part G)

This records the completion of the Stage 1 branch-protection proof: that the
six required status checks on `main` (`test`, `guard`, `supervise`,
`dispatch`, `security-gate`, `review-gate`) can all be satisfied
simultaneously on one exact commit, and that GitHub's own merge box — not
just each check's individually reported conclusion — recognizes that commit
as mergeable.

## Result

Stage 1 passed through PR #97 ("Stage-1 re-verification #2: isolate the
close/reopen variable").

- Exact verification head: `cb97d6e51968bc5696da730d42b51fba4de61665`
- Merge commit: `e2d5fa54b6c9890ac4ca68aefda7e9ce1717fc11`
- Merged by the repository owner on 2026-11-12, with branch protection's
  `enforce_admins` enabled — the merge was only possible because GitHub
  itself evaluated the commit as mergeable, not because of an owner bypass.
- All six required checks reported `success` on that exact head:
  `test`, `guard`, `supervise`, `dispatch`, `security-gate`, `review-gate`.
- The PR was never closed and reopened while open; its only `closed` event
  is the terminal merge-close.

## The Workspace Agent credential failure was unrelated to governance logic

Partway through the PR #97 verification cycle, the `dispatch` check began
failing with `HTTP 401 Incorrect API key provided` from the Workspace Agent
trigger call in `.github/workflows/dispatch-pr-merge-gate.yml`. This was an
expired `CHATGPT_WORKSPACE_AGENT_TOKEN` secret — an operational/
authentication issue, not a defect in any governance check's logic. Once the
token was rotated, `dispatch` passed again on the same exact head with no
code change.

## PR #96's close/reopen anomaly is historical, not a proof artifact

PR #96 ("Stage-1 re-verification: prove repaired review-gate retry path
post-#95") got all six required checks to report `success` individually,
but GitHub's merge box never stopped showing "Waiting for status to be
reported" for `security-gate`/`review-gate`, and `mergeable_state` stayed
`blocked` indefinitely. The leading evidence-backed explanation: PR #96 was
incidentally closed and reopened once mid-cycle (2026-10-12), which splits
check-suite lineage — `security-gate`/`review-gate` are published via a raw
Checks API call (`merge-gates.yml`'s "Publish result" step), and GitHub
attaches a new check-run to whichever check suite already exists for
`(app_id, head_sha)`. A pre-close suite's association with that commit can't
be superseded by a later check-run, even one posted long after the reopen.

PR #97 deliberately avoided that variable — it was never closed or reopened
while open — and merged cleanly, corroborating this explanation. PR #96 was
closed as superseded by #97 without being merged or repaired in place.

## Rule for future verification PRs

A PR used to verify or re-verify Stage 1 (or any required-check behavior)
must stay open and untouched — no close/reopen — for the entire verification
cycle. Closing and reopening it mid-cycle is known to permanently desynchronize
that commit's check-suite lineage from any check-run published via the raw
Checks API, with no available repair other than opening a fresh PR on a new
commit.

## Manual Claude Code Review trigger

The `claude[bot]` GitHub App is triggered by a PR comment that mentions
`@claude`; there is no separate activation step. For that review to be
recognized by `review-gate`, its verdict must match one of the canonical
phrasings in `scripts/autonomy-supervisor.js` (for example
`ACCEPTED — exact head <sha> — no surviving actionable findings.`, or the
free-form "no issues" / "nothing new to post" phrasings matched by
`CLEAR_INITIAL_REVIEW` / `CLEAR_REREVIEW`). A genuine review worded outside
those patterns is treated as fail-closed by design, not as a bug — this is
the same behavior that blocked `review-gate` on PR #94 for several weeks.
