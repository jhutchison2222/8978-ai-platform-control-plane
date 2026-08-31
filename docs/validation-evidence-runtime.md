# Authenticated Validation Evidence Runtime

Status: DEVELOPMENT FOUNDATION ONLY — UNBOUND AND NOT DEPLOYED

PR #10 implements three more `PolicyGateway` dependencies without connecting them to the deployable Worker: authenticated maker/checker identity, digest-bound required-test evidence, and executable rollback verification. All authority reads use the same test-only `AUTHORITY_DB` contract introduced in PR #9. No real database is provisioned or bound.

## Maker and checker identity

An identity claim is not trusted merely because it appears in D1. The caller supplies a compact token:

```text
v1.<base64url canonical payload>.<base64url Ed25519 signature>
```

The canonical payload contains exactly `schemaVersion`, `attestationId`, `principalId`, `keyId`, `role`, `actionDigest`, `issuedAt`, and `expiresAt`. The verifier:

1. rejects malformed, oversized, duplicate-key, non-UTF-8, and non-canonical payloads;
2. requires the requested role and gateway-computed action digest to match exactly;
3. enforces canonical timestamps, current validity, and a maximum 24-hour attestation lifetime;
4. selects exactly one active `CURRENT` or `FINAL` public-key record;
5. verifies principal, allowed role, key validity window, version, and key-record digest;
6. imports only a 32-byte raw Ed25519 public key and verifies the 64-byte signature with Workers Web Crypto.

Private keys never enter D1, source control, Project Knowledge, or this Worker. The independent maker and checker systems retain their own signing keys. `PolicyGateway` still rejects two valid signatures if both resolve to the same principal.

## Required-test evidence

`D1TestEvidenceProvider` selects current records for the exact action digest. Every policy-required test ID must have exactly one active record. The adapter verifies the test result, source principal, validity window, version, and RFC 8785 SHA-256 content digest before returning evidence. Missing, expired, disabled, duplicated, malformed, or altered evidence fails closed.

## Rollback evidence

`D1RollbackVerifier` requires an exact rollback reference plus exact action digest and exactly one active record. It returns only digest-verified validity, executability, executor reference, evidence times, and version. The existing gateway independently requires `valid: true`, `executable: true`, the same action digest, current evidence, and a valid evidence-digest shape.

## Migration and write boundary

`migrations/authority/0002_validation_evidence.sql` adds the public-key registry, test-evidence, and rollback-evidence tables. The runtime module contains only prepared `SELECT` queries and Web Crypto verification. It has no DML, DDL, external fetch, private-key handling, authority promotion, or evidence-writing method.

Tests apply both authority migrations to a real local D1 instance through Cloudflare's Workers Vitest pool. Test code seeds fixture keys and evidence directly; that test-only setup is not part of the runtime adapter.

## Deliberately unbound

The code-only wiring candidate supplies the verified development `AUTHORITY_DB` binding so the runtime can compose these readers, but performs no deployment or D1 operation. The Worker remains `ready: false`, external writes remain disabled, and `/v1/actions/execute` remains an unconditional denial.

A future infrastructure PR must separately create or select a dedicated development authority database, define the reviewed evidence-writer trust boundary, install public keys without private material, apply migrations, bind the Worker, and receive independent checker plus owner authorization.
