import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import {
  assertDevelopmentAuthorityMigrationExecutionRecord,
  ORDERED_AUTHORITY_MIGRATIONS,
} from "../src/development-authority-migration-execution-record.js";

const schema = parseJsonStrict(await readFile("schemas/development-authority-migration-execution-record.schema.json", "utf8"));
const executionRecord = parseJsonStrict(await readFile("deployment/development-authority-migration-execution-record.json", "utf8"));
const clone = (value) => structuredClone(value);

function fixture(status = "COMPLETED") {
  const completed = status === "COMPLETED";
  const partial = status === "STOPPED_PARTIAL";
  return {
    schemaVersion: "1.0.0", status, governing: false, environment: "development",
    source: {
      reviewedCommit: "b2e3188b28b7c9071e267e69e90c374650747035",
      packetPath: "deployment/development-authority-migration-execution-packet.json",
      packetSha256: "ab865340c48279e6e5654e8e6b0ed52cb9d4af28115c49b47d787ad1ec205d8a",
    },
    authorization: {
      ownerDecisionId: "fixture-owner-decision", ownerAuthorizationDigest: `sha256:${"a".repeat(64)}`,
      accountId: "de5e0273347b0b4c5f8f4e554aa2288f", executionAuthorized: true, authorizedAttemptLimit: 1,
    },
    operator: { principalId: "fixture-operator", authenticatedAccountId: "de5e0273347b0b4c5f8f4e554aa2288f" },
    preflight: {
      completed: completed || partial, databaseName: completed || partial ? "8978-ai-authority-dev" : null,
      databaseId: completed || partial ? "741ade94-8539-4fc8-b6be-24884720dee8" : null,
      region: completed || partial ? "WNAM" : null, jurisdiction: null,
      version: completed || partial ? "production" : null, tableCount: completed || partial ? 0 : null,
      fileSizeBytes: completed || partial ? 12288 : null,
      identityMatched: completed || partial, emptyStateMatched: completed || partial,
    },
    backup: {
      bookmarkCaptured: completed || partial, bookmark: completed || partial ? "fixture-bookmark" : null,
      exportCaptured: completed || partial, exportSha256: completed || partial ? "b".repeat(64) : null,
      exportSizeBytes: completed || partial ? 12288 : null, exportCommitted: false,
    },
    migration: {
      attemptCount: completed || partial ? 1 : 0,
      applyCommand: "wrangler d1 migrations apply 8978-ai-authority-dev --remote --config deployment/wrangler.authority-migrations.jsonc",
      invoked: completed || partial, outcome: completed ? "SUCCEEDED" : partial ? "INTERRUPTED" : "NOT_INVOKED",
      pendingBefore: completed || partial ? [...ORDERED_AUTHORITY_MIGRATIONS] : null,
      applied: completed ? [...ORDERED_AUTHORITY_MIGRATIONS] : partial ? ORDERED_AUTHORITY_MIGRATIONS.slice(0, 2) : [],
      pendingAfter: completed ? [] : partial ? ORDERED_AUTHORITY_MIGRATIONS.slice(2) : null,
    },
    postState: {
      retrieved: completed, tableCount: completed ? 11 : null, fileSizeBytes: completed ? 65536 : null,
      migrationsApplied: completed, migrationBookkeepingRowsCreated: completed || partial, remoteSchemaVerified: false,
    },
    externalEffects: {
      runtimeBindingInstalled: false, workerCreatedOrDeployed: false, workflowCreatedOrTriggered: false,
      queueConnectedOrPublished: false, secretOrKeyChanged: false, authorityDataWritten: false,
      projectKnowledgeSeeded: false, activationEvidenceWritten: false, activationPlanUpdated: false,
      deploymentActivated: false, productionOrCustomerResourceTouched: false,
    },
    partialFailurePolicy: { restoreAttempted: false, retryAttempted: false, cleanupAttempted: false, deletionAttempted: false },
    errors: completed ? [] : [partial ? "fixture interrupted result" : "fixture preflight stop"],
    recordedAt: "2026-08-18T21:00:00.000Z",
  };
}

test("actual completed record preserves the exact successful migration boundary", () => {
  assert.equal(assertDevelopmentAuthorityMigrationExecutionRecord(schema, executionRecord), true);
  assert.equal(executionRecord.authorization.ownerDecisionId, "github-workflow-dispatch-32901834491");
  assert.equal(executionRecord.operator.principalId, "github:jhutchison2222");
  assert.equal(executionRecord.preflight.tableCount, 0);
  assert.equal(executionRecord.backup.exportCommitted, false);
  assert.deepEqual(executionRecord.migration.pendingBefore, ORDERED_AUTHORITY_MIGRATIONS);
  assert.deepEqual(executionRecord.migration.applied, ORDERED_AUTHORITY_MIGRATIONS);
  assert.deepEqual(executionRecord.migration.pendingAfter, []);
  assert.equal(executionRecord.postState.tableCount, 11);
  assert.equal(executionRecord.postState.remoteSchemaVerified, false);
  assert.deepEqual(executionRecord.errors, []);
});

test("contract accepts exact completed, no-mutation, and partial-stop fixtures", () => {
  for (const status of ["COMPLETED", "STOPPED_NO_MUTATION", "STOPPED_PARTIAL"]) {
    assert.equal(assertDevelopmentAuthorityMigrationExecutionRecord(schema, fixture(status)), true);
  }
});

test("completed result requires exact backups, migration order, and post-state", () => {
  const mutations = [
    (r) => { r.backup.bookmarkCaptured = false; },
    (r) => { r.backup.exportSha256 = null; },
    (r) => { r.migration.attemptCount = 2; },
    (r) => { r.migration.pendingBefore.reverse(); },
    (r) => { r.migration.applied.pop(); },
    (r) => { r.migration.pendingAfter = [ORDERED_AUTHORITY_MIGRATIONS[5]]; },
    (r) => { r.postState.tableCount = 10; },
    (r) => { r.postState.migrationsApplied = false; },
    (r) => { r.errors.push("invented warning"); },
  ];
  for (const mutate of mutations) {
    const changed = clone(fixture()); mutate(changed);
    assert.throws(() => assertDevelopmentAuthorityMigrationExecutionRecord(schema, changed));
  }
});

test("stopped outcomes cannot promote uncertain state or hide invocation", () => {
  const mutations = [
    ["STOPPED_NO_MUTATION", (r) => { r.migration.invoked = true; }],
    ["STOPPED_NO_MUTATION", (r) => { r.migration.attemptCount = 1; }],
    ["STOPPED_NO_MUTATION", (r) => { r.postState.migrationBookkeepingRowsCreated = true; }],
    ["STOPPED_PARTIAL", (r) => { r.migration.outcome = "SUCCEEDED"; }],
    ["STOPPED_PARTIAL", (r) => { r.postState.migrationsApplied = true; }],
    ["STOPPED_PARTIAL", (r) => { r.errors = []; }],
    ["STOPPED_PARTIAL", (r) => { r.migration.applied = [ORDERED_AUTHORITY_MIGRATIONS[1]]; }],
    ["STOPPED_PARTIAL", (r) => { r.migration.applied = [...ORDERED_AUTHORITY_MIGRATIONS]; r.migration.pendingAfter = []; }],
    ["STOPPED_PARTIAL", (r) => { r.postState.migrationBookkeepingRowsCreated = false; }],
    ["STOPPED_PARTIAL", (r) => { r.postState.tableCount = 11; }],
  ];
  for (const [status, mutate] of mutations) {
    const changed = clone(fixture(status)); mutate(changed);
    assert.throws(() => assertDevelopmentAuthorityMigrationExecutionRecord(schema, changed));
  }
});

test("no-mutation stop preserves unexpected account or D1 observations without invoking", () => {
  const stopped = fixture("STOPPED_NO_MUTATION");
  stopped.operator.authenticatedAccountId = "unexpected-account";
  stopped.preflight.databaseName = null;
  stopped.preflight.databaseId = null;
  stopped.preflight.region = null;
  stopped.preflight.version = null;
  stopped.preflight.tableCount = null;
  stopped.preflight.fileSizeBytes = null;
  assert.equal(assertDevelopmentAuthorityMigrationExecutionRecord(schema, stopped), true);

  for (const status of ["COMPLETED", "STOPPED_PARTIAL"]) {
    const invoked = fixture(status);
    invoked.operator.authenticatedAccountId = "unexpected-account";
    assert.throws(() => assertDevelopmentAuthorityMigrationExecutionRecord(schema, invoked));
  }
});

test("every outcome rejects identity drift and adjacent external effects", () => {
  const mutations = [
    (r) => { r.source.reviewedCommit = "0".repeat(40); },
    (r) => { r.source.packetSha256 = "0".repeat(64); },
    (r) => { r.authorization.accountId = "wrong"; },
    (r) => { r.postState.remoteSchemaVerified = true; },
    (r) => { r.externalEffects.runtimeBindingInstalled = true; },
    (r) => { r.externalEffects.authorityDataWritten = true; },
    (r) => { r.externalEffects.deploymentActivated = true; },
    (r) => { r.partialFailurePolicy.restoreAttempted = true; },
    (r) => { r.partialFailurePolicy.retryAttempted = true; },
    (r) => { r.unexpected = true; },
  ];
  for (const status of ["COMPLETED", "STOPPED_NO_MUTATION", "STOPPED_PARTIAL"]) {
    for (const mutate of mutations) {
      const changed = clone(fixture(status)); mutate(changed);
      assert.throws(() => assertDevelopmentAuthorityMigrationExecutionRecord(schema, changed));
    }
  }
  for (const status of ["COMPLETED", "STOPPED_PARTIAL"]) {
    for (const mutate of [
      (r) => { r.operator.authenticatedAccountId = "wrong"; },
      (r) => { r.preflight.databaseId = "wrong"; },
    ]) {
      const changed = clone(fixture(status)); mutate(changed);
      assert.throws(() => assertDevelopmentAuthorityMigrationExecutionRecord(schema, changed));
    }
  }
});
