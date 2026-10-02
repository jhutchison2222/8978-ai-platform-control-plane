# Independent Claude Checker Packet — Development Control-Plane Worker

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable Draft PR #7 head SHA recorded in the PR description. Refuse a branch name or moving target.

This candidate adds a development-only Cloudflare Worker entrypoint around the already accepted HMAC service-authentication, SQLite Durable Object replay defense, and trusted policy gateway. It is designed to evaluate signed requests while every authoritative dependency and all action execution remain unavailable.

## Required checks

1. Diff the exact base and head; confirm no existing policy, schema, trust anchor, proposed Project Knowledge record, or master-prompt source was modified.
2. Confirm `wrangler.jsonc` is development-only, disables `workers_dev` and preview URLs, has no account, route, D1, R2, Queue, Workflow, service, provider, or production binding, and sets `ALLOW_EXTERNAL_WRITES` to the string `false`.
3. Confirm the only stateful binding is `SERVICE_AUTH_REPLAY` and its `v1` migration uses `new_sqlite_classes` for `ServiceAuthReplayDurableObject`.
4. Confirm the Worker authenticates every route with the existing HMAC verifier and durable replay store before routing or policy evaluation.
5. Confirm there is no OAuth, bearer-token, `Authorization`, or `Proxy-Authorization` fallback; those headers must be rejected.
6. Confirm the key registry is read only from `SERVICE_AUTH_KEYS_JSON`, that this name is absent from plaintext Wrangler vars, and that no real secret or credential entered the repository.
7. Confirm strict body bounds, exact body-digest binding, strict JSON parsing, and requested-action shape validation fail closed.
8. Confirm `/v1/runtime/readiness` truthfully reports `ready: false`, external writes disabled, and all authoritative dependencies unavailable.
9. Confirm `/v1/actions/evaluate` invokes the trusted `PolicyGateway` and a structurally valid request is denied at authoritative resource resolution.
10. Confirm `/v1/actions/execute` always returns `execution_disabled` and no code path can dispatch a Workflow, publish a Queue message, call a provider, or mutate external business state.
11. Review `createUnavailableRuntime()` carefully: every dependency must throw, with structural durability markers serving only to permit fail-closed gateway construction and never supplying a successful effect.
12. Run the Cloudflare Workers integration tests against the actual Worker and SQLite Durable Object. Verify unauthenticated denial, signed readiness, bearer rejection, concurrent same-nonce single-winner behavior, fail-closed evaluation, and disabled execution.
13. Independently stress the replay path with concurrent identical and distinct nonces, and inspect stored SQLite results if the test harness permits.
14. Diff and mutation-test each new CI invariant in `scripts/validate-artifacts.js`, including the development boundary, public URL prohibition, external-binding prohibition, secret-var prohibition, exact Durable Object binding/migration, and Worker fail-closed tokens.
15. Confirm generated Worker types are current and the Wrangler dry run contains only the replay Durable Object and the two non-secret development vars.
16. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and the exact base-to-head `git diff --check`.
17. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: DEVELOPMENT WORKER ACCEPTED`
- `CLAUDE CHECKER: DEVELOPMENT WORKER REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, deployment, secret creation, Cloudflare resource creation, Project Knowledge promotion, production or customer-data operation, external write, provider call, Queue publish, Workflow dispatch, call, message, campaign, booking, transfer, or payment.
