import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createServiceAuthenticatedRequest } from "../../src/service-auth-adapter.js";

const URL = "https://control-plane.invalid";
const IDENTITY = Object.freeze({
  principalId: "test-orchestrator",
  keyId: "test-key-1",
  secret: "worker-test-fixture-secret-32-bytes-minimum",
});

function signed(path, init = {}) {
  return createServiceAuthenticatedRequest({ url: URL + path, ...IDENTITY, ...init });
}

function validAction() {
  return {
    actionId: "action-1",
    operation: "read",
    requestedTarget: { locator: "repo" },
    correlationId: "correlation-1",
    idempotencyKey: "idempotency-1",
    rollbackRef: "rollback-1",
    evidence: { makerAttestation: "maker", checkerAttestation: "checker" },
    productionSensitive: false,
    destructiveProductionOrCustomerData: false,
    credentialScopeExpansion: false,
    newProductionExternalWriteIntegration: false,
    finalOwnerDecisionChange: false,
    legalPrivacyComplianceContractualDecision: false,
  };
}

describe("development control-plane Worker", () => {
  it("rejects unauthenticated requests without OAuth fallback", async () => {
    const result = await exports.default.fetch(URL + "/v1/runtime/readiness");
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ outcome: "denied", reason: "service_authentication_failed" });
  });

  it("reports a signed, fail-closed readiness state", async () => {
    const result = await exports.default.fetch(await signed("/v1/runtime/readiness"));
    const body = await result.json();
    expect(result.status).toBe(200);
    expect(body.ready).toBe(false);
    expect(body.externalWritesEnabled).toBe(false);
    expect(body.serviceIdentity).toEqual({ mechanism: "hmac-sha256", principalId: "test-orchestrator", keyId: "test-key-1" });
    expect(body.missingAuthoritativeDependencies).toContain("workflowDispatcher");
  });

  it("allows exactly one winner in a concurrent nonce race through the real SQLite Durable Object", async () => {
    const request = await signed("/v1/runtime/readiness", { nonce: "concurrent-replay-test-nonce" });
    const results = await Promise.all(Array.from({ length: 20 }, () => exports.default.fetch(request.clone())));
    const statuses = results.map((result) => result.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 401)).toHaveLength(19);
  });

  it("rejects bearer and OAuth authorization headers", async () => {
    const request = await signed("/v1/runtime/readiness");
    request.headers.set("authorization", "Bearer forbidden");
    expect((await exports.default.fetch(request)).status).toBe(401);
  });

  it("evaluates a valid signed action but denies unavailable authoritative resolution", async () => {
    const body = JSON.stringify(validAction());
    const result = await exports.default.fetch(await signed("/v1/actions/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ outcome: "denied", reason: "authoritative_resolution_unavailable" });
  });

  it("keeps execution disabled even for an authenticated caller", async () => {
    const result = await exports.default.fetch(await signed("/v1/actions/execute", { method: "POST", body: "{}" }));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ outcome: "denied", reason: "execution_disabled" });
  });
});
