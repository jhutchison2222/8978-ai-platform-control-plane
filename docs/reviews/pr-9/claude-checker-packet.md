# Independent Claude Checker Packet — Read-Only Authoritative D1 Runtime

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable Draft PR #9 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff the exact PR #8 merge base and PR #9 head. Confirm the only runtime addition is the read-only authority adapter, its migration, tests, documentation, secret-scan coverage, and CI invariants.
2. Confirm no standing policy, schema, trust-anchor digest, Project Knowledge record, or master-prompt source changed.
3. Confirm `wrangler.jsonc` remains byte-for-byte unchanged: no D1/account/database/route/provider binding, no deploy target, four existing Durable Objects only, external writes disabled, and workers.dev/preview URLs disabled.
4. Confirm the development Worker and `createDevelopmentRuntime()` remain unbound from `AUTHORITY_DB`, readiness remains false, evaluation remains fail-closed in the deployed shape, and `/v1/actions/execute` remains unconditionally denied.
5. Confirm service authentication remains HMAC-SHA256 with Durable Object replay defense and no OAuth/bearer fallback.
6. Review `0001_authority_read_model.sql`: exact status and enabled constraints, ordered validity windows, positive versions, non-negative limits, risk enumeration, and lookup indexes.
7. Confirm the runtime adapter contains parameterized `SELECT` statements only—no INSERT, UPDATE, DELETE, DDL, external fetch, or write-capable method.
8. Confirm resource lookup requires exactly one enabled, active `CURRENT` or `FINAL` record and rejects missing, future, expired, disabled, ambiguous, malformed, or tampered data.
9. Confirm strict JSON parsing rejects duplicate keys; resource schema, derived resource key, and RFC 8785 SHA-256 content digest are all verified before return.
10. Confirm limit lookup derives the key from the validated resolved resource, matches the exact operation, requires one active record, validates types/ranges/evidence digest, and returns the supplied action digest unchanged.
11. Attempt locator/operation injection and caller-supplied provider/environment fields. Verify prepared binding and exact requested-target shape reject them.
12. Run the actual migration and adapter in the Cloudflare Workers Vitest pool using real local D1, not a handwritten database mock.
13. Confirm the gateway integration test reaches `validation_required` for identity, tests, and rollback—proving resolution and limits passed—without authorizing or executing anything.
14. Mutation-test every new CI invariant, including read-only SQL, migration constraints/indexes, test-only D1 setup, no Worker/runtime binding, and migrations secret-scan coverage.
15. Confirm `pk-d1-dev` is not reused or modified and no Cloudflare resource, secret, migration, or deployment was created remotely.
16. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and the exact base-to-head `git diff --check`.
17. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: AUTHORITY READ MODEL ACCEPTED`
- `CLAUDE CHECKER: AUTHORITY READ MODEL REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, deployment, D1 creation or binding, migration application outside the local test runtime, authority write or promotion, secret creation, Project Knowledge promotion, production/customer operation, external write, provider call, Queue publish, Workflow dispatch, call, message, campaign, booking, transfer, or payment.
