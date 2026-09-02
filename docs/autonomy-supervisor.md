# Autonomous supervisor

The repository supervisor closes the event gap between validation, independent Claude review, remediation, and merge-gate execution. It runs every five minutes and can also be dispatched manually. It performs GitHub and Workspace Agent coordination only; it does not call Cloudflare, deploy code, modify secrets, access customer systems, or authorize production operations.

For each non-draft pull request, the supervisor waits for completed checks. Failed checks are routed to the Workspace Agent after a ten-minute fallback delay, giving the normal event dispatcher time to act first. Passing checks require an explicit Claude verdict bound to the exact head commit. Missing or inconclusive reviews cause at most three `@claude` requests: immediately, after ten minutes, and after another fifteen minutes. Fifteen minutes after the third unanswered request, the supervisor applies `autonomy-blocked` and dispatches the Workspace Agent with the stalled-review evidence. An exact-head rejection is dispatched for remediation. An exact-head acceptance is dispatched after the same ten-minute fallback delay to the existing merge gate, which must independently retrieve fresh evidence before merging.

HTML comment markers and deterministic Workspace Agent idempotency keys prevent repeated requests or duplicate merge/remediation dispatches for the same head and reason. A new commit creates a new exact-head review cycle.

Open issues labeled `autonomy-ready` form the task queue. The oldest eligible task is dispatched when no non-draft pull request is open. An issue labeled `autonomy-parallel` may be dispatched while pull requests are pending. Dispatched tasks receive `autonomy-dispatched`. Issues labeled `security-review` or `major-decision` are held for owner authorization.

The supervisor creates these six repository labels if they do not already exist. It never changes an existing label definition.

The workflow has only `actions: read`, `checks: read`, `contents: read`, `issues: write`, and `pull-requests: write`. It has no `contents: write` permission and therefore cannot modify code or merge directly. Clean-code merging remains the responsibility of the Workspace Agent under the owner's standing authorization and the repository's exact-head independent-review policy.
