# Development Resource Creation Execution Packet

Status: PLANNING AND REVIEW ONLY — EXECUTION IS NOT AUTHORIZED

This packet defines the first Cloudflare infrastructure action after the code-only control-plane foundation. It creates nothing by itself, is not imported by runtime code, and does not alter the checked-in activation plan or Wrangler configuration.

## Phase boundary

Only two empty, unbound development resources are candidates for a later exact owner authorization:

- D1 database `8978-ai-authority-dev`, using Cloudflare's recommended automatic location selection; and
- Queue `8978-ai-orchestrator-dev`, with zero delivery delay and 86,400-second retention.

The operator must first perform read-only exact-name collision checks in the single owner-authorized Cloudflare account. Any existing resource with either name is a hard stop; it is not adopted, modified, deleted, or reused automatically. The known Project Knowledge database `pk-d1-dev` is never eligible for authority storage.

Cloudflare documents standalone creation commands for D1 and Queues. Wrangler does not expose a standalone Workflow creation command: Workflows are defined in Worker configuration and established through deployment. Therefore `8978-ai-orchestrator-dev` Workflow creation is explicitly deferred to the separately reviewed and separately authorized binding/deployment phase.

## Execution authorization contract

The checked-in packet has `executionAuthorized:false`. Before Claude may act, the owner authorization must name:

1. the exact reviewed repository commit;
2. the SHA-256 digest of `deployment/development-resource-creation-packet.json`;
3. exactly one Cloudflare account ID; and
4. permission to create only the two resources described above.

Authorization is invalid if it omits any value, refers to a branch or moving target, or expands the packet. Claude must stop instead of asking a tool to infer the intended account.

## Required sequence

1. Verify the repository commit, packet digest, authenticated operator, and exact authorized account.
2. Read-only check for both exact resource names.
3. Stop on either name collision.
4. Create the empty D1 database without `--update-config`, a binding, a migration, a SQL statement, a seed, or a location/jurisdiction override.
5. Read back its immutable identifier and metadata without SQL.
6. Create the Queue with the exact approved settings and no producer or consumer.
7. Read back its immutable identifier and settings.
8. Stop and return the required evidence. Do not continue into Workflow creation, binding, migration, secret installation, evidence insertion, activation, or deployment.

The two creates are not atomic. If either succeeds and a later step fails, Claude must not retry or delete anything automatically. It must stop and report the exact partial remote state for a new owner decision.

## Repository and runtime invariants

`wrangler.jsonc`, `deployment/development-activation-plan.json`, all six migrations, Worker/runtime sources, policies, Project Knowledge, and master-prompt source material remain unchanged. The activation plan stays `PLANNED`, non-governing, unauthorized, unbound, unmigrated, evidence-empty, and blocked by exactly 20 gates. No runtime imports this packet.
