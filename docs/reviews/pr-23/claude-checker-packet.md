# Independent Claude Checker Packet — D1 Development Activation Preflight Runtime Composition

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #23 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff exact PR #22 merge base `4bda49c256ef79274a3ab448bcfd1fb808c15348` against the PR #23 head. Confirm scope is limited to one unwired preflight evaluator, Node and real Workers/D1 tests, documentation, checker packet, and CI invariants.
2. Confirm `wrangler.jsonc`, Worker, development runtime, activation preflight and checked-in plan, all schemas and six migrations, every PR #16–#22 evidence component, service authentication, policies, Durable Objects, Project Knowledge, and master-prompt source material are byte-for-byte unchanged.
3. Confirm the evaluator only constructs the reviewed PR #22 D1 evidence chain and passes it to the existing preflight as `evidenceVerifier`; it cannot alter, replace, or bypass preflight plan validation or blockers.
4. Confirm constructor failures from invalid/missing D1, exact options, writer identity, reviewed commit, or clock propagate fail-closed.
5. Confirm the same database and clock references reach all PR #22 components and no ambient/global/environment fallback exists.
6. Confirm evaluator injection removes only `independent_evidence_verifier_unavailable`, leaving the other 19 blockers without any D1 query, evidence verification, resource action, or external effect. Separately confirm the unchanged default preflight still returns exactly 20 blockers for the checked-in plan.
7. Run the actual PR #18 HMAC writer against real migrated local D1 and then evaluate the in-memory fully gated test plan through the PR #23 evaluator. Confirm readiness depends on the complete PR #16–#22 chain.
8. Confirm the fully gated plan is test-only and cannot modify or replace `deployment/development-activation-plan.json`.
9. Mutation-test chain omission/substitution, preflight bypass, forced-ready return, swallowed construction errors, second database/clock, ambient fallback, runtime/preflight/plan import drift, and addition of SQL/fetch/secret/OAuth/resource/deployment behavior.
10. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
11. Confirm the checked-in plan remains `PLANNED`, non-governing, unauthorized, unbound, unmigrated, schema-unverified, evidence-empty, and blocked by exactly 20 gates. Confirm `pk-d1-dev`, `deployment_versions`, Cloudflare resources, and external systems are untouched.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: D1 ACTIVATION PREFLIGHT RUNTIME COMPOSITION ACCEPTED`
- `CLAUDE CHECKER: D1 ACTIVATION PREFLIGHT RUNTIME COMPOSITION REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, activation, deployment, resource creation/deletion, binding, migration application, database/evidence write, key/secret installation, external write, provider call, Queue publish, Workflow dispatch, customer/production operation, call, message, campaign, booking, transfer, or payment.
