# Deterministic Policy and Execution Gateway

## Trusted construction boundary

`PolicyGateway.create` accepts a digest-pinned policy set and a complete runtime dependency object. It fails closed unless the runtime supplies authoritative resource resolution, authenticated maker/checker verification, trusted limit/test/rollback evidence, owner-signature verification, single-use owner-decision storage, atomic leased idempotency, durable append-only audit storage, standing-policy/kill-switch revalidation, Project Knowledge reads, and Cloudflare Workflow and Queue adapters.

Callers and models submit an operation and opaque target locator. They do not decide provider, account, resource, environment, customer, risk, cost, record count, test result, reviewer identity, or rollback validity. Authoritative resolution is included in the RFC 8785 action digest.

## Decision order

1. Validate the requested intent.
2. Resolve the target through the trusted resolver and enforce the discriminated provider/resource and customer-isolation contracts.
3. Compute the RFC 8785/SHA-256 digest over intent plus authoritative resolution.
4. Find all active exact policy matches. More than one raw match is denied before any policy limit is evaluated.
5. Resolve digest-bound limits from the trusted limit provider.
6. Preserve standing authorization first. Use the owner-exception path only for no match, a trusted limit overrun, production, or another enumerated owner-only boundary.
7. Authenticate distinct maker and checker principals and revalidate immutable, current, digest-bound test and executable rollback evidence.
8. Read relevant `FINAL`/`CURRENT` Project Knowledge through the runtime contract. Until that MCP exists, material authorization fails closed.
9. Issue an instance-bound authorization. Immediately before an effect, repeat resolution, evidence, policy, Project Knowledge, signature, expiry, and kill-switch checks.
10. Atomically reserve a durable idempotency lease, persist and verify an append-only intent event, execute, persist the terminal event, and complete the lease. Expired leases are recoverable; active and completed leases block duplicates.

Owner verifiers are injected only during gateway construction. Owner decisions are signature-checked, digest-bound, time-bounded, and atomically consumed once at the execution boundary. A caller cannot substitute a verifier.

## Audit and evidence contract

The audit store must declare durable append-only behavior. Every append returns a verified receipt containing sequence, previous digest, and event digest. The first append occurs before the external effect. Terminal success or failure and rollback evidence are appended to the same chain. A failed or unverifiable intent append prevents the effect.

`src/test-runtime-stores.js` contains deterministic test doubles for Node contract tests. The development Worker now injects separately tested SQLite Durable Object implementations for idempotency leases, owner-decision consumption, and append-only audit chains. The remaining authoritative adapters are still unavailable, and provider credentials are runtime secrets that must never be stored in Project Knowledge or evidence payloads.

## Runtime target

Cloudflare Workers remain the deterministic gateway/orchestrator target. Cloudflare Workflows provide durable orchestration and Cloudflare Queues provide event delivery; a D1-polled queue is prohibited. D1 and R2 remain the intended metadata/evidence stores subject to durable append-only adapters. Each production customer must have a dedicated Worker and D1 with matching customer bindings; shared production D1 tenancy is rejected.

## Identifier status

Enabled:

- GitHub repository `jhutchison2222/8978-ai-platform-control-plane`.

Recorded but disabled pending authoritative account/runtime resolution:

- Workers `8978-ai-orchestrator-dev` and `project-knowledge-worker-dev`.
- D1 `pk-d1-dev` / `9cd8094c-f334-44e6-bdd1-b325802474d5`.
- R2 `pk-r2-dev`.
- GHL location `openai api integration test` / `GtErr1MjPdjYDGU8gUd6`.
- ai-employees.net test account/environment.
- all Cloudflare Queue and Workflow names and IDs.

The Cloudflare account ID, GHL account ID, ai-employees.net account/environment IDs, and Queue/Workflow identifiers were not authoritatively available through attached sources. No Cloudflare write was attempted, and no resource was deployed, created, modified, activated, merged, called, or messaged.

## Validation

Run `npm test`, `npm run check`, and `npm run secret-scan`. Independent maker/checker acceptance remains pending until Claude reviews the corrected commit and its evidence.
