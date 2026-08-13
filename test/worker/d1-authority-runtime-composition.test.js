import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createD1AuthorityRuntimeDependencies,
  D1_AUTHORITY_RUNTIME_DEPENDENCIES,
} from "../../src/d1-authority-runtime-composition.js";
import {
  createDevelopmentRuntime,
  developmentUnavailableRuntimeDependencies,
} from "../../src/development-runtime.js";

const expectedConstructors = Object.freeze({
  resourceResolver: "D1AuthoritativeResourceResolver",
  identityVerifier: "D1Ed25519IdentityVerifier",
  evidenceProvider: "D1TestEvidenceProvider",
  rollbackVerifier: "D1RollbackVerifier",
  limitProvider: "D1TrustedLimitProvider",
  ownerVerifier: "D1Ed25519OwnerDecisionVerifier",
  projectKnowledge: "D1GoverningProjectKnowledgeReader",
});

describe("D1 authority runtime composition", () => {
  beforeAll(async () => applyD1Migrations(env.AUTHORITY_DB, env.AUTHORITY_TEST_MIGRATIONS));

  it("constructs every reviewed read-only dependency from one real D1 binding", async () => {
    const dependencies = createD1AuthorityRuntimeDependencies(env.AUTHORITY_DB);
    expect(Object.keys(dependencies)).toEqual(D1_AUTHORITY_RUNTIME_DEPENDENCIES);
    expect(Object.isFrozen(dependencies)).toBe(true);
    for (const [name, constructorName] of Object.entries(expectedConstructors)) {
      expect(dependencies[name].constructor.name).toBe(constructorName);
      expect(dependencies[name].database).toBe(env.AUTHORITY_DB);
    }
    expect(typeof dependencies.revalidateStandingState).toBe("function");
    await expect(dependencies.revalidateStandingState(null, null)).rejects.toThrow(/context is invalid/);
  });

  it("activates authority reads only when AUTHORITY_DB is actually injected", async () => {
    const runtime = createDevelopmentRuntime(env);
    expect(runtime.resourceResolver.constructor.name).toBe("D1AuthoritativeResourceResolver");
    expect(developmentUnavailableRuntimeDependencies(env)).toEqual(["workflowDispatcher", "queuePublisher"]);
    await expect(runtime.resourceResolver.resolve({ locator: "missing-authority-record" })).rejects.toThrow(/unavailable/);

    const withoutAuthority = {
      IDEMPOTENCY_STORE: env.IDEMPOTENCY_STORE,
      OWNER_DECISION_STORE: env.OWNER_DECISION_STORE,
      AUDIT_STORE: env.AUDIT_STORE,
    };
    const unavailableRuntime = createDevelopmentRuntime(withoutAuthority);
    expect(developmentUnavailableRuntimeDependencies(withoutAuthority)).toContain("resourceResolver");
    await expect(unavailableRuntime.resourceResolver.resolve({ locator: "anything" })).rejects.toThrow(/dependency unavailable/);
  });
});
