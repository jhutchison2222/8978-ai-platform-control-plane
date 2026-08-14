import { digestCanonicalValue } from "./canonical-digest.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u;
const NONCE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const EVIDENCE_FIELDS = Object.freeze([
  "backupDigest", "checkerValidationDigest", "makerValidationDigest",
  "resourceActivationAuthorizationDigest", "reviewedCommit", "rollbackEvidenceDigest",
  "workerDeploymentAuthorizationDigest",
]);

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new TypeError(`Development activation ${label} fields must be exact`);
  }
}

function component(value, label, pattern = COMPONENT) {
  if (typeof value !== "string" || !pattern.test(value)) {
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

function instant(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  const timestamp = date.getTime();
  if (!Number.isSafeInteger(timestamp)) {
    throw new TypeError("Invalid development activation evidence write verification time");
  }
  return timestamp;
}

function assertEvidence(evidence, reviewedCommit) {
  exactFields(evidence, EVIDENCE_FIELDS, "evidence write verification request");
  if (typeof evidence.reviewedCommit !== "string" || !COMMIT.test(evidence.reviewedCommit) ||
      evidence.reviewedCommit !== reviewedCommit) {
    throw new TypeError("Invalid development activation reviewed commit");
  }
  const digests = EVIDENCE_FIELDS.filter((field) => field !== "reviewedCommit")
    .map((field) => digest(evidence[field], field));
  if (new Set(digests).size !== digests.length) {
    throw new Error("Development activation evidence digests must be unique");
  }
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("Development activation evidence write verifier D1 binding is unavailable");
  }
}

function assertAuthorizedWriter(value) {
  exactFields(value, ["keyId", "principalId"], "authorized evidence writer");
  component(value.principalId, "authorized writer principal ID");
  component(value.keyId, "authorized writer key ID");
  return Object.freeze({ ...value });
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export class D1DevelopmentActivationEvidenceWriteVerifier {
  constructor(database, { authorizedWriter, reviewedCommit } = {}) {
    assertDatabase(database);
    if (typeof reviewedCommit !== "string" || !COMMIT.test(reviewedCommit)) {
      throw new TypeError("Invalid development activation write verifier reviewed commit");
    }
    this.database = database;
    this.authorizedWriter = assertAuthorizedWriter(authorizedWriter);
    this.reviewedCommit = reviewedCommit;
    Object.freeze(this);
  }

  async verify(evidence, { now = new Date() } = {}) {
    assertEvidence(evidence, this.reviewedCommit);
    const nowMs = instant(now);
    const response = await this.database.prepare(`
      SELECT
        bundles.record_id, bundles.bundle_digest, bundles.record_digest, bundles.status,
        bundles.issued_at_ms, bundles.expires_at_ms, bundles.version AS record_version,
        writes.write_id, writes.record_digest AS write_record_digest,
        writes.request_body_digest, writes.service_principal_id, writes.service_key_id,
        writes.service_nonce, writes.authenticated_at_ms, writes.inserted_at_ms,
        writes.write_digest, writes.version AS write_version
      FROM authority_development_activation_evidence_bundles AS bundles
      INNER JOIN authority_development_activation_evidence_writes AS writes
        ON writes.record_id = bundles.record_id
      WHERE bundles.reviewed_commit = ?1
        AND bundles.maker_validation_digest = ?2
        AND bundles.checker_validation_digest = ?3
        AND bundles.resource_activation_authorization_digest = ?4
        AND bundles.worker_deployment_authorization_digest = ?5
        AND bundles.rollback_evidence_digest = ?6
        AND bundles.backup_digest = ?7
        AND bundles.enabled = 1 AND bundles.status = 'CURRENT'
        AND bundles.issued_at_ms <= ?8 AND bundles.expires_at_ms > ?8
    `).bind(
      evidence.reviewedCommit,
      evidence.makerValidationDigest,
      evidence.checkerValidationDigest,
      evidence.resourceActivationAuthorizationDigest,
      evidence.workerDeploymentAuthorizationDigest,
      evidence.rollbackEvidenceDigest,
      evidence.backupDigest,
      nowMs,
    ).all();
    if (!response?.success || !Array.isArray(response.results)) {
      throw new Error("Development activation evidence write receipt query failed");
    }
    if (response.results.length === 0) {
      throw new Error("Development activation evidence write receipt unavailable");
    }
    if (response.results.length !== 1) {
      throw new Error("Development activation evidence write receipt is ambiguous");
    }

    const row = response.results[0];
    component(row.record_id, "evidence record ID");
    component(row.write_id, "evidence write ID");
    component(row.service_principal_id, "evidence writer principal ID");
    component(row.service_key_id, "evidence writer key ID");
    component(row.service_nonce, "evidence writer nonce", NONCE);
    digest(row.bundle_digest, "evidence bundle digest");
    digest(row.record_digest, "evidence record digest");
    digest(row.write_record_digest, "write-bound record digest");
    digest(row.request_body_digest, "evidence request body digest");
    digest(row.write_digest, "evidence write digest");
    if (row.write_id !== row.record_id || row.write_record_digest !== row.record_digest ||
        row.service_principal_id !== this.authorizedWriter.principalId ||
        row.service_key_id !== this.authorizedWriter.keyId) {
      throw new Error("Development activation evidence write receipt binding mismatch");
    }
    if (row.status !== "CURRENT" || row.record_version !== 1 || row.write_version !== 1 ||
        !Number.isSafeInteger(row.issued_at_ms) || !Number.isSafeInteger(row.expires_at_ms) ||
        !Number.isSafeInteger(row.authenticated_at_ms) || !Number.isSafeInteger(row.inserted_at_ms) ||
        row.expires_at_ms <= row.issued_at_ms || row.inserted_at_ms < row.issued_at_ms ||
        row.inserted_at_ms >= row.expires_at_ms || row.authenticated_at_ms > row.inserted_at_ms) {
      throw new Error("Development activation evidence write receipt is invalid");
    }

    const record = {
      recordId: row.record_id,
      status: row.status,
      reviewedCommit: evidence.reviewedCommit,
      evidence,
      bundleDigest: row.bundle_digest,
      issuedAt: new Date(row.issued_at_ms).toISOString(),
      expiresAt: new Date(row.expires_at_ms).toISOString(),
      version: row.record_version,
    };
    if (await digestCanonicalValue(record) !== row.record_digest) {
      throw new Error("Development activation evidence write record integrity check failed");
    }
    const writeRecord = {
      writeId: row.write_id,
      recordId: row.record_id,
      recordDigest: row.record_digest,
      requestBodyDigest: row.request_body_digest,
      serviceIdentity: {
        principalId: row.service_principal_id,
        keyId: row.service_key_id,
        nonce: row.service_nonce,
      },
      authenticatedAt: new Date(row.authenticated_at_ms).toISOString(),
      insertedAt: new Date(row.inserted_at_ms).toISOString(),
      version: row.write_version,
    };
    if (await digestCanonicalValue(writeRecord) !== row.write_digest) {
      throw new Error("Development activation evidence write receipt integrity check failed");
    }
    const verificationDigest = await digestCanonicalValue({
      evidence,
      recordDigest: row.record_digest,
      writeDigest: row.write_digest,
      schemaVersion: "1.0.0",
    });
    return freeze({
      valid: true,
      reviewedCommit: evidence.reviewedCommit,
      recordId: row.record_id,
      recordDigest: row.record_digest,
      requestBodyDigest: row.request_body_digest,
      writeDigest: row.write_digest,
      servicePrincipalId: row.service_principal_id,
      serviceKeyId: row.service_key_id,
      authenticatedAt: writeRecord.authenticatedAt,
      insertedAt: writeRecord.insertedAt,
      verificationDigest,
    });
  }
}
