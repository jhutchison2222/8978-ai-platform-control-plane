# Development Activation Evidence Chain Verifier

Status: DEVELOPMENT FOUNDATION ONLY — UNWIRED, UNBOUND, AND NOT DEPLOYED

PR #20 adds a fail-closed composition boundary that requires both the independently authenticated evidence-bundle verification from PR #16/17 and the authenticated-write receipt verification from PR #19. It does not create evidence, add a migration, install a key or secret, add a Worker route or binding, change the activation plan, authorize activation, or deploy anything.

## Exact composition boundary

`AuthenticatedDevelopmentActivationEvidenceChainVerifier` accepts the exact reviewed commit and six unique evidence digests already required by the activation preflight. Its constructor requires two separately injected `verify()` contracts: the evidence verifier and the write-receipt verifier. Both receive the same frozen evidence request; the receipt verifier also receives the chain's single validated verification time.

Both returned receipts must have exact fields, report `valid: true`, and bind the requested commit and evidence. The chain defensively validates every principal, digest, record ID, key ID, and timestamp it consumes. Maker, checker, and owner must remain distinct, and the authenticated writer principal must be distinct from all three. Missing, malformed, rejected, mismatched, or colliding results fail closed.

The preflight-compatible result keeps the existing exact field shape. Its replacement verification digest binds the requested evidence, the prior evidence-verification digest, the complete validated write-receipt identity and timing fields, record/request-body/write digests, and all four security principals. A caller therefore cannot accept the result without transitively accepting both verification chains.

## Trust and safety boundary

This composition does not authenticate HMAC requests itself, read HMAC secrets, query or write D1 directly, consume nonces, or replace either underlying verifier. The PR #18 writer remains the only reviewed insertion boundary, and the PR #19 verifier remains responsible for stored receipt integrity and the constructor-pinned writer key.

The module contains no SQL, external `fetch`, REST or OAuth dependency, secret, private key, process/filesystem action, Wrangler invocation, Queue publish, Workflow dispatch, provider mutation, or deployment path. It is not imported by the Worker, development runtime, activation preflight, or activation plan.

Node contract tests exercise exact result validation, binding failures, malformed timestamps and digests, dependency failures, and every principal collision. A Workers-pool interoperability test runs the real PR #18 writer, real migrated local D1, real Ed25519 verifiers, the PR #17 provider, the PR #19 receipt verifier, and the new chain end to end. No remote D1 or Cloudflare resource is touched.
