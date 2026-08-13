# Independent Claude Checker Packet — Governing Project Knowledge Reader

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #11 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff exact PR #10 merge base `29c3948658bbc1af39e1b70152c21e445a786311` against the PR #11 head. Confirm scope is limited to the Project Knowledge migration, read adapter, contract binding, real D1 tests, docs, and CI invariants.
2. Confirm no Batch 1–3 `PROPOSED` record was promoted or copied into the authority migration; all existing proposed packages remain `governing: false`.
3. Confirm the migration accepts only `CURRENT`/`FINAL`, requires `governing = 1`, starts empty, and has no seed data.
4. Confirm lookup is fixed to a constructor-validated scope, accepts only exact `statuses` and `actionDigest` request fields, and rejects `PROPOSED`, duplicate statuses, forged scope, invalid digest, missing, expired, disabled, wrong-scope, and ambiguous rows.
5. Confirm `knowledge_json` must be a canonical JSON object, duplicate keys fail, size is bounded to 256 KiB, and the digest binds record ID, status, version, scope, and the complete knowledge object.
6. Confirm recursive secret-field rejection covers nested credential, secret, token, authorization, API-key, refresh-token, access-token, proxy-authorization, and private-key variants.
7. Confirm the gateway independently requires the returned Project Knowledge `actionDigest` to equal the gateway-computed digest.
8. Confirm runtime code contains parameterized `SELECT` only: no DML, DDL, external fetch, promotion, writer, credential, or provider path.
9. Run the actual migration and adapter under `@cloudflare/vitest-pool-workers` with real local D1. Confirm a fully evidenced gateway reaches `authorized_by_standing_policy`, while all negative cases fail closed.
10. Confirm `wrangler.jsonc`, `src/control-plane-worker.js`, and `src/development-runtime.js` are unchanged; no D1 binding, database/account ID, route, secret, deployment target, or external-write capability exists.
11. Confirm HMAC-SHA256 service authentication with Durable Object replay defense remains unchanged and no OAuth/bearer dependency appears.
12. Mutation-test every new CI invariant, including removal of each table constraint, insertion of a seed row, status/governing weakening, write SQL/external fetch, secret-field guard removal, action-digest binding removal, and Worker/runtime activation.
13. Confirm `pk-d1-dev` is untouched and no Project Knowledge record was written, promoted, or altered.
14. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
15. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: GOVERNING PROJECT KNOWLEDGE READER ACCEPTED`
- `CLAUDE CHECKER: GOVERNING PROJECT KNOWLEDGE READER REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, deployment, D1 creation or binding, migration application, record insertion or promotion, key or secret installation, production/customer operation, external write, provider call, Queue publish, Workflow dispatch, call, message, campaign, booking, transfer, or payment.
