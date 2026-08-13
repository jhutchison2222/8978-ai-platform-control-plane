# Authoritative D1 Read Model

Status: DEVELOPMENT FOUNDATION ONLY — UNBOUND AND NOT DEPLOYED

This module implements the first two authoritative dependencies in the policy gateway: opaque locator resolution and trusted action limits. It is a read-only D1 consumer. It does not create, update, promote, or delete authority records, and it is not connected to the development Worker in `wrangler.jsonc`.

## Trust boundary

Callers provide only an opaque `locator` and requested operation. `D1AuthoritativeResourceResolver` selects exactly one enabled, active `CURRENT` or `FINAL` resource row using a prepared statement. It parses the stored JSON with duplicate-key rejection, validates the discriminated resource contract, recomputes its RFC 8785 SHA-256 digest, and verifies the derived resource key.

`D1TrustedLimitProvider` derives the resource key from that validated resolution and selects exactly one enabled, active limits row for the exact operation. It validates risk, non-negative cost and record count, evidence-digest shape, and returns the gateway-computed action digest unchanged. Missing, expired, future, disabled, malformed, tampered, or ambiguous rows fail closed.

The schema intentionally permits multiple versioned rows so ambiguity cannot be silently resolved by insertion order. Operational authority requires exactly one active match at lookup time.

## Storage contract

The migration at `migrations/authority/0001_authority_read_model.sql` defines:

- `authority_resources`: locator, status, validity window, canonical resource JSON, derived resource key, content digest, and version.
- `authority_limits`: resource key, operation, status, validity window, risk, cost, record count, evidence digest, and version.

The additive `0002_validation_evidence.sql` migration extends this read model with authenticated identity keys, required-test evidence, and rollback evidence. Its separate trust rules are documented in `docs/validation-evidence-runtime.md`.

The additive, empty `0003_governing_project_knowledge.sql` migration adds a governing Project Knowledge snapshot table. It promotes nothing and remains unbound; its trust rules are documented in `docs/project-knowledge-runtime.md`.

The additive, empty `0004_owner_control.sql` migration adds public owner-key and standing-state tables. It installs no key or state and remains unbound; its trust rules are documented in `docs/owner-control-runtime.md`.

The runtime adapter contains only parameterized `SELECT` queries. A separate, future authority-management path must own writes, approvals, promotion, and rollback. Those capabilities must not be added to this adapter.

## Deliberately unbound

The real Worker has no D1 binding, route, account ID, or database ID for this read model. The existing `pk-d1-dev` Project Knowledge database is not reused as mixed-purpose runtime authority storage. Tests create a local `AUTHORITY_DB` through the Cloudflare Workers Vitest pool and apply the actual migration with `applyD1Migrations()`.

Binding a dedicated development database requires a separate owner-authorized infrastructure step with an authoritative account/database identifier, independent review, and rollback evidence. Until then, Worker readiness remains `false`, action evaluation still fails closed at authoritative resource resolution, and `/v1/actions/execute` remains unconditionally disabled.

## Verification

Run:

```sh
npm test
npm run check
npm run secret-scan
npm run cf:types:check
npm run cf:dry-run
```

The Workers integration tests exercise the real D1 API and migration, including integrity verification, exact-match selection, expired/disabled/missing rows, ambiguity, cross-resource limit rejection, and progression through the real gateway to the next unavailable validation gates.
