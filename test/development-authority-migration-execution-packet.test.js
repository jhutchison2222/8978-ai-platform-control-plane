import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { AUTHORITY_MIGRATIONS } from "../src/development-activation-preflight.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const packet = await load("deployment/development-authority-migration-execution-packet.json");
const schema = await load("schemas/development-authority-migration-execution-packet.schema.json");
const migrationConfig = await load("deployment/wrangler.authority-migrations.jsonc");

test("migration packet is exact, non-governing, and execution-disabled", async () => {
  assert.deepEqual(validateSchema(schema, packet), []);
  assert.equal(packet.status, "PLANNED");
  assert.equal(packet.governing, false);
  assert.equal(packet.executionAuthorized, false);
  assert.equal(packet.account.accountId, null);
  for (const source of [packet.sourcePlan, packet.sourceCompletionRecord]) {
    assert.equal(await digest(source.path), source.sha256);
  }
  assert.equal(await digest(packet.migrationConfiguration.path), packet.migrationConfiguration.sha256);
});

test("migration-only Wrangler configuration cannot deploy or install a runtime binding", () => {
  assert.equal(JSON.stringify(migrationConfig), JSON.stringify({
    $schema: "../node_modules/wrangler/config-schema.json",
    name: "8978-ai-authority-migrations-dev",
    compatibility_date: "2026-08-18",
    d1_databases: [{
      binding: "AUTHORITY_DB",
      database_name: "8978-ai-authority-dev",
      database_id: "741ade94-8539-4fc8-b6be-24884720dee8",
      migrations_dir: "../migrations/authority",
    }],
  }));
  assert.equal("main" in migrationConfig, false);
  assert.equal(packet.migrationConfiguration.deployableWorkerConfiguration, false);
  assert.equal(packet.migrationConfiguration.installsRuntimeBinding, false);
});

test("packet pins six ordered DDL-only authority migrations", async () => {
  assert.equal(JSON.stringify(packet.migration.migrations), JSON.stringify(AUTHORITY_MIGRATIONS));
  let tableCount = 0;
  for (const migration of packet.migration.migrations) {
    const sql = await readFile(migration.path, "utf8");
    assert.equal(await digest(migration.path), migration.sha256);
    assert.equal(/^\s*(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ATTACH|DETACH|VACUUM)\b/imu.test(sql), false);
    tableCount += (sql.match(/\bCREATE\s+TABLE\b/giu) ?? []).length;
  }
  assert.equal(tableCount, 10);
  assert.equal(packet.postMigrationBoundary.expectedTableCountIncludingMigrationBookkeeping, 11);
  assert.equal(packet.migration.insertsAuthorityData, false);
  assert.equal(packet.migration.seedsProjectKnowledge, false);
  assert.equal(packet.migration.writesActivationEvidence, false);
});

test("backup, one-attempt, and post-migration boundaries remain fail-closed", () => {
  assert.equal(packet.backup.timeTravelBookmarkRequired, true);
  assert.equal(packet.backup.sqlExportRequired, true);
  assert.equal(packet.backup.exportSha256Required, true);
  assert.equal(packet.backup.commitExportToRepository, false);
  assert.equal(packet.backup.restoreAuthorized, false);
  assert.equal(packet.backup.automaticRestoreAuthorized, false);
  assert.equal(packet.migration.attemptLimit, 1);
  assert.equal(packet.postMigrationBoundary.remoteSchemaVerified, false);
  assert.equal(packet.postMigrationBoundary.activationPlanUpdateDeferred, true);
  assert.equal(packet.partialFailurePolicy.automaticRestore, false);
  assert.equal(packet.partialFailurePolicy.automaticRetry, false);
  assert.equal(packet.partialFailurePolicy.automaticCleanup, false);
});

test("schema rejects authorization, identity drift, weakened recovery, retry, and fabricated completion", () => {
  const mutations = [
    (value) => { value.executionAuthorized = true; },
    (value) => { value.account.accountId = "de5e0273347b0b4c5f8f4e554aa2288f"; },
    (value) => { value.authorityDatabase.databaseId = "invented"; },
    (value) => { value.authorityDatabase.expectedRegion = "ENAM"; },
    (value) => { value.backup.timeTravelBookmarkRequired = false; },
    (value) => { value.backup.sqlExportRequired = false; },
    (value) => { value.backup.restoreAuthorized = true; },
    (value) => { value.backup.automaticRestoreAuthorized = true; },
    (value) => { value.migration.attemptLimit = 2; },
    (value) => { value.migration.insertsAuthorityData = true; },
    (value) => { value.migration.writesActivationEvidence = true; },
    (value) => { value.postMigrationBoundary.remoteSchemaVerified = true; },
    (value) => { value.partialFailurePolicy.automaticRetry = true; },
    (value) => { value.partialFailurePolicy.automaticCleanup = true; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(packet); mutate(changed);
    assert.notDeepEqual(validateSchema(schema, changed), []);
  }
});
