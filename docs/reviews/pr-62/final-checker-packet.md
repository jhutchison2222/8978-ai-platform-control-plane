# PR #62 Final Independent Checker Packet

Review the complete current pull-request head against `main`. This packet governs the final exact-head verdict for the GitHub-only autonomous supervisor watchdog.

1. Confirm the diff is limited to GitHub repository coordination: the autonomous supervisor and independent watchdog workflows, their implementation, tests, documentation, and this checker packet.
2. Confirm the supervisor permissions are exactly least-privilege for its behavior: `actions:read`, `checks:read`, `contents:read`, `issues:write`, and `pull-requests:write`; no contents write or Cloudflare credential is introduced.
3. Confirm the separate watchdog has only `contents:read`, `issues:write`, and `pull-requests:read`; it receives no Workspace Agent ID/token and cannot dispatch, modify code, review, or merge.
4. Confirm canonical security-stop issue `#66` blocks every new Workspace Agent dispatch while open regardless of label removal, and an open PR changing either automation workflow or dispatch-boundary script reopens that persistent stop.
5. Confirm the supervisor and watchdog never close canonical issue `#66`, and only a closure by the exact repository owner reactivates dispatch; an unauthorized closure reopens the same stop without causing a permanent poison state after a later owner closure.
6. Confirm one PR/task failure cannot abort supervision of other PRs or queued tasks.
7. Confirm only a genuine exact-head Claude review containing the exact required `ACCEPTED — exact head <FULL_SHA> — no surviving actionable findings.` verdict provides technical clearance, and only after exact-head CI passes and every review thread is resolved. “Nothing new to post,” `LGTM`, “looks good,” no-finding summaries, silence, optional-only prose, deferral, explicit rejection, actionable findings, dismissed reviews, untrusted comments, stale-head reviews, failed/pending CI, and unresolved threads remain fail-closed. Owner authorization remains separate from technical clearance.
8. Confirm retry markers are authenticated by the workflow’s own deterministic marker format, limited to three review requests and three task dispatches, and cannot be inflated by arbitrary commenters.
9. Confirm at most one accepted Workspace Agent task dispatch occurs per supervisor cycle.
10. Confirm an accepted HTTP 202 trigger is recorded as dispatch acceptance, not task completion; stalled tasks retry only after 15 minutes and stop after the cap.
11. Confirm linked work is limited to pull requests whose `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR` and that contain same-repository closing references or task branches; untrusted contributors, missing trust metadata, cross-repository issue URLs, and incidental text do not suppress dispatch.
12. Confirm active draft work pauses duplicate dispatch while an inactive draft returns to the bounded retry/block path.
13. Confirm stall evidence is recorded idempotently before supplementary labels and no cycle produces duplicate request, dispatch, or block markers.
14. Confirm scheduled/manual/event wakeups cannot execute Cloudflare, D1, Queue, Workflow, deployment, production/customer, secret-changing, permission-expanding, deletion, cleanup, restore, or rollback operations.
15. Run the complete repository validation suite and inspect every prior review thread. No unresolved actionable finding may survive.

Return exactly one final verdict bound to the current full head SHA:

`ACCEPTED — exact head <FULL_SHA> — no surviving actionable findings.`

or

`REJECTED — exact head <FULL_SHA>`

followed by every surviving actionable finding.

The exact verdict above is required. No free-text no-finding summary substitutes for it, and technical clearance never replaces owner authorization for consequential activation.
