# Independent Claude Checker Packet — Durable Control-Plane State

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable Draft PR #8 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff the exact PR #7 merge base and PR #8 head; confirm no policy, schema, trust anchor, Project Knowledge record, or master-prompt source changed.
2. Confirm the Worker remains development-only, `ready: false`, external writes disabled, and `/v1/actions/execute` unconditionally denied.
3. Confirm HMAC/replay service authentication and the no-OAuth/no-bearer boundary are unchanged.
4. Confirm the accepted `v1` replay migration is byte-for-byte preserved and `v2` adds exactly the three new SQLite Durable Object classes.
5. Confirm the four Durable Object bindings and class exports are exact; no D1, R2, Queue, Workflow, service, provider, route, account, or production binding was added.
6. Verify sharding: idempotency by scope digest, owner decision by decision ID, and audit by scope digest; reject any global singleton shard.
7. Verify every namespace adapter validates keys and advertises only the durability/atomicity properties its Durable Object actually provides.
8. Stress idempotency with concurrent reservations. Confirm exactly one winner, active/completed duplicate denial, expiry recovery, stale-lease rejection, exact-lease release, and duration bounds.
9. Stress owner decisions with identical and conflicting action digests. Confirm each decision ID is consumable exactly once and that direct RPC input cannot supply a decision ID different from the Durable Object's own named shard, including before the first write.
10. Stress audit appends with at least 100 concurrent events on one scope and concurrent events on multiple scopes. Inspect SQLite directly and prove sequences are gap-free, every previous digest matches, every stored canonical event matches its receipt, and no fork exists.
11. Review the optimistic audit compare-and-swap carefully. Confirm head update and event insert are in one `transactionSync()` and every losing caller recomputes from the new head.
12. Confirm malformed/non-I-JSON inputs fail before storage and no audit deletion or external fetch exists in the Durable Object or adapter code.
13. Confirm receipt verification rejects event, sequence, previous-digest, event-digest, and scope tampering.
14. Mutation-test every new CI invariant: exact binding order/classes, immutable `v1`, exact `v2`, Worker wiring, atomicity tokens, no audit deletion, and no external fetch.
15. Confirm generated types are current and the dry-run binding table lists only four Durable Objects plus the two non-secret development vars.
16. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and the exact base-to-head `git diff --check`.
17. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: DURABLE CONTROL-PLANE STATE ACCEPTED`
- `CLAUDE CHECKER: DURABLE CONTROL-PLANE STATE REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, deployment, secret or resource creation, Project Knowledge promotion, production/customer operation, external write, provider call, Queue publish, Workflow dispatch, call, message, campaign, booking, transfer, or payment.
