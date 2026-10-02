# Independent Claude Checker Packet — Authenticated Development Activation Evidence Verifier

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #16 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff exact PR #15 merge base `ee22fa907aff460ffda7aaae0c4bc1a114dc15b4` against the PR #16 head. Confirm the scope is limited to the evidence-bundle schema, authenticated verifier, real Workers tests, documentation, checker packet, and CI invariants.
2. Confirm `wrangler.jsonc`, `src/control-plane-worker.js`, `src/development-runtime.js`, every D1 migration and adapter, policies, trust anchors, Project Knowledge, master-prompt source, service authentication, Durable Objects, Workflow, Queue adapters, and the checked-in PR #15 activation plan are byte-for-byte unchanged.
3. Confirm the verifier composes the previously reviewed `D1Ed25519IdentityVerifier` and `D1Ed25519OwnerDecisionVerifier` interfaces without duplicating or weakening their cryptography.
4. Confirm the bundle and every returned verification object use exact-field validation; tokens and components are bounded; the reviewed commit and all evidence digests are strictly validated.
5. Independently recompute all six purpose action digests. Confirm RFC 8785/SHA-256 domain separation binds schema version, development environment, exact reviewed commit, and one exact purpose.
6. Confirm maker validation, checker validation, rollback evidence, and backup evidence use the required role and unique purpose digest, and their verified evidence digests equal the PR #15 preflight inputs.
7. Confirm resource activation and Worker deployment require separate approved Ed25519 owner decisions, separate decision IDs, separate purpose action digests, verified signatures, and exact decision-payload digests matching the preflight inputs.
8. Confirm maker continuity across maker-validation/backup artifacts, checker continuity across checker-validation/rollback artifacts, owner continuity across resource/Worker authorizations, and pairwise-distinct maker/checker/owner principals.
9. Confirm the final verification digest binds the complete requested evidence, all authenticated principals, and all six purpose digests, and the result exactly satisfies the PR #15 preflight verifier contract.
10. Run the real Workers/D1 test. Confirm ephemeral private keys exist only in test memory, only public keys enter local D1, all six signatures are verified through the real previously reviewed adapters, and the complete test preflight reaches ready only with every gate satisfied.
11. Confirm provider failure, missing verifier dependencies, digest or purpose reuse, token/signature tampering, decision reuse, bundle-shape drift, role discontinuity, and principal collisions all fail closed.
12. Confirm there is no `fetch`, REST, OAuth, service credential, private key in source/config, D1 query/write, process execution, Wrangler invocation, Queue publish, Workflow dispatch, filesystem action, resource mutation, or deployment path.
13. Confirm the verifier and schema are not imported by the Worker or development runtime, no bundle/provider is wired, and the checked-in activation plan still reports exactly 20 blockers.
14. Mutation-test every new CI invariant, including removal of each purpose/role binding, owner decision separation, both owner-verification checks, every digest equality, role continuity, principal independence, verification-digest binding, dangerous-API guard, and runtime-import prohibition.
15. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
16. Confirm `pk-d1-dev` and Cloudflare resources are untouched and `deployment_versions` remains empty. Record findings by severity with exact file/section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: AUTHENTICATED ACTIVATION EVIDENCE VERIFIER ACCEPTED`
- `CLAUDE CHECKER: AUTHENTICATED ACTIVATION EVIDENCE VERIFIER REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, activation, deployment, resource creation/deletion, binding, migration, database write, evidence insertion/promotion, key/secret installation, external write, provider call, Queue publish, Workflow dispatch, customer/production operation, call, message, campaign, booking, transfer, or payment.
