# Authenticated Development Activation Evidence Verifier

Status: DEVELOPMENT FOUNDATION ONLY — UNWIRED, UNBOUND, AND NOT DEPLOYED

PR #16 adds the independent evidence-verifier implementation required by the PR #15 development activation preflight. It composes the already-reviewed D1-backed Ed25519 identity and owner-decision verifiers. It does not create evidence, install keys, write to D1, add bindings, change Wrangler, authorize activation, or deploy the Worker.

PR #21 hardens the temporal boundary without changing that scope: one validated verification instant is now shared by the bundle lookup, all four identity checks, and both owner-decision checks. When composed through the PR #20 chain, the same instant also governs write-receipt verification.

## Evidence bundle

The injected bundle provider must return exactly six authenticated artifacts:

- maker validation attestation;
- checker validation attestation;
- resource-activation owner decision;
- Worker-deployment owner decision;
- rollback-evidence checker attestation; and
- backup-evidence maker attestation.

No bundle is checked in. No provider is wired into the Worker or development runtime. An unavailable provider, key, signature, or record therefore leaves the PR #15 preflight fail closed.

## Domain separation and binding

Each artifact uses a distinct RFC 8785/SHA-256 action digest over the exact reviewed commit, the development environment, schema version, and one fixed purpose. A token valid for maker validation cannot be reused as backup evidence; a resource-activation decision cannot be reused as Worker-deployment authorization.

The verifier requires:

- all six plan evidence digests to be well formed and unique;
- every identity result to match its exact role, purpose digest, and requested evidence digest;
- both owner decisions to be approved, Ed25519-signed, separately identified, and verified against their purpose digests;
- maker continuity between validation and backup evidence;
- checker continuity between validation and rollback evidence;
- owner continuity across the two separate authorization decisions; and
- pairwise-distinct maker, checker, and owner principals.

The returned verification digest binds the complete requested evidence set, all three authenticated principals, and all six purpose action digests. The PR #15 preflight independently rechecks every returned digest and principal boundary before reporting ready.

## Safety boundary

The module has no `fetch`, REST, OAuth, service credential, private key, D1 query, DML/DDL, process execution, Wrangler command, Workflow dispatch, Queue publish, filesystem access, or provider mutation. It accepts only injected verifier interfaces and is not imported by `control-plane-worker.js` or `development-runtime.js`.

Real Workers-pool tests generate ephemeral Ed25519 keys, install only their public keys into a local migrated D1 database, sign all six artifacts in test memory, and drive the complete PR #15 preflight to ready. Negative tests cover purpose reuse, digest reuse, signature tampering, owner-decision reuse, principal collisions, bundle-shape drift, provider failure, and missing constructor dependencies.

Actual development activation still requires a separately reviewed evidence provider, authoritative evidence records, explicit owner authorization for resource creation, and a later distinct authorization for Worker deployment.
