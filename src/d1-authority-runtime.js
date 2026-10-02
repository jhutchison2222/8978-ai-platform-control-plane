import { digestCanonicalValue, parseJsonStrict } from "./canonical-digest.js";
import { resourceKey, validateResolvedResource } from "./resource-contract.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const RISKS = new Set(["low", "medium", "high", "critical"]);
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}$/;

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("Authoritative D1 binding is unavailable");
  }
}

function instant(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError("Invalid authority lookup time");
  return timestamp;
}

function component(value, name) {
  if (typeof value !== "string" || !COMPONENT.test(value)) {
    throw new TypeError(`Invalid authority ${name}`);
  }
  return value;
}

async function uniqueActive(database, sql, bindings, label) {
  const response = await database.prepare(sql).bind(...bindings).all();
  if (!response?.success || !Array.isArray(response.results)) {
    throw new Error(`Authoritative ${label} query failed`);
  }
  if (response.results.length === 0) throw new Error(`Authoritative ${label} unavailable`);
  if (response.results.length !== 1) throw new Error(`Authoritative ${label} is ambiguous`);
  return response.results[0];
}

function validVersion(value) {
  return Number.isInteger(value) && value > 0;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export class D1AuthoritativeResourceResolver {
  constructor(database) {
    assertDatabase(database);
    this.database = database;
  }

  async resolve(requestedTarget, { now = new Date() } = {}) {
    if (!requestedTarget || Object.keys(requestedTarget).length !== 1) {
      throw new TypeError("Requested target must contain only locator");
    }
    const locator = component(requestedTarget.locator, "locator");
    const row = await uniqueActive(this.database, `
      SELECT record_id, resource_key, resource_json, resource_digest, version
      FROM authority_resources
      WHERE locator = ?1 AND enabled = 1 AND status IN ('CURRENT', 'FINAL')
        AND valid_from_ms <= ?2
        AND (valid_until_ms IS NULL OR valid_until_ms > ?2)
    `, [locator, instant(now)], "resource");

    if (!validVersion(row.version) || typeof row.record_id !== "string" || !COMPONENT.test(row.record_id) ||
        typeof row.resource_json !== "string" ||
        typeof row.resource_key !== "string" || !DIGEST.test(row.resource_digest ?? "")) {
      throw new Error("Authoritative resource record is invalid");
    }
    const resource = parseJsonStrict(row.resource_json);
    if (validateResolvedResource(resource).length !== 0 || resourceKey(resource) !== row.resource_key ||
        await digestCanonicalValue(resource) !== row.resource_digest) {
      throw new Error("Authoritative resource integrity check failed");
    }
    return freeze(structuredClone(resource));
  }
}

export class D1TrustedLimitProvider {
  constructor(database) {
    assertDatabase(database);
    this.database = database;
  }

  async resolve(action, resolvedTarget, { actionDigest, now = new Date() } = {}) {
    const operation = component(action?.operation, "operation");
    if (!DIGEST.test(actionDigest ?? "")) throw new TypeError("Invalid requested action digest");
    if (validateResolvedResource(resolvedTarget).length !== 0) {
      throw new TypeError("Invalid resolved target for limit lookup");
    }
    const key = component(resourceKey(resolvedTarget), "resource key");
    const row = await uniqueActive(this.database, `
      SELECT record_id, risk, cost_usd, record_count, evidence_digest, version
      FROM authority_limits
      WHERE resource_key = ?1 AND operation = ?2
        AND enabled = 1 AND status IN ('CURRENT', 'FINAL')
        AND valid_from_ms <= ?3
        AND (valid_until_ms IS NULL OR valid_until_ms > ?3)
    `, [key, operation, instant(now)], "limits");

    if (!validVersion(row.version) || typeof row.record_id !== "string" || !COMPONENT.test(row.record_id) ||
        !RISKS.has(row.risk) ||
        typeof row.cost_usd !== "number" || !Number.isFinite(row.cost_usd) || row.cost_usd < 0 ||
        !Number.isInteger(row.record_count) || row.record_count < 0 ||
        !DIGEST.test(row.evidence_digest ?? "")) {
      throw new Error("Authoritative limit record is invalid");
    }
    return freeze({
      risk: row.risk,
      costUsd: row.cost_usd,
      recordCount: row.record_count,
      evidenceDigest: row.evidence_digest,
      actionDigest,
    });
  }
}
