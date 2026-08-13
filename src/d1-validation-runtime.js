import { canonicalize, digestCanonicalValue, parseJsonStrict } from "./canonical-digest.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ROLES = new Set(["maker", "checker"]);
const ATTESTATION_FIELDS = Object.freeze([
  "actionDigest", "attestationId", "expiresAt", "issuedAt", "keyId", "principalId", "role", "schemaVersion",
]);
const MAX_ATTESTATION_MS = 86_400_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function") throw new TypeError("Validation D1 binding is unavailable");
}

function component(value, name) {
  if (typeof value !== "string" || !COMPONENT.test(value)) throw new TypeError(`Invalid validation ${name}`);
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`Invalid validation ${name}`);
  return value;
}

function instant(value, name = "lookup time") {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  const timestamp = date.getTime();
  if (!Number.isSafeInteger(timestamp)) throw new TypeError(`Invalid validation ${name}`);
  return timestamp;
}

function iso(timestamp) {
  if (!Number.isSafeInteger(timestamp)) throw new TypeError("Invalid validation evidence time");
  return new Date(timestamp).toISOString();
}

function exactIso(value, name) {
  if (typeof value !== "string") throw new TypeError(`Invalid attestation ${name}`);
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`Invalid attestation ${name}`);
  }
  return timestamp;
}

function version(value) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError("Invalid validation record version");
  return value;
}

function decodeBase64url(value, name, expectedLength = null) {
  if (typeof value !== "string" || !BASE64URL.test(value) || value.length % 4 === 1) {
    throw new TypeError(`Invalid ${name} encoding`);
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  let binary;
  try { binary = atob(padded); } catch { throw new TypeError(`Invalid ${name} encoding`); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (expectedLength !== null && bytes.byteLength !== expectedLength) throw new TypeError(`Invalid ${name} length`);
  return bytes;
}

async function uniqueActive(database, sql, bindings, label) {
  const response = await database.prepare(sql).bind(...bindings).all();
  if (!response?.success || !Array.isArray(response.results)) throw new Error(`Validation ${label} query failed`);
  if (response.results.length === 0) throw new Error(`Validation ${label} unavailable`);
  if (response.results.length !== 1) throw new Error(`Validation ${label} is ambiguous`);
  return response.results[0];
}

function parseAttestation(token) {
  if (typeof token !== "string" || token.length > 8192) throw new TypeError("Invalid identity attestation");
  const segments = token.split(".");
  if (segments.length !== 3 || segments[0] !== "v1") throw new TypeError("Invalid identity attestation format");
  const payloadBytes = decodeBase64url(segments[1], "attestation payload");
  const signature = decodeBase64url(segments[2], "attestation signature", 64);
  let payloadText;
  try { payloadText = decoder.decode(payloadBytes); } catch { throw new TypeError("Invalid attestation UTF-8"); }
  const payload = parseJsonStrict(payloadText);
  if (canonicalize(payload) !== payloadText || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(ATTESTATION_FIELDS)) {
    throw new TypeError("Attestation payload must be exact canonical JSON");
  }
  return { payload, payloadBytes, signature };
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export class D1Ed25519IdentityVerifier {
  constructor(database) { assertDatabase(database); this.database = database; }

  async verify(attestation, { role, actionDigest, now = new Date() } = {}) {
    if (!ROLES.has(role)) throw new TypeError("Invalid required identity role");
    digest(actionDigest, "action digest");
    const { payload, payloadBytes, signature } = parseAttestation(attestation);
    if (payload.schemaVersion !== "1.0.0" || payload.role !== role || payload.actionDigest !== actionDigest) {
      throw new Error("Identity attestation binding mismatch");
    }
    component(payload.attestationId, "attestation ID");
    component(payload.principalId, "principal ID");
    component(payload.keyId, "key ID");
    const issuedAtMs = exactIso(payload.issuedAt, "issuedAt");
    const expiresAtMs = exactIso(payload.expiresAt, "expiresAt");
    const nowMs = instant(now);
    if (issuedAtMs > nowMs || expiresAtMs <= nowMs || expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > MAX_ATTESTATION_MS) {
      throw new Error("Identity attestation is not current");
    }

    const row = await uniqueActive(this.database, `
      SELECT record_id, principal_id, allowed_roles_json, algorithm, public_key_base64url,
        key_digest, valid_from_ms, valid_until_ms, version
      FROM authority_identity_keys
      WHERE key_id = ?1 AND enabled = 1 AND status IN ('CURRENT', 'FINAL')
        AND valid_from_ms <= ?2
        AND (valid_until_ms IS NULL OR valid_until_ms > ?2)
    `, [payload.keyId, nowMs], "identity key");

    component(row.record_id, "identity key record ID");
    component(row.principal_id, "identity key principal ID");
    version(row.version);
    if (row.algorithm !== "Ed25519" || row.principal_id !== payload.principalId ||
        !Number.isSafeInteger(row.valid_from_ms) || (row.valid_until_ms !== null && !Number.isSafeInteger(row.valid_until_ms)) ||
        issuedAtMs < row.valid_from_ms || (row.valid_until_ms !== null && expiresAtMs > row.valid_until_ms)) {
      throw new Error("Identity key binding mismatch");
    }
    const allowedRoles = parseJsonStrict(row.allowed_roles_json);
    if (!Array.isArray(allowedRoles) || canonicalize(allowedRoles) !== row.allowed_roles_json ||
        new Set(allowedRoles).size !== allowedRoles.length || allowedRoles.some((value) => !ROLES.has(value)) ||
        !allowedRoles.includes(role)) throw new Error("Identity key role unavailable");
    const keyRecord = {
      keyId: payload.keyId, principalId: row.principal_id, allowedRoles, algorithm: row.algorithm,
      publicKeyBase64url: row.public_key_base64url, version: row.version,
    };
    if (!DIGEST.test(row.key_digest ?? "") || await digestCanonicalValue(keyRecord) !== row.key_digest) {
      throw new Error("Identity key integrity check failed");
    }
    const publicKey = await crypto.subtle.importKey(
      "raw", decodeBase64url(row.public_key_base64url, "Ed25519 public key", 32), "Ed25519", false, ["verify"],
    );
    if (!await crypto.subtle.verify("Ed25519", publicKey, signature, payloadBytes)) {
      throw new Error("Identity attestation signature invalid");
    }
    return freeze({
      principalId: payload.principalId,
      actionDigest,
      role,
      attestationId: payload.attestationId,
      evidenceDigest: await digestCanonicalValue(payload),
    });
  }
}

export class D1TestEvidenceProvider {
  constructor(database) { assertDatabase(database); this.database = database; }

  async getTestEvidence(actionDigest, requiredTests, { now = new Date() } = {}) {
    digest(actionDigest, "action digest");
    if (!Array.isArray(requiredTests) || requiredTests.length === 0 || new Set(requiredTests).size !== requiredTests.length) {
      throw new TypeError("Required tests must be a non-empty unique list");
    }
    for (const testId of requiredTests) component(testId, "test ID");
    const nowMs = instant(now);
    const response = await this.database.prepare(`
      SELECT record_id, test_id, result, source_principal_id, evidence_digest,
        issued_at_ms, expires_at_ms, version
      FROM authority_test_evidence
      WHERE action_digest = ?1 AND enabled = 1 AND status IN ('CURRENT', 'FINAL')
        AND issued_at_ms <= ?2 AND expires_at_ms > ?2
    `).bind(actionDigest, nowMs).all();
    if (!response?.success || !Array.isArray(response.results)) throw new Error("Validation test evidence query failed");

    const evidence = [];
    for (const testId of requiredTests) {
      const matches = response.results.filter((row) => row.test_id === testId);
      if (matches.length === 0) throw new Error(`Validation test evidence unavailable: ${testId}`);
      if (matches.length !== 1) throw new Error(`Validation test evidence is ambiguous: ${testId}`);
      const row = matches[0];
      component(row.record_id, "test evidence record ID");
      component(row.source_principal_id, "test evidence source principal ID");
      version(row.version);
      const issuedAt = iso(row.issued_at_ms);
      const expiresAt = iso(row.expires_at_ms);
      const record = { testId, result: row.result, actionDigest, issuedAt, expiresAt, sourcePrincipalId: row.source_principal_id, version: row.version };
      if (!new Set(["passed", "failed"]).has(row.result) || !DIGEST.test(row.evidence_digest ?? "") ||
          await digestCanonicalValue(record) !== row.evidence_digest) throw new Error("Test evidence integrity check failed");
      evidence.push(freeze({ ...record, evidenceDigest: row.evidence_digest }));
    }
    return freeze(evidence);
  }
}

export class D1RollbackVerifier {
  constructor(database) { assertDatabase(database); this.database = database; }

  async verify(rollbackRef, { actionDigest, now = new Date() } = {}) {
    component(rollbackRef, "rollback reference");
    digest(actionDigest, "action digest");
    const nowMs = instant(now);
    const row = await uniqueActive(this.database, `
      SELECT record_id, valid, executable, executor_ref, evidence_digest,
        issued_at_ms, expires_at_ms, version
      FROM authority_rollbacks
      WHERE rollback_ref = ?1 AND action_digest = ?2
        AND enabled = 1 AND status IN ('CURRENT', 'FINAL')
        AND issued_at_ms <= ?3 AND expires_at_ms > ?3
    `, [rollbackRef, actionDigest, nowMs], "rollback evidence");
    component(row.record_id, "rollback record ID");
    component(row.executor_ref, "rollback executor reference");
    version(row.version);
    if (![0, 1].includes(row.valid) || ![0, 1].includes(row.executable)) throw new Error("Rollback evidence flags are invalid");
    const record = {
      rollbackRef, actionDigest, valid: row.valid === 1, executable: row.executable === 1,
      executorRef: row.executor_ref, issuedAt: iso(row.issued_at_ms), expiresAt: iso(row.expires_at_ms), version: row.version,
    };
    if (!DIGEST.test(row.evidence_digest ?? "") || await digestCanonicalValue(record) !== row.evidence_digest) {
      throw new Error("Rollback evidence integrity check failed");
    }
    return freeze({ ...record, evidenceDigest: row.evidence_digest });
  }
}
