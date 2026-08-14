import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalize, digestCanonicalValue } from "../../src/canonical-digest.js";
import {
  AuthenticatedDevelopmentActivationEvidenceVerifier,
  developmentActivationPurposeDigest,
  digestDevelopmentActivationOwnerDecision,
} from "../../src/development-activation-evidence-verifier.js";
import { D1DevelopmentActivationEvidenceBundleProvider } from "../../src/d1-development-activation-evidence-provider.js";
import { D1Ed25519OwnerDecisionVerifier } from "../../src/d1-owner-control-runtime.js";
import { D1Ed25519IdentityVerifier } from "../../src/d1-validation-runtime.js";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const farPast = Date.parse("2000-01-01T00:00:00.000Z");
const farFuture = Date.parse("2100-01-01T00:00:00.000Z");
const digest = (character) => `sha256:${character.repeat(64)}`;
const encoder = new TextEncoder();
let makerKeys;
let checkerKeys;
let ownerKeys;
const evidence = Object.freeze({
  reviewedCommit: "a".repeat(40),
  makerValidationDigest: digest("a"),
  checkerValidationDigest: digest("b"),
  resourceActivationAuthorizationDigest: digest("c"),
  workerDeploymentAuthorizationDigest: digest("d"),
  rollbackEvidenceDigest: digest("e"),
  backupDigest: digest("f"),
});

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function seedIdentityKey({ keyId, principalId, role, keyPair }) {
  const publicKeyBase64url = base64url(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const keyRecord = {
    keyId, principalId, allowedRoles: [role], algorithm: "Ed25519", publicKeyBase64url, version: 1,
  };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_identity_keys
      (record_id, key_id, principal_id, allowed_roles_json, algorithm, public_key_base64url,
       key_digest, status, enabled, valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, ?4, 'Ed25519', ?5, ?6, 'CURRENT', 1, ?7, ?8, 1)
  `).bind(
    crypto.randomUUID(), keyId, principalId, canonicalize([role]), publicKeyBase64url,
    await digestCanonicalValue(keyRecord), farPast, farFuture,
  ).run();
}

async function seedOwnerKey() {
  const publicKeyBase64url = base64url(await crypto.subtle.exportKey("raw", ownerKeys.publicKey));
  const keyRecord = {
    keyId: "activation-owner-key", principalId: "activation-owner",
    algorithm: "Ed25519", publicKeyBase64url, version: 1,
  };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_owner_keys
      (record_id, key_id, principal_id, algorithm, public_key_base64url, key_digest,
       status, enabled, valid_from_ms, valid_until_ms, version)
    VALUES (?1, 'activation-owner-key', 'activation-owner', 'Ed25519', ?2, ?3, 'FINAL', 1, ?4, ?5, 1)
  `).bind(
    crypto.randomUUID(), publicKeyBase64url, await digestCanonicalValue(keyRecord), farPast, farFuture,
  ).run();
}

async function signedAttestation({ keyId, principalId, role, purpose, keyPair, attestationId }) {
  const payload = {
    actionDigest: await developmentActivationPurposeDigest(evidence.reviewedCommit, purpose),
    attestationId,
    expiresAt: "2026-08-14T13:00:00.000Z",
    issuedAt: "2026-08-14T11:59:00.000Z",
    keyId,
    principalId,
    role,
    schemaVersion: "1.0.0",
  };
  const bytes = encoder.encode(canonicalize(payload));
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, bytes);
  return { token: `v1.${base64url(bytes)}.${base64url(signature)}`, evidenceDigest: await digestCanonicalValue(payload) };
}

async function signedOwnerDecision(purpose, decisionId) {
  const actionDigest = await developmentActivationPurposeDigest(evidence.reviewedCommit, purpose);
  const payload = {
    decisionId,
    requestedActionDigest: actionDigest,
    decision: "approved",
    decidedBy: "activation-owner",
    decidedAt: "2026-08-14T11:59:00.000Z",
    expiresAt: "2026-08-14T13:00:00.000Z",
    issuerKeyId: "activation-owner-key",
    signatureAlgorithm: "Ed25519",
  };
  const signature = await crypto.subtle.sign("Ed25519", ownerKeys.privateKey, encoder.encode(canonicalize(payload)));
  const decision = { ...payload, signature: base64url(signature) };
  return {
    decision,
    evidenceDigest: await digestDevelopmentActivationOwnerDecision(decision, { actionDigest, label: purpose }),
  };
}

async function authenticatedFixture() {
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
  const resource = await signedOwnerDecision("resource_activation_authorization", "activation-resource-decision");
  const worker = await signedOwnerDecision("worker_deployment_authorization", "activation-worker-decision");
  return {
    evidence: {
      reviewedCommit: evidence.reviewedCommit,
      makerValidationDigest: maker.evidenceDigest,
      checkerValidationDigest: checker.evidenceDigest,
      resourceActivationAuthorizationDigest: resource.evidenceDigest,
      workerDeploymentAuthorizationDigest: worker.evidenceDigest,
      rollbackEvidenceDigest: rollback.evidenceDigest,
      backupDigest: backup.evidenceDigest,
    },
    bundle: {
      schemaVersion: "1.0.0",
      makerValidationAttestation: maker.token,
      checkerValidationAttestation: checker.token,
      resourceActivationDecision: resource.decision,
      workerDeploymentDecision: worker.decision,
      rollbackAttestation: rollback.token,
      backupAttestation: backup.token,
    },
  };
}

function ownerDecision(decisionId, requestedActionDigest) {
  return {
    decisionId,
    requestedActionDigest,
    decision: "approved",
    decidedBy: "activation-owner",
    decidedAt: "2026-08-14T11:59:00.000Z",
    expiresAt: "2026-08-14T13:00:00.000Z",
    issuerKeyId: "activation-owner-key",
    signatureAlgorithm: "Ed25519",
    signature: "test-signature",
  };
}

function bundle() {
  return {
    schemaVersion: "1.0.0",
    makerValidationAttestation: "v1.maker.signature",
    checkerValidationAttestation: "v1.checker.signature",
    resourceActivationDecision: ownerDecision("resource-decision", digest("1")),
    workerDeploymentDecision: ownerDecision("worker-decision", digest("2")),
    rollbackAttestation: "v1.rollback.signature",
    backupAttestation: "v1.backup.signature",
  };
}

async function insertBundle(overrides = {}) {
  const recordId = overrides.recordId ?? crypto.randomUUID();
  const status = overrides.status ?? "CURRENT";
  const version = overrides.version ?? 1;
  const value = overrides.bundle ?? bundle();
  const bundleJson = overrides.bundleJson ?? canonicalize(value);
  const bundleDigest = overrides.bundleDigest ?? await digestCanonicalValue(value);
  const issuedAtMs = overrides.issuedAtMs ?? farPast;
  const expiresAtMs = overrides.expiresAtMs ?? farFuture;
  const requestedEvidence = overrides.evidence ?? evidence;
  const record = {
    recordId,
    status,
    reviewedCommit: requestedEvidence.reviewedCommit,
    evidence: requestedEvidence,
    bundleDigest,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    version,
  };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_development_activation_evidence_bundles
      (record_id, reviewed_commit, maker_validation_digest, checker_validation_digest,
       resource_activation_authorization_digest, worker_deployment_authorization_digest,
       rollback_evidence_digest, backup_digest, bundle_json, bundle_digest, record_digest,
       status, enabled, issued_at_ms, expires_at_ms, version)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
  `).bind(
    recordId,
    requestedEvidence.reviewedCommit,
    requestedEvidence.makerValidationDigest,
    requestedEvidence.checkerValidationDigest,
    requestedEvidence.resourceActivationAuthorizationDigest,
    requestedEvidence.workerDeploymentAuthorizationDigest,
    requestedEvidence.rollbackEvidenceDigest,
    requestedEvidence.backupDigest,
    bundleJson,
    bundleDigest,
    overrides.recordDigest ?? await digestCanonicalValue(record),
    status,
    overrides.enabled ?? 1,
    issuedAtMs,
    expiresAtMs,
    version,
  ).run();
}

describe("read-only development activation evidence bundle provider", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.AUTHORITY_DB, env.AUTHORITY_TEST_MIGRATIONS);
    makerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    checkerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    ownerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  });

  beforeEach(async () => {
    await env.AUTHORITY_DB.batch([
      env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_bundles"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_identity_keys"),
      env.AUTHORITY_DB.prepare("DELETE FROM authority_owner_keys"),
    ]);
    await seedIdentityKey({
      keyId: "activation-maker-key", principalId: "activation-maker", role: "maker", keyPair: makerKeys,
    });
    await seedIdentityKey({
      keyId: "activation-checker-key", principalId: "activation-checker", role: "checker", keyPair: checkerKeys,
    });
    await seedOwnerKey();
  });

  it("returns one current canonical digest-verified bundle for the exact evidence set", async () => {
    await insertBundle({ recordId: "activation-evidence-1" });
    const result = await new D1DevelopmentActivationEvidenceBundleProvider(env.AUTHORITY_DB)
      .read(evidence, { now: NOW });
    expect(result).toEqual(bundle());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.resourceActivationDecision)).toBe(true);
  });

  it("supplies all six artifacts to the real D1-backed authenticated verifier", async () => {
    const value = await authenticatedFixture();
    await insertBundle(value);
    const provider = new D1DevelopmentActivationEvidenceBundleProvider(env.AUTHORITY_DB);
    const verifier = new AuthenticatedDevelopmentActivationEvidenceVerifier({
      bundleProvider: provider,
      identityVerifier: new D1Ed25519IdentityVerifier(env.AUTHORITY_DB),
      ownerVerifier: new D1Ed25519OwnerDecisionVerifier(env.AUTHORITY_DB),
      now: () => NOW,
    });
    await expect(verifier.verify(value.evidence)).resolves.toMatchObject({
      ...value.evidence,
      valid: true,
      makerPrincipalId: "activation-maker",
      checkerPrincipalId: "activation-checker",
      ownerPrincipalId: "activation-owner",
    });
  });

  it("rejects missing, disabled, expired, ambiguous, and digest-mismatched records", async () => {
    const provider = new D1DevelopmentActivationEvidenceBundleProvider(env.AUTHORITY_DB);
    await expect(provider.read(evidence, { now: NOW })).rejects.toThrow(/unavailable/);
    await insertBundle({ enabled: 0 });
    await expect(provider.read(evidence, { now: NOW })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_bundles").run();
    await insertBundle({ expiresAtMs: NOW.valueOf() });
    await expect(provider.read(evidence, { now: NOW })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_bundles").run();
    await insertBundle();
    await insertBundle();
    await expect(provider.read(evidence, { now: NOW })).rejects.toThrow(/ambiguous/);
    await expect(provider.read({ ...evidence, backupDigest: digest("9") }, { now: NOW })).rejects.toThrow(/unavailable/);
  });

  it("rejects bundle, record, canonical-JSON, shape, and request tampering", async () => {
    const provider = new D1DevelopmentActivationEvidenceBundleProvider(env.AUTHORITY_DB);
    await insertBundle({ bundleDigest: digest("0") });
    await expect(provider.read(evidence, { now: NOW })).rejects.toThrow(/bundle integrity/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_bundles").run();
    await insertBundle({ recordDigest: digest("0") });
    await expect(provider.read(evidence, { now: NOW })).rejects.toThrow(/record integrity/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_bundles").run();
    await insertBundle({ bundleJson: JSON.stringify(bundle()) });
    await expect(provider.read(evidence, { now: NOW })).rejects.toThrow(/canonical JSON/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_bundles").run();
    await insertBundle({ bundleJson: '{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}' });
    await expect(provider.read(evidence, { now: NOW })).rejects.toThrow(/Duplicate JSON object key/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_bundles").run();
    await insertBundle({ bundle: { ...bundle(), unexpected: true } });
    await expect(provider.read(evidence, { now: NOW })).rejects.toThrow(/fields must be exact/);
    await expect(provider.read({ ...evidence, reviewedCommit: "not-a-commit" }, { now: NOW })).rejects.toThrow(/reviewed commit/);
    await expect(provider.read({ ...evidence, unexpected: true }, { now: NOW })).rejects.toThrow(/fields must be exact/);
    await expect(provider.read({ ...evidence, backupDigest: evidence.makerValidationDigest }, { now: NOW })).rejects.toThrow(/must be unique/);
  });

  it("rejects a digest-consistent record with a malformed record ID", async () => {
    await insertBundle({ recordId: "invalid record id" });
    await expect(new D1DevelopmentActivationEvidenceBundleProvider(env.AUTHORITY_DB)
      .read(evidence, { now: NOW })).rejects.toThrow(/evidence bundle record ID/);
  });

  it("requires a D1 binding and rejects invalid lookup times", async () => {
    expect(() => new D1DevelopmentActivationEvidenceBundleProvider()).toThrow(/D1 binding is unavailable/);
    await insertBundle();
    await expect(new D1DevelopmentActivationEvidenceBundleProvider(env.AUTHORITY_DB)
      .read(evidence, { now: "not-a-time" })).rejects.toThrow(/lookup time/);
  });
});
