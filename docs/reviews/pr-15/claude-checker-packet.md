# Independent Claude Checker Packet — Development Activation Preflight

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #15 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff exact PR #14 merge base `848190a3517c7b23c537450a5f1e6832f1690f8d` against the PR #15 head. Confirm scope is limited to the inert activation plan/schema/preflight, tests, documentation, secret-scan coverage, and CI invariants.
2. Confirm `wrangler.jsonc`, `src/control-plane-worker.js`, `src/development-runtime.js`, all runtime adapters, migrations, policies, trust anchors, Project Knowledge, master-prompt source, HMAC service-auth, and Durable Objects are byte-for-byte unchanged.
3. Confirm the plan is `PLANNED`, `governing:false`, development-only, activation unauthorized, Worker deployment unauthorized, and every resource/binding/migration/schema state flag is false.
4. Confirm the plan contains no D1 database ID, secret, credential, key, token, account ID, route, customer/production identifier, or deployable placeholder binding.
5. Confirm both the `pk-d1-dev` name and known database identifier are explicitly prohibited from authority-runtime reuse.
6. Independently recompute all four migration SHA-256 digests from exact file bytes and confirm path, order, and digest equality with the plan and source constants.
7. Confirm exact identities for the development Worker, dedicated authority D1, Workflow, Queue, and Workflow class.
8. Confirm readiness requires every resource-created/binding-installed/migrations-applied/schema-verified flag, a valid non-prohibited D1 UUID, distinct maker/checker validation digests, reviewed commit, distinct resource-activation and Worker-deployment owner-authorization digests, rollback evidence, backup digest, both authorization booleans, and a separately injected evidence verifier.
9. Confirm rollback is fixed to `unbind_before_delete`, requires unbinding first, forbids automatic resource deletion, and restores to the exact PR #14 merge commit.
10. Confirm the module is validation-only and unreachable from the Worker: no fetch, REST API, Wrangler/process execution, filesystem write, D1 query/write, migration command, Workflow dispatch, Queue publish, secret access, provider action, or deployment entrypoint.
11. Confirm the current checked-in plan reports exactly 20 blockers, including `independent_evidence_verifier_unavailable`, and can never be mistaken for ready.
12. Confirm a fully populated test fixture remains blocked without a verifier, verifier errors fail closed, maker/checker/owner principals must be pairwise distinct, every returned evidence digest and reviewed commit must equal the requested values, and ready is possible only after every structural gate plus independent evidence verification succeeds. Mutation-test each gate independently.
13. Mutation-test CI against plan promotion, authorization flips, resource/binding/migration/schema flips, D1 identifier insertion, migration digest/order drift, prohibited database weakening, rollback weakening, source-side dangerous API insertion, Wrangler binding addition, readiness enablement, and execute-denial weakening.
14. Confirm deployment manifests are covered by the default secret scanner and independently inject a fake credential into a scratch manifest to prove detection.
15. Confirm `pk-d1-dev` is untouched and `deployment_versions` remains empty. No Cloudflare resource, binding, migration, secret, Workflow, Queue, deployment, or provider action may be created.
16. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
17. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: DEVELOPMENT ACTIVATION PREFLIGHT ACCEPTED`
- `CLAUDE CHECKER: DEVELOPMENT ACTIVATION PREFLIGHT REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, deployment, resource creation/deletion, binding, migration application, database read/write, backup/restore, key/secret installation, record insertion/promotion, production/customer operation, external write, provider call, Queue publish, Workflow dispatch, call, message, campaign, booking, transfer, or payment.
