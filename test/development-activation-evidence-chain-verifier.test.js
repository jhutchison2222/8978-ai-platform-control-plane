import assert from "node:assert/strict";
import test from "node:test";
import { digestCanonicalValue } from "../src/canonical-digest.js";
import { AuthenticatedDevelopmentActivationEvidenceChainVerifier } from "../src/development-activation-evidence-chain-verifier.js";

const NOW = new Date("2026-08-14T20:00:00.000Z");
const COMMIT = "c".repeat(40);
const sha = (character) => `sha256:${character.repeat(64)}`;
const evidence = Object.freeze({
  reviewedCommit: COMMIT,
  makerValidationDigest: sha("1"),
  checkerValidationDigest: sha("2"),
  resourceActivationAuthorizationDigest: sha("3"),
  workerDeploymentAuthorizationDigest: sha("4"),
  rollbackEvidenceDigest: sha("5"),
  backupDigest: sha("6"),
});

function evidenceResult(overrides = {}) {
  return {
    ...evidence,
    valid: true,
    makerPrincipalId: "maker-principal",
    checkerPrincipalId: "checker-principal",
    ownerPrincipalId: "owner-principal",
    verificationDigest: sha("7"),
    ...overrides,
  };
}

function writeResult(overrides = {}) {
  return {
    valid: true,
    reviewedCommit: COMMIT,
    recordId: "activation-record-1",
    recordDigest: sha("8"),
    requestBodyDigest: sha("9"),
    writeDigest: sha("a"),
    servicePrincipalId: "writer-principal",
    serviceKeyId: "writer-key",
    authenticatedAt: "2026-08-14T19:59:59.000Z",
    insertedAt: NOW.toISOString(),
    verificationDigest: sha("b"),
    ...overrides,
  };
}

function verifier({ evidenceValue = evidenceResult(), writeValue = writeResult(), now = () => NOW } = {}) {
  return new AuthenticatedDevelopmentActivationEvidenceChainVerifier({
    evidenceVerifier: { async verify() { return structuredClone(evidenceValue); } },
    writeReceiptVerifier: { async verify() { return structuredClone(writeValue); } },
    now,
  });
}

test("activation evidence chain binds both independent verification receipts", async () => {
  let evidenceRequest;
  let evidenceNow;
  let writeRequest;
  let writeNow;
  const subject = new AuthenticatedDevelopmentActivationEvidenceChainVerifier({
    evidenceVerifier: { async verify(value, options) {
      evidenceRequest = value;
      evidenceNow = options.now;
      return evidenceResult();
    } },
    writeReceiptVerifier: { async verify(value, options) {
      writeRequest = value;
      writeNow = options.now;
      return writeResult();
    } },
    now: () => NOW,
  });
  const result = await subject.verify(evidence);
  assert.equal(evidenceRequest, writeRequest);
  assert.equal(Object.isFrozen(evidenceRequest), true);
  assert.equal(evidenceNow, NOW);
  assert.equal(writeNow, NOW);
  assert.deepEqual(Object.keys(result).sort(), [
    "backupDigest", "checkerPrincipalId", "checkerValidationDigest", "makerPrincipalId",
    "makerValidationDigest", "ownerPrincipalId", "resourceActivationAuthorizationDigest",
    "reviewedCommit", "rollbackEvidenceDigest", "valid", "verificationDigest",
    "workerDeploymentAuthorizationDigest",
  ]);
  assert.equal(result.verificationDigest, await digestCanonicalValue({
    authenticatedAt: "2026-08-14T19:59:59.000Z",
    evidence,
    evidenceVerificationDigest: sha("7"),
    insertedAt: NOW.toISOString(),
    principals: {
      checkerPrincipalId: "checker-principal",
      makerPrincipalId: "maker-principal",
      ownerPrincipalId: "owner-principal",
      writerPrincipalId: "writer-principal",
    },
    recordDigest: sha("8"),
    recordId: "activation-record-1",
    requestBodyDigest: sha("9"),
    schemaVersion: "1.0.0",
    writeDigest: sha("a"),
    writeReceiptVerificationDigest: sha("b"),
    writerKeyId: "writer-key",
  }));
  assert.equal(Object.isFrozen(result), true);
});

test("activation evidence chain constructors, requests, and clocks fail closed", async () => {
  assert.throws(() => new AuthenticatedDevelopmentActivationEvidenceChainVerifier(), /evidence verifier is unavailable/);
  assert.throws(() => new AuthenticatedDevelopmentActivationEvidenceChainVerifier({
    evidenceVerifier: { verify() {} }, writeReceiptVerifier: null,
  }), /write receipt verifier is unavailable/);
  assert.throws(() => new AuthenticatedDevelopmentActivationEvidenceChainVerifier({
    evidenceVerifier: { verify() {} }, writeReceiptVerifier: { verify() {} }, now: null,
  }), /clock is unavailable/);
  await assert.rejects(() => verifier().verify({ ...evidence, extra: true }), /fields must be exact/);
  await assert.rejects(() => verifier().verify({ ...evidence, reviewedCommit: "invalid" }), /reviewed commit/);
  await assert.rejects(() => verifier().verify({ ...evidence, backupDigest: evidence.makerValidationDigest }), /must be unique/);
  await assert.rejects(() => verifier({ now: () => new Date("invalid") }).verify(evidence), /verification time/);
});

test("activation evidence chain rejects malformed or mismatched dependency receipts", async () => {
  await assert.rejects(() => verifier({ evidenceValue: evidenceResult({ valid: false }) }).verify(evidence), /evidence verification failed/);
  await assert.rejects(() => verifier({ evidenceValue: evidenceResult({ reviewedCommit: "d".repeat(40) }) }).verify(evidence), /binding mismatch/);
  const evidenceWithExtra = evidenceResult();
  evidenceWithExtra.extra = true;
  await assert.rejects(() => verifier({ evidenceValue: evidenceWithExtra }).verify(evidence), /fields must be exact/);
  await assert.rejects(() => verifier({ writeValue: writeResult({ valid: false }) }).verify(evidence), /write verification result binding mismatch/);
  await assert.rejects(() => verifier({ writeValue: writeResult({ reviewedCommit: "d".repeat(40) }) }).verify(evidence), /binding mismatch/);
  await assert.rejects(() => verifier({ writeValue: writeResult({ recordDigest: "invalid" }) }).verify(evidence), /record digest/);
  await assert.rejects(() => verifier({ writeValue: writeResult({ insertedAt: "not-an-instant" }) }).verify(evidence), /insertedAt/);
  await assert.rejects(() => verifier({ writeValue: writeResult({
    authenticatedAt: "2026-08-14T20:00:01.000Z",
  }) }).verify(evidence), /time is invalid/);
});

test("activation evidence chain re-enforces all four principal independence boundaries", async () => {
  await assert.rejects(() => verifier({
    evidenceValue: evidenceResult({ checkerPrincipalId: "maker-principal" }),
  }).verify(evidence), /distinct principals/);
  for (const servicePrincipalId of ["maker-principal", "checker-principal", "owner-principal"]) {
    await assert.rejects(() => verifier({ writeValue: writeResult({ servicePrincipalId }) }).verify(evidence),
      /writer must be independent/);
  }
});
