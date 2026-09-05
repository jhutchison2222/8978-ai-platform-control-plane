# PR #62 Final Independent Checker Packet

Review the complete current pull-request head against `main`. This packet governs the final exact-head verdict for the GitHub-only autonomous supervisor watchdog.

1. Confirm the diff is limited to GitHub repository coordination: the autonomous supervisor workflow, supervisor implementation, tests, documentation, and this checker packet.
2. Confirm the workflow permissions are exactly least-privilege for its behavior: `actions:read`, `checks:read`, `contents:read`, `issues:write`, and `pull-requests:write`; no contents write or Cloudflare credential is introduced.
3. Confirm one PR/task failure cannot abort supervision of other PRs or queued tasks.
4. Confirm only genuine exact-head Claude reviews are accepted; dismissed reviews, ambiguous prose, untrusted comments, and stale-head reviews cannot satisfy the merge gate.
5. Confirm retry markers are authenticated by the workflow’s own deterministic marker format, limited to three review requests and three task dispatches, and cannot be inflated by arbitrary commenters.
6. Confirm at most one accepted Workspace Agent task dispatch occurs per supervisor cycle.
7. Confirm an accepted HTTP 202 trigger is recorded as dispatch acceptance, not task completion; stalled tasks retry only after 15 minutes and stop after the cap.
8. Confirm linked work is limited to pull requests whose `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR` and that contain same-repository closing references or task branches; untrusted contributors, missing trust metadata, cross-repository issue URLs, and incidental text do not suppress dispatch.
9. Confirm active draft work pauses duplicate dispatch while an inactive draft returns to the bounded retry/block path.
10. Confirm stall evidence is recorded idempotently before supplementary labels and no cycle produces duplicate request, dispatch, or block markers.
11. Confirm scheduled/manual/event wakeups cannot execute Cloudflare, D1, Queue, Workflow, deployment, production/customer, secret-changing, permission-expanding, deletion, cleanup, restore, or rollback operations.
12. Run the complete repository validation suite and inspect every prior review thread. No unresolved actionable finding may survive.

Return exactly one final verdict bound to the current full head SHA:

`ACCEPTED — exact head <FULL_SHA> — no surviving actionable findings.`

or

`REJECTED — exact head <FULL_SHA>`

followed by every surviving actionable finding.

Do not return an empty review, “nothing new to post,” “code review completed,” or optional-suggestions-only prose in place of the required verdict.
