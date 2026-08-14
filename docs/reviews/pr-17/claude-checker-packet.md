# Independent Claude Checker Packet — Development Activation Evidence Bundle Provider

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #17 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff exact PR #16 merge base `38e38a3d292297eff7259b27258fc29db954f1d8` against the PR #17 head. Confirm scope is limited to the empty fifth authority migration, read-only evidence-bundle provider, real D1 tests, activation migration manifest/schema updates, documentation, checker packet, and CI invariants.
2. Confirm `wrangler.jsonc`, `src/control-plane-worker.js`, `src/development-runtime.js`, all prior migrations and adapters, policies, trust anchors, service authentication, Durable Objects, Workflow/Queue adapters, Project Knowledge, and master-prompt source are byte-for-byte unchanged.
3. Confirm migration `0005` creates exactly one empty evidence-bundle table and one index, contains no seed row or artifact, and is pinned by exact byte digest and order in both the plan and source constant.
4. Confirm the activation plan remains `PLANNED`, `governing:false`, unauthorized, unbound, unmigrated, schema-unverified, and contains no database ID or evidence digest. Confirm its blocker count remains exactly 20.
5. Confirm the provider uses only one parameterized `SELECT`; contains no write SQL, `fetch`, REST/OAuth, service credential, private key, process/filesystem action, Queue/Workflow operation, or provider mutation; and is not imported by the Worker or development runtime.
6. Confirm requests require exactly one reviewed commit plus six well-formed unique evidence digests and that all seven values participate in the parameterized lookup.
7. Confirm only one enabled active `CURRENT`/`FINAL` row can be accepted; missing, disabled, expired, mismatched, query-failed, and ambiguous states fail closed.
8. Confirm strict canonical JSON and duplicate-key rejection, the 64 KiB UTF-8 bound, exact bundle/owner-decision fields, token bounds, approved Ed25519 boundary, bundle digest, and record digest all fail closed on tampering.
9. Independently recompute the bundle and record digests from a real local D1 row. Confirm the record digest binds record ID, status, reviewed commit, complete evidence request, bundle digest, validity interval, and version.
10. Run the real Workers/D1 test using `applyD1Migrations()` and actual `env.AUTHORITY_DB.prepare().bind().all()` calls. Confirm the migration table starts empty and no remote D1 is touched.
11. Mutation-test every new CI invariant, including migration removal/order/digest drift, table constraints/index/seed prohibition, request-field or digest-uniqueness weakening, omitted SQL binding, active/current/unique-row weakening, canonical/digest checks, read-only/fetch prohibition, and runtime import prohibition.
12. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
13. Confirm `pk-d1-dev`, `deployment_versions`, and Cloudflare resources are untouched. Record findings by severity with exact file/section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: ACTIVATION EVIDENCE BUNDLE PROVIDER ACCEPTED`
- `CLAUDE CHECKER: ACTIVATION EVIDENCE BUNDLE PROVIDER REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, activation, deployment, resource creation/deletion, binding, migration application, database/evidence write, key/secret installation, external write, provider call, Queue publish, Workflow dispatch, customer/production operation, call, message, campaign, booking, transfer, or payment.
