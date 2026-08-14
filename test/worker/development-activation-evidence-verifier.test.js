import activationPlan from "../../deployment/development-activation-plan.json" with { type: "json" };
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalize, digestCanonicalValue } from "../../src/canonical-digest.js";
import {
  AuthenticatedDevelopmentActivationEvidenceVerifier,
  developmentActivationPurposeDigest,
  digestDevelopmentActivationOwnerDecision,
} from "../../src/development-activation-evidence-verifier.js";
import { developmentActivationPreflight } from "../../src/development-activation-preflight.js";
import { D1Ed25519OwnerDecisionVerifier } from "../../src/d1-owner-control-runtime.js";
import { D1Ed25519IdentityVerifier } from "../../src/d1-validation-runtime.js";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const REVIEWED_COMMIT = "ee22fa907aff460ffda7aaae0c4bc1a114dc15b4";
const farPast = Date.parse("2000-01-01T00:00:00.000Z");
const farFuture = Date.parse("2100-01-01T00:00:00.000Z");
const encoder = new TextEncoder();
let makerKeys;
let checkerKeys;
let ownerKeys;

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function seedIdentityKey({ keyId, principalId, roles, keyPair }) {
  const publicKeyBase64url = base64url(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const keyRecord = { keyId, principalId, allowedRoles: roles, algorithm: "Ed25519", publicKeyBase64url, version: 1 };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_identity_keys
      (record_id, key_id, principal_id, allowed_roles_json, algorithm, public_key_base64url, key_digest,
       status, enabled, valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, ?4, 'Ed25519', ?5, ?6, 'CURRENT', 1, ?7, ?8, 1)
  `).bind(
    crypto.randomUUID(), keyId, principalId, canonicalize(roles), publicKeyBase64url,
    await digestCanonicalValue(keyRecord), farPast, farFuture,
  ).run();
}

async function seedOwnerKey() {
  const keyId = "activation-owner-key";
  const principalId = "activation-owner";
  const publicKeyBase64url = base64url(await crypto.subtle.exportKey("raw", ownerKeys.publicKey));
  const keyRecord = { keyId, principalId, algorithm: "Ed25519", publicKeyBase64url, version: 1 };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_owner_keys
      (record_id, key_id, principal_id, algorithm, public_key_base64url, key_digest,
       status, enabled, valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, 'Ed25519', ?4, ?5, 'FINAL', 1, ?6, ?7, 1)
  `).bind(
    crypto.randomUUID(), keyId, principalId, publicKeyBase64url,
    await digestCanonicalValue(keyRecord), farPast, farFuture,
  ).run();
}

async function signedAttestation({ keyId, principalId, role, purpose, keyPair, attestationId }) {
  const payload = {
    actionDigest: await developmentActivationPurposeDigest(REVIEWED_COMMIT, purpose),
    attestationId,
    expiresAt: new Date(NOW.valueOf() + 3_600_000).toISOString(),
    issuedAt: new Date(NOW.valueOf() - 60_000).toISOString(),
    keyId,
    principalId,
    role,
    schemaVersion: "1.0.0",
  };
  const bytes = encoder.encode(canonicalize(payload));
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, bytes);
  return { token: `v1.${base64url(bytes)}.${base64url(signature)}`, evidenceDigest: await digestCanonicalValue(payload) };
}

async function signedOwnerDecision({ purpose, decisionId, overrides = {} }) {
  const actionDigest = await developmentActivationPurposeDigest(REVIEWED_COMMIT, purpose);
  const payload = {
    decisionId,
    requestedActionDigest: actionDigest,
    decision: "approved",
    decidedBy: "activation-owner",
    decidedAt: new Date(NOW.valueOf() - 60_000).toISOString(),
    expiresAt: new Date(NOW.valueOf() + 3_600_000).toISOString(),
    issuerKeyId: "activation-owner-key",
    signatureAlgorithm: "Ed25519",
    ...overrides,
  };
  const signature = await crypto.subtle.sign("Ed25519", ownerKeys.privateKey, encoder.encode(canonicalize(payload)));
  const decision = { ...payload, signature: base64url(signature) };
  return {
    actionDigest,
    decision,
    evidenceDigest: await digestDevelopmentActivationOwnerDecision(decision, { actionDigest, label: purpose }),
  };
}

async function fixture() {
  const maker = await signedAttestation({
    keyId: "activation-maker-key", principalId: "activation-maker", role: "maker",
    purpose: "maker_validation", keyPair: makerKeys, attestationId: "activation-maker-validation",
  });
  const checker = await signedAttestation({
    keyId: "activation-checker-key", principalId: "activation-checker", role: "checker",
    purpose: "checker_validation", keyPair: checkerKeys, attestationId: "activation-checker-validation",
  });
  const rollback = await signedAttestation({
    keyId: "activation-checker-key", principalId: "activation-checker", role: "checker",
    purpose: "rollback_evidence", keyPair: checkerKeys, attestationId: "activation-rollback-evidence",
  });
  const backup = await signedAttestation({
    keyId: "activation-maker-key", principalId: "activation-maker", role: "maker",
    purpose: "backup_evidence", keyPair: makerKeys, attestationId: "activation-backup-evidence",
  });
  const resource = await signedOwnerDecision({
    purpose: "resource_activation_authorization", decisionId: "activation-resource-decision",
  });
  const worker = await signedOwnerDecision({
    purpose: "worker_deployment_authorization", decisionId: "activation-worker-decision",
  });
  const evidence = {
    reviewedCommit: REVIEWED_COMMIT,
    makerValidationDigest: maker.evidenceDigest,
    checkerValidationDigest: checker.evidenceDigest,
    resourceActivationAuthorizationDigest: resource.evidenceDigest,
    workerDeploymentAuthorizationDigest: worker.evidenceDigest,
    rollbackEvidenceDigest: rollback.evidenceDigest,
    backupDigest: backup.evidenceDigest,
  };
  const bundle = {
    schemaVersion: "1.0.0",
    makerValidationAttestation: maker.token,
    checkerValidationAttestation: checker.token,
    resourceActivationDecision: resource.decision,
    workerDeploymentDecision: worker.decision,
    rollbackAttestation: rollback.token,
    backupAttestation: backup.token,
  };
  return { evidence, bundle };
}

function verifier(bundle, overrides = {}) {
  return new AuthenticatedDevelopmentActivationEvidenceVerifier({
    bundleProvider: overrides.bundleProvider ?? { async read() { return bundle; } },
    identityVerifier: overrides.identityVerifier ?? new D1Ed25519IdentityVerifier(env.AUTHORITY_DB),
    ownerVerifier: overrides.ownerVerifier ?? new D1Ed25519OwnerDecisionVerifier(env.AUTHORITY_DB),
    now: () => NOW,
  });
}

function readyPlan(evidence) {
  const plan = structuredClone(activationPlan);
  plan.status = "READY";
  plan.activationAuthorized = true;
  plan.workerDeploymentAuthorized = true;
  Object.assign(plan.authorityDatabase, {
    databaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    resourceCreated: true, bindingInstalled: true, migrationsApplied: true, remoteSchemaVerified: true,
  });
  Object.assign(plan.workflow, { resourceCreated: true, bindingInstalled: true });
  Object.assign(plan.queue, { resourceCreated: true, bindingInstalled: true });
  Object.assign(plan.evidence, {
    reviewedCommit: evidence.reviewedCommit,
    makerValidationDigest: evidence.makerValidationDigest,
    checkerValidationDigest: evidence.checkerValidationDigest,
    resourceActivationAuthorizationDigest: evidence.resourceActivationAuthorizationDigest,
    workerDeploymentAuthorizationDigest: evidence.workerDeploymentAuthorizationDigest,
    rollbackEvidenceDigest: evidence.rollbackEvidenceDigest,
  });
  plan.rollback.backupDigest = evidence.backupDigest;
  return plan;
}

describe("authenticated development activation evidence verifier", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.AUTHORITY_DB, env.AUTHORITY_TEST_MIGRATIONS);
    makerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    checkerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    ownerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  });

  beforeEach(async () => {
    await env.AUTHORITY_DB.batch([
      env.AUTHORITY_DB.prepare("DELETE FROM authority_identity_keys"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_owner_keys"),
    ]);
    await seedIdentityKey({
      keyId: "activation-maker-key", principalId: "activation-maker", roles: ["maker"], keyPair: makerKeys,
    });
    await seedIdentityKey({
      keyId: "activation-checker-key", principalId: "activation-checker", roles: ["checker"], keyPair: checkerKeys,
    });
    await seedOwnerKey();
  });

  it("authenticates all six domain-separated evidence purposes through real D1-backed Ed25519 verifiers", async () => {
    const { evidence, bundle } = await fixture();
    const result = await verifier(bundle).verify(evidence);
    expect(result).toMatchObject({
      ...evidence,
      valid: true,
      makerPrincipalId: "activation-maker",
      checkerPrincipalId: "activation-checker",
      ownerPrincipalId: "activation-owner",
    });
    expect(result.verificationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);

    const report = await developmentActivationPreflight(readyPlan(evidence), { evidenceVerifier: verifier(bundle) });
    expect(report).toEqual({ ready: true, environment: "development", blockers: [] });
  });

  it("rejects digest, purpose, signature, decision-reuse, and bundle-shape tampering", async () => {
    const { evidence, bundle } = await fixture();
    await expect(verifier(bundle).verify({ ...evidence, makerValidationDigest: evidence.checkerValidationDigest }))
      .rejects.toThrow(/digests must be unique/);
    await expect(verifier({ ...bundle, makerValidationAttestation: bundle.backupAttestation }).verify(evidence))
      .rejects.toThrow(/binding mismatch/);
    await expect(verifier({
      ...bundle,
      resourceActivationDecision: { ...bundle.resourceActivationDecision, signature: "AQ" },
    }).verify(evidence)).rejects.toThrow();
    await expect(verifier({
      ...bundle,
      workerDeploymentDecision: bundle.resourceActivationDecision,
    }).verify(evidence)).rejects.toThrow(/owner binding mismatch|must be distinct/);
    await expect(verifier({ ...bundle, unexpected: true }).verify(evidence)).rejects.toThrow(/fields must be exact/);
  });

  it("rejects principal collisions, role discontinuity, and unavailable evidence providers", async () => {
    const { evidence, bundle } = await fixture();
    const collisionVerifier = verifier(bundle, {
      identityVerifier: {
        async verify(token, context) {
          const verified = await new D1Ed25519IdentityVerifier(env.AUTHORITY_DB).verify(token, context);
          return { ...verified, principalId: "activation-owner" };
        },
      },
    });
    await expect(collisionVerifier.verify(evidence)).rejects.toThrow(/role continuity mismatch|must be distinct principals/);

    const unavailable = verifier(bundle, { bundleProvider: { async read() { throw new Error("unavailable"); } } });
    const report = await developmentActivationPreflight(readyPlan(evidence), { evidenceVerifier: unavailable });
    expect(report).toEqual({
      ready: false, environment: "development", blockers: ["independent_evidence_verification_failed"],
    });
  });

  it("requires every verifier dependency at construction", () => {
    const present = { bundleProvider: { read() {} }, identityVerifier: { verify() {} }, ownerVerifier: { verify() {} } };
    expect(() => new AuthenticatedDevelopmentActivationEvidenceVerifier({ ...present, bundleProvider: null })).toThrow(/bundle provider is unavailable/);
    expect(() => new AuthenticatedDevelopmentActivationEvidenceVerifier({ ...present, identityVerifier: null })).toThrow(/identity verifier is unavailable/);
    expect(() => new AuthenticatedDevelopmentActivationEvidenceVerifier({ ...present, ownerVerifier: null })).toThrow(/owner verifier is unavailable/);
  });
});
