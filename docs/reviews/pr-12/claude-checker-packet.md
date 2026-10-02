# Independent Claude Checker Packet — Authenticated Owner Control

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #12 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff the exact PR #11 merge base and PR #12 head. Confirm scope is limited to the fourth authority migration, owner-control adapters, targeted gateway timing/error handling, real Workers/D1 tests, docs, and CI invariants.
2. Confirm no standing policy, trust anchor, Project Knowledge record, master-prompt source, service-auth implementation, Durable Object implementation, Worker entrypoint, development runtime, or Wrangler configuration changed.
3. Confirm the migration starts empty and stores only public owner keys plus standing state; no private key, signature seed, writer, deployment, binding, or promotion path exists.
4. Confirm owner decisions require exact fields, `approved`, exact action digest, exact owner principal/key binding, canonical timestamps, current validity, maximum 24-hour lifetime, and `Ed25519`.
5. Independently generate Ed25519 keys in the Workers runtime. Verify valid signatures pass and altered fields, wrong signer, wrong digest, denied decision, ES256 label, expired/overlong window, malformed signature, disabled/expired/ambiguous key, principal mismatch, short public key, and altered key digest fail closed.
6. Confirm private owner keys appear only as ephemeral test variables and never in runtime, migration, docs fixtures, Project Knowledge, or configuration.
7. Confirm the gateway supplies the explicit evaluation/execution time to the verifier, converts verifier errors to denial, and re-verifies immediately before the existing single-use Durable Object consume.
8. Confirm standing-state revalidation recomputes the action digest against the authorized resolved target and looks up exactly one active row for the exact policy ID/version.
9. Confirm missing, expired, disabled, ambiguous, malformed, altered, disabled-state, and kill-switched records all prevent execution.
10. Confirm runtime adapters contain parameterized `SELECT` only: no DML, DDL, external fetch, private-key import, signing, key installation, state write, or promotion path.
11. Run the actual migrations and adapters in `@cloudflare/vitest-pool-workers` with real local D1 and the real owner-decision Durable Object. Confirm one signed owner decision executes exactly once and a standing authorization is blocked immediately after the kill switch changes.
12. Confirm `wrangler.jsonc`, `src/control-plane-worker.js`, and `src/development-runtime.js` are unchanged; no D1 binding, account/database ID, route, secret, deployment target, or external-write capability exists.
13. Confirm HMAC-SHA256 service authentication with Durable Object replay defense remains unchanged and no OAuth/bearer dependency appears.
14. Mutation-test every new CI invariant, including table constraint removal, seed insertion, algorithm/lifetime/action binding removal, write SQL/fetch injection, key/state digest removal, kill-switch bypass, gateway time/error handling removal, and Worker/runtime activation.
15. Confirm `pk-d1-dev` is untouched and contains no owner key, private material, standing-state row, deployment, or secret.
16. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
17. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: AUTHENTICATED OWNER CONTROL ACCEPTED`
- `CLAUDE CHECKER: AUTHENTICATED OWNER CONTROL REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, deployment, D1 creation or binding, migration application, public- or private-key installation, owner-decision creation or signing, standing-state insertion or change, Project Knowledge promotion, production/customer operation, external write, provider call, Queue publish, Workflow dispatch, call, message, campaign, booking, transfer, or payment.
