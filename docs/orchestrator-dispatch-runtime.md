# Cloudflare Orchestrator Dispatch Foundation

Status: DEVELOPMENT FOUNDATION ONLY — TEST-BOUND, EXECUTION-DISABLED, AND NOT DEPLOYED

PR #14 implements the final two `PolicyGateway` runtime dependency contracts: a Cloudflare Workflow dispatcher and Queue publisher. Both are direct binding adapters. Neither calls the Cloudflare REST API, embeds a credential, or provides an action-execution path.

## Exact envelope boundary

Both adapters accept only the exact orchestrator envelope fields defined by `schemas/orchestrator-envelope.schema.json`. The envelope binds message ID, action digest, correlation and idempotency identifiers, configured Workflow and Queue names, and one `CURRENT` or `FINAL` governing Project Knowledge reference with its digest. The message ID is capped at Cloudflare Workflow's 100-character instance-ID limit; the remaining component identifiers are capped at 256 characters.

Unknown fields, malformed identifiers, invalid digests, non-governing Project Knowledge status, wrong Workflow/Queue names, non-I-JSON content, and envelopes over 128 KiB fail before either binding is called.

## Binding behavior

- `CloudflareWorkflowDispatcher` calls the injected Workflow binding with `create({ id: messageId, params: envelope })`. It requires the returned instance ID to equal the exact message ID.
- `CloudflareQueuePublisher` awaits the injected Queue producer's `send(envelope, { contentType: "json" })` call.
- Both return small frozen acknowledgements only after the binding call succeeds.

`OrchestratorWorkflow` performs one durable validation step and returns `execution_disabled`. It does not call a provider, execute an action, publish another message, write authority data, or access secrets.

## Conditional development composition

The development runtime installs both adapters only when the environment supplies a complete pair: `ORCHESTRATOR_WORKFLOW.create` and `ORCHESTRATOR_QUEUE.send`. If either is missing or malformed, both dependency slots remain the existing throwing unavailable implementations.

The Workers test configuration injects local Miniflare Workflow and Queue bindings so the real platform-shaped APIs are exercised. `wrangler.jsonc` remains unchanged and has no Workflow or Queue binding. The deployable Worker therefore remains unbound, reports `ready: false`, keeps `ALLOW_EXTERNAL_WRITES="false"`, and returns `execution_disabled` for every `/v1/actions/execute` request.
