import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const packet = await load("deployment/development-authority-schema-inventory-verification-packet.json");
const schema = await load("schemas/development-authority-schema-inventory-verification-packet.schema.json");
const migrationRecord = await load("deployment/development-authority-migration-execution-record.json");
const migrationPaths = Array.from({ length: 6 }, (_, index) => `migrations/authority/000${index + 1}_${[
  "authority_read_model", "validation_evidence", "governing_project_knowledge", "owner_control",
  "development_activation_evidence", "development_activation_evidence_writes",
][index]}.sql`);

const expectedTables = packet.expectedInventory.tables.filter((name) => name !== "d1_migrations");
const expectedIndexes = packet.expectedInventory.indexes;

test("schema inventory packet remains non-executing after accepting the completed migration record", async () => {
  assert.deepEqual(validateSchema(schema, packet), []);
  assert.equal(packet.status, "PLANNED");
  assert.equal(packet.governing, false);
  assert.equal(packet.executionAuthorized, false);
  assert.equal(packet.account.accountId, null);
  assert.equal(packet.prerequisite.recordSha256, await digest(packet.prerequisite.executionRecordPath));
  assert.equal(packet.prerequisite.satisfied, true);
  assert.equal(migrationRecord.status, packet.prerequisite.requiredStatus);
  assert.equal(await digest(packet.sourceMigrationPacket.path), packet.sourceMigrationPacket.sha256);
  assert.equal(await digest(packet.sourceExecutionRecordContract.schemaPath), packet.sourceExecutionRecordContract.schemaSha256);
  assert.equal(await digest(packet.sourceExecutionRecordContract.validatorPath), packet.sourceExecutionRecordContract.validatorSha256);
});

test("expected table and index inventory is derived exactly from six pinned migrations", async () => {
  const tables = [];
  const indexes = [];
  for (const path of migrationPaths) {
    const sql = await readFile(path, "utf8");
    tables.push(...[...sql.matchAll(/^CREATE TABLE ([a-z0-9_]+)/gimu)].map((match) => match[1]));
    indexes.push(...[...sql.matchAll(/^CREATE (?:UNIQUE )?INDEX ([a-z0-9_]+)/gimu)].map((match) => match[1]));
  }
  assert.deepEqual(tables.sort(), [...expectedTables].sort());
  assert.deepEqual(indexes.sort(), [...expectedIndexes].sort());
  assert.equal(new Set(packet.expectedInventory.tables).size, 11);
  assert.equal(new Set(packet.expectedInventory.indexes).size, 10);
  assert.deepEqual(packet.expectedInventory.appliedMigrations, migrationPaths.map((path) => path.split("/").at(-1)));
});

test("all planned queries are read-only and cannot certify schema by themselves", () => {
  for (const [name, command] of Object.entries(packet.queries)) {
    if (name !== "databaseInfo") {
      assert.match(command, /^wrangler d1 execute 8978-ai-authority-dev --remote --config deployment\/wrangler\.authority-migrations\.jsonc --command /u);
      assert.match(command, / --json$/u);
      assert.equal(/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM)\b/iu.test(command), false);
      assert.match(command, /(?:SELECT|PRAGMA)/u);
    }
  }
  assert.equal(
    packet.queries.integrity,
    "wrangler d1 execute 8978-ai-authority-dev --remote --config deployment/wrangler.authority-migrations.jsonc --command \"PRAGMA quick_check\" --json",
  );
  assert.doesNotMatch(packet.queries.integrity, /integrity_check/u);
  assert.equal(Object.values(packet.resultBoundary).filter((value) => value === true).length, 2);
  assert.equal(packet.resultBoundary.remoteSchemaVerified, false);
  assert.equal(packet.resultBoundary.activationPlanUpdateDeferred, true);
  assert.equal(packet.resultBoundary.verificationRecordRequired, true);
});

test("schema rejects authorization, prerequisite, result, and adjacent-effect promotion", () => {
  const mutations = [
    (value) => { value.executionAuthorized = true; },
    (value) => { value.account.accountId = "de5e0273347b0b4c5f8f4e554aa2288f"; },
    (value) => { value.prerequisite.recordSha256 = "a".repeat(64); },
    (value) => { value.prerequisite.satisfied = false; },
    (value) => { value.authorityDatabase.databaseId = "wrong"; },
    (value) => { value.resultBoundary.inventoryVerified = true; },
    (value) => { value.resultBoundary.remoteSchemaVerified = true; },
    (value) => { value.resultBoundary.activationPlanUpdateDeferred = false; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(packet); mutate(changed);
    assert.notDeepEqual(validateSchema(schema, changed), []);
  }
});
