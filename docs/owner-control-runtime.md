# Authenticated Owner Control Runtime

Status: DEVELOPMENT FOUNDATION ONLY — UNBOUND, EMPTY, AND NOT DEPLOYED

PR #12 adds read-only D1 adapters for Ed25519-authenticated owner decisions and authoritative standing-policy state revalidation. It does not install an owner key, create a standing-state row, bind D1, or change the deployable Worker.

## Owner decisions

An owner exception decision contains exactly the schema-defined fields. The signature covers canonical RFC 8785 JSON for every field except `signature`, including the decision ID, exact requested-action digest, approved decision, owner principal, decision and expiry times, issuer key ID, and `Ed25519` algorithm.

The verifier requires one enabled, active `CURRENT` or `FINAL` public-key row. It verifies the owner principal, key validity containment, version, key-record digest, 32-byte public key, 64-byte signature, current decision window, and a maximum 24-hour decision lifetime. Private owner keys never enter D1, source control, Project Knowledge, configuration, or runtime code.

The gateway passes its own evaluation time into verification, converts verifier errors into fail-closed denials, re-verifies the signature immediately before execution, and then uses the existing SQLite Durable Object to consume the decision exactly once.

## Standing state and kill switch

The standing-state reader requires exactly one enabled, active `CURRENT` or `FINAL` row for the exact authorizing policy ID and version. Its digest binds policy ID, policy version, enabled/disabled state, kill-switch flag, reason, and record version.

Immediately before standing-policy execution, the adapter independently recomputes the requested-action digest against the authorization's resolved target. It returns true only when the action is unchanged, the row says `enabled`, and `kill_switch` is false. Missing, expired, disabled, ambiguous, malformed, altered, or kill-switched state fails closed.

## Deliberately empty and unbound

`0004_owner_control.sql` creates schema only. Runtime code contains parameterized `SELECT` statements and Web Crypto verification; it has no DML, DDL, external fetch, key installation, signing, promotion, or state writer.

The development runtime can now compose this adapter from an injected `AUTHORITY_DB`, but `wrangler.jsonc` still provides no such binding. The Worker remains `ready: false`, external writes remain disabled, and `/v1/actions/execute` remains unconditionally denied.
