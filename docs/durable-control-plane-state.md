# Durable Control-Plane State

Status: DEVELOPMENT IMPLEMENTATION — NOT DEPLOYED

PR #8 adds three SQLite Durable Object classes and their namespace adapters. They satisfy the structural runtime contracts but authorize no action by themselves. The Worker remains `ready: false`, external writes remain disabled, and `/v1/actions/execute` remains a hard denial.

## Coordination atoms

| Binding | Durable Object | Shard key | Guarantee |
|---|---|---|---|
| `IDEMPOTENCY_STORE` | `IdempotencyStateDurableObject` | RFC 8785 action execution scope digest | One active lease or one completed result per scope |
| `OWNER_DECISION_STORE` | `OwnerDecisionStateDurableObject` | Owner decision ID | One successful consumption regardless of action-digest reuse attempt |
| `AUDIT_STORE` | `AuditStateDurableObject` | Idempotency scope digest | One ordered append-only hash chain per execution scope |

Each namespace uses `getByName()` with an immutable coordination key. No single global Durable Object is introduced.

## Idempotency lifecycle

Reservations are created atomically with a cryptographically random lease ID. An active lease rejects concurrent reservations. A completed record rejects all future reservations. An expired reservation may be replaced; the replaced lease can no longer complete or release the new lease. Completion requires the exact scope and lease ID and a still-active lease. Lease duration is bounded to 24 hours.

## Owner-decision consumption

Each shard holds one row whose decision ID is unique. Before storage, the Durable Object requires the RPC decision ID to equal its own `ctx.id.name`, binding the payload to the namespace adapter's `getByName(decisionId)` route. `INSERT ... ON CONFLICT(id) DO NOTHING RETURNING decision_id` makes the first valid consumer the only winner. Reusing the same decision ID with a different action digest is also denied, and a direct attempt to present another decision ID to the same shard is rejected even before the first write.

## Append-only audit chain

Each canonical event is stored with a sequence, previous digest, event digest, and exact canonical JSON. The event digest binds all four logical elements: sequence, previous digest, and event content under RFC 8785/SHA-256.

Web Crypto is asynchronous, so concurrent appends use optimistic compare-and-swap against `audit_head`. The head update and event insertion occur in one `transactionSync()` block. A caller that loses the comparison recomputes against the new head; it cannot create a fork. Audit-event deletion is absent and prohibited by CI.

## Migration boundary

The accepted replay migration remains immutable as `v1`. The three new SQLite classes are added by a separate `v2` migration. The configuration creates no D1, R2, Queue, Workflow, service, route, account, provider, or production binding. A dry run validates the bundle but creates nothing.

## Remaining readiness blockers

- authoritative resource resolver
- maker/checker identity verifier
- trusted test-evidence provider
- rollback verifier
- trusted limit provider
- owner-signature verifier
- standing-state and kill-switch revalidation
- governing Project Knowledge reader
- Workflow dispatcher
- Queue publisher

No deployment is allowed until the remaining adapters, identifiers, tests, independent review, and owner authorization are complete.
