import {
  CloudflareDurableAuditStore,
  CloudflareDurableIdempotencyStore,
  CloudflareDurableOwnerDecisionStore,
} from "./cloudflare-runtime-stores.js";
import { CloudflareQueuePublisher, CloudflareWorkflowDispatcher } from "./cloudflare-orchestrator-adapters.js";
import { createD1AuthorityRuntimeDependencies, D1_AUTHORITY_RUNTIME_DEPENDENCIES } from "./d1-authority-runtime-composition.js";
import { REQUIRED_RUNTIME_DEPENDENCIES } from "./runtime-contracts.js";
import { createUnavailableRuntime } from "./unavailable-runtime.js";

const DURABLE_DEPENDENCIES = Object.freeze(["idempotencyStore", "ownerDecisionStore", "auditStore"]);

export const DEVELOPMENT_UNAVAILABLE_RUNTIME_DEPENDENCIES = Object.freeze(
  REQUIRED_RUNTIME_DEPENDENCIES.filter((name) => !DURABLE_DEPENDENCIES.includes(name)),
);

function hasAuthorityDatabase(env) {
  return typeof env?.AUTHORITY_DB?.prepare === "function";
}

function hasOrchestratorBindings(env) {
  return typeof env?.ORCHESTRATOR_WORKFLOW?.create === "function" && typeof env?.ORCHESTRATOR_QUEUE?.send === "function";
}

export function developmentUnavailableRuntimeDependencies(env) {
  const implemented = new Set(DURABLE_DEPENDENCIES);
  if (hasAuthorityDatabase(env)) for (const name of D1_AUTHORITY_RUNTIME_DEPENDENCIES) implemented.add(name);
  if (hasOrchestratorBindings(env)) for (const name of ["workflowDispatcher", "queuePublisher"]) implemented.add(name);
  return Object.freeze(REQUIRED_RUNTIME_DEPENDENCIES.filter((name) => !implemented.has(name)));
}

export function createDevelopmentRuntime(env) {
  const authorityDependencies = hasAuthorityDatabase(env)
    ? createD1AuthorityRuntimeDependencies(env.AUTHORITY_DB)
    : {};
  const orchestratorDependencies = hasOrchestratorBindings(env) ? {
    workflowDispatcher: new CloudflareWorkflowDispatcher(env.ORCHESTRATOR_WORKFLOW, { workflowName: "8978-ai-orchestrator-dev" }),
    queuePublisher: new CloudflareQueuePublisher(env.ORCHESTRATOR_QUEUE, { queueName: "8978-ai-orchestrator-dev" }),
  } : {};
  return createUnavailableRuntime({
    idempotencyStore: new CloudflareDurableIdempotencyStore(env.IDEMPOTENCY_STORE),
    ownerDecisionStore: new CloudflareDurableOwnerDecisionStore(env.OWNER_DECISION_STORE),
    auditStore: new CloudflareDurableAuditStore(env.AUDIT_STORE),
    ...authorityDependencies,
    ...orchestratorDependencies,
  });
}
