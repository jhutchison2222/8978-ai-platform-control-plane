import policies from "../../policies/development-standing-policies.json" with { type: "json" };
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalize, digestCanonicalValue, digestRequestedAction } from "../../src/canonical-digest.js";
import { CloudflareDurableOwnerDecisionStore } from "../../src/cloudflare-runtime-stores.js";
import { D1Ed25519OwnerDecisionVerifier, D1StandingStateRevalidator } from "../../src/d1-owner-control-runtime.js";
import { PolicyGateway } from "../../src/policy-gateway.js";
import { createUnavailableRuntime } from "../../src/unavailable-runtime.js";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const farPast = Date.parse("2000-01-01T00:00:00.000Z");
const farFuture = Date.parse("2100-01-01T00:00:00.000Z");
const digest = (character) => `sha256:${character.repeat(64)}`;
const repository = Object.freeze({
  kind: "github_repository", provider: "github",
  repository: "jhutchison2222/8978-ai-platform-control-plane", environment: "development",
  isolation: { mode: "internal_8978" },
});
let ownerKeys;

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function action(overrides = {}) {
  return {
    actionId: "owner-control-action", operation: "write_code", requestedTarget: { locator: "control-plane" },
    correlationId: "owner-control-correlation", idempotencyKey: "owner-control-idempotency", rollbackRef: "rollback-ok",
    evidence: { makerAttestation: "maker", checkerAttestation: "checker" }, productionSensitive: false,
    destructiveProductionOrCustomerData: false, credentialScopeExpansion: false,
    newProductionExternalWriteIntegration: false, finalOwnerDecisionChange: false,
    legalPrivacyComplianceContractualDecision: false, ...overrides,
  };
}

async function seedOwnerKey(overrides = {}) {
  const publicKeyBase64url = overrides.publicKeyBase64url ?? base64url(await crypto.subtle.exportKey("raw", ownerKeys.publicKey));
  const keyId = overrides.keyId ?? "owner-key";
  const principalId = overrides.principalId ?? "owner-principal";
  const version = overrides.version ?? 1;
  const keyRecord = { keyId, principalId, algorithm: "Ed25519", publicKeyBase64url, version };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_owner_keys
      (record_id, key_id, principal_id, algorithm, public_key_base64url, key_digest,
       status, enabled, valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, 'Ed25519', ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  `).bind(
    overrides.recordId ?? crypto.randomUUID(), keyId, principalId, publicKeyBase64url,
    overrides.keyDigest ?? await digestCanonicalValue(keyRecord), overrides.status ?? "CURRENT",
    overrides.enabled ?? 1, overrides.validFromMs ?? farPast, overrides.validUntilMs ?? farFuture, version,
  ).run();
}

async function signedDecision(actionDigest, overrides = {}) {
  const payload = {
    decisionId: overrides.decisionId ?? `decision-${crypto.randomUUID()}`,
    requestedActionDigest: actionDigest,
    decision: overrides.decision ?? "approved",
    decidedBy: overrides.decidedBy ?? "owner-principal",
    decidedAt: overrides.decidedAt ?? new Date(NOW.valueOf() - 60_000).toISOString(),
    expiresAt: overrides.expiresAt ?? new Date(NOW.valueOf() + 3_600_000).toISOString(),
    issuerKeyId: overrides.issuerKeyId ?? "owner-key",
    signatureAlgorithm: overrides.signatureAlgorithm ?? "Ed25519",
  };
  const signature = await crypto.subtle.sign(
    "Ed25519", overrides.privateKey ?? ownerKeys.privateKey, new TextEncoder().encode(canonicalize(payload)),
  );
  return { ...payload, signature: overrides.signature ?? base64url(signature), ...(overrides.extra ?? {}) };
}

async function seedStandingState(overrides = {}) {
  const policyId = overrides.policyId ?? "dev-github-control-plane";
  const policyVersion = overrides.policyVersion ?? "2.0.0";
  const state = overrides.state ?? "enabled";
  const killSwitch = overrides.killSwitch ?? false;
  const reason = overrides.reason ?? "active";
  const version = overrides.version ?? 1;
  const record = { policyId, policyVersion, state, killSwitch, reason, version };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_standing_state
      (record_id, policy_id, policy_version, state, kill_switch, reason, evidence_digest,
       status, enabled, valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
  `).bind(
    overrides.recordId ?? crypto.randomUUID(), policyId, policyVersion, state, Number(killSwitch), reason,
    overrides.evidenceDigest ?? await digestCanonicalValue(record), overrides.status ?? "FINAL", overrides.enabled ?? 1,
    overrides.validFromMs ?? farPast, overrides.validUntilMs ?? farFuture, version,
  ).run();
}

function runtime(overrides = {}) {
  return createUnavailableRuntime({
    resourceResolver: { async resolve() { return repository; } },
    limitProvider: { async resolve(_action, _target, { actionDigest }) { return { risk: "medium", costUsd: 0, recordCount: 1, actionDigest, evidenceDigest: digest("c") }; } },
    identityVerifier: { async verify(_claim, { role, actionDigest }) { return { principalId: `${role}-principal`, role, actionDigest }; } },
    evidenceProvider: { async getTestEvidence(actionDigest, required) { return required.map((testId) => ({ testId, result: "passed", actionDigest, issuedAt: new Date(farPast).toISOString(), expiresAt: new Date(farFuture).toISOString(), evidenceDigest: digest("d") })); } },
    rollbackVerifier: { async verify(_reference, { actionDigest }) { return { valid: true, executable: true, actionDigest, issuedAt: new Date(farPast).toISOString(), expiresAt: new Date(farFuture).toISOString(), evidenceDigest: digest("e") }; } },
    projectKnowledge: { async readGoverningKnowledge({ actionDigest }) { return { recordId: "pk-owner-control", status: "FINAL", version: "1", scope: "control-plane", knowledge: { mode: "development" }, digest: digest("f"), retrievedAt: NOW.toISOString(), actionDigest }; } },
    ownerDecisionStore: new CloudflareDurableOwnerDecisionStore(env.OWNER_DECISION_STORE),
    idempotencyStore: { atomic: true, durability: "durable", async reserve(){}, async complete(){}, async release(){} },
    auditStore: { durability: "durable", appendOnly: true, async append(){}, async verifyReceipt(){} },
    workflowDispatcher: { async dispatch() {} }, queuePublisher: { async publish() {} },
    ...overrides,
  });
}

describe("owner-control D1 runtime", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.AUTHORITY_DB, env.AUTHORITY_TEST_MIGRATIONS);
    ownerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  });

  beforeEach(async () => {
    await env.AUTHORITY_DB.batch([
      env.AUTHORITY_DB.prepare("DELETE FROM authority_owner_keys"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_standing_state"),
    ]);
  });

  it("verifies an exact digest-bound Ed25519 owner decision", async () => {
    await seedOwnerKey();
    const verifier = new D1Ed25519OwnerDecisionVerifier(env.AUTHORITY_DB);
    const decision = await signedDecision(digest("a"));
    expect(await verifier.verify(decision, { actionDigest: digest("a"), now: NOW })).toBe(true);
    expect(Object.hasOwn(decision, "privateKey")).toBe(false);
  });

  it("rejects tampering, wrong signers, bad lifetimes, key faults, and non-exact decisions", async () => {
    await seedOwnerKey();
    const verifier = new D1Ed25519OwnerDecisionVerifier(env.AUTHORITY_DB);
    const valid = await signedDecision(digest("a"));
    await expect(verifier.verify({ ...valid, decisionId: "tampered" }, { actionDigest: digest("a"), now: NOW })).resolves.toBe(false);
    const otherKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    await expect(verifier.verify(await signedDecision(digest("a"), { privateKey: otherKeys.privateKey }), { actionDigest: digest("a"), now: NOW })).resolves.toBe(false);
    await expect(verifier.verify(valid, { actionDigest: digest("b"), now: NOW })).rejects.toThrow(/binding/);
    await expect(verifier.verify(await signedDecision(digest("a"), { signatureAlgorithm: "ES256" }), { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/binding/);
    await expect(verifier.verify(await signedDecision(digest("a"), { decision: "denied" }), { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/binding/);
    await expect(verifier.verify(await signedDecision(digest("a"), { expiresAt: new Date(NOW.valueOf() + 86_400_001).toISOString() }), { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/not current/);
    await expect(verifier.verify(await signedDecision(digest("a"), { decidedAt: new Date(NOW.valueOf() - 120_000).toISOString(), expiresAt: new Date(NOW.valueOf() - 60_000).toISOString() }), { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/not current/);
    await expect(verifier.verify({ ...valid, extra: true }, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/fields must be exact/);
    await expect(verifier.verify({ ...valid, signature: "AQ" }, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/signature length/);
    await env.AUTHORITY_DB.prepare("UPDATE authority_owner_keys SET enabled=0").run();
    await expect(verifier.verify(valid, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("UPDATE authority_owner_keys SET enabled=1, key_digest=?1").bind(digest("0")).run();
    await expect(verifier.verify(valid, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/integrity/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_owner_keys").run();
    await seedOwnerKey(); await seedOwnerKey();
    await expect(verifier.verify(valid, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/ambiguous/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_owner_keys").run();
    await seedOwnerKey({ principalId: "different-owner" });
    await expect(verifier.verify(valid, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/binding/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_owner_keys").run();
    await seedOwnerKey({ validUntilMs: NOW.valueOf() });
    await expect(verifier.verify(valid, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_owner_keys").run();
    await seedOwnerKey({ publicKeyBase64url: "AQ" });
    await expect(verifier.verify(valid, { actionDigest: digest("a"), now: NOW })).rejects.toThrow(/public key length/);
  });

  it("revalidates one exact standing state and fails closed for every inactive state", async () => {
    const revalidator = new D1StandingStateRevalidator(env.AUTHORITY_DB);
    const requested = action();
    const actionDigest = await digestRequestedAction(requested, repository);
    const authorization = { outcome: "authorized_by_standing_policy", actionDigest, resolvedTarget: repository, authorizingPolicy: { policyId: "dev-github-control-plane", policyVersion: "2.0.0" } };
    await seedStandingState();
    expect(await revalidator.revalidate(requested, authorization, { now: NOW })).toBe(true);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_standing_state").run();
    await seedStandingState({ killSwitch: true });
    expect(await revalidator.revalidate(requested, authorization, { now: NOW })).toBe(false);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_standing_state").run();
    await seedStandingState({ state: "disabled" });
    expect(await revalidator.revalidate(requested, authorization, { now: NOW })).toBe(false);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_standing_state").run();
    await seedStandingState({ enabled: 0 });
    await expect(revalidator.revalidate(requested, authorization, { now: NOW })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_standing_state").run();
    await seedStandingState({ validUntilMs: NOW.valueOf() });
    await expect(revalidator.revalidate(requested, authorization, { now: NOW })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_standing_state").run();
    await seedStandingState({ evidenceDigest: digest("0") });
    await expect(revalidator.revalidate(requested, authorization, { now: NOW })).rejects.toThrow(/integrity/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_standing_state").run();
    await seedStandingState(); await seedStandingState();
    await expect(revalidator.revalidate(requested, authorization, { now: NOW })).rejects.toThrow(/ambiguous/);
    await expect(revalidator.revalidate({ ...requested, actionId: "tampered" }, authorization, { now: NOW })).rejects.toThrow(/action binding/);
  });

  it("drives owner exception verification through single-use durable consumption", async () => {
    await seedOwnerKey();
    const ownerVerifier = new D1Ed25519OwnerDecisionVerifier(env.AUTHORITY_DB);
    const gateway = await PolicyGateway.create(policies, runtime({ ownerVerifier }));
    const requested = action({ operation: "delete_repository", actionId: `owner-${crypto.randomUUID()}` });
    const approval = await gateway.evaluate(requested, NOW);
    expect(approval.outcome).toBe("owner_approval_required");
    const decision = await signedDecision(approval.actionDigest);
    const authorization = await gateway.authorizeOwnerException(requested, decision, { now: NOW });
    expect(authorization.outcome).toBe("authorized_by_owner_exception");
    await expect(gateway.assertExecutable(requested, authorization, { now: new Date(NOW.valueOf() + 1) })).resolves.toBe(true);
    await expect(gateway.assertExecutable(requested, authorization, { now: new Date(NOW.valueOf() + 2) })).rejects.toThrow(/replay/);
  });

  it("blocks standing execution immediately when the authoritative kill switch changes", async () => {
    await seedStandingState();
    const revalidator = new D1StandingStateRevalidator(env.AUTHORITY_DB);
    const gateway = await PolicyGateway.create(policies, runtime({
      ownerVerifier: { async verify() { return false; } },
      revalidateStandingState: revalidator.revalidate.bind(revalidator),
    }));
    const requested = action({ actionId: `standing-${crypto.randomUUID()}` });
    const authorization = await gateway.evaluate(requested, NOW);
    expect(authorization.outcome).toBe("authorized_by_standing_policy");
    await expect(gateway.assertExecutable(requested, authorization, { now: NOW })).resolves.toBe(true);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_standing_state").run();
    await seedStandingState({ killSwitch: true, reason: "owner-stop" });
    await expect(gateway.assertExecutable(requested, authorization, { now: NOW })).rejects.toThrow(/kill switch/);
  });
});
