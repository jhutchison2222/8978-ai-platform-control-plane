import { REQUIRED_RUNTIME_DEPENDENCIES } from "./runtime-contracts.js";

const unavailable = (name) => async () => {
  throw new Error(`Development runtime dependency unavailable: ${name}`);
};

export function createUnavailableRuntime(overrides = {}) {
  const runtime = {
    resourceResolver: { resolve: unavailable("resourceResolver") },
    identityVerifier: { verify: unavailable("identityVerifier") },
    evidenceProvider: { getTestEvidence: unavailable("evidenceProvider") },
    rollbackVerifier: { verify: unavailable("rollbackVerifier") },
    limitProvider: { resolve: unavailable("limitProvider") },
    ownerVerifier: { verify: unavailable("ownerVerifier") },
    ownerDecisionStore: { atomic: true, durability: "durable", consume: unavailable("ownerDecisionStore") },
    idempotencyStore: {
      atomic: true,
      durability: "durable",
      reserve: unavailable("idempotencyStore"),
      complete: unavailable("idempotencyStore"),
      release: unavailable("idempotencyStore"),
    },
    auditStore: {
      durability: "durable",
      appendOnly: true,
      append: unavailable("auditStore"),
      verifyReceipt: unavailable("auditStore"),
    },
    revalidateStandingState: unavailable("revalidateStandingState"),
    projectKnowledge: { readGoverningKnowledge: unavailable("projectKnowledge") },
    workflowDispatcher: { dispatch: unavailable("workflowDispatcher") },
    queuePublisher: { publish: unavailable("queuePublisher") },
    ...overrides,
  };
  return Object.freeze(runtime);
}

export const UNAVAILABLE_RUNTIME_DEPENDENCIES = REQUIRED_RUNTIME_DEPENDENCIES;
