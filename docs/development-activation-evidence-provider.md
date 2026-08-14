# Development Activation Evidence Bundle Provider

Status: DEVELOPMENT FOUNDATION ONLY — READ-ONLY, UNWIRED, UNSEEDED, UNBOUND, AND NOT DEPLOYED

PR #17 adds the authoritative read side for the authenticated development-activation evidence bundle introduced in PR #16. It does not create evidence, install keys, authorize activation, add a deployable binding, apply a remote migration, or deploy the Worker.

## Exact read boundary

`D1DevelopmentActivationEvidenceBundleProvider` accepts only the seven exact values already required by the PR #15 preflight: the reviewed commit and six unique SHA-256 evidence digests. Its parameterized D1 query requires one enabled, current `CURRENT` or `FINAL` record matching that complete evidence set. Missing, expired, disabled, mismatched, or ambiguous records fail closed.

The provider then independently verifies:

- exact canonical JSON with duplicate-key rejection and a 64 KiB UTF-8 limit;
- the exact seven-field bundle shape required by PR #16;
- bounded identity tokens and exact owner-decision fields;
- approved Ed25519 owner-decision boundaries;
- a digest over the canonical bundle; and
- a second record digest binding the record ID, status, reviewed commit, complete requested evidence set, bundle digest, validity interval, and version.

The provider returns only the deeply frozen exact evidence bundle. PR #16 remains responsible for authenticating all six signatures and checking their purpose, digest, role-continuity, and principal-independence bindings.

## Migration boundary

Migration `0005_development_activation_evidence.sql` creates one empty authority table and its active-evidence lookup index. It contains no seed row, key, token, signature, decision, or fabricated evidence. The non-governing activation plan now pins six byte-level migration digests in exact order, while every resource, binding, migration-applied, schema-verified, authorization, and evidence-state flag remains false or null.

## Safety boundary

The adapter is read-only and contains no write SQL, external `fetch`, REST or OAuth dependency, service credential, private key, filesystem or process action, Wrangler invocation, Queue publish, Workflow dispatch, provider mutation, or deployment path. It is not imported by the Worker or development runtime. `wrangler.jsonc` remains unchanged with no D1, Workflow, or Queue binding.

Actual activation still requires separately authorized resource creation, installation and remote application of the exact reviewed migration set, separately authorized use of the unbound authenticated evidence writer, independent verification, and distinct owner authorization for Worker deployment.
