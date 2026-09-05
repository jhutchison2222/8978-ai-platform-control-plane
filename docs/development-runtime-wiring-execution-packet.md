# Development runtime-wiring execution packet

This non-governing development packet defines the exact D1, Workflow, and Queue-producer bindings that may be proposed in a later code-only `wrangler.jsonc` candidate. It does not modify configuration, install a binding, create or trigger a Workflow, publish a Queue message, query or write D1, install a secret, or deploy a Worker.

The packet pins the already verified authority D1 UUID and the reviewed development resource names. Its original wiring boundary permitted no Queue consumer, route, `workers_dev` URL, preview URL, or secret value. The later development live-test successor now declares only the owner-selected `workers_dev` production URL while keeping preview URLs, routes, and custom domains disabled and requiring independently verified Worker-level Cloudflare Access before deployment. `ALLOW_EXTERNAL_WRITES` remains the string `"false"`, `/v1/actions/execute` remains unconditionally disabled, and the Workflow implementation remains execution-disabled.

The next repository action is a separately reviewed code-only wiring candidate. Any remote operation requires an exact reviewed subpacket and must stop on ambiguity, partial state, identity mismatch, scope expansion, or any production/customer effect.
