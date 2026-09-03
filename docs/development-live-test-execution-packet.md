# Development live-test execution packet

This code-only, non-governing packet defines the next owner-decision boundary for one fail-closed development deployment and synthetic canary. It authorizes nothing and performs no Cloudflare operation.

## Proven and unproven state

`wrangler.jsonc` declares the exact D1, Workflow, and Queue-producer bindings. Repository configuration does not prove a deployed Worker or installed remote binding. Historical records independently verify the development D1 identity, six migrations, 11 tables, 10 indexes, foreign key, integrity, and zero authority-data rows. Queue creation is owner-attested but not independently retrieved. Workflow existence, deployed Worker state, installed bindings, secret installation, and access surface remain unverified.

## Required owner decisions

The Worker is unreachable as committed: `workers_dev:false`, `preview_urls:false`, and no route. The owner must select an exact, expiring development access surface and access policy. HMAC protects application authentication but does not restrict network reachability.

The owner must also name a new development-only HMAC principal and key ID and identify the secret custodian. A non-interactive canary additionally needs an exact, expiring Cloudflare Access service-token identity and credential custodian. Both credential values must stay outside GitHub, repository files, retained artifacts, logs, and comments. The HMAC value is installed as managed secret `SERVICE_AUTH_KEYS_JSON`. After these choices, a new exact-head packet must be independently accepted before execution.

## Smallest useful canary

The five requests prove unauthenticated denial, signed readiness, replay denial, a synthetic D1-backed evaluation denial, and unconditional execution denial. There are no D1 writes, Queue messages, Workflow instances, external actions, production targets, or customer records.

The canary is not literally free of all writes: successful signed requests consume at most three unique nonces in the SQLite Durable Object replay store. That bounded security-state effect is explicit and requires owner authorization.

## Preflight, evidence, and failure

The packet pins read-only account, deployment, D1, Queue, Workflow, and secret-name checks. Secret values may never be retrieved or recorded. Evidence must include the deployed version, sanitized bindings, request paths/statuses/responses, replay rejection, D1 non-mutation, zero Queue/Workflow/external effects, and Worker observations.

Any mismatch, unexpected state, missing evidence, partial result, credential risk, or write outside the three replay nonces stops the operation. There is no automatic retry, cleanup, deletion, restore, or rollback. The JSON packet contains the exact owner-authorization template and placeholders that only the owner may resolve.
