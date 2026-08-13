import {
  CloudflareDurableAuditStore,
  CloudflareDurableIdempotencyStore,
  CloudflareDurableOwnerDecisionStore,
} from "./cloudflare-runtime-stores.js";
import { REQUIRED_RUNTIME_DEPENDENCIES } from "./runtime-contracts.js";
import { createUnavailableRuntime } from "./unavailable-runtime.js";

const IMPLEMENTED = new Set(["idempotencyStore", "ownerDecisionStore", "auditStore"]);

export const DEVELOPMENT_UNAVAILABLE_RUNTIME_DEPENDENCIES = Object.freeze(
  REQUIRED_RUNTIME_DEPENDENCIES.filter((name) => !IMPLEMENTED.has(name)),
);

export function createDevelopmentRuntime(env) {
  return createUnavailableRuntime({
    idempotencyStore: new CloudflareDurableIdempotencyStore(env.IDEMPOTENCY_STORE),
    ownerDecisionStore: new CloudflareDurableOwnerDecisionStore(env.OWNER_DECISION_STORE),
    auditStore: new CloudflareDurableAuditStore(env.AUDIT_STORE),
  });
}
