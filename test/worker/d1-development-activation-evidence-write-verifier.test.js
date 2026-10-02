import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalize, digestCanonicalValue } from "../../src/canonical-digest.js";
import { D1DevelopmentActivationEvidenceWriteVerifier } from "../../src/d1-development-activation-evidence-write-verifier.js";

const COMMIT = "b".repeat(40);
const NOW = new Date("2026-08-14T20:00:00.000Z");
const WRITER = Object.freeze({ principalId: "activation-writer", keyId: "activation-writer-key" });
const digest = (character) => `sha256:${character.repeat(64)}`;
const evidence = Object.freeze({
  reviewedCommit: COMMIT,
  makerValidationDigest: digest("1"),
  checkerValidationDigest: digest("2"),
  resourceActivationAuthorizationDigest: digest("3"),
  workerDeploymentAuthorizationDigest: digest("4"),
  rollbackEvidenceDigest: digest("5"),
  backupDigest: digest("6"),
});

function verifier(overrides = {}) {
  return new D1DevelopmentActivationEvidenceWriteVerifier(env.AUTHORITY_DB, {
    authorizedWriter: WRITER,
    reviewedCommit: COMMIT,
    ...overrides,
  });
}

async function clearPairs() {
  await env.AUTHORITY_DB.batch([
    env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_writes"),
    env.AUTHORITY_DB.prepare("DELETE FROM authority_development_activation_evidence_bundles"),
  ]);
}

async function insertPair(overrides = {}) {
  const requestedEvidence = overrides.evidence ?? evidence;
  const recordId = overrides.recordId ?? "activation-write-record-1";
  const status = overrides.status ?? "CURRENT";
  const recordVersion = overrides.recordVersion ?? 1;
  const writeVersion = overrides.writeVersion ?? 1;
  const issuedAtMs = overrides.issuedAtMs ?? NOW.valueOf() - 60_000;
  const expiresAtMs = overrides.expiresAtMs ?? NOW.valueOf() + 3_600_000;
  const authenticatedAtMs = overrides.authenticatedAtMs ?? NOW.valueOf() - 1_000;
  const insertedAtMs = overrides.insertedAtMs ?? NOW.valueOf();
  const bundle = overrides.bundle ?? { schemaVersion: "1.0.0", fixture: recordId };
  const bundleDigest = overrides.bundleDigest ?? await digestCanonicalValue(bundle);
  const record = {
    recordId,
    status,
    reviewedCommit: requestedEvidence.reviewedCommit,
    evidence: requestedEvidence,
    bundleDigest,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    version: recordVersion,
  };
  const recordDigest = overrides.recordDigest ?? await digestCanonicalValue(record);
  const requestBodyDigest = overrides.requestBodyDigest ?? digest(recordId.endsWith("2") ? "8" : "7");
  const principalId = overrides.principalId ?? WRITER.principalId;
  const keyId = overrides.keyId ?? WRITER.keyId;
  const nonce = overrides.nonce ?? `${recordId}-nonce`;
  const writeRecord = {
    writeId: overrides.writeId ?? recordId,
    recordId,
    recordDigest: overrides.writeRecordDigest ?? recordDigest,
    requestBodyDigest,
    serviceIdentity: { principalId, keyId, nonce },
    authenticatedAt: new Date(authenticatedAtMs).toISOString(),
    insertedAt: new Date(insertedAtMs).toISOString(),
    version: writeVersion,
  };
  const writeDigest = overrides.writeDigest ?? await digestCanonicalValue(writeRecord);

  await env.AUTHORITY_DB.batch([
    env.AUTHORITY_DB.prepare(`
      INSERT INTO authority_development_activation_evidence_bundles
        (record_id, reviewed_commit, maker_validation_digest, checker_validation_digest,
         resource_activation_authorization_digest, worker_deployment_authorization_digest,
         rollback_evidence_digest, backup_digest, bundle_json, bundle_digest, record_digest,
         status, enabled, issued_at_ms, expires_at_ms, version)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
    `).bind(
      recordId, requestedEvidence.reviewedCommit, requestedEvidence.makerValidationDigest,
      requestedEvidence.checkerValidationDigest, requestedEvidence.resourceActivationAuthorizationDigest,
      requestedEvidence.workerDeploymentAuthorizationDigest, requestedEvidence.rollbackEvidenceDigest,
      requestedEvidence.backupDigest, canonicalize(bundle), bundleDigest, recordDigest, status,
      overrides.enabled ?? 1, issuedAtMs, expiresAtMs, recordVersion,
    ),
    env.AUTHORITY_DB.prepare(`
      INSERT INTO authority_development_activation_evidence_writes
        (write_id, record_id, record_digest, request_body_digest, service_principal_id,
         service_key_id, service_nonce, authenticated_at_ms, inserted_at_ms, write_digest, version)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    `).bind(
      writeRecord.writeId, recordId, writeRecord.recordDigest, requestBodyDigest, principalId,
      keyId, nonce, authenticatedAtMs, insertedAtMs, writeDigest, writeVersion,
    ),
  ]);
  return { record, recordDigest, requestBodyDigest, writeRecord, writeDigest };
}

describe("read-only development activation evidence write verifier", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.AUTHORITY_DB, env.AUTHORITY_TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await clearPairs();
  });

  it("verifies one exact CURRENT row pair and independently recomputes both integrity digests", async () => {
    const fixture = await insertPair();
    const result = await verifier().verify(evidence, { now: NOW });
    expect(result).toMatchObject({
      valid: true,
      reviewedCommit: COMMIT,
      recordId: fixture.record.recordId,
      recordDigest: fixture.recordDigest,
      requestBodyDigest: fixture.requestBodyDigest,
      writeDigest: fixture.writeDigest,
      servicePrincipalId: WRITER.principalId,
      serviceKeyId: WRITER.keyId,
      authenticatedAt: fixture.writeRecord.authenticatedAt,
      insertedAt: fixture.writeRecord.insertedAt,
    });
    expect(result.verificationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects missing, disabled, expired, FINAL, wrong-writer, and ambiguous receipt pairs", async () => {
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/unavailable/);
    await insertPair({ enabled: 0 });
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/unavailable/);
    await clearPairs();
    await insertPair({ expiresAtMs: NOW.valueOf() });
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/unavailable/);
    await clearPairs();
    await insertPair({ status: "FINAL" });
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/unavailable/);
    await clearPairs();
    await insertPair({ principalId: "wrong-writer" });
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/binding mismatch/);
    await clearPairs();
    await insertPair({ recordId: "activation-write-record-1" });
    await insertPair({ recordId: "activation-write-record-2" });
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/ambiguous/);
  });

  it("rejects record, receipt, digest, nonce, identity, and temporal tampering", async () => {
    await insertPair();
    await env.AUTHORITY_DB.batch([
      env.AUTHORITY_DB.prepare("UPDATE authority_development_activation_evidence_bundles SET record_digest = ?1")
        .bind(digest("a")),
      env.AUTHORITY_DB.prepare("UPDATE authority_development_activation_evidence_writes SET record_digest = ?1")
        .bind(digest("a")),
    ]);
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/record integrity/);

    await clearPairs();
    await insertPair();
    await env.AUTHORITY_DB.prepare("UPDATE authority_development_activation_evidence_writes SET write_digest = ?1")
      .bind(digest("b")).run();
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/receipt integrity/);

    await clearPairs();
    await insertPair();
    await env.AUTHORITY_DB.prepare(
      "UPDATE authority_development_activation_evidence_writes SET request_body_digest = 'invalid'",
    ).run();
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/request body digest/);

    await clearPairs();
    await insertPair();
    await env.AUTHORITY_DB.prepare(
      "UPDATE authority_development_activation_evidence_writes SET service_nonce = 'invalid nonce'",
    ).run();
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/writer nonce/);

    await clearPairs();
    await insertPair();
    await env.AUTHORITY_DB.prepare(
      "UPDATE authority_development_activation_evidence_writes SET service_key_id = 'wrong-key'",
    ).run();
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/binding mismatch/);

    await clearPairs();
    const temporal = await insertPair();
    await env.AUTHORITY_DB.prepare(
      "UPDATE authority_development_activation_evidence_writes SET inserted_at_ms = ?1",
    ).bind(Date.parse(temporal.record.expiresAt)).run();
    await expect(verifier().verify(evidence, { now: NOW })).rejects.toThrow(/receipt is invalid/);
  });

  it("rejects malformed requests, constructors, lookup times, and query failures", async () => {
    expect(() => new D1DevelopmentActivationEvidenceWriteVerifier()).toThrow(/D1 binding/);
    expect(() => verifier({ reviewedCommit: "not-a-commit" })).toThrow(/reviewed commit/);
    expect(() => verifier({ authorizedWriter: { principalId: "invalid writer", keyId: "key" } }))
      .toThrow(/principal ID/);
    await expect(verifier().verify({ ...evidence, unexpected: true }, { now: NOW }))
      .rejects.toThrow(/fields must be exact/);
    await expect(verifier().verify({ ...evidence, backupDigest: evidence.makerValidationDigest }, { now: NOW }))
      .rejects.toThrow(/must be unique/);
    await expect(verifier().verify({ ...evidence, reviewedCommit: "c".repeat(40) }, { now: NOW }))
      .rejects.toThrow(/reviewed commit/);
    await expect(verifier().verify(evidence, { now: "not-a-time" })).rejects.toThrow(/verification time/);

    const failedDatabase = {
      prepare() {
        return { bind() { return { async all() { return { success: false }; } }; } };
      },
    };
    await expect(new D1DevelopmentActivationEvidenceWriteVerifier(failedDatabase, {
      authorizedWriter: WRITER, reviewedCommit: COMMIT,
    }).verify(evidence, { now: NOW })).rejects.toThrow(/query failed/);
  });
});
