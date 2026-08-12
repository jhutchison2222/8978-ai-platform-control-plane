# Service-Authenticated Runtime Foundation

Status: DEVELOPMENT CONTRACT — NOT DEPLOYED

## Authentication boundary

The autonomous runtime does not depend on interactive OAuth.

- Worker-to-Worker calls should use Cloudflare Service Bindings so internal services are not exposed through public URLs.
- Calls that cross the Cloudflare service-binding boundary use the versioned HMAC-SHA-256 request contract in `src/service-auth.js`.
- Provider credentials and HMAC secrets remain in Cloudflare secret bindings or a supported secret store. They never enter Project Knowledge, D1 business records, prompts, action payloads, logs, or evidence.
- GitHub/Cloudflare user OAuth may still exist for human-operated administrative tools, but it is outside the autonomous runtime dependency graph.

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

Verification fails closed for unknown principals/keys, signature mismatch, body mismatch, timestamp skew, invalid encodings, short secrets, or replay.

The verifier requires a durable atomic replay store. The in-repository test store is only a deterministic contract fixture. A deployable adapter must atomically consume `principal + key ID + nonce` until the replay window expires.

## Rotation

The secret resolver accepts a principal and key ID, which allows a controlled overlap between an active key and a retiring key. Removing the retiring key ends the overlap. Rotation procedures, binding names, identities, and cadence remain unresolved and must be supplied authoritatively before deployment.

## Cloudflare implementation boundary

Cloudflare's current guidance favors Service Bindings for Worker-to-Worker calls, runtime secret bindings for secrets, Web Crypto for signing/verification, generated binding types, current compatibility dates, and no request-scoped mutable module state. This repository slice implements the portable cryptographic contract only; it does not create a Worker, service binding, secret, Queue, Workflow, D1 table, or deployment.

## Remaining adapters

- Cloudflare service-binding caller and receiver
- durable replay store
- Project Knowledge reader
- Workflow dispatcher
- Queue publisher
- append-only audit store
- durable idempotency and owner-decision stores
- provider-specific AutoCalls/CRM adapters
- structured observability with credential-shape redaction

All deployment and production policies remain disabled until authoritative identifiers and independent checker evidence are available.
