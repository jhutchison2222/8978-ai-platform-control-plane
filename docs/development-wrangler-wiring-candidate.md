# Development Wrangler wiring candidate

This code-only candidate adds the exact reviewed development authority-D1, Workflow, and Queue-producer bindings to `wrangler.jsonc`. It does not deploy the Worker or install anything remotely merely by being committed.

The candidate adds no Queue consumer, route, account identifier, secret value, production/customer target, or external-write enablement. Workers.dev and preview URLs remain disabled. `ALLOW_EXTERNAL_WRITES` remains `"false"`; `/v1/actions/execute` remains an unconditional denial; and the Workflow returns `execution_disabled` after envelope validation.

Deployment, managed-secret installation, evidence writes, Queue publication, Workflow triggering, activation, production/customer operations, deletion, cleanup, retry, and restore remain separate operations requiring their own exact reviewed execution boundary.
