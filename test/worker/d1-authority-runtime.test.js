import policies from "../../policies/development-standing-policies.json" with { type: "json" };
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { digestCanonicalValue } from "../../src/canonical-digest.js";
import { D1AuthoritativeResourceResolver, D1TrustedLimitProvider } from "../../src/d1-authority-runtime.js";
import { PolicyGateway } from "../../src/policy-gateway.js";
import { resourceKey } from "../../src/resource-contract.js";
import { createUnavailableRuntime } from "../../src/unavailable-runtime.js";

const NOW = new Date("2026-08-13T12:00:00Z");
const repository = Object.freeze({
  kind: "github_repository",
  provider: "github",
  repository: "jhutchison2222/8978-ai-platform-control-plane",
  environment: "development",
  isolation: { mode: "internal_8978" },
});
const digest = (character) => `sha256:${character.repeat(64)}`;

function action(overrides = {}) {
  return {
    actionId: "d1-action-1",
    operation: "write_code",
    requestedTarget: { locator: "control-plane" },
    correlationId: "d1-correlation-1",
    idempotencyKey: "d1-idempotency-1",
    rollbackRef: "rollback-unavailable",
    evidence: { makerAttestation: "maker", checkerAttestation: "checker" },
    productionSensitive: false,
    destructiveProductionOrCustomerData: false,
    credentialScopeExpansion: false,
    newProductionExternalWriteIntegration: false,
    finalOwnerDecisionChange: false,
    legalPrivacyComplianceContractualDecision: false,
    ...overrides,
  };
}

async function insertResource(overrides = {}) {
  const resource = overrides.resource ?? repository;
  const statement = env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_resources
      (record_id, locator, status, enabled, valid_from_ms, valid_until_ms, resource_key, resource_json, resource_digest, version)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  `);
  await statement.bind(
    overrides.recordId ?? crypto.randomUUID(),
    overrides.locator ?? "control-plane",
    overrides.status ?? "CURRENT",
    overrides.enabled ?? 1,
    overrides.validFromMs ?? NOW.valueOf() - 1,
    overrides.validUntilMs ?? Date.parse("2100-01-01T00:00:00Z"),
    overrides.resourceKey ?? resourceKey(resource),
    overrides.resourceJson ?? JSON.stringify(resource),
    overrides.resourceDigest ?? await digestCanonicalValue(resource),
    overrides.version ?? 1,
  ).run();
}

async function insertLimits(overrides = {}) {
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_limits
      (record_id, resource_key, operation, status, enabled, valid_from_ms, valid_until_ms, risk, cost_usd, record_count, evidence_digest, version)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
  `).bind(
    overrides.recordId ?? crypto.randomUUID(),
    overrides.resourceKey ?? resourceKey(repository),
    overrides.operation ?? "write_code",
    overrides.status ?? "FINAL",
    overrides.enabled ?? 1,
    overrides.validFromMs ?? NOW.valueOf() - 1,
    overrides.validUntilMs ?? Date.parse("2100-01-01T00:00:00Z"),
    overrides.risk ?? "medium",
    overrides.costUsd ?? 0,
    overrides.recordCount ?? 1,
    overrides.evidenceDigest ?? digest("c"),
    overrides.version ?? 1,
  ).run();
}

describe("read-only authoritative D1 runtime", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.AUTHORITY_DB, env.AUTHORITY_TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await env.AUTHORITY_DB.batch([
      env.AUTHORITY_DB.prepare("DELETE FROM authority_limits"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_resources"),
    ]);
  });

  it("resolves one current digest-verified resource and returns digest-bound limits", async () => {
    await insertResource();
    await insertLimits();
    const resolver = new D1AuthoritativeResourceResolver(env.AUTHORITY_DB);
    const limits = new D1TrustedLimitProvider(env.AUTHORITY_DB);
    const resolved = await resolver.resolve({ locator: "control-plane" }, { now: NOW });
    const result = await limits.resolve(action(), resolved, { actionDigest: digest("a"), now: NOW });
    expect(resolved).toEqual(repository);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(result).toEqual({ risk: "medium", costUsd: 0, recordCount: 1, evidenceDigest: digest("c"), actionDigest: digest("a") });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects missing, expired, disabled, ambiguous, and tampered resource records", async () => {
    const resolver = new D1AuthoritativeResourceResolver(env.AUTHORITY_DB);
    await expect(resolver.resolve({ locator: "missing" }, { now: NOW })).rejects.toThrow(/unavailable/);

    await insertResource({ locator: "expired", validUntilMs: NOW.valueOf() });
    await expect(resolver.resolve({ locator: "expired" }, { now: NOW })).rejects.toThrow(/unavailable/);

    await insertResource({ locator: "disabled", enabled: 0 });
    await expect(resolver.resolve({ locator: "disabled" }, { now: NOW })).rejects.toThrow(/unavailable/);

    await insertResource({ locator: "ambiguous" });
    await insertResource({ locator: "ambiguous" });
    await expect(resolver.resolve({ locator: "ambiguous" }, { now: NOW })).rejects.toThrow(/ambiguous/);

    await insertResource({ locator: "tampered", resourceDigest: digest("f") });
    await expect(resolver.resolve({ locator: "tampered" }, { now: NOW })).rejects.toThrow(/integrity/);

    await insertResource({ locator: "duplicate-json", resourceJson: '{"kind":"github_repository","kind":"cloudflare_worker"}' });
    await expect(resolver.resolve({ locator: "duplicate-json" }, { now: NOW })).rejects.toThrow(/Duplicate JSON object key/);
  });

  it("rejects forged request fields, ambiguous limits, and limits for a different resource", async () => {
    await insertResource();
    await insertLimits();
    const resolver = new D1AuthoritativeResourceResolver(env.AUTHORITY_DB);
    const provider = new D1TrustedLimitProvider(env.AUTHORITY_DB);
    await expect(resolver.resolve({ locator: "control-plane", provider: "forged" }, { now: NOW })).rejects.toThrow(/only locator/);
    await expect(resolver.resolve({ locator: "control-plane' OR 1=1--" }, { now: NOW })).rejects.toThrow(/Invalid authority locator/);
    const resolved = await resolver.resolve({ locator: "control-plane" }, { now: NOW });
    await expect(provider.resolve(action({ operation: "write_code' OR 1=1--" }), resolved, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/Invalid authority operation/);
    await insertLimits();
    await expect(provider.resolve(action(), resolved, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/ambiguous/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_limits").run();
    await insertLimits({ resourceKey: "github:someone/else" });
    await expect(provider.resolve(action(), resolved, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/unavailable/);
  });

  it("advances the real gateway beyond resolution and limits to the next closed gates", async () => {
    await insertResource();
    await insertLimits();
    const runtime = createUnavailableRuntime({
      resourceResolver: new D1AuthoritativeResourceResolver(env.AUTHORITY_DB),
      limitProvider: new D1TrustedLimitProvider(env.AUTHORITY_DB),
    });
    const gateway = await PolicyGateway.create(policies, runtime);
    const result = await gateway.evaluate(action(), NOW);
    expect(result.outcome, JSON.stringify(result)).toBe("validation_required");
    expect(result.unmetGates.map((gate) => gate.gate).sort()).toEqual(["identity", "identity", "rollback", "tests"]);
  });
});
