# Independent Claude Checker Packet — D1 Development Activation Evidence Runtime Composition

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #22 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff exact PR #21 merge base `9c4567d9c9e289b46be1e2e58c8363cff8d01390` against the PR #22 head. Confirm scope is limited to one unwired D1 activation-evidence composition factory, contract and real Workers/D1 tests, documentation, checker packet, and CI invariants.
2. Confirm `wrangler.jsonc`, the Worker, development runtime, activation preflight and plan, all six migrations, the PR #18 writer, PR #17 provider, PR #16 evidence verifier, PR #19 write-receipt verifier, PR #20/#21 chain verifier, service authentication, policies, Durable Objects, Project Knowledge, and every master-prompt source file are byte-for-byte unchanged.
3. Confirm no migration, seed row, binding, route, secret, key, HMAC or OAuth implementation, external fetch, SQL, process/filesystem action, Queue/Workflow operation, provider mutation, evidence write, activation, or deployment path is added.
4. Confirm the factory requires exact options containing only `authorizedWriter`, `reviewedCommit`, and `now`; invalid, missing, or extra options fail closed.
5. Confirm the factory constructs only the previously reviewed D1 evidence provider, D1 Ed25519 identity verifier, D1 Ed25519 owner verifier, authenticated evidence verifier, D1 write-receipt verifier, and evidence chain verifier.
6. Confirm all four D1-backed components receive the same injected database object, with no secondary binding or database lookup.
7. Confirm the evidence verifier and chain verifier receive the same clock function and the PR #21 exact-one-`Date` propagation remains unchanged.
8. Confirm the authorized HMAC writer principal/key pair and exact reviewed commit remain pinned in the write-receipt verifier, with no secret present in the composition options or returned chain.
9. Run the actual PR #18 HMAC writer against real migrated local D1, then run the new factory-produced chain against that exact row and confirm the maker, checker, owner, writer, record, receipt, digest, and time checks remain effective.
10. Mutation-test omission or substitution of every composed dependency, use of a second database or clock, omission of the writer/commit pins, option-shape weakening, direct runtime/preflight import, and insertion of SQL/fetch/secret/OAuth behavior.
11. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
12. Confirm the activation plan remains `PLANNED`, unauthorized, unbound, unmigrated, schema-unverified, empty of evidence, and blocked by exactly 20 gates. Confirm `pk-d1-dev`, `deployment_versions`, all Cloudflare resources, Project Knowledge, and master-prompt source material are untouched.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: D1 ACTIVATION EVIDENCE RUNTIME COMPOSITION ACCEPTED`
- `CLAUDE CHECKER: D1 ACTIVATION EVIDENCE RUNTIME COMPOSITION REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, activation, deployment, resource creation/deletion, binding, migration application, database/evidence write, key/secret installation, external write, provider call, Queue publish, Workflow dispatch, customer/production operation, call, message, campaign, booking, transfer, or payment.
