# Development Control-Plane Worker Runtime

Status: DEVELOPMENT FOUNDATION ONLY — NOT DEPLOYED

This Worker exposes the existing policy gateway behind service-to-service HMAC-SHA256 authentication and SQLite Durable Objects for replay defense, idempotency, owner-decision consumption, and append-only audit chains. It has no OAuth or bearer-token fallback. It is deliberately unable to execute actions or perform external writes.

## Runtime boundary

- `CONTROL_PLANE_MODE` must equal `development`.
- `ALLOW_EXTERNAL_WRITES` must equal the string `false`.
- `workers_dev` and preview URLs are disabled in `wrangler.jsonc`.
- No D1, R2, Queue, Workflow, provider, or production binding exists in this configuration. A read-only authoritative D1 adapter and migration now exist, but they are test-only and deliberately unbound.
- The idempotency, owner-decision, and audit adapters are durable development implementations. Every other unresolved authoritative runtime adapter throws, so evaluation still fails closed at authoritative resource resolution.
- `/v1/actions/execute` always returns `execution_disabled`.

## Authentication

`SERVICE_AUTH_KEYS_JSON` is a Wrangler secret and must never be placed in source, `wrangler.jsonc`, `.dev.vars`, logs, or Project Knowledge. Its value is a JSON object indexed by service principal and key identifier:

```json
{
  "orchestrator-service-id": {
    "key-id": "secret-of-at-least-32-bytes"
  }
}
```

The shown value is a shape example, not a usable secret. Requests use the `x-8978-*` HMAC headers documented in `docs/service-auth-runtime.md`. `Authorization` and `Proxy-Authorization` are rejected.

## Authenticated routes

- `GET /v1/runtime/readiness` reports `ready: false`, the disabled-write boundary, and missing authoritative dependency names.
- `POST /v1/actions/evaluate` parses strict JSON and calls the trusted development `PolicyGateway`.
- `/v1/actions/execute` is present only as an explicit fail-closed denial.

## Local verification

```sh
npm ci
npm test
npm run check
npm run secret-scan
npm run cf:types:check
npm run cf:dry-run
```

The Worker tests run inside Cloudflare's Vitest Workers pool and exercise the actual SQLite Durable Object replay, lease, single-use decision, concurrent audit-chain paths, and the local D1 authority migration/read path. The dry run bundles and validates configuration but does not deploy.

Before any deployment, replace every unavailable adapter with a verified durable implementation, add an explicit development account/route decision, provision the secret through Wrangler, obtain independent checker acceptance, and obtain owner authorization.
