# Development live-test execution packet

This code-only, non-governing successor packet records the owner's protected `workers.dev` decision and defines the remaining security-material boundary for one fail-closed development deployment and synthetic canary. It authorizes nothing and performs no Cloudflare operation.

## Proven and unproven state

`wrangler.jsonc` declares the exact D1, Workflow, Queue-producer, and `workers.dev` production-URL configuration. Preview URLs remain disabled and no route or custom domain exists. Repository configuration does not prove a deployed Worker, installed remote binding, or active Access protection. Historical records independently verify the development D1 identity, six migrations, 11 tables, 10 indexes, foreign key, integrity, and zero authority-data rows. Queue creation is owner-attested but not independently retrieved. Workflow existence, deployed Worker state, installed bindings, secret installation, and Access state remain unverified.

## Recorded decision and remaining material

The owner selected only `https://8978-ai-control-plane-dev.jhutchison.workers.dev`, protected by a Worker-level Cloudflare Access service-token policy. `workers_dev:true` declares that future production URL; it does not make the Worker deployed or protected. Preview URLs remain disabled, and no DNS migration, route, or custom domain is allowed.

A later reviewed execution record must materialize a new development-only HMAC principal and key ID, plus a new Cloudflare Access service-token identity that expires no later than 24 hours after creation. It may record only identities, exact scope, expiration, and custodians. Credential values must stay outside GitHub, repository files, retained artifacts, logs, and comments. The HMAC value may exist only in managed secret `SERVICE_AUTH_KEYS_JSON`.

The Access application and service-token policy must be created and independently confirmed active for the exact URL before any deployment uses this `workers_dev:true` configuration. If that ordering cannot be proven, deployment stops; the public hostname must never substitute for proof of Access enforcement.

## Smallest useful canary

The five requests prove unauthenticated denial, signed readiness, replay denial, a synthetic D1-backed evaluation denial, and unconditional execution denial. There are no D1 writes, Queue messages, Workflow instances, external actions, production targets, or customer records.

The canary is not literally free of all writes: successful signed requests consume at most three unique nonces in the SQLite Durable Object replay store. That bounded security-state effect is explicit and requires owner authorization.

## Preflight, evidence, and failure

The packet pins read-only account, deployment, D1, Queue, Workflow, and secret-name checks. Secret values may never be retrieved or recorded. Evidence must include the deployed version, sanitized bindings, request paths/statuses/responses, replay rejection, D1 non-mutation, zero Queue/Workflow/external effects, and Worker observations.

Any mismatch, unexpected state, missing evidence, partial result, credential risk, or write outside the three replay nonces stops the operation. There is no automatic retry, cleanup, deletion, restore, or rollback. The standing development authorization applies only after an independently accepted exact execution record contains the required non-secret identities and expirations; selecting the surface does not authorize deployment by itself.
