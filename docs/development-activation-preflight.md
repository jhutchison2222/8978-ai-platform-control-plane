# Development Activation Preflight

Status: PLANNING AND VALIDATION ONLY — NON-GOVERNING, UNBOUND, AND NOT DEPLOYED

PR #15 added an inert, fail-closed preflight contract for the future development activation of the control plane. The later code-only wiring candidate changes `wrangler.jsonc` but does not create or mutate a Cloudflare resource, install a remote binding or secret, authorize a deployment, or enable action execution.

## Why the manifest is separate from Wrangler

Cloudflare can automatically provision some resources when a deployment config contains a binding without a resource identifier. The wiring candidate therefore uses only exact verified development resource identifiers and adds no placeholder, service, route, provider, consumer, account, or secret-value configuration. Committing the candidate does not deploy it.

`deployment/development-activation-plan.json` is data for local validation only. No runtime or deployment entrypoint imports it.

## Exact resource boundary

The plan reserves these development-only identities:

- Worker: `8978-ai-control-plane-dev`;
- dedicated authority D1 binding/name: `AUTHORITY_DB` / `8978-ai-authority-dev`;
- Workflow binding/name/class: `ORCHESTRATOR_WORKFLOW` / `8978-ai-orchestrator-dev` / `OrchestratorWorkflow`;
- Queue binding/name: `ORCHESTRATOR_QUEUE` / `8978-ai-orchestrator-dev`.

The existing `pk-d1-dev` Project Knowledge database and its known identifier are explicitly prohibited as authority runtime storage. The plan pins the byte-level SHA-256 digest and order of all six reviewed authority migrations.

## Required gates

The preflight cannot report ready until every condition is present:

- plan status is `READY`;
- resource activation and Worker deployment are covered by distinct owner-authorization evidence;
- a dedicated authority database exists and has a valid, non-prohibited UUID;
- its binding is installed, all six exact migrations are applied, and the remote schema is verified;
- the Workflow and Queue exist and both bindings are installed;
- the reviewed commit and independent maker/checker validation digests are available;
- distinct resource-activation authorization, Worker-deployment authorization, and rollback-evidence digests are available;
- a verified backup digest exists; and
- a separately injected evidence verifier authenticates the exact reviewed commit and every evidence digest, with distinct maker, checker, and owner principals; and
- rollback remains `unbind_before_delete`, with unbinding first and automatic resource deletion forbidden.

The checked-in plan intentionally satisfies none of the activation-state gates and no evidence verifier is wired into any runtime. Its preflight result contains 20 blockers. Digest-shaped strings alone cannot make the preflight ready.

## Safety boundary

The preflight module performs validation only. Its verifier is dependency-injected and absent by default; verifier absence or error fails closed. The module contains no `fetch`, Cloudflare REST call, Wrangler invocation, process execution, D1 query, DML/DDL, filesystem write, deployment, migration application, Queue publish, Workflow dispatch, secret access, or provider action. It is not wired into the Worker.

A later, separately reviewed and explicitly owner-authorized infrastructure action must create/select the dedicated resources, capture their authoritative identifiers, back up and migrate the database, verify the remote schema, install bindings, and update evidence. A separate deployment authorization remains required after those steps.
