# Independent Claude Checker Packet — Authenticated Development Activation Evidence Writer

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #18 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff exact PR #17 merge base `a889d6f012bde0448c0a2ba19e02c1f98e662e45` against the PR #18 head. Confirm scope is limited to one empty sixth authority migration, one unbound HMAC-authenticated append-only evidence writer, real Workers/D1/Durable Object tests, activation migration manifest/schema updates, documentation, checker packet, and CI invariants.
2. Confirm `wrangler.jsonc`, `src/control-plane-worker.js`, `src/development-runtime.js`, migrations `0001`–`0005`, all prior adapters, policies, trust anchors, service-auth implementation, Durable Object implementation, Workflow/Queue adapters, Project Knowledge, and every master-prompt source file are byte-for-byte unchanged.
3. Confirm migration `0006` creates only an empty write-receipt table and its service-nonce index, contains no seed DML, preserves the evidence row through restrictive foreign-key actions, and is pinned by exact byte digest and order in both the plan and source constant.
4. Confirm the activation plan remains `PLANNED`, `governing:false`, unauthorized, unbound, unmigrated, schema-unverified, and contains no database ID or evidence digest. Confirm its blocker count remains exactly 20.
5. Confirm the writer is not imported by the Worker or development runtime and has no Worker route, Wrangler binding, plaintext secret, secret-binding read, private signing key, external `fetch`, REST/OAuth dependency, process/filesystem action, Queue/Workflow operation, provider action, update SQL, delete SQL, or deployment path.
6. Confirm only exact-path `POST` with exact `application/json` is accepted; OAuth/bearer/proxy-authorization is rejected; and the existing HMAC-SHA-256 verifier authenticates exact bounded body bytes with timestamp, principal, key, nonce, method, target, body digest, signature, and durable atomic replay protection.
7. Confirm constructor-fixed authorization requires exactly one allowed HMAC principal/key and one 40-character reviewed commit. Confirm the HMAC writer principal must be distinct from authenticated maker, checker, and owner principals.
8. Confirm strict canonical JSON, duplicate-key rejection, exact request fields, a 64 KiB body bound, version 1, `CURRENT`-only status, exact reviewed-commit binding, and a live validity interval no longer than 24 hours all fail closed before D1 insertion.
9. Confirm the complete PR #16 verifier authenticates all four Ed25519 attestations and both distinct Ed25519 owner decisions before insertion, including six unique evidence digests, purpose binding, exact roles, role continuity, distinct maker/checker/owner principals, and exact reviewed commit.
10. Independently recompute the bundle digest, provider-compatible record digest, and write digest. Confirm the write digest binds record ID/digest, canonical HMAC request-body digest, service principal, service key, nonce, authentication time, insertion time, and version.
11. Confirm one D1 batch uses an exact-commit `WHERE NOT EXISTS` evidence insert and a foreign-key-bound write-receipt insert to atomically create exactly one pair; conflicts and concurrent attempts leave exactly one complete pair and no partial row. Confirm neither implementation statement can update, disable, supersede, delete, or create `FINAL` evidence. Confirm PR #17's provider ambiguity defense remains independently testable.
12. Run the real Workers test with `applyD1Migrations()`, actual D1 statements, ephemeral Ed25519 keys, HMAC request signing, and the real SQLite `SERVICE_AUTH_REPLAY` Durable Object. Confirm no remote D1 or Cloudflare resource is touched.
13. Mutation-test every new CI invariant, including removal of HMAC authentication, OAuth rejection, replay durability, writer authorization, commit pinning, canonical/body/validity bounds, cryptographic verification, principal independence, either atomic insert, receipt fields/digests, uniqueness/foreign-key constraints, migration order/digest, runtime non-import, and no-update/no-delete/no-fetch/no-secret-binding prohibitions.
14. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
15. Confirm `pk-d1-dev`, `deployment_versions`, all Cloudflare resources, keys, secrets, bindings, remote migrations, evidence records, Project Knowledge, and master-prompt source material are untouched. Record findings by severity with exact file/section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: AUTHENTICATED ACTIVATION EVIDENCE WRITER ACCEPTED`
- `CLAUDE CHECKER: AUTHENTICATED ACTIVATION EVIDENCE WRITER REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, activation, deployment, resource creation/deletion, binding, migration application, database/evidence write, key/secret installation, external write, provider call, Queue publish, Workflow dispatch, customer/production operation, call, message, campaign, booking, transfer, or payment.
