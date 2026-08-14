import { digestCanonicalValue } from "./canonical-digest.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u;
const EVIDENCE_FIELDS = Object.freeze([
  "backupDigest", "checkerValidationDigest", "makerValidationDigest",
  "resourceActivationAuthorizationDigest", "reviewedCommit", "rollbackEvidenceDigest",
  "workerDeploymentAuthorizationDigest",
]);
const EVIDENCE_RESULT_FIELDS = Object.freeze([
  "backupDigest", "checkerPrincipalId", "checkerValidationDigest", "makerPrincipalId",
  "makerValidationDigest", "ownerPrincipalId", "resourceActivationAuthorizationDigest",
  "reviewedCommit", "rollbackEvidenceDigest", "valid", "verificationDigest",
  "workerDeploymentAuthorizationDigest",
]);
const WRITE_RESULT_FIELDS = Object.freeze([
  "authenticatedAt", "insertedAt", "recordDigest", "recordId", "requestBodyDigest",
  "reviewedCommit", "serviceKeyId", "servicePrincipalId", "valid", "verificationDigest",
  "writeDigest",
]);

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new TypeError(`Development activation ${label} fields must be exact`);
  }
}

function component(value, label) {
  if (typeof value !== "string" || !COMPONENT.test(value)) {
    throw new TypeError(`Invalid development activation ${label}`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`Invalid development activation ${label}`);
  }
  return value;
}

function exactIso(value, label) {
  if (typeof value !== "string") throw new TypeError(`Invalid development activation ${label}`);
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`Invalid development activation ${label}`);
  }
  return timestamp;
}

function assertEvidence(evidence) {
  exactFields(evidence, EVIDENCE_FIELDS, "evidence chain request");
  if (typeof evidence.reviewedCommit !== "string" || !COMMIT.test(evidence.reviewedCommit)) {
    throw new TypeError("Invalid development activation reviewed commit");
  }
  const digests = EVIDENCE_FIELDS.filter((field) => field !== "reviewedCommit")
    .map((field) => digest(evidence[field], field));
  if (new Set(digests).size !== digests.length) {
    throw new Error("Development activation evidence digests must be unique");
  }
}

function assertVerifier(value, method, label) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(`Development activation ${label} is unavailable`);
  }
}

function assertEvidenceResult(result, evidence) {
  exactFields(result, EVIDENCE_RESULT_FIELDS, "evidence verification result");
  if (result.valid !== true) throw new Error("Development activation evidence verification failed");
  for (const field of EVIDENCE_FIELDS) {
    if (result[field] !== evidence[field]) {
      throw new Error("Development activation evidence verification result binding mismatch");
    }
  }
  component(result.makerPrincipalId, "maker principal ID");
  component(result.checkerPrincipalId, "checker principal ID");
  component(result.ownerPrincipalId, "owner principal ID");
  digest(result.verificationDigest, "evidence verification digest");
  if (new Set([result.makerPrincipalId, result.checkerPrincipalId, result.ownerPrincipalId]).size !== 3) {
    throw new Error("Development activation maker, checker, and owner must be distinct principals");
  }
}

function assertWriteResult(result, evidence) {
  exactFields(result, WRITE_RESULT_FIELDS, "evidence write verification result");
  if (result.valid !== true || result.reviewedCommit !== evidence.reviewedCommit) {
    throw new Error("Development activation evidence write verification result binding mismatch");
  }
  component(result.recordId, "evidence record ID");
  component(result.servicePrincipalId, "evidence writer principal ID");
  component(result.serviceKeyId, "evidence writer key ID");
  digest(result.recordDigest, "evidence record digest");
  digest(result.requestBodyDigest, "evidence request body digest");
  digest(result.writeDigest, "evidence write digest");
  digest(result.verificationDigest, "evidence write verification digest");
  const authenticatedAt = exactIso(result.authenticatedAt, "evidence authenticatedAt");
  const insertedAt = exactIso(result.insertedAt, "evidence insertedAt");
  if (authenticatedAt > insertedAt) {
    throw new Error("Development activation evidence write verification time is invalid");
  }
}

export class AuthenticatedDevelopmentActivationEvidenceChainVerifier {
  constructor({ evidenceVerifier, writeReceiptVerifier, now = () => new Date() } = {}) {
    assertVerifier(evidenceVerifier, "verify", "evidence verifier");
    assertVerifier(writeReceiptVerifier, "verify", "write receipt verifier");
    if (typeof now !== "function") throw new TypeError("Development activation chain clock is unavailable");
    this.evidenceVerifier = evidenceVerifier;
    this.writeReceiptVerifier = writeReceiptVerifier;
    this.now = now;
    Object.freeze(this);
  }

  async verify(evidence) {
    assertEvidence(evidence);
    const requestedEvidence = Object.freeze({ ...evidence });
    const now = this.now();
    if (!(now instanceof Date) || !Number.isSafeInteger(now.valueOf())) {
      throw new TypeError("Invalid development activation evidence chain verification time");
    }
    const [evidenceResult, writeResult] = await Promise.all([
      this.evidenceVerifier.verify(requestedEvidence),
      this.writeReceiptVerifier.verify(requestedEvidence, { now }),
    ]).then((results) => results.map((result) => structuredClone(result)));
    assertEvidenceResult(evidenceResult, requestedEvidence);
    assertWriteResult(writeResult, requestedEvidence);
    if ([evidenceResult.makerPrincipalId, evidenceResult.checkerPrincipalId, evidenceResult.ownerPrincipalId]
      .includes(writeResult.servicePrincipalId)) {
      throw new Error("Development activation writer must be independent of maker, checker, and owner");
    }

    const verificationDigest = await digestCanonicalValue({
      authenticatedAt: writeResult.authenticatedAt,
      evidence: requestedEvidence,
      evidenceVerificationDigest: evidenceResult.verificationDigest,
      insertedAt: writeResult.insertedAt,
      principals: {
        checkerPrincipalId: evidenceResult.checkerPrincipalId,
        makerPrincipalId: evidenceResult.makerPrincipalId,
        ownerPrincipalId: evidenceResult.ownerPrincipalId,
        writerPrincipalId: writeResult.servicePrincipalId,
      },
      recordDigest: writeResult.recordDigest,
      recordId: writeResult.recordId,
      requestBodyDigest: writeResult.requestBodyDigest,
      schemaVersion: "1.0.0",
      writeDigest: writeResult.writeDigest,
      writeReceiptVerificationDigest: writeResult.verificationDigest,
      writerKeyId: writeResult.serviceKeyId,
    });
    return Object.freeze({
      ...requestedEvidence,
      valid: true,
      makerPrincipalId: evidenceResult.makerPrincipalId,
      checkerPrincipalId: evidenceResult.checkerPrincipalId,
      ownerPrincipalId: evidenceResult.ownerPrincipalId,
      verificationDigest,
    });
  }
}
