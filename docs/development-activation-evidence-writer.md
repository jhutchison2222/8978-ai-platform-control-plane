# Authenticated Development Activation Evidence Writer

Status: DEVELOPMENT FOUNDATION ONLY — HMAC-AUTHENTICATED, UNWIRED, UNBOUND, UNSEEDED, AND NOT DEPLOYED

PR #18 adds the append-only insertion boundary required to store a PR #16 evidence bundle for the PR #17 read provider. It creates no Cloudflare resource, applies no remote migration, installs no key or secret, adds no Worker route or binding, writes no checked-in evidence, authorizes no activation, and deploys nothing.

## Authentication and authorization boundary

`AuthenticatedDevelopmentActivationEvidenceWriter` accepts only `POST /v1/development-activation/evidence` requests whose exact canonical JSON bytes are authenticated by the existing HMAC-SHA-256 service-auth contract. OAuth, bearer, proxy-authorization, unknown principals or keys, stale timestamps, body-digest mismatch, and replayed nonces fail closed. The constructor pins exactly one authorized service principal/key pair and one reviewed commit; it receives secrets only through the existing injected resolver and never reads a secret binding itself.

The authenticated writer must be distinct from the verified maker, independent Claude checker, and owner principals. The request can create only a version-1 `CURRENT` record with a validity window no longer than 24 hours. It cannot create `FINAL`, update, disable, supersede, delete, or otherwise promote an existing record.

## Evidence and write-integrity boundary

Before any insert, the writer reuses the complete authenticated evidence verifier. All four Ed25519 attestations, both separate Ed25519 owner decisions, six unique evidence digests, purpose bindings, role continuity, and maker/checker/owner independence must verify against the exact constructor-pinned commit.

Migration `0006_development_activation_evidence_writes.sql` adds an empty append-only write-receipt table with unique record, request-body, write-digest, and service-nonce constraints. One D1 batch uses a conditional evidence insert plus a foreign-key-bound receipt insert to allow only one enabled `CURRENT`/`FINAL` evidence record per reviewed commit and to prevent a partial write. The receipt binds the record digest, canonical request-body digest, HMAC principal, HMAC key, nonce, authentication time, insertion time, and version. There is no seed DML.

## Safety boundary

The module contains no OAuth flow, bearer fallback, external `fetch`, Cloudflare REST call, Wrangler invocation, process or filesystem action, private signing key, Queue publish, Workflow dispatch, provider mutation, update SQL, or delete SQL. It is not imported by the Worker or development runtime, and `wrangler.jsonc` remains unchanged with no D1, Workflow, Queue, service, route, or writer binding.

Workers-pool tests use the real local D1 migration set, real Ed25519 verification, HMAC request signing, and the real SQLite replay Durable Object. Test-only inserts seed ephemeral public keys; no remote D1 or Cloudflare resource is touched.

Actual development activation still requires independent acceptance of the exact PR #18 commit, explicit merge authorization, separately authorized resource creation and remote migration, installation of an HMAC writer secret, authoritative evidence creation and insertion, an independent evidence check, and a later distinct owner authorization for Worker deployment.
