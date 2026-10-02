# Independent Claude Checker Packet — Cloudflare Orchestrator Dispatch Foundation

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable draft PR #14 head SHA recorded in the PR description. Refuse a branch name or moving target.

## Required checks

1. Diff the exact PR #13 merge base `fed269fafeaaa11c196cfd5541482f3236ba701b` against the PR #14 head. Confirm scope is limited to Workflow/Queue adapters, exact envelope validation, conditional development composition, local binding tests, docs, and CI invariants.
2. Confirm the adapters use direct Cloudflare bindings only: Workflow `create({ id, params })` and awaited Queue `send(message, { contentType: "json" })`; no REST API, HTTP fetch, API token, or OAuth dependency exists.
3. Confirm envelope validation and its JSON Schema require exact fields, exact SHA-256 digests, a 100-character Workflow instance/message ID limit, 256-character component limits, one `CURRENT`/`FINAL` Project Knowledge reference, no unknown fields, canonical I-JSON serializability, and a 128 KiB maximum.
4. Confirm configured Workflow and Queue names must match the envelope before binding calls, Workflow acknowledgement must return the exact message ID, and binding errors propagate as failure rather than accepted results.
5. Confirm `OrchestratorWorkflow` uses one durable step to revalidate the envelope and returns only `execution_disabled`; it cannot execute an action or perform any provider/external/authority write.
6. Confirm development composition installs both adapters only as a complete pair when `ORCHESTRATOR_WORKFLOW.create` and `ORCHESTRATOR_QUEUE.send` are functions. Missing or malformed partial bindings must leave both throwing unavailable dependencies.
7. Run the tests in `@cloudflare/vitest-pool-workers`. Confirm a real local Workflow instance is created with the exact message ID and the real local Queue producer accepts a valid JSON envelope.
8. Confirm runtime readiness remains hard-coded `false`, `ALLOW_EXTERNAL_WRITES` remains `false`, and `/v1/actions/execute` remains an unconditional 503 `execution_disabled` denial.
9. Confirm `wrangler.jsonc` is byte-for-byte unchanged and contains no Workflow, Queue, D1, route, provider, or service binding.
10. Confirm authority migrations/adapters, policies, schemas other than the orchestrator-envelope contract alignment, trust anchors, Project Knowledge records, master prompts, HMAC service-auth, and Durable Object implementations are unchanged.
11. Confirm invalid, oversized, wrong-route, non-governing, acknowledgement-mismatched, and binding-error cases fail closed without a binding side effect.
12. Mutation-test every new CI invariant: remove either binding method check, allow partial composition, remove exact envelope fields, weaken Project Knowledge status/digest validation, remove size bound, remove name matching, remove awaited Queue send, change Workflow ID, remove Workflow execution denial, add fetch, add a Wrangler binding, or enable readiness/execution.
13. Confirm `pk-d1-dev` is untouched and no provider resource, binding, deployment, secret, Workflow, or Queue was created remotely.
14. Run `npm ci`, `npm test`, `npm run check`, `npm run secret-scan`, `npm run cf:types:check`, `npm run cf:dry-run`, and exact base-to-head `git diff --check`.
15. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: ORCHESTRATOR DISPATCH FOUNDATION ACCEPTED`
- `CLAUDE CHECKER: ORCHESTRATOR DISPATCH FOUNDATION REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, deployment, Workflow or Queue creation/binding, D1 creation/binding, migration, record insertion/promotion, key/secret installation, production/customer operation, external write, provider call, call, message, campaign, booking, transfer, or payment.
