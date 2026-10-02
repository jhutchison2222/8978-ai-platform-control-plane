# Development Activation Evidence Write Receipt Verifier

Status: DEVELOPMENT FOUNDATION ONLY — READ-ONLY, UNWIRED, UNBOUND, AND NOT DEPLOYED

PR #19 adds an independent read-only verifier for the authenticated write receipt created by PR #18. It does not create or modify evidence, add a migration, install a key or secret, add a Worker route or binding, authorize activation, or deploy anything.

## Exact verification boundary

`D1DevelopmentActivationEvidenceWriteVerifier` accepts the exact reviewed commit and six unique evidence digests already used by the activation preflight. Its constructor pins one authorized HMAC writer principal/key pair and the reviewed commit. A parameterized D1 join requires exactly one enabled, live `CURRENT` evidence record and its one foreign-key-bound write receipt. Missing, expired, disabled, `FINAL`, mismatched, query-failed, or ambiguous row pairs fail closed.

The verifier independently recomputes:

- the provider-compatible evidence record digest, binding record ID, `CURRENT` status, reviewed commit, all six evidence digests, bundle digest, validity interval, and version;
- the PR #18 write digest, binding write/record IDs, record digest, canonical request-body digest, authorized service principal/key, nonce, authentication time, insertion time, and version; and
- a verification digest over the exact requested evidence, verified record digest, and verified write digest.

The record/write IDs and digests must match, the writer identity must equal the constructor-pinned principal/key, both versions must be 1, authentication cannot occur after insertion, and insertion must occur inside the evidence validity interval. The returned verification receipt is deeply frozen.

## Trust and safety boundary

The verifier confirms the integrity and authorized identity recorded by the PR #18 HMAC-authenticated insertion boundary. It does not claim to reauthenticate an archived HMAC request: it reads no HMAC secret, does not consume a replay nonce, and does not treat D1 data as an OAuth token. Future infrastructure authorization must preserve D1 as an access-controlled authority boundary and permit evidence insertion only through the separately reviewed writer.

The module contains one parameterized `SELECT` join and no write SQL, external `fetch`, REST or OAuth dependency, secret, private key, process/filesystem action, Wrangler invocation, Queue publish, Workflow dispatch, provider mutation, or deployment path. It is not imported by the Worker or development runtime. The later code-only wiring candidate adds the shared verified development bindings but does not wire this verifier or perform any external operation.

Real Workers-pool tests apply all six migrations to local D1, verify a receipt produced by the actual PR #18 writer, recompute both integrity digests, and reject missing, disabled, expired, `FINAL`, wrong-writer, ambiguous, malformed, and tampered rows. No remote D1 or Cloudflare resource is touched.
