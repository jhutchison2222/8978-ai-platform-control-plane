# Independent Claude Checker Packet — Development Activation Evidence Write Receipt Verifier

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #19 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff exact PR #18 merge base `7e0e7a34c7042c9bdbfe6814a526fff33d93dc07` against the PR #19 head. Confirm scope is limited to one read-only D1 write-receipt verifier, real Workers/D1 tests, documentation, checker packet, and CI invariants.
2. Confirm `wrangler.jsonc`, `src/control-plane-worker.js`, `src/development-runtime.js`, all six migrations, the PR #18 writer, every prior adapter, policies, trust anchors, service authentication, Durable Objects, Workflow/Queue adapters, Project Knowledge, and every master-prompt source file are byte-for-byte unchanged.
3. Confirm no migration, seed row, binding, route, secret, private key, HMAC credential, OAuth dependency, external fetch, D1 write, process/filesystem action, Queue/Workflow operation, provider mutation, activation, or deployment path is added.
4. Confirm the verifier constructor requires a D1 `prepare()` contract, exactly one authorized writer principal/key pair, and one exact reviewed commit; all malformed or missing dependencies fail closed.
5. Confirm verification requires the exact seven-field evidence request with one reviewed commit plus six well-formed unique SHA-256 evidence digests, and every value participates in the parameterized D1 lookup.
6. Confirm the single read-only query joins the PR #17 evidence table to the PR #18 write-receipt table by record ID and accepts exactly one enabled, live `CURRENT` pair. Missing, disabled, expired, `FINAL`, mismatched, query-failed, and ambiguous pairs must fail closed.
7. Confirm write ID equals record ID; the receipt-bound record digest equals the evidence-row record digest; and the stored service principal/key exactly equal the constructor-pinned authorized writer identity.
8. Confirm record and receipt versions are exactly 1; all timestamps are safe integers; authentication is not after insertion; insertion is inside the evidence validity interval; and malformed IDs, nonce, or digests fail closed.
9. Independently recompute the provider-compatible record digest and PR #18 write digest from real local D1 rows without trusting the stored values. Confirm every record/write field is bound exactly once and tampering fails closed.
10. Confirm the returned deeply frozen verification receipt includes the reviewed commit, record ID/digest, request-body digest, write digest, authorized writer identity, times, and a verification digest binding the exact evidence, record digest, and write digest.
11. Run the real PR #18 writer against local migrated D1 and then verify its resulting row pair through the new verifier. Confirm exact interoperability with the actual writer rather than only hand-constructed fixtures.
12. Mutation-test every new CI invariant, including join removal, any evidence binding removal, `CURRENT`/enabled/validity weakening, unique-row weakening, writer identity weakening, record/write ID or digest binding removal, version/time weakening, either digest recomputation removal, verification-digest weakening, write SQL/fetch/secret/runtime import insertion, and removal of actual-writer interoperability coverage.
13. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
14. Confirm the activation plan remains `PLANNED`, unauthorized, unbound, unmigrated, schema-unverified, empty of evidence, and blocked by exactly 20 gates. Confirm `pk-d1-dev`, `deployment_versions`, all Cloudflare resources, Project Knowledge, and master-prompt source material are untouched.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: ACTIVATION EVIDENCE WRITE RECEIPT VERIFIER ACCEPTED`
- `CLAUDE CHECKER: ACTIVATION EVIDENCE WRITE RECEIPT VERIFIER REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, activation, deployment, resource creation/deletion, binding, migration application, database/evidence write, key/secret installation, external write, provider call, Queue publish, Workflow dispatch, customer/production operation, call, message, campaign, booking, transfer, or payment.
