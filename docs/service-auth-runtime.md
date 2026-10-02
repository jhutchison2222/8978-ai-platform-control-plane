# Service-Authenticated Runtime Foundation

Status: DEVELOPMENT IMPLEMENTATION — NOT DEPLOYED

## Authentication boundary

The autonomous runtime does not depend on interactive OAuth.

- Worker-to-Worker calls use Cloudflare Service Bindings so internal services are not exposed through public URLs.
- Calls crossing a service-binding or trusted machine boundary use the versioned HMAC-SHA-256 request contract in `src/service-auth.js` and the bounded adapter in `src/service-auth-adapter.js`.
- Provider credentials and HMAC secrets remain in Cloudflare secret bindings or a supported secret store. They never enter Project Knowledge, D1 business records, prompts, action payloads, logs, or evidence.
- GitHub or Cloudflare user OAuth may exist for human-operated administrative tools, but it is outside the autonomous runtime dependency graph.
- The request adapter rejects `Authorization` and `Proxy-Authorization` headers so this path cannot silently acquire an OAuth or bearer-token dependency.

## Signed request

The canonical signature binds:

1. contract version;
2. stable service principal;
3. rotating key ID;
4. ISO timestamp;
5. nonce;
6. HTTP method;
7. path and query;
8. independently verified SHA-256 body digest.

The adapter accepts only byte-deterministic string, `ArrayBuffer`, or `ArrayBufferView` bodies. Its default body limit is 1 MiB and its receiver reads the body through a bounded stream before computing the digest. Callers may configure a smaller limit. Verification fails closed for unknown principals or keys, signature mismatch, body mismatch, timestamp skew, invalid encodings, short secrets, oversized bodies, or replay.

A receiver must complete authentication and atomic nonce consumption before any business action, Queue publish, Workflow dispatch, provider call, or durable business-state mutation. Authentication failures exposed across an HTTP boundary must use one generic response; internal exception details are diagnostic data and must not be returned to the caller.

## Durable replay defense

`CloudflareDurableReplayStore` routes each `principalId + keyId` pair to a deterministic Durable Object shard. Length-prefixed shard names prevent ambiguous concatenation, and key rotation naturally creates a separate shard.

`ServiceAuthReplayDurableObject` uses SQLite-backed Durable Object storage:

- `nonce` is the primary key;
- `INSERT ... ON CONFLICT DO NOTHING RETURNING nonce` performs the single-use decision;
- consumption is determined by whether the insert returns a row, not by `rowsWritten`, because Cloudflare counts index writes in that billing-oriented counter;
- cleanup and insertion execute inside `transactionSync`;
- expired entries are removed in bounded batches;
- malformed, expired, or unreasonably long retention windows fail closed.

The routing adapter advertises `atomic = true` and `durability = "durable"`, satisfying the verifier contract. The in-memory store in `test/service-auth.test.js` remains only a deterministic unit-test fixture.

The development-only configuration in `wrangler.jsonc` now adds the generated namespace binding and a SQLite-class migration. It remains undeployed and contains no production route, account identifier, or secret:

```jsonc
{
  "compatibility_date": "2026-08-12",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      {
        "name": "SERVICE_AUTH_REPLAY",
        "class_name": "ServiceAuthReplayDurableObject"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["ServiceAuthReplayDurableObject"]
    }
  ]
}
```

This is a development configuration contract, not authorization to create or deploy the binding. Binding types are generated with `wrangler types` and checked in CI.

## Rotation

The secret resolver accepts a principal and key ID, allowing controlled overlap between an active key and a retiring key. Removing the retiring key ends the overlap. Rotation procedures, secret binding names, identities, cadence, and emergency revocation remain unresolved and must be supplied authoritatively before deployment.

## Cloudflare implementation boundary

The implementation follows current Cloudflare guidance retrieved 2026-08-12: Service Bindings for Worker-to-Worker calls, runtime secret bindings for secrets, Web Crypto for signing and verification, generated binding types, a current compatibility date, SQLite-backed Durable Objects for strongly consistent per-shard state, and no request-scoped mutable module state.

This repository slice adds portable signing and verification, bounded request adapters, Durable Object namespace routing, and the SQLite replay class. It does not create or modify a Worker, service binding, secret, Queue, Workflow, D1 database, R2 bucket, Durable Object namespace, or deployment.

## Remaining adapters and gates

- independent acceptance of the candidate development Worker entrypoint and generated environment types
- authoritative principal, key, secret-binding, and rotation registry
- Project Knowledge reader
- Workflow dispatcher
- Queue publisher
- append-only audit store
- durable idempotency and owner-decision stores
- provider-specific AutoCalls and CRM adapters
- structured observability with credential-shape redaction
- deployment-stage smoke, rollback, and secret-rotation tests in an explicitly approved Cloudflare development account
- independent Claude review bound to the exact candidate commit

All deployment and production policies remain disabled until authoritative identifiers, approved configuration, runtime integration tests, and independent checker evidence are available.
