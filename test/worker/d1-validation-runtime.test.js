import policies from "../../policies/development-standing-policies.json" with { type: "json" };
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalize, digestCanonicalValue, digestRequestedAction } from "../../src/canonical-digest.js";
import { D1AuthoritativeResourceResolver, D1TrustedLimitProvider } from "../../src/d1-authority-runtime.js";
import { D1Ed25519IdentityVerifier, D1RollbackVerifier, D1TestEvidenceProvider } from "../../src/d1-validation-runtime.js";
import { D1GoverningProjectKnowledgeReader } from "../../src/d1-project-knowledge-runtime.js";
import { PolicyGateway } from "../../src/policy-gateway.js";
import { resourceKey } from "../../src/resource-contract.js";
import { createUnavailableRuntime } from "../../src/unavailable-runtime.js";

const repository = Object.freeze({
  kind: "github_repository",
  provider: "github",
  repository: "jhutchison2222/8978-ai-platform-control-plane",
  environment: "development",
  isolation: { mode: "internal_8978" },
});
const encoder = new TextEncoder();
const digest = (character) => `sha256:${character.repeat(64)}`;
const farPast = Date.parse("2000-01-01T00:00:00.000Z");
const farFuture = Date.parse("2100-01-01T00:00:00.000Z");
let makerKeys;
let checkerKeys;

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function action(overrides = {}) {
  return {
    actionId: "validation-action-1",
    operation: "write_code",
    requestedTarget: { locator: "control-plane" },
    correlationId: "validation-correlation-1",
    idempotencyKey: "validation-idempotency-1",
    rollbackRef: "rollback-validation-1",
    evidence: { makerAttestation: "pending", checkerAttestation: "pending" },
    productionSensitive: false,
    destructiveProductionOrCustomerData: false,
    credentialScopeExpansion: false,
    newProductionExternalWriteIntegration: false,
    finalOwnerDecisionChange: false,
    legalPrivacyComplianceContractualDecision: false,
    ...overrides,
  };
}

async function seedKey({ keyId, principalId, role, keyPair, ...overrides }) {
  const publicKeyBase64url = base64url(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const allowedRoles = overrides.allowedRoles ?? [role];
  const version = overrides.version ?? 1;
  const keyRecord = { keyId, principalId, allowedRoles, algorithm: "Ed25519", publicKeyBase64url, version };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_identity_keys
      (record_id, key_id, principal_id, allowed_roles_json, algorithm, public_key_base64url, key_digest,
       status, enabled, valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, ?4, 'Ed25519', ?5, ?6, ?7, ?8, ?9, ?10, ?11)
  `).bind(
    overrides.recordId ?? crypto.randomUUID(), keyId, principalId, canonicalize(allowedRoles), publicKeyBase64url,
    overrides.keyDigest ?? await digestCanonicalValue(keyRecord), overrides.status ?? "CURRENT", overrides.enabled ?? 1,
    overrides.validFromMs ?? farPast, overrides.validUntilMs ?? farFuture, version,
  ).run();
}

async function attestation({ keyId, principalId, role, actionDigest, keyPair, now = new Date(), ...overrides }) {
  const payload = {
    schemaVersion: "1.0.0",
    attestationId: overrides.attestationId ?? crypto.randomUUID(),
    principalId,
    keyId,
    role,
    actionDigest,
    issuedAt: new Date(now.valueOf() - 60_000).toISOString(),
    expiresAt: new Date(now.valueOf() + 3_600_000).toISOString(),
    ...overrides.payload,
  };
  const payloadBytes = encoder.encode(canonicalize(payload));
  const signature = await crypto.subtle.sign("Ed25519", overrides.signingKey ?? keyPair.privateKey, payloadBytes);
  return `v1.${base64url(payloadBytes)}.${base64url(signature)}`;
}

async function seedTestEvidence({ actionDigest, testId, ...overrides }) {
  const record = {
    testId,
    result: overrides.result ?? "passed",
    actionDigest,
    issuedAt: new Date(overrides.issuedAtMs ?? farPast).toISOString(),
    expiresAt: new Date(overrides.expiresAtMs ?? farFuture).toISOString(),
    sourcePrincipalId: overrides.sourcePrincipalId ?? "ci-validator",
    version: overrides.version ?? 1,
  };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_test_evidence
      (record_id, action_digest, test_id, result, source_principal_id, evidence_digest,
       status, enabled, issued_at_ms, expires_at_ms, version)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
  `).bind(
    overrides.recordId ?? crypto.randomUUID(), actionDigest, testId, record.result, record.sourcePrincipalId,
    overrides.evidenceDigest ?? await digestCanonicalValue(record), overrides.status ?? "FINAL", overrides.enabled ?? 1,
    overrides.issuedAtMs ?? farPast, overrides.expiresAtMs ?? farFuture, record.version,
  ).run();
}

async function seedRollback({ rollbackRef, actionDigest, ...overrides }) {
  const record = {
    rollbackRef,
    actionDigest,
    valid: overrides.valid ?? true,
    executable: overrides.executable ?? true,
    executorRef: overrides.executorRef ?? "rollback-executor-development",
    issuedAt: new Date(overrides.issuedAtMs ?? farPast).toISOString(),
    expiresAt: new Date(overrides.expiresAtMs ?? farFuture).toISOString(),
    version: overrides.version ?? 1,
  };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_rollbacks
      (record_id, rollback_ref, action_digest, valid, executable, executor_ref, evidence_digest,
       status, enabled, issued_at_ms, expires_at_ms, version)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
  `).bind(
    overrides.recordId ?? crypto.randomUUID(), rollbackRef, actionDigest, Number(record.valid), Number(record.executable),
    record.executorRef, overrides.evidenceDigest ?? await digestCanonicalValue(record), overrides.status ?? "CURRENT",
    overrides.enabled ?? 1, overrides.issuedAtMs ?? farPast, overrides.expiresAtMs ?? farFuture, record.version,
  ).run();
}

async function seedResourceAndLimits(actionDigest) {
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_resources
      (record_id, locator, status, enabled, valid_from_ms, valid_until_ms, resource_key, resource_json, resource_digest, version)
    VALUES (?1, 'control-plane', 'CURRENT', 1, ?2, ?3, ?4, ?5, ?6, 1)
  `).bind(crypto.randomUUID(), farPast, farFuture, resourceKey(repository), canonicalize(repository), await digestCanonicalValue(repository)).run();
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_limits
      (record_id, resource_key, operation, status, enabled, valid_from_ms, valid_until_ms, risk, cost_usd, record_count, evidence_digest, version)
    VALUES (?1, ?2, 'write_code', 'FINAL', 1, ?3, ?4, 'medium', 0, 1, ?5, 1)
  `).bind(crypto.randomUUID(), resourceKey(repository), farPast, farFuture, digest("c")).run();
  for (const testId of ["unit", "artifact-validation", "secret-scan"]) await seedTestEvidence({ actionDigest, testId });
  await seedRollback({ rollbackRef: "rollback-validation-1", actionDigest });
}

async function seedGoverningKnowledge() {
  const recordId = "pk-runtime-development";
  const status = "CURRENT";
  const version = "1";
  const scope = "control-plane";
  const knowledge = { directives: [{ id: "external-writes", value: "disabled" }] };
  const digestRecord = { recordId, status, version, scope, knowledge };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_project_knowledge
      (record_id, knowledge_scope, status, governing, enabled, knowledge_json, knowledge_digest,
       valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, 1, 1, ?4, ?5, ?6, ?7, ?8)
  `).bind(recordId, scope, status, canonicalize(knowledge), await digestCanonicalValue(digestRecord), farPast, farFuture, version).run();
}

describe("D1 validation evidence runtime", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.AUTHORITY_DB, env.AUTHORITY_TEST_MIGRATIONS);
    makerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    checkerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  });

  beforeEach(async () => {
    await env.AUTHORITY_DB.batch([
      env.AUTHORITY_DB.prepare("DELETE FROM authority_project_knowledge"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_identity_keys"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_test_evidence"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_rollbacks"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_limits"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_resources"),
    ]);
  });

  it("verifies exact-role, exact-digest Ed25519 identity attestations", async () => {
    const now = new Date();
    await seedKey({ keyId: "maker-key", principalId: "maker-principal", role: "maker", keyPair: makerKeys });
    const token = await attestation({ keyId: "maker-key", principalId: "maker-principal", role: "maker", actionDigest: digest("a"), keyPair: makerKeys, now });
    const result = await new D1Ed25519IdentityVerifier(env.AUTHORITY_DB).verify(token, { role: "maker", actionDigest: digest("a"), now });
    expect(result.principalId).toBe("maker-principal");
    expect(result.role).toBe("maker");
    expect(result.actionDigest).toBe(digest("a"));
    expect(result.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects wrong role, digest, signer, expiry, disabled keys, and key ambiguity", async () => {
    const now = new Date();
    const verifier = new D1Ed25519IdentityVerifier(env.AUTHORITY_DB);
    await seedKey({ keyId: "maker-key", principalId: "maker-principal", role: "maker", keyPair: makerKeys });
    const token = await attestation({ keyId: "maker-key", principalId: "maker-principal", role: "maker", actionDigest: digest("a"), keyPair: makerKeys, now });
    await expect(verifier.verify(token, { role: "checker", actionDigest: digest("a"), now })).rejects.toThrow(/binding mismatch/);
    await expect(verifier.verify(token, { role: "maker", actionDigest: digest("b"), now })).rejects.toThrow(/binding mismatch/);

    const forged = await attestation({ keyId: "maker-key", principalId: "maker-principal", role: "maker", actionDigest: digest("a"), keyPair: makerKeys, signingKey: checkerKeys.privateKey, now });
    await expect(verifier.verify(forged, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/signature invalid/);
    const wrongPrincipal = await attestation({ keyId: "maker-key", principalId: "other-principal", role: "maker", actionDigest: digest("a"), keyPair: makerKeys, now });
    await expect(verifier.verify(wrongPrincipal, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/key binding mismatch/);

    const expired = await attestation({ keyId: "maker-key", principalId: "maker-principal", role: "maker", actionDigest: digest("a"), keyPair: makerKeys, now, payload: { issuedAt: new Date(now.valueOf() - 120_000).toISOString(), expiresAt: new Date(now.valueOf() - 60_000).toISOString() } });
    await expect(verifier.verify(expired, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/not current/);

    await env.AUTHORITY_DB.prepare("UPDATE authority_identity_keys SET enabled=0").run();
    await expect(verifier.verify(token, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("UPDATE authority_identity_keys SET enabled=1").run();
    await seedKey({ keyId: "maker-key", principalId: "maker-principal", role: "maker", keyPair: makerKeys });
    await expect(verifier.verify(token, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/ambiguous/);
  });

  it("rejects non-canonical payloads, duplicate fields, tampered key records, and overlong attestations", async () => {
    const now = new Date();
    const verifier = new D1Ed25519IdentityVerifier(env.AUTHORITY_DB);
    await seedKey({ keyId: "maker-key", principalId: "maker-principal", role: "maker", keyPair: makerKeys });
    const payload = {
      schemaVersion: "1.0.0", attestationId: "attestation-1", principalId: "maker-principal", keyId: "maker-key",
      role: "maker", actionDigest: digest("a"), issuedAt: new Date(now.valueOf() - 60_000).toISOString(),
      expiresAt: new Date(now.valueOf() + 60_000).toISOString(),
    };
    const noncanonicalBytes = encoder.encode(JSON.stringify(payload, null, 2));
    const noncanonicalSignature = await crypto.subtle.sign("Ed25519", makerKeys.privateKey, noncanonicalBytes);
    await expect(verifier.verify(`v1.${base64url(noncanonicalBytes)}.${base64url(noncanonicalSignature)}`, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/canonical JSON/);

    const duplicateText = canonicalize(payload).replace('{"actionDigest"', `{"role":"maker","actionDigest"`);
    const duplicateBytes = encoder.encode(duplicateText);
    const duplicateSignature = await crypto.subtle.sign("Ed25519", makerKeys.privateKey, duplicateBytes);
    await expect(verifier.verify(`v1.${base64url(duplicateBytes)}.${base64url(duplicateSignature)}`, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/Duplicate JSON object key/);

    await env.AUTHORITY_DB.prepare("UPDATE authority_identity_keys SET key_digest=?1").bind(digest("f")).run();
    const validToken = await attestation({ keyId: "maker-key", principalId: "maker-principal", role: "maker", actionDigest: digest("a"), keyPair: makerKeys, now });
    await expect(verifier.verify(validToken, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/integrity/);
    await expect(verifier.verify("v1." + "a".repeat(8192) + ".x", { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/Invalid identity attestation/);
    const [prefix, encodedPayload] = validToken.split(".");
    await expect(verifier.verify(`${prefix}.${encodedPayload}.AQ`, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/signature length/);

    const shortPublicKey = "AQ";
    const shortKeyRecord = { keyId: "maker-key", principalId: "maker-principal", allowedRoles: ["maker"], algorithm: "Ed25519", publicKeyBase64url: shortPublicKey, version: 1 };
    await env.AUTHORITY_DB.prepare("UPDATE authority_identity_keys SET public_key_base64url=?1, key_digest=?2")
      .bind(shortPublicKey, await digestCanonicalValue(shortKeyRecord)).run();
    await expect(verifier.verify(validToken, { role: "maker", actionDigest: digest("a"), now })).rejects.toThrow(/public key length/);
  });

  it("returns exact digest-verified test and rollback evidence and rejects ambiguity or tampering", async () => {
    const actionDigest = digest("d");
    await seedTestEvidence({ actionDigest, testId: "unit" });
    await seedRollback({ rollbackRef: "rollback-1", actionDigest });
    const tests = new D1TestEvidenceProvider(env.AUTHORITY_DB);
    const rollback = new D1RollbackVerifier(env.AUTHORITY_DB);
    expect((await tests.getTestEvidence(actionDigest, ["unit"]))[0]).toMatchObject({ testId: "unit", result: "passed", actionDigest });
    expect(await rollback.verify("rollback-1", { actionDigest })).toMatchObject({ valid: true, executable: true, actionDigest });

    await seedTestEvidence({ actionDigest, testId: "unit" });
    await expect(tests.getTestEvidence(actionDigest, ["unit"])).rejects.toThrow(/ambiguous/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_test_evidence").run();
    await seedTestEvidence({ actionDigest, testId: "unit", evidenceDigest: digest("f") });
    await expect(tests.getTestEvidence(actionDigest, ["unit"])).rejects.toThrow(/integrity/);

    await env.AUTHORITY_DB.prepare("UPDATE authority_rollbacks SET evidence_digest=?1").bind(digest("e")).run();
    await expect(rollback.verify("rollback-1", { actionDigest })).rejects.toThrow(/integrity/);
    await expect(rollback.verify("rollback-1' OR 1=1--", { actionDigest })).rejects.toThrow(/Invalid validation rollback reference/);
  });

  it("fails closed for missing, expired, disabled, failed, false, and cross-digest evidence", async () => {
    const now = new Date();
    const actionDigest = digest("7");
    const tests = new D1TestEvidenceProvider(env.AUTHORITY_DB);
    const rollback = new D1RollbackVerifier(env.AUTHORITY_DB);
    await expect(tests.getTestEvidence(actionDigest, ["unit"], { now })).rejects.toThrow(/unavailable/);
    await seedTestEvidence({ actionDigest, testId: "unit", enabled: 0 });
    await expect(tests.getTestEvidence(actionDigest, ["unit"], { now })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_test_evidence").run();
    await seedTestEvidence({ actionDigest, testId: "unit", issuedAtMs: now.valueOf() - 120_000, expiresAtMs: now.valueOf() - 60_000 });
    await expect(tests.getTestEvidence(actionDigest, ["unit"], { now })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_test_evidence").run();
    await seedTestEvidence({ actionDigest, testId: "unit", result: "failed" });
    expect((await tests.getTestEvidence(actionDigest, ["unit"], { now }))[0].result).toBe("failed");

    await seedRollback({ rollbackRef: "rollback-false", actionDigest, valid: false, executable: false });
    expect(await rollback.verify("rollback-false", { actionDigest, now })).toMatchObject({ valid: false, executable: false });
    await expect(rollback.verify("rollback-false", { actionDigest: digest("8"), now })).rejects.toThrow(/unavailable/);
    await seedRollback({ rollbackRef: "rollback-false", actionDigest });
    await expect(rollback.verify("rollback-false", { actionDigest, now })).rejects.toThrow(/ambiguous/);
    await env.AUTHORITY_DB.prepare("UPDATE authority_rollbacks SET enabled=0").run();
    await expect(rollback.verify("rollback-false", { actionDigest, now })).rejects.toThrow(/unavailable/);
  });

  it("advances the real gateway through governing Project Knowledge to standing authorization", async () => {
    const now = new Date();
    const requested = action();
    const actionDigest = await digestRequestedAction(requested, repository);
    await seedResourceAndLimits(actionDigest);
    await seedGoverningKnowledge();
    await seedKey({ keyId: "maker-key", principalId: "maker-principal", role: "maker", keyPair: makerKeys });
    await seedKey({ keyId: "checker-key", principalId: "checker-principal", role: "checker", keyPair: checkerKeys });
    requested.evidence = {
      makerAttestation: await attestation({ keyId: "maker-key", principalId: "maker-principal", role: "maker", actionDigest, keyPair: makerKeys, now }),
      checkerAttestation: await attestation({ keyId: "checker-key", principalId: "checker-principal", role: "checker", actionDigest, keyPair: checkerKeys, now }),
    };
    const runtime = createUnavailableRuntime({
      resourceResolver: new D1AuthoritativeResourceResolver(env.AUTHORITY_DB),
      limitProvider: new D1TrustedLimitProvider(env.AUTHORITY_DB),
      identityVerifier: new D1Ed25519IdentityVerifier(env.AUTHORITY_DB),
      evidenceProvider: new D1TestEvidenceProvider(env.AUTHORITY_DB),
      rollbackVerifier: new D1RollbackVerifier(env.AUTHORITY_DB),
      projectKnowledge: new D1GoverningProjectKnowledgeReader(env.AUTHORITY_DB),
    });
    const gateway = await PolicyGateway.create(policies, runtime);
    const result = await gateway.evaluate(requested, now);
    expect(result.outcome).toBe("authorized_by_standing_policy");
    expect(result.actionDigest).toBe(actionDigest);
    expect(result.evidenceSnapshot.projectKnowledge).toMatchObject({ recordId: "pk-runtime-development", actionDigest });
  });

  it("the real gateway rejects independently signed maker and checker claims for one principal", async () => {
    const now = new Date();
    const requested = action({ actionId: "same-principal-action" });
    const actionDigest = await digestRequestedAction(requested, repository);
    await seedResourceAndLimits(actionDigest);
    await seedKey({ keyId: "maker-key", principalId: "shared-principal", role: "maker", keyPair: makerKeys });
    await seedKey({ keyId: "checker-key", principalId: "shared-principal", role: "checker", keyPair: checkerKeys });
    requested.evidence = {
      makerAttestation: await attestation({ keyId: "maker-key", principalId: "shared-principal", role: "maker", actionDigest, keyPair: makerKeys, now }),
      checkerAttestation: await attestation({ keyId: "checker-key", principalId: "shared-principal", role: "checker", actionDigest, keyPair: checkerKeys, now }),
    };
    const runtime = createUnavailableRuntime({
      resourceResolver: new D1AuthoritativeResourceResolver(env.AUTHORITY_DB),
      limitProvider: new D1TrustedLimitProvider(env.AUTHORITY_DB),
      identityVerifier: new D1Ed25519IdentityVerifier(env.AUTHORITY_DB),
      evidenceProvider: new D1TestEvidenceProvider(env.AUTHORITY_DB),
      rollbackVerifier: new D1RollbackVerifier(env.AUTHORITY_DB),
    });
    const result = await (await PolicyGateway.create(policies, runtime)).evaluate(requested, now);
    expect(result.outcome).toBe("validation_required");
    expect(result.unmetGates).toContainEqual({ gate: "identity", reason: "independent_authenticated_principals_required" });
  });
});
