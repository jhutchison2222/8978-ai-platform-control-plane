# Independent Claude Checker Packet — PR #28 Authority Migration Execution Packet

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT A BRANCH OR MAKER SUMMARY

Candidate commit: use the immutable draft PR #28 head SHA recorded in the PR description.

## Required checks

1. Diff exact base `ebd7a82dc47095814de2dc663c5615d60e87b0e1` against the exact PR #28 head and confirm the complete scope.
2. Recompute and confirm the unchanged resource-reconciled plan digest `3621dc92abf5c309d4a92a86cf4dc3f01da473d88c273697c9e91e9e7d092825` and completion-record digest `98f9c0623e2240aad87d68f9fdc7b3fe895d0853308d272c9398ec6858815747`.
3. Confirm the migration-only config digest `7d028839586d0009ff88ec172da85efaa0bb1e05b43644af65f37dd1cd7fbd26`, exact D1 identity, and `../migrations/authority` directory.
4. Confirm the migration-only config cannot deploy the Worker, is not the deployable `wrangler.jsonc`, and contains no Worker entry point, Queue, Workflow, route, service, secret, environment variable, Durable Object, or deployment setting.
5. Recompute all six migration digests and confirm their exact order. Confirm the SQL is DDL-only and contains no seed or authority/business/evidence DML.
6. Confirm `executionAuthorized:false`, unresolved account ID, attempt limit one, and exact owner authorization is required before execution.
7. Confirm backup requires both a Time Travel bookmark and an ephemeral untracked SQL export digest before migration.
8. Confirm restore, automatic restore, retry, cleanup, deletion, schema certification, plan update, binding, Workflow, Queue connection/message, secret/key, evidence insertion, deployment, and activation remain prohibited.
9. Confirm the checked-in historical and resource-reconciled activation plans remain byte-for-byte unchanged and blocked by 20 and 17 gates respectively.
10. Mutation-test authorization, account, D1 identity/region/version/empty state, migration config/directory/digest, backup weakening, attempt-count expansion, migration order/digest/DML, restore/retry/cleanup authorization, runtime import, source-plan drift, completion-record drift, activation-plan drift, and deployable Wrangler drift.
11. Validate exact Wrangler 4.x help or current official Cloudflare documentation for the pinned Time Travel, export, pending-list, and apply command forms without executing a remote operation.
12. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
13. Perform no Cloudflare, GitHub, Project Knowledge, Queue, Worker, Workflow, D1, SQL, migration, export, bookmark, or other external write/read beyond ordinary public documentation retrieval during review.

## Required terminal result

End with exactly one terminal line:

- `CLAUDE CHECKER: PR #28 AUTHORITY MIGRATION EXECUTION PACKET ACCEPTED`
- `CLAUDE CHECKER: PR #28 AUTHORITY MIGRATION EXECUTION PACKET REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit and authorizes no merge or external action.
