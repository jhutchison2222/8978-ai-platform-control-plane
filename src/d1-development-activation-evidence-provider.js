import { canonicalize, digestCanonicalValue, parseJsonStrict } from "./canonical-digest.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const GOVERNING_STATUSES = new Set(["CURRENT", "FINAL"]);
const MAX_BUNDLE_BYTES = 65_536;
const EVIDENCE_FIELDS = Object.freeze([
  "backupDigest", "checkerValidationDigest", "makerValidationDigest",
  "resourceActivationAuthorizationDigest", "reviewedCommit", "rollbackEvidenceDigest",
  "workerDeploymentAuthorizationDigest",
]);
const BUNDLE_FIELDS = Object.freeze([
  "backupAttestation", "checkerValidationAttestation", "makerValidationAttestation",
  "resourceActivationDecision", "rollbackAttestation", "schemaVersion", "workerDeploymentDecision",
]);
const OWNER_DECISION_FIELDS = Object.freeze([
  "decidedAt", "decidedBy", "decision", "decisionId", "expiresAt", "issuerKeyId",
  "requestedActionDigest", "signature", "signatureAlgorithm",
]);
const encoder = new TextEncoder();

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new TypeError(`Development activation ${label} fields must be exact`);
  }
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("Development activation evidence D1 binding is unavailable");
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

function instant(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  const timestamp = date.getTime();
  if (!Number.isSafeInteger(timestamp)) throw new TypeError("Invalid development activation evidence lookup time");
  return timestamp;
}

function exactIso(value, label) {
  if (typeof value !== "string") throw new TypeError(`Invalid development activation ${label}`);
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`Invalid development activation ${label}`);
  }
}

function token(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    throw new TypeError(`Invalid development activation ${label}`);
  }
}

function assertEvidence(evidence) {
  exactFields(evidence, EVIDENCE_FIELDS, "evidence request");
  if (typeof evidence.reviewedCommit !== "string" || !COMMIT.test(evidence.reviewedCommit)) {
    throw new TypeError("Invalid development activation reviewed commit");
  }
  const digests = EVIDENCE_FIELDS.filter((field) => field !== "reviewedCommit")
    .map((field) => digest(evidence[field], field));
  if (new Set(digests).size !== digests.length) {
    throw new Error("Development activation evidence digests must be unique");
  }
}

function assertOwnerDecision(decision, label) {
  exactFields(decision, OWNER_DECISION_FIELDS, `${label} owner decision`);
  component(decision.decisionId, `${label} decision ID`);
  component(decision.decidedBy, `${label} owner principal ID`);
  component(decision.issuerKeyId, `${label} owner key ID`);
  digest(decision.requestedActionDigest, `${label} requested action digest`);
  token(decision.signature, `${label} owner signature`);
  exactIso(decision.decidedAt, `${label} decidedAt`);
  exactIso(decision.expiresAt, `${label} expiresAt`);
  if (decision.decision !== "approved" || decision.signatureAlgorithm !== "Ed25519") {
    throw new Error(`Development activation ${label} owner decision boundary changed`);
  }
}

function assertBundle(bundle) {
  exactFields(bundle, BUNDLE_FIELDS, "evidence bundle");
  if (bundle.schemaVersion !== "1.0.0") throw new Error("Development activation evidence bundle version mismatch");
  token(bundle.makerValidationAttestation, "maker validation attestation");
  token(bundle.checkerValidationAttestation, "checker validation attestation");
  token(bundle.rollbackAttestation, "rollback attestation");
  token(bundle.backupAttestation, "backup attestation");
  assertOwnerDecision(bundle.resourceActivationDecision, "resource activation");
  assertOwnerDecision(bundle.workerDeploymentDecision, "Worker deployment");
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export class D1DevelopmentActivationEvidenceBundleProvider {
  constructor(database) {
    assertDatabase(database);
    this.database = database;
  }

  async read(evidence, { now = new Date() } = {}) {
    assertEvidence(evidence);
    const nowMs = instant(now);
    const response = await this.database.prepare(`
      SELECT record_id, bundle_json, bundle_digest, record_digest, status,
        issued_at_ms, expires_at_ms, version
      FROM authority_development_activation_evidence_bundles
      WHERE reviewed_commit = ?1
        AND maker_validation_digest = ?2
        AND checker_validation_digest = ?3
        AND resource_activation_authorization_digest = ?4
        AND worker_deployment_authorization_digest = ?5
        AND rollback_evidence_digest = ?6
        AND backup_digest = ?7
        AND enabled = 1 AND status IN ('CURRENT', 'FINAL')
        AND issued_at_ms <= ?8 AND expires_at_ms > ?8
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
      throw new Error("Development activation evidence bundle query failed");
    }
    if (response.results.length === 0) throw new Error("Development activation evidence bundle unavailable");
    if (response.results.length !== 1) throw new Error("Development activation evidence bundle is ambiguous");

    const row = response.results[0];
    component(row.record_id, "evidence bundle record ID");
    if (!GOVERNING_STATUSES.has(row.status) || !Number.isSafeInteger(row.issued_at_ms) ||
        !Number.isSafeInteger(row.expires_at_ms) || row.expires_at_ms <= row.issued_at_ms ||
        !Number.isInteger(row.version) || row.version < 1 || typeof row.bundle_json !== "string" ||
        encoder.encode(row.bundle_json).byteLength > MAX_BUNDLE_BYTES ||
        !DIGEST.test(row.bundle_digest ?? "") || !DIGEST.test(row.record_digest ?? "")) {
      throw new Error("Development activation evidence bundle record is invalid");
    }
    const bundle = parseJsonStrict(row.bundle_json);
    if (canonicalize(bundle) !== row.bundle_json) {
      throw new Error("Development activation evidence bundle must be canonical JSON");
    }
    assertBundle(bundle);
    if (await digestCanonicalValue(bundle) !== row.bundle_digest) {
      throw new Error("Development activation evidence bundle integrity check failed");
    }
    const record = {
      recordId: row.record_id,
      status: row.status,
      reviewedCommit: evidence.reviewedCommit,
      evidence,
      bundleDigest: row.bundle_digest,
      issuedAt: new Date(row.issued_at_ms).toISOString(),
      expiresAt: new Date(row.expires_at_ms).toISOString(),
      version: row.version,
    };
    if (await digestCanonicalValue(record) !== row.record_digest) {
      throw new Error("Development activation evidence record integrity check failed");
    }
    return freeze(bundle);
  }
}
