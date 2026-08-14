# Independent Claude Checker Packet — Development Activation Evidence Chain Verifier

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #20 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff exact PR #19 merge base `95bdabdb741832ee200d04cd147b9692843f03cb` against the PR #20 head. Confirm scope is limited to one unwired evidence-chain verifier, contract and real Workers/D1 tests, documentation, checker packet, and CI invariants.
2. Confirm `wrangler.jsonc`, the Worker, development runtime, activation preflight and plan, all six migrations, the PR #18 writer, the PR #17 provider, the PR #19 write-receipt verifier, every prior authority adapter, service authentication, policies, trust anchors, Durable Objects, Project Knowledge, and every master-prompt source file are byte-for-byte unchanged.
3. Confirm no migration, seed row, binding, route, secret, key, HMAC or OAuth implementation, external fetch, SQL, process/filesystem action, Queue/Workflow operation, provider mutation, activation, or deployment path is added.
4. Confirm the constructor requires separate evidence-verifier and write-receipt-verifier `verify()` contracts plus a clock, freezes its configured instance, and rejects every missing or malformed dependency.
5. Confirm verification requires the exact seven-field evidence request with one commit plus six well-formed unique SHA-256 digests and passes the same frozen request to both dependencies.
6. Confirm one validated chain time is passed to the write-receipt verifier and invalid clocks fail before either verification result can be accepted.
7. Confirm both dependency receipts are cloned before validation, require exact field sets and `valid: true`, and bind the exact requested evidence or reviewed commit. Extra, missing, malformed, mismatched, or rejected receipts must fail closed.
8. Confirm every maker, checker, owner, and writer principal is well formed; maker/checker/owner are mutually distinct; and writer is independently rechecked as distinct from all three.
9. Confirm record, request-body, write, evidence-verification, and write-receipt-verification digests; record/key IDs; and exact ISO timestamps are validated, with authentication not after insertion.
10. Independently recompute the final chain digest. Confirm it binds the exact evidence, both prior verification digests, record/request-body/write digests, receipt record/key IDs and times, all four principals, and schema version.
11. Confirm the returned frozen object preserves the exact existing activation-preflight receipt shape and exposes no mutable nested state or extra unreviewed fields.
12. Run the actual PR #18 HMAC writer against real local migrated D1 with real Ed25519 maker/checker/owner verification, then require the PR #17 provider, PR #19 receipt verifier, and PR #20 chain to succeed on that exact inserted pair.
13. Mutation-test dependency bypass, request divergence, exact-result weakening, either `valid` check removal, evidence/commit binding removal, clock weakening, any principal-collision removal, any digest-domain field removal, direct SQL/fetch/secret insertion, runtime/preflight import, and actual-writer interoperability removal. Confirm CI and/or behavioral tests catch each mutation.
14. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
15. Confirm the activation plan remains `PLANNED`, unauthorized, unbound, unmigrated, schema-unverified, empty of evidence, and blocked by exactly 20 gates. Confirm `pk-d1-dev`, `deployment_versions`, all Cloudflare resources, Project Knowledge, and master-prompt source material are untouched.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: ACTIVATION EVIDENCE CHAIN VERIFIER ACCEPTED`
- `CLAUDE CHECKER: ACTIVATION EVIDENCE CHAIN VERIFIER REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, activation, deployment, resource creation/deletion, binding, migration application, database/evidence write, key/secret installation, external write, provider call, Queue publish, Workflow dispatch, customer/production operation, call, message, campaign, booking, transfer, or payment.
