# Governing Project Knowledge Read Runtime

Status: DEVELOPMENT FOUNDATION ONLY — UNBOUND, EMPTY, AND NOT DEPLOYED

PR #11 adds a read-only D1 adapter for the `PolicyGateway` governing Project Knowledge dependency. It does not promote any normalized prompt material and does not connect a database to the deployable Worker.

## Governing boundary

`authority_project_knowledge` can contain only `CURRENT` or `FINAL` rows whose `governing` value is exactly `1`. The existing Batch 1–3 normalization packages remain `PROPOSED`, `governing: false`, and outside this migration. Copying a proposed record into source control does not make it governing.

The adapter uses a constructor-fixed scope and accepts only an exact action digest plus an allow-list containing unique `CURRENT`/`FINAL` values. It requires exactly one enabled, current row. Missing, expired, disabled, wrong-scope, malformed, or ambiguous rows fail closed.

## Integrity and safety

The stored knowledge payload must be one canonical RFC 8785 JSON object no larger than 256 KiB. Its SHA-256 digest binds the record ID, status, version, fixed scope, and complete knowledge object. The returned snapshot is also bound to the caller's exact action digest before the gateway can authorize it.

Recursive key inspection rejects credential-, secret-, token-, authorization-, API-key-, refresh-token-, access-token-, and private-key-shaped fields anywhere in the payload. Runtime code contains only a parameterized `SELECT`; it has no DML, DDL, external fetch, promotion method, or writer path.

## Deliberately empty and unbound

The migration creates schema only and inserts no records. `wrangler.jsonc`, `src/control-plane-worker.js`, and `src/development-runtime.js` remain unchanged and contain no `AUTHORITY_DB` binding. The Worker therefore remains `ready: false`, external writes remain disabled, and `/v1/actions/execute` remains unconditionally denied.

A future authority-management PR must define authenticated promotion, conflict resolution, provenance, rollback, and independent approval before inserting any governing record. A later infrastructure PR must separately provision and bind a dedicated development authority D1 database.
