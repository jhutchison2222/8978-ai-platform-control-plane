# Independent Claude Checker Packet — Authenticated Validation Evidence

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable Draft PR #10 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff the exact PR #9 merge base and PR #10 head. Confirm scope is limited to the second authority migration, read-only validation adapters, real Workers/D1 tests, docs, and CI invariants.
2. Confirm no standing policy, schema, trust-anchor digest, Project Knowledge record, master-prompt source, Durable Object, service-auth implementation, Worker entrypoint, development runtime wiring, or Wrangler configuration changed.
3. Confirm no D1 binding, database/account ID, route, secret, provider integration, deployment target, or external-write capability was added; readiness and execution remain fail closed.
4. Confirm HMAC-SHA256 service authentication with Durable Object replay defense remains unchanged and there is no OAuth/bearer dependency.
5. Review the `v1.payload.signature` attestation parser for strict segment count, length, base64url, UTF-8, duplicate-key, exact-field, and RFC 8785 canonicalization enforcement.
6. Confirm the signed payload binds exact schema version, attestation ID, principal ID, key ID, maker/checker role, action digest, issued time, and expiry.
7. Confirm canonical timestamps, current validity, maximum 24-hour lifetime, and containment within the trusted public key's validity window.
8. Confirm the key lookup requires exactly one enabled, active `CURRENT` or `FINAL` row and verifies principal, allowed roles, Ed25519 algorithm, 32-byte raw public key, positive version, and key-record digest.
9. Independently generate Ed25519 key pairs in the Workers runtime. Verify valid signatures pass and wrong signer, role, digest, principal, expired token, disabled key, ambiguous key, altered key digest, non-canonical JSON, duplicate JSON key, bad key length, bad signature length, and oversized token fail closed.
10. Confirm maker and checker private keys never appear in runtime code, migrations, documentation fixtures, Project Knowledge, or configuration. Only public keys belong in the authority read model.
11. Confirm `PolicyGateway` rejects two cryptographically valid role signatures resolving to the same principal.
12. Confirm test evidence requires each policy-required test exactly once for the action digest and verifies result, source principal, validity, version, and content digest. Test missing, expired, disabled, ambiguous, failed, and tampered records.
13. Confirm rollback lookup binds exact reference plus action digest, requires one active row, and verifies validity, executability, executor reference, times, version, and content digest. Test wrong digest/reference, expired, disabled, ambiguous, false flags, and tampering.
14. Confirm runtime adapters contain parameterized `SELECT` only: no DML, DDL, external fetch, private-key import, signing, evidence writes, or promotion path.
15. Run the actual migrations and adapters in `@cloudflare/vitest-pool-workers` with real local D1. Confirm the full gateway reaches `governing_project_knowledge_unavailable`, proving identity/tests/rollback passed without authorizing execution.
16. Mutation-test every new CI invariant, including cryptographic tokens, digest checks, read-only prohibition, migration constraints/indexes, and no Worker/runtime activation.
17. Confirm `pk-d1-dev` is untouched and has no new authority tables, keys, private material, test evidence, rollback evidence, deployment, or secret.
18. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
19. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: VALIDATION EVIDENCE ACCEPTED`
- `CLAUDE CHECKER: VALIDATION EVIDENCE REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, deployment, D1 creation or binding, remote migration, public- or private-key installation, secret creation, evidence write or promotion, Project Knowledge promotion, production/customer operation, external write, provider call, Queue publish, Workflow dispatch, call, message, campaign, booking, transfer, or payment.
