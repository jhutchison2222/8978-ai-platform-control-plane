import { canonicalize, digestCanonicalValue, parseJsonStrict } from "./canonical-digest.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ACTION_DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const MAX_KNOWLEDGE_BYTES = 262_144;
const GOVERNING_STATUSES = new Set(["CURRENT", "FINAL"]);
const FORBIDDEN_SECRET_KEYS = new Set([
  "apikey", "authorization", "credential", "credentials", "privatekey", "proxyauthorization",
  "refreshtoken", "secret", "secrets", "token", "tokens", "accesstoken",
]);
const encoder = new TextEncoder();

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("Project Knowledge D1 binding is unavailable");
  }
}

function component(value, name) {
  if (typeof value !== "string" || !COMPONENT.test(value)) {
    throw new TypeError(`Invalid Project Knowledge ${name}`);
  }
  return value;
}

function instant(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError("Invalid Project Knowledge lookup time");
  return { timestamp, retrievedAt: date.toISOString() };
}

function assertStatuses(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0 || statuses.length > GOVERNING_STATUSES.size ||
      new Set(statuses).size !== statuses.length || statuses.some((status) => !GOVERNING_STATUSES.has(status))) {
    throw new TypeError("Project Knowledge statuses must be unique CURRENT/FINAL values");
  }
  return { current: Number(statuses.includes("CURRENT")), final: Number(statuses.includes("FINAL")) };
}

function assertNoSecretFields(value) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_SECRET_KEYS.has(normalized)) {
        throw new Error(`Governing Project Knowledge contains prohibited secret field: ${key}`);
      }
      if (child && typeof child === "object") pending.push(child);
    }
  }
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export class D1GoverningProjectKnowledgeReader {
  constructor(database, { scope = "control-plane" } = {}) {
    assertDatabase(database);
    this.database = database;
    this.scope = component(scope, "scope");
  }

  async readGoverningKnowledge(request, { now = new Date() } = {}) {
    if (!request || typeof request !== "object" || Array.isArray(request) ||
        Object.keys(request).sort().join(",") !== "actionDigest,statuses") {
      throw new TypeError("Project Knowledge request must contain only actionDigest and statuses");
    }
    if (!ACTION_DIGEST.test(request.actionDigest ?? "")) {
      throw new TypeError("Invalid Project Knowledge action digest");
    }
    const statuses = assertStatuses(request.statuses);
    const lookup = instant(now);
    const response = await this.database.prepare(`
      SELECT record_id, status, knowledge_json, knowledge_digest, version
      FROM authority_project_knowledge
      WHERE knowledge_scope = ?1 AND governing = 1 AND enabled = 1
        AND ((status = 'CURRENT' AND ?2 = 1) OR (status = 'FINAL' AND ?3 = 1))
        AND valid_from_ms <= ?4
        AND (valid_until_ms IS NULL OR valid_until_ms > ?4)
    `).bind(this.scope, statuses.current, statuses.final, lookup.timestamp).all();
    if (!response?.success || !Array.isArray(response.results)) {
      throw new Error("Governing Project Knowledge query failed");
    }
    if (response.results.length === 0) throw new Error("Governing Project Knowledge unavailable");
    if (response.results.length !== 1) throw new Error("Governing Project Knowledge is ambiguous");
    const row = response.results[0];
    if (typeof row.record_id !== "string" || !COMPONENT.test(row.record_id) ||
        !GOVERNING_STATUSES.has(row.status) || typeof row.version !== "string" || !COMPONENT.test(row.version) ||
        typeof row.knowledge_json !== "string" || encoder.encode(row.knowledge_json).byteLength > MAX_KNOWLEDGE_BYTES ||
        !DIGEST.test(row.knowledge_digest ?? "")) {
      throw new Error("Governing Project Knowledge record is invalid");
    }
    const knowledge = parseJsonStrict(row.knowledge_json);
    if (!knowledge || typeof knowledge !== "object" || Array.isArray(knowledge) ||
        canonicalize(knowledge) !== row.knowledge_json) {
      throw new Error("Governing Project Knowledge must be one canonical JSON object");
    }
    assertNoSecretFields(knowledge);
    const digestRecord = {
      recordId: row.record_id,
      status: row.status,
      version: row.version,
      scope: this.scope,
      knowledge,
    };
    if (await digestCanonicalValue(digestRecord) !== row.knowledge_digest) {
      throw new Error("Governing Project Knowledge integrity check failed");
    }
    return freeze({
      ...digestRecord,
      digest: row.knowledge_digest,
      retrievedAt: lookup.retrievedAt,
      actionDigest: request.actionDigest,
    });
  }
}
