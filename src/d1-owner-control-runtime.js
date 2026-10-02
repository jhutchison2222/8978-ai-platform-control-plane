import { canonicalize, digestCanonicalValue, digestRequestedAction } from "./canonical-digest.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_OWNER_DECISION_MS = 86_400_000;
const DECISION_FIELDS = Object.freeze([
  "decidedAt", "decidedBy", "decision", "decisionId", "expiresAt", "issuerKeyId",
  "requestedActionDigest", "signature", "signatureAlgorithm",
]);

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function") throw new TypeError("Owner-control D1 binding is unavailable");
}

function component(value, name) {
  if (typeof value !== "string" || !COMPONENT.test(value)) throw new TypeError(`Invalid owner-control ${name}`);
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`Invalid owner-control ${name}`);
  return value;
}

function instant(value, name = "lookup time") {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  const timestamp = date.getTime();
  if (!Number.isSafeInteger(timestamp)) throw new TypeError(`Invalid owner-control ${name}`);
  return timestamp;
}

function exactIso(value, name) {
  if (typeof value !== "string") throw new TypeError(`Invalid owner decision ${name}`);
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`Invalid owner decision ${name}`);
  }
  return timestamp;
}

function decodeBase64url(value, name, expectedLength) {
  if (typeof value !== "string" || !BASE64URL.test(value) || value.length % 4 === 1) {
    throw new TypeError(`Invalid ${name} encoding`);
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  let binary;
  try { binary = atob(padded); } catch { throw new TypeError(`Invalid ${name} encoding`); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== expectedLength) throw new TypeError(`Invalid ${name} length`);
  return bytes;
}

async function uniqueActive(database, sql, bindings, label) {
  const response = await database.prepare(sql).bind(...bindings).all();
  if (!response?.success || !Array.isArray(response.results)) throw new Error(`Owner-control ${label} query failed`);
  if (response.results.length === 0) throw new Error(`Owner-control ${label} unavailable`);
  if (response.results.length !== 1) throw new Error(`Owner-control ${label} is ambiguous`);
  return response.results[0];
}

function decisionPayload(decision) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision) ||
      JSON.stringify(Object.keys(decision).sort()) !== JSON.stringify(DECISION_FIELDS)) {
    throw new TypeError("Owner decision fields must be exact");
  }
  const { signature: _signature, ...payload } = decision;
  return payload;
}

export class D1Ed25519OwnerDecisionVerifier {
  constructor(database) { assertDatabase(database); this.database = database; }

  async verify(decision, { actionDigest, now = new Date() } = {}) {
    digest(actionDigest, "action digest");
    const payload = decisionPayload(decision);
    component(payload.decisionId, "decision ID");
    component(payload.decidedBy, "owner principal ID");
    component(payload.issuerKeyId, "owner key ID");
    if (payload.decision !== "approved" || payload.requestedActionDigest !== actionDigest || payload.signatureAlgorithm !== "Ed25519") {
      throw new Error("Owner decision binding mismatch");
    }
    const decidedAtMs = exactIso(payload.decidedAt, "decidedAt");
    const expiresAtMs = exactIso(payload.expiresAt, "expiresAt");
    const nowMs = instant(now);
    if (decidedAtMs > nowMs || expiresAtMs <= nowMs || expiresAtMs <= decidedAtMs ||
        expiresAtMs - decidedAtMs > MAX_OWNER_DECISION_MS) throw new Error("Owner decision is not current");
    const row = await uniqueActive(this.database, `
      SELECT record_id, principal_id, algorithm, public_key_base64url, key_digest,
        valid_from_ms, valid_until_ms, version
      FROM authority_owner_keys
      WHERE key_id = ?1 AND enabled = 1 AND status IN ('CURRENT', 'FINAL')
        AND valid_from_ms <= ?2
        AND (valid_until_ms IS NULL OR valid_until_ms > ?2)
    `, [payload.issuerKeyId, nowMs], "owner key");
    component(row.record_id, "owner key record ID");
    component(row.principal_id, "owner key principal ID");
    if (!Number.isInteger(row.version) || row.version < 1 || row.algorithm !== "Ed25519" || row.principal_id !== payload.decidedBy ||
        !Number.isSafeInteger(row.valid_from_ms) || (row.valid_until_ms !== null && !Number.isSafeInteger(row.valid_until_ms)) ||
        decidedAtMs < row.valid_from_ms || (row.valid_until_ms !== null && expiresAtMs > row.valid_until_ms)) {
      throw new Error("Owner key binding mismatch");
    }
    const keyRecord = {
      keyId: payload.issuerKeyId, principalId: row.principal_id, algorithm: row.algorithm,
      publicKeyBase64url: row.public_key_base64url, version: row.version,
    };
    if (!DIGEST.test(row.key_digest ?? "") || await digestCanonicalValue(keyRecord) !== row.key_digest) {
      throw new Error("Owner key integrity check failed");
    }
    const publicKey = await crypto.subtle.importKey(
      "raw", decodeBase64url(row.public_key_base64url, "owner Ed25519 public key", 32), "Ed25519", false, ["verify"],
    );
    const signature = decodeBase64url(decision.signature, "owner Ed25519 signature", 64);
    const verified = await crypto.subtle.verify(
      "Ed25519", publicKey, signature, new TextEncoder().encode(canonicalize(payload)),
    );
    return verified;
  }
}

export class D1StandingStateRevalidator {
  constructor(database) { assertDatabase(database); this.database = database; }

  async revalidate(action, authorization, { now = new Date() } = {}) {
    if (!action || !authorization || authorization.outcome !== "authorized_by_standing_policy" ||
        action.actionId === undefined || authorization.actionDigest === undefined) {
      throw new TypeError("Standing-state revalidation context is invalid");
    }
    digest(authorization.actionDigest, "authorization action digest");
    if (await digestRequestedAction(action, authorization.resolvedTarget) !== authorization.actionDigest) {
      throw new Error("Standing-state action binding mismatch");
    }
    const policyId = component(authorization.authorizingPolicy?.policyId, "policy ID");
    const policyVersion = component(authorization.authorizingPolicy?.policyVersion, "policy version");
    const nowMs = instant(now);
    const row = await uniqueActive(this.database, `
      SELECT record_id, state, kill_switch, reason, evidence_digest, version
      FROM authority_standing_state
      WHERE policy_id = ?1 AND policy_version = ?2
        AND enabled = 1 AND status IN ('CURRENT', 'FINAL')
        AND valid_from_ms <= ?3
        AND (valid_until_ms IS NULL OR valid_until_ms > ?3)
    `, [policyId, policyVersion, nowMs], "standing state");
    component(row.record_id, "standing-state record ID");
    component(row.reason, "standing-state reason");
    if (!Number.isInteger(row.version) || row.version < 1 || !new Set(["enabled", "disabled"]).has(row.state) ||
        ![0, 1].includes(row.kill_switch)) throw new Error("Standing-state record is invalid");
    const record = {
      policyId, policyVersion, state: row.state, killSwitch: row.kill_switch === 1,
      reason: row.reason, version: row.version,
    };
    if (!DIGEST.test(row.evidence_digest ?? "") || await digestCanonicalValue(record) !== row.evidence_digest) {
      throw new Error("Standing-state integrity check failed");
    }
    return row.state === "enabled" && row.kill_switch === 0;
  }
}
