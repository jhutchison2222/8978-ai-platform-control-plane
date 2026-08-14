import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthenticatedDevelopmentActivationEvidenceWriter } from "../../src/authenticated-development-activation-evidence-writer.js";
import { canonicalize, digestCanonicalValue } from "../../src/canonical-digest.js";
import { CloudflareDurableReplayStore } from "../../src/cloudflare-replay-store.js";
import {
  AuthenticatedDevelopmentActivationEvidenceVerifier,
  developmentActivationPurposeDigest,
  digestDevelopmentActivationOwnerDecision,
} from "../../src/development-activation-evidence-verifier.js";
import { D1DevelopmentActivationEvidenceBundleProvider } from "../../src/d1-development-activation-evidence-provider.js";
import { D1Ed25519OwnerDecisionVerifier } from "../../src/d1-owner-control-runtime.js";
import { D1Ed25519IdentityVerifier } from "../../src/d1-validation-runtime.js";
import { createServiceAuthenticatedRequest } from "../../src/service-auth-adapter.js";
import { digestServiceBody } from "../../src/service-auth.js";

const COMMIT = "b".repeat(40);
const URL = "https://activation-writer.invalid/v1/development-activation/evidence";
const WRITER = Object.freeze({
  principalId: "test-orchestrator",
  keyId: "test-key-1",
  secret: "worker-test-fixture-secret-32-bytes-minimum",
});
const encoder = new TextEncoder();
let makerKeys;
let checkerKeys;
let ownerKeys;

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/=/gu, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

async function seedIdentityKey({ keyId, principalId, role, keyPair }) {
  const publicKeyBase64url = base64url(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const keyRecord = { keyId, principalId, allowedRoles: [role], algorithm: "Ed25519", publicKeyBase64url, version: 1 };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_identity_keys
      (record_id, key_id, principal_id, allowed_roles_json, algorithm, public_key_base64url,
       key_digest, status, enabled, valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, ?4, 'Ed25519', ?5, ?6, 'CURRENT', 1, ?7, ?8, 1)
  `).bind(
    crypto.randomUUID(), keyId, principalId, canonicalize([role]), publicKeyBase64url,
    await digestCanonicalValue(keyRecord), Date.now() - 86_400_000, Date.now() + 86_400_000,
  ).run();
}

async function seedOwnerKey({
  keyId = "activation-owner-key", principalId = "activation-owner",
} = {}) {
  const publicKeyBase64url = base64url(await crypto.subtle.exportKey("raw", ownerKeys.publicKey));
  const keyRecord = {
    keyId, principalId, algorithm: "Ed25519", publicKeyBase64url, version: 1,
  };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_owner_keys
      (record_id, key_id, principal_id, algorithm, public_key_base64url, key_digest,
       status, enabled, valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, 'Ed25519', ?4, ?5, 'FINAL', 1, ?6, ?7, 1)
  `).bind(
    crypto.randomUUID(), keyId, principalId, publicKeyBase64url, await digestCanonicalValue(keyRecord),
    Date.now() - 86_400_000, Date.now() + 86_400_000,
  ).run();
}

async function signedAttestation({ keyId, principalId, role, purpose, keyPair, attestationId, now }) {
  const payload = {
    actionDigest: await developmentActivationPurposeDigest(COMMIT, purpose),
    attestationId,
    expiresAt: new Date(now.valueOf() + 3_600_000).toISOString(),
    issuedAt: new Date(now.valueOf() - 60_000).toISOString(),
    keyId,
    principalId,
    role,
    schemaVersion: "1.0.0",
  };
  const bytes = encoder.encode(canonicalize(payload));
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, bytes);
  return { token: `v1.${base64url(bytes)}.${base64url(signature)}`, digest: await digestCanonicalValue(payload) };
}

async function signedOwnerDecision(purpose, decisionId, now, {
  keyId = "activation-owner-key", principalId = "activation-owner",
} = {}) {
  const actionDigest = await developmentActivationPurposeDigest(COMMIT, purpose);
  const payload = {
    decisionId,
    requestedActionDigest: actionDigest,
    decision: "approved",
    decidedBy: principalId,
    decidedAt: new Date(now.valueOf() - 60_000).toISOString(),
    expiresAt: new Date(now.valueOf() + 3_600_000).toISOString(),
    issuerKeyId: keyId,
    signatureAlgorithm: "Ed25519",
  };
  const signature = await crypto.subtle.sign("Ed25519", ownerKeys.privateKey, encoder.encode(canonicalize(payload)));
  const decision = { ...payload, signature: base64url(signature) };
  return {
    decision,
    digest: await digestDevelopmentActivationOwnerDecision(decision, { actionDigest, label: purpose }),
  };
}

async function fixture(now = new Date(), {
  recordId = crypto.randomUUID(),
  makerKeyId = "activation-maker-key", makerPrincipalId = "activation-maker",
  checkerKeyId = "activation-checker-key", checkerPrincipalId = "activation-checker",
  ownerKeyId = "activation-owner-key", ownerPrincipalId = "activation-owner",
} = {}) {
  const maker = await signedAttestation({
    keyId: makerKeyId, principalId: makerPrincipalId, role: "maker",
    purpose: "maker_validation", keyPair: makerKeys, attestationId: "activation-maker-validation", now,
  });
  const checker = await signedAttestation({
    keyId: checkerKeyId, principalId: checkerPrincipalId, role: "checker",
    purpose: "checker_validation", keyPair: checkerKeys, attestationId: "activation-checker-validation", now,
  });
  const rollback = await signedAttestation({
    keyId: checkerKeyId, principalId: checkerPrincipalId, role: "checker",
    purpose: "rollback_evidence", keyPair: checkerKeys, attestationId: "activation-rollback-evidence", now,
  });
  const backup = await signedAttestation({
    keyId: makerKeyId, principalId: makerPrincipalId, role: "maker",
    purpose: "backup_evidence", keyPair: makerKeys, attestationId: "activation-backup-evidence", now,
  });
  const owner = { keyId: ownerKeyId, principalId: ownerPrincipalId };
  const resource = await signedOwnerDecision(
    "resource_activation_authorization", "activation-resource-decision", now, owner,
  );
  const worker = await signedOwnerDecision(
    "worker_deployment_authorization", "activation-worker-decision", now, owner,
  );
  const evidence = {
    reviewedCommit: COMMIT,
    makerValidationDigest: maker.digest,
    checkerValidationDigest: checker.digest,
    resourceActivationAuthorizationDigest: resource.digest,
    workerDeploymentAuthorizationDigest: worker.digest,
    rollbackEvidenceDigest: rollback.digest,
    backupDigest: backup.digest,
  };
  return {
    bundle: {
      schemaVersion: "1.0.0",
      makerValidationAttestation: maker.token,
      checkerValidationAttestation: checker.token,
      resourceActivationDecision: resource.decision,
      workerDeploymentDecision: worker.decision,
      rollbackAttestation: rollback.token,
      backupAttestation: backup.token,
    },
    evidence,
    expiresAt: new Date(now.valueOf() + 3_600_000).toISOString(),
    issuedAt: new Date(now.valueOf() - 60_000).toISOString(),
    recordId,
    schemaVersion: "1.0.0",
    status: "CURRENT",
    version: 1,
  };
}

function writer(overrides = {}) {
  const secretResolver = {
    async resolve({ principalId, keyId }) {
      return principalId === WRITER.principalId && keyId === WRITER.keyId ? WRITER.secret : null;
    },
  };
  return new AuthenticatedDevelopmentActivationEvidenceWriter({
    database: env.AUTHORITY_DB,
    secretResolver,
    replayStore: new CloudflareDurableReplayStore(env.SERVICE_AUTH_REPLAY),
    authorizedWriter: { principalId: WRITER.principalId, keyId: WRITER.keyId },
    reviewedCommit: COMMIT,
    identityVerifier: new D1Ed25519IdentityVerifier(env.AUTHORITY_DB),
    ownerVerifier: new D1Ed25519OwnerDecisionVerifier(env.AUTHORITY_DB),
    ...overrides,
  });
}

function signed(value, now, overrides = {}) {
  const body = overrides.body ?? canonicalize(value);
  return createServiceAuthenticatedRequest({
    url: URL,
    method: "POST",
    headers: { "content-type": "application/json", ...overrides.headers },
    body,
    secret: WRITER.secret,
    principalId: WRITER.principalId,
    keyId: WRITER.keyId,
    now,
    nonce: overrides.nonce ?? crypto.randomUUID(),
  });
}

describe("authenticated development activation evidence writer", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.AUTHORITY_DB, env.AUTHORITY_TEST_MIGRATIONS);
    makerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    checkerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    ownerKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  });

  beforeEach(async () => {
    await env.AUTHORITY_DB.batch([
      env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_writes"),
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

  it("authenticates, verifies, and atomically inserts one append-only CURRENT record", async () => {
    const now = new Date();
    const value = await fixture(now, { recordId: "activation-write-1" });
    const nonce = "activation-write-1-nonce";
    const receipt = await writer().write(await signed(value, now, { nonce }), { now });
    expect(receipt).toMatchObject({
      inserted: true,
      recordId: "activation-write-1",
      reviewedCommit: COMMIT,
      status: "CURRENT",
      servicePrincipalId: WRITER.principalId,
    });
    expect(Object.isFrozen(receipt)).toBe(true);

    const rows = await env.AUTHORITY_DB.prepare(
      "SELECT record_id, status, enabled FROM authority_development_activation_evidence_bundles",
    ).all();
    expect(rows.results).toEqual([{ record_id: "activation-write-1", status: "CURRENT", enabled: 1 }]);
    const writes = await env.AUTHORITY_DB.prepare(
      "SELECT record_id, service_principal_id, record_digest, write_digest FROM authority_development_activation_evidence_writes",
    ).all();
    expect(writes.results).toHaveLength(1);
    expect(writes.results[0]).toMatchObject({
      record_id: "activation-write-1", service_principal_id: WRITER.principalId,
      record_digest: receipt.recordDigest, write_digest: receipt.writeDigest,
    });
    const bundleDigest = await digestCanonicalValue(value.bundle);
    const expectedRecordDigest = await digestCanonicalValue({
      recordId: value.recordId,
      status: value.status,
      reviewedCommit: value.evidence.reviewedCommit,
      evidence: value.evidence,
      bundleDigest,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
      version: value.version,
    });
    const expectedBodyDigest = await digestServiceBody(encoder.encode(canonicalize(value)));
    expect(receipt.recordDigest).toBe(expectedRecordDigest);
    expect(receipt.requestBodyDigest).toBe(expectedBodyDigest);
    await expect(digestCanonicalValue({
      writeId: value.recordId,
      recordId: value.recordId,
      recordDigest: expectedRecordDigest,
      requestBodyDigest: expectedBodyDigest,
      serviceIdentity: { principalId: WRITER.principalId, keyId: WRITER.keyId, nonce },
      authenticatedAt: now.toISOString(),
      insertedAt: now.toISOString(),
      version: 1,
    })).resolves.toBe(receipt.writeDigest);

    const provider = new D1DevelopmentActivationEvidenceBundleProvider(env.AUTHORITY_DB);
    await expect(new AuthenticatedDevelopmentActivationEvidenceVerifier({
      bundleProvider: provider,
      identityVerifier: new D1Ed25519IdentityVerifier(env.AUTHORITY_DB),
      ownerVerifier: new D1Ed25519OwnerDecisionVerifier(env.AUTHORITY_DB),
      now: () => now,
    }).verify(value.evidence)).resolves.toMatchObject({ valid: true, reviewedCommit: COMMIT });
  });

  it("rejects unsigned, OAuth-bearing, wrong-route, and unauthorized-writer requests without inserting", async () => {
    const now = new Date();
    const value = await fixture(now);
    await expect(writer().write(new Request(URL, {
      method: "POST", headers: { "content-type": "application/json" }, body: canonicalize(value),
    }), { now })).rejects.toThrow(/authentication/);

    const oauth = await signed(value, now);
    oauth.headers.set("authorization", "Bearer forbidden");
    await expect(writer().write(oauth, { now })).rejects.toThrow(/OAuth/);
    await expect(writer().write(await signed(value, now), { now: new Date(now.valueOf() + 600_000) }))
      .rejects.toThrow(/replay window/);
    await expect(writer({ authorizedWriter: { principalId: "another-writer", keyId: WRITER.keyId } })
      .write(await signed(value, now), { now })).rejects.toThrow(/not authorized/);
    const wrongRoute = await createServiceAuthenticatedRequest({
      url: "https://activation-writer.invalid/v1/other", method: "POST",
      headers: { "content-type": "application/json" }, body: canonicalize(value), ...WRITER, now,
    });
    await expect(writer().write(wrongRoute, { now })).rejects.toThrow(/route is unavailable/);
    const queryTarget = await createServiceAuthenticatedRequest({
      url: URL + "?unexpected=true", method: "POST",
      headers: { "content-type": "application/json" }, body: canonicalize(value), ...WRITER, now,
    });
    await expect(writer().write(queryTarget, { now })).rejects.toThrow(/route is unavailable/);

    const count = await env.AUTHORITY_DB.prepare(
      "SELECT COUNT(*) AS count FROM authority_development_activation_evidence_bundles",
    ).first();
    expect(count.count).toBe(0);
  });

  it("rejects replay, noncanonical JSON, shape drift, FINAL self-promotion, commit drift, and bundle tampering", async () => {
    const now = new Date();
    const value = await fixture(now);
    const replay = await signed(value, now, { nonce: "activation-writer-replay" });
    await writer().write(replay.clone(), { now });
    await expect(writer().write(replay.clone(), { now })).rejects.toThrow(/replay denied/);

    await env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_writes").run();
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_bundles").run();
    await expect(writer().write(await signed(value, now, { body: JSON.stringify(value) }), { now }))
      .rejects.toThrow(/canonical JSON/);
    await expect(writer().write(await signed({ ...value, unexpected: true }, now), { now }))
      .rejects.toThrow(/fields must be exact/);
    const duplicate = canonicalize(value).replace(/\}$/u, ',"version":1}');
    await expect(writer().write(await signed(value, now, { body: duplicate }), { now }))
      .rejects.toThrow(/Duplicate JSON object key/);
    await expect(writer().write(await signed({ ...value, status: "FINAL" }, now), { now }))
      .rejects.toThrow(/boundary changed/);
    await expect(writer().write(await signed({
      ...value, evidence: { ...value.evidence, reviewedCommit: "c".repeat(40) },
    }, now), { now })).rejects.toThrow(/not authorized/);
    await expect(writer().write(await signed({
      ...value, bundle: { ...value.bundle, backupAttestation: value.bundle.makerValidationAttestation },
    }, now), { now })).rejects.toThrow();
    await expect(writer().write(await signed({
      ...value, expiresAt: new Date(now.valueOf() + 86_400_001).toISOString(),
    }, now), { now })).rejects.toThrow(/validity window/);
  });

  it("rejects HMAC writer identity collisions with maker, checker, and owner before insertion", async () => {
    const now = new Date();
    await seedIdentityKey({
      keyId: "writer-collision-maker-key", principalId: WRITER.principalId, role: "maker", keyPair: makerKeys,
    });
    await seedIdentityKey({
      keyId: "writer-collision-checker-key", principalId: WRITER.principalId, role: "checker", keyPair: checkerKeys,
    });
    await seedOwnerKey({ keyId: "writer-collision-owner-key", principalId: WRITER.principalId });

    const collisions = [
      ["maker", { makerKeyId: "writer-collision-maker-key", makerPrincipalId: WRITER.principalId }],
      ["checker", { checkerKeyId: "writer-collision-checker-key", checkerPrincipalId: WRITER.principalId }],
      ["owner", { ownerKeyId: "writer-collision-owner-key", ownerPrincipalId: WRITER.principalId }],
    ];
    for (const [role, identity] of collisions) {
      const value = await fixture(now, { recordId: `writer-${role}-collision`, ...identity });
      await expect(writer().write(await signed(value, now), { now })).rejects.toThrow(
        /writer must be independent of maker, checker, and owner/,
      );
    }

    const bundles = await env.AUTHORITY_DB.prepare(
      "SELECT COUNT(*) AS count FROM authority_development_activation_evidence_bundles",
    ).first();
    const writes = await env.AUTHORITY_DB.prepare(
      "SELECT COUNT(*) AS count FROM authority_development_activation_evidence_writes",
    ).first();
    expect(bundles.count).toBe(0);
    expect(writes.count).toBe(0);
  });

  it("allows only one atomic active write per reviewed commit under concurrency", async () => {
    const now = new Date();
    const first = await fixture(now, { recordId: "activation-concurrent-1" });
    const second = { ...first, recordId: "activation-concurrent-2" };
    const results = await Promise.allSettled([
      writer().write(await signed(first, now), { now }),
      writer().write(await signed(second, now), { now }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const bundles = await env.AUTHORITY_DB.prepare(
      "SELECT COUNT(*) AS count FROM authority_development_activation_evidence_bundles",
    ).first();
    const writes = await env.AUTHORITY_DB.prepare(
      "SELECT COUNT(*) AS count FROM authority_development_activation_evidence_writes",
    ).first();
    expect(bundles.count).toBe(1);
    expect(writes.count).toBe(1);
  });

  it("requires explicit D1, HMAC, durable replay, identity, owner, writer, commit, and time boundaries", async () => {
    expect(() => new AuthenticatedDevelopmentActivationEvidenceWriter()).toThrow(/D1 binding/);
    expect(() => writer({ secretResolver: {} })).toThrow(/secret resolver/);
    expect(() => writer({ replayStore: {} })).toThrow(/durable replay/);
    expect(() => writer({ identityVerifier: {} })).toThrow(/identity verifier/);
    expect(() => writer({ ownerVerifier: {} })).toThrow(/owner verifier/);
    expect(() => writer({ reviewedCommit: "not-a-commit" })).toThrow(/reviewed commit/);
    expect(() => writer({ authorizedWriter: { principalId: "invalid writer", keyId: "key" } }))
      .toThrow(/principal ID/);
    const now = new Date();
    const value = await fixture(now);
    await expect(writer().write(await signed(value, now), { now: new Date("invalid") }))
      .rejects.toThrow(/write time/);
  });
});
