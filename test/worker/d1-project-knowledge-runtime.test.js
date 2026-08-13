import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalize, digestCanonicalValue } from "../../src/canonical-digest.js";
import { D1GoverningProjectKnowledgeReader } from "../../src/d1-project-knowledge-runtime.js";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const ACTION_DIGEST = `sha256:${"a".repeat(64)}`;
const farPast = Date.parse("2000-01-01T00:00:00.000Z");
const farFuture = Date.parse("2100-01-01T00:00:00.000Z");

async function insertKnowledge(overrides = {}) {
  const recordId = overrides.recordId ?? crypto.randomUUID();
  const status = overrides.status ?? "CURRENT";
  const version = overrides.version ?? "1";
  const scope = overrides.scope ?? "control-plane";
  const knowledge = overrides.knowledge ?? { directives: [{ id: "dev-read-only", value: true }] };
  const digestRecord = { recordId, status, version, scope, knowledge };
  await env.AUTHORITY_DB.prepare(`
    INSERT INTO authority_project_knowledge
      (record_id, knowledge_scope, status, governing, enabled, knowledge_json, knowledge_digest,
       valid_from_ms, valid_until_ms, version)
    VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9)
  `).bind(
    recordId, scope, status, overrides.enabled ?? 1,
    overrides.knowledgeJson ?? canonicalize(knowledge),
    overrides.knowledgeDigest ?? await digestCanonicalValue(digestRecord),
    overrides.validFromMs ?? farPast, overrides.validUntilMs ?? farFuture, version,
  ).run();
}

describe("read-only governing Project Knowledge runtime", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.AUTHORITY_DB, env.AUTHORITY_TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_project_knowledge").run();
  });

  it("returns one current canonical digest-verified governing snapshot bound to the action", async () => {
    await insertKnowledge({ recordId: "pk-governing-1" });
    const result = await new D1GoverningProjectKnowledgeReader(env.AUTHORITY_DB).readGoverningKnowledge({
      statuses: ["FINAL", "CURRENT"], actionDigest: ACTION_DIGEST,
    }, { now: NOW });
    expect(result).toMatchObject({
      recordId: "pk-governing-1", status: "CURRENT", version: "1", scope: "control-plane",
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), actionDigest: ACTION_DIGEST,
      retrievedAt: NOW.toISOString(), knowledge: { directives: [{ id: "dev-read-only", value: true }] },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.knowledge)).toBe(true);
  });

  it("rejects missing, disabled, expired, ambiguous, wrong-scope, and disallowed-status records", async () => {
    const reader = new D1GoverningProjectKnowledgeReader(env.AUTHORITY_DB);
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/unavailable/);
    await insertKnowledge({ enabled: 0 });
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_project_knowledge").run();
    await insertKnowledge({ validUntilMs: NOW.valueOf() });
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/unavailable/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_project_knowledge").run();
    await insertKnowledge(); await insertKnowledge();
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/ambiguous/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_project_knowledge").run();
    await insertKnowledge({ scope: "other-scope" });
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/unavailable/);
    await expect(reader.readGoverningKnowledge({ statuses: ["PROPOSED"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/CURRENT\/FINAL/);
  });

  it("rejects tampering, non-canonical or duplicate JSON, secret fields, oversized content, and forged requests", async () => {
    const reader = new D1GoverningProjectKnowledgeReader(env.AUTHORITY_DB);
    await insertKnowledge({ knowledgeDigest: `sha256:${"f".repeat(64)}` });
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/integrity/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_project_knowledge").run();
    await insertKnowledge({ knowledgeJson: JSON.stringify({ z: 1, a: 2 }) });
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/canonical/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_project_knowledge").run();
    await insertKnowledge({ knowledgeJson: '{"directives":[],"directives":[]}' });
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/Duplicate JSON object key/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_project_knowledge").run();
    await insertKnowledge({ knowledge: { nested: { api_key: "not-allowed" } } });
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/prohibited secret field/);
    await env.AUTHORITY_DB.prepare("DELETE FROM authority_project_knowledge").run();
    const oversized = canonicalize({ text: "x".repeat(262_144) });
    await insertKnowledge({ knowledgeJson: oversized });
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST }, { now: NOW })).rejects.toThrow(/invalid/);
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: "not-a-digest" }, { now: NOW })).rejects.toThrow(/action digest/);
    await expect(reader.readGoverningKnowledge({ statuses: ["CURRENT"], actionDigest: ACTION_DIGEST, scope: "forged" }, { now: NOW })).rejects.toThrow(/contain only/);
  });
});
