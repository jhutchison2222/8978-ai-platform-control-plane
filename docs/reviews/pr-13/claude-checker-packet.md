# Independent Claude Checker Packet — Read-Only Authority Runtime Composition

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #13 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff the exact PR #12 merge base `622fbdca9ab55e9e8128d6f0a9db93e5e3c4f937` against the PR #13 head. Confirm scope is limited to read-only authority composition, development-runtime conditional wiring, readiness reporting, real Workers tests, docs, and CI invariants.
2. Confirm `createD1AuthorityRuntimeDependencies()` constructs exactly the eight reviewed dependencies from one injected D1 binding and freezes the returned map.
3. Confirm the standing-state method remains bound to its validated instance and Project Knowledge remains fixed to the `control-plane` scope.
4. Confirm `createDevelopmentRuntime()` activates the authority readers only when `env.AUTHORITY_DB.prepare` is a function; missing or malformed bindings retain the throwing unavailable dependencies and fail closed.
5. Confirm readiness is still always `false`, but accurately distinguishes the local D1-injected test runtime from the unbound deployable configuration.
6. Run the composition through `@cloudflare/vitest-pool-workers` with real local D1 and the actual four migrations. Confirm all constructed adapters use the same binding and an empty authority lookup fails closed.
7. Confirm `wrangler.jsonc` remains byte-for-byte unchanged and has no D1 binding, database/account identifier, route, Queue, Workflow, service, R2, or provider binding.
8. Confirm `/v1/actions/execute` remains an unconditional 503 `execution_disabled` response and `ALLOW_EXTERNAL_WRITES` remains `false`.
9. Confirm no authority migration, adapter query, policy, schema, trust anchor, Project Knowledge record, master-prompt source, service-auth implementation, or Durable Object implementation changed.
10. Confirm HMAC-SHA256 service authentication and Durable Object replay defense remain unchanged with no OAuth or bearer fallback.
11. Confirm the composition adds no DML, DDL, external fetch, REST API call, private key, secret, writer, promotion, deployment, or provider action.
12. Mutation-test each new CI invariant, including deletion of every adapter from the composition, weakening the exact D1-binding predicate, removing the frozen dependency map, removing the runtime spread, falsifying readiness, adding a Wrangler D1 binding, adding external fetch, and weakening the execute denial.
13. Confirm `pk-d1-dev` is untouched and is not referenced as the authority runtime database.
14. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
15. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: AUTHORITY RUNTIME COMPOSITION ACCEPTED`
- `CLAUDE CHECKER: AUTHORITY RUNTIME COMPOSITION REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, deployment, D1 creation or binding, migration application, record insertion or promotion, key or secret installation, production/customer operation, external write, provider call, Queue publish, Workflow dispatch, call, message, campaign, booking, transfer, or payment.
