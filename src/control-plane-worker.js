import policies from "../policies/development-standing-policies.json" with { type: "json" };
import { CloudflareDurableReplayStore } from "./cloudflare-replay-store.js";
import { parseJsonStrict } from "./canonical-digest.js";
import { AuditStateDurableObject, IdempotencyStateDurableObject, OwnerDecisionStateDurableObject } from "./control-plane-state-durable-objects.js";
import { createDevelopmentRuntime, developmentUnavailableRuntimeDependencies } from "./development-runtime.js";
import { OrchestratorWorkflow } from "./orchestrator-workflow.js";
import { PolicyGateway } from "./policy-gateway.js";
import { authenticateServiceRequest } from "./service-auth-adapter.js";
import { ServiceAuthReplayDurableObject } from "./service-auth-replay-durable-object.js";

const JSON_HEADERS = Object.freeze({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
const MAX_BODY_BYTES = 1_048_576;
const ACTION_FIELDS = Object.freeze([
  "actionId", "operation", "requestedTarget", "correlationId", "idempotencyKey", "rollbackRef", "evidence",
  "productionSensitive", "destructiveProductionOrCustomerData", "credentialScopeExpansion",
  "newProductionExternalWriteIntegration", "finalOwnerDecisionChange", "legalPrivacyComplianceContractualDecision",
]);

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function requireDevelopmentEnvironment(env) {
  if (env?.CONTROL_PLANE_MODE !== "development" || env?.ALLOW_EXTERNAL_WRITES !== "false") {
    throw new Error("Development-only runtime boundary unavailable");
  }
  for (const binding of ["SERVICE_AUTH_REPLAY", "IDEMPOTENCY_STORE", "OWNER_DECISION_STORE", "AUDIT_STORE"]) {
    if (!env[binding]) throw new Error(`${binding} unavailable`);
  }
}

function secretResolver(env) {
  return {
    async resolve({ principalId, keyId }) {
      if (typeof env.SERVICE_AUTH_KEYS_JSON !== "string") throw new Error("Service-auth key binding unavailable");
      const keys = parseJsonStrict(env.SERVICE_AUTH_KEYS_JSON);
      const secret = keys?.[principalId]?.[keyId];
      return typeof secret === "string" ? secret : null;
    },
  };
}

function actionErrors(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return ["action_must_be_object"];
  const allowed = new Set([...ACTION_FIELDS, "payload"]);
  const errors = Object.keys(action).filter((field) => !allowed.has(field)).map((field) => `unexpected_${field}`);
  for (const field of ACTION_FIELDS) if (!Object.hasOwn(action, field)) errors.push(`missing_${field}`);
  for (const field of ["actionId", "operation", "correlationId", "idempotencyKey", "rollbackRef"]) {
    if (typeof action[field] !== "string" || action[field].length === 0) errors.push(`invalid_${field}`);
  }
  const target = action.requestedTarget;
  if (!target || typeof target !== "object" || Array.isArray(target) || Object.keys(target).some((field) => field !== "locator") ||
      typeof target.locator !== "string" || target.locator.length === 0) errors.push("invalid_requestedTarget");
  const evidence = action.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) ||
      Object.keys(evidence).some((field) => !["makerAttestation", "checkerAttestation"].includes(field)) ||
      typeof evidence.makerAttestation !== "string" || evidence.makerAttestation.length === 0 ||
      typeof evidence.checkerAttestation !== "string" || evidence.checkerAttestation.length === 0) errors.push("invalid_evidence");
  for (const field of ACTION_FIELDS.slice(7)) if (typeof action[field] !== "boolean") errors.push(`invalid_${field}`);
  return errors;
}

async function authenticate(request, env) {
  if (request.headers.has("authorization") || request.headers.has("proxy-authorization")) {
    throw new Error("OAuth and bearer authorization headers are not accepted");
  }
  return authenticateServiceRequest({
    request,
    secretResolver: secretResolver(env),
    replayStore: new CloudflareDurableReplayStore(env.SERVICE_AUTH_REPLAY),
    maxBodyBytes: MAX_BODY_BYTES,
  });
}

async function evaluateAction(bodyBytes, env) {
  let action;
  try { action = parseJsonStrict(new TextDecoder().decode(bodyBytes)); }
  catch { return response(400, { outcome: "denied", reason: "invalid_json" }); }
  const errors = actionErrors(action);
  if (errors.length) return response(400, { outcome: "denied", reason: "invalid_requested_action", details: errors });
  const gateway = await PolicyGateway.create(policies, createDevelopmentRuntime(env));
  return response(200, await gateway.evaluate(action));
}

export default {
  async fetch(request, env) {
    try { requireDevelopmentEnvironment(env); }
    catch { return response(503, { outcome: "denied", reason: "runtime_boundary_unavailable" }); }

    let authenticated;
    try { authenticated = await authenticate(request, env); }
    catch { return response(401, { outcome: "denied", reason: "service_authentication_failed" }); }

    const path = new URL(request.url).pathname;
    if (path === "/v1/runtime/readiness" && request.method === "GET") {
      return response(200, {
        ready: false,
        mode: "development",
        externalWritesEnabled: false,
        missingAuthoritativeDependencies: developmentUnavailableRuntimeDependencies(env),
        durableDependencies: ["idempotencyStore", "ownerDecisionStore", "auditStore"],
        serviceIdentity: {
          mechanism: authenticated.identity.mechanism,
          principalId: authenticated.identity.principalId,
          keyId: authenticated.identity.keyId,
        },
      });
    }
    if (path === "/v1/actions/evaluate" && request.method === "POST") return evaluateAction(authenticated.bodyBytes, env);
    if (path === "/v1/actions/execute") return response(503, { outcome: "denied", reason: "execution_disabled" });
    return response(404, { outcome: "denied", reason: "route_not_found" });
  },
};

export { AuditStateDurableObject, IdempotencyStateDurableObject, OrchestratorWorkflow, OwnerDecisionStateDurableObject, ServiceAuthReplayDurableObject };
