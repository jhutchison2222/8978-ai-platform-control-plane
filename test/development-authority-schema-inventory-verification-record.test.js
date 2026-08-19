import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import {
  assertDevelopmentAuthoritySchemaInventoryVerificationRecord,
  EXPECTED_AUTHORITY_INDEXES,
  EXPECTED_AUTHORITY_MIGRATIONS,
  EXPECTED_AUTHORITY_TABLES,
  ORDERED_SCHEMA_INVENTORY_QUERIES,
} from "../src/development-authority-schema-inventory-verification-record.js";

const schema = parseJsonStrict(await readFile("schemas/development-authority-schema-inventory-verification-record.schema.json", "utf8"));
const clone = (value) => structuredClone(value);
const allFalse = (keys) => Object.fromEntries(keys.map((key) => [key, false]));

function fixture(status = "VERIFIED") {
  const verified = status === "VERIFIED";
  const inconclusive = status === "INCONCLUSIVE_READ_ONLY";
  const invoked = verified || inconclusive;
  const observed = verified;
  const databaseObserved = verified || inconclusive;
  return {
    schemaVersion: "1.0.0", status, governing: false, environment: "development",
    source: {
      reviewedCommit: "fb0812cf84508602904dc556ebde5f1f6c88c7a3",
      packetPath: "deployment/development-authority-schema-inventory-verification-packet.json",
      packetSha256: "0d4db909103fffbc81b70d09335dcf44f84261fd8593234b242f035cde49c0c8",
      authorizedAccountId: "de5e0273347b0b4c5f8f4e554aa2288f",
    },
    authorization: {
      ownerDecisionId: invoked ? "fixture-owner-decision" : null,
      ownerAuthorizationDigest: invoked ? `sha256:${"a".repeat(64)}` : null,
      accountId: invoked ? "de5e0273347b0b4c5f8f4e554aa2288f" : null,
      readOnlyVerificationAuthorized: invoked, authorizedAttemptLimit: invoked ? 1 : 0,
    },
    operator: { principalId: "fixture-operator", authenticatedAccountId: invoked ? "de5e0273347b0b4c5f8f4e554aa2288f" : null },
    prerequisite: {
      executionRecordPath: "deployment/development-authority-migration-execution-record.json",
      executionRecordSha256: invoked ? "b".repeat(64) : null,
      status: invoked ? "COMPLETED" : null, independentlyAccepted: invoked,
    },
    execution: {
      attemptCount: invoked ? 1 : 0, invoked,
      commandsInvoked: verified ? [...ORDERED_SCHEMA_INVENTORY_QUERIES] : inconclusive ? ["databaseInfo"] : [],
      outcome: verified ? "SUCCEEDED" : inconclusive ? "INTERRUPTED" : "NOT_INVOKED",
    },
    evidence: { queryResultSha256: Object.fromEntries(ORDERED_SCHEMA_INVENTORY_QUERIES.map((key, index) =>
      [key, verified || (inconclusive && index === 0) ? `${index + 1}`.repeat(64) : null])) },
    observations: {
      database: {
        retrieved: databaseObserved, name: databaseObserved ? "8978-ai-authority-dev" : null,
        databaseId: databaseObserved ? "741ade94-8539-4fc8-b6be-24884720dee8" : null,
        region: databaseObserved ? "WNAM" : null, jurisdiction: null,
        version: databaseObserved ? "production" : null, identityMatched: databaseObserved,
      },
      definitions: {
        retrieved: observed, tables: observed ? [...EXPECTED_AUTHORITY_TABLES] : null,
        indexes: observed ? [...EXPECTED_AUTHORITY_INDEXES] : null,
        definitionsSha256: observed ? "c".repeat(64) : null,
      },
      migrations: { retrieved: observed, names: observed ? [...EXPECTED_AUTHORITY_MIGRATIONS] : null },
      foreignKey: {
        retrieved: observed,
        fromTable: observed ? "authority_development_activation_evidence_writes" : null,
        toTable: observed ? "authority_development_activation_evidence_bundles" : null,
        fromColumn: observed ? "record_id" : null, toColumn: observed ? "record_id" : null,
        onUpdate: observed ? "RESTRICT" : null, onDelete: observed ? "RESTRICT" : null, matched: observed,
      },
      integrity: { retrieved: observed, result: observed ? "ok" : null },
      authorityData: { retrieved: observed, rowCount: observed ? 0 : null },
    },
    independentReview: {
      completed: verified, checkerPrincipalId: verified ? "fixture-independent-checker" : null,
      checkerDigest: verified ? `sha256:${"d".repeat(64)}` : null, accepted: verified,
    },
    conclusions: verified ? {
      inventoryVerified: true, definitionsVerified: true, foreignKeysVerified: true,
      integrityVerified: true, emptyAuthorityDataVerified: true, remoteSchemaVerified: true,
      activationPlanUpdateAuthorized: false, activationPlanUpdated: false,
    } : allFalse(["inventoryVerified", "definitionsVerified", "foreignKeysVerified", "integrityVerified",
      "emptyAuthorityDataVerified", "remoteSchemaVerified", "activationPlanUpdateAuthorized", "activationPlanUpdated"]),
    externalEffects: allFalse(["mutatingSqlExecuted", "migrationAppliedOrCreated", "runtimeBindingInstalled",
      "workerCreatedOrDeployed", "workflowCreatedOrTriggered", "queueConnectedOrPublished", "secretOrKeyChanged",
      "authorityDataWritten", "projectKnowledgeSeeded", "activationEvidenceWritten", "deploymentActivated",
      "productionOrCustomerResourceTouched"]),
    failurePolicy: allFalse(["restoreAttempted", "retryAttempted", "cleanupAttempted", "deletionAttempted"]),
    errors: verified ? [] : [inconclusive ? "fixture interrupted read-only pass" : "fixture authorization unavailable"],
    recordedAt: "2026-08-18T22:30:00.000Z",
  };
}

test("contract accepts verified, no-query stop, and inconclusive read-only fixtures", () => {
  for (const status of ["VERIFIED", "STOPPED_NO_QUERY", "INCONCLUSIVE_READ_ONLY"]) {
    assert.equal(assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, fixture(status)), true);
  }
});

test("verified result requires exact complete evidence and independent acceptance", () => {
  const mutations = [
    (r) => { r.execution.commandsInvoked.pop(); },
    (r) => { r.evidence.queryResultSha256.definitions = null; },
    (r) => { r.observations.database.databaseId = "wrong"; },
    (r) => { r.observations.definitions.tables.pop(); },
    (r) => { r.observations.definitions.indexes.reverse(); },
    (r) => { r.observations.migrations.names.reverse(); },
    (r) => { r.observations.foreignKey.onDelete = "CASCADE"; },
    (r) => { r.observations.integrity.result = "error"; },
    (r) => { r.observations.authorityData.rowCount = 1; },
    (r) => { r.independentReview.checkerPrincipalId = r.operator.principalId; },
    (r) => { r.independentReview.accepted = false; },
    (r) => { r.conclusions.remoteSchemaVerified = false; },
  ];
  for (const mutate of mutations) {
    const changed = clone(fixture()); mutate(changed);
    assert.throws(() => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, changed));
  }
  for (const checkerPrincipalId of [null, ""]) {
    const changed = clone(fixture());
    changed.independentReview.checkerPrincipalId = checkerPrincipalId;
    const semanticSchema = clone(schema);
    delete semanticSchema.properties.independentReview.properties.checkerPrincipalId.minLength;
    assert.throws(
      () => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(semanticSchema, changed),
      /^Error: Verified schema record lacks exact read-only evidence or independent acceptance$/u,
    );
  }
});

test("stopped and inconclusive results cannot promote verification or hide query state", () => {
  const mutations = [
    ["STOPPED_NO_QUERY", (r) => { r.execution.invoked = true; }],
    ["STOPPED_NO_QUERY", (r) => { r.execution.commandsInvoked = ["databaseInfo"]; }],
    ["STOPPED_NO_QUERY", (r) => { r.evidence.queryResultSha256.databaseInfo = "e".repeat(64); }],
    ["STOPPED_NO_QUERY", (r) => { r.conclusions.inventoryVerified = true; }],
    ["INCONCLUSIVE_READ_ONLY", (r) => { r.execution.commandsInvoked = []; }],
    ["INCONCLUSIVE_READ_ONLY", (r) => { r.execution.commandsInvoked = ["definitions"]; }],
    ["INCONCLUSIVE_READ_ONLY", (r) => { r.evidence.queryResultSha256.definitions = "f".repeat(64); }],
    ["INCONCLUSIVE_READ_ONLY", (r) => { r.observations.definitions.retrieved = true; r.observations.definitions.tables = []; r.observations.definitions.indexes = []; r.observations.definitions.definitionsSha256 = "f".repeat(64); }],
    ["INCONCLUSIVE_READ_ONLY", (r) => { r.conclusions.remoteSchemaVerified = true; }],
    ["INCONCLUSIVE_READ_ONLY", (r) => { r.independentReview.accepted = true; }],
    ["INCONCLUSIVE_READ_ONLY", (r) => { r.errors = []; }],
  ];
  for (const [status, mutate] of mutations) {
    const changed = clone(fixture(status)); mutate(changed);
    assert.throws(() => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, changed));
  }
});

test("query result digests match retrieved observations and successful execution is complete", () => {
  const successfulInconclusive = clone(fixture("VERIFIED"));
  successfulInconclusive.status = "INCONCLUSIVE_READ_ONLY";
  successfulInconclusive.independentReview = {
    completed: false, checkerPrincipalId: null, checkerDigest: null, accepted: false,
  };
  successfulInconclusive.conclusions = allFalse([
    "inventoryVerified", "definitionsVerified", "foreignKeysVerified", "integrityVerified",
    "emptyAuthorityDataVerified", "remoteSchemaVerified", "activationPlanUpdateAuthorized", "activationPlanUpdated",
  ]);
  successfulInconclusive.errors = ["fixture independent review unavailable"];
  assert.equal(assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, successfulInconclusive), true);

  const digestWithoutObservation = clone(fixture("INCONCLUSIVE_READ_ONLY"));
  digestWithoutObservation.observations.database = {
    retrieved: false, name: null, databaseId: null, region: null, jurisdiction: null, version: null,
    identityMatched: false,
  };
  assert.throws(
    () => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, digestWithoutObservation),
    /^Error: Schema query result evidence must match its retrieved observation$/u,
  );

  const observationWithoutDigest = clone(fixture("INCONCLUSIVE_READ_ONLY"));
  observationWithoutDigest.evidence.queryResultSha256.databaseInfo = null;
  assert.throws(
    () => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, observationWithoutDigest),
    /^Error: Schema query result evidence must match its retrieved observation$/u,
  );

  const incompleteSuccess = clone(fixture("INCONCLUSIVE_READ_ONLY"));
  incompleteSuccess.execution.outcome = "SUCCEEDED";
  assert.throws(
    () => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, incompleteSuccess),
    /^Error: Successful schema verification execution must carry every reviewed query result$/u,
  );
});

test("partial query result evidence forms an ordered prefix", () => {
  const interruptedAfterSecondInvocation = clone(fixture("INCONCLUSIVE_READ_ONLY"));
  interruptedAfterSecondInvocation.execution.commandsInvoked.push("definitions");
  assert.equal(
    assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, interruptedAfterSecondInvocation),
    true,
  );

  const gappedEvidence = clone(interruptedAfterSecondInvocation);
  gappedEvidence.evidence.queryResultSha256.databaseInfo = null;
  gappedEvidence.observations.database = {
    retrieved: false, name: null, databaseId: null, region: null, jurisdiction: null, version: null,
    identityMatched: false,
  };
  gappedEvidence.evidence.queryResultSha256.definitions = "e".repeat(64);
  gappedEvidence.observations.definitions = {
    retrieved: true, tables: [], indexes: [], definitionsSha256: "f".repeat(64),
  };
  assert.throws(
    () => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, gappedEvidence),
    /^Error: Schema query result evidence must form an ordered prefix$/u,
  );
});

test("invoked outcomes require exact authorization and accepted migration evidence", () => {
  for (const status of ["VERIFIED", "INCONCLUSIVE_READ_ONLY"]) {
    for (const mutate of [
      (r) => { r.authorization.readOnlyVerificationAuthorized = false; },
      (r) => { r.authorization.ownerDecisionId = ""; },
      (r) => { r.authorization.ownerAuthorizationDigest = null; },
      (r) => { r.authorization.accountId = "wrong"; },
      (r) => { r.operator.authenticatedAccountId = "wrong"; },
      (r) => { r.prerequisite.executionRecordSha256 = null; },
      (r) => { r.prerequisite.independentlyAccepted = false; },
    ]) {
      const changed = clone(fixture(status)); mutate(changed);
      assert.throws(() => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, changed));
    }
  }

  const schemaWithoutOwnerDecisionMinLength = clone(schema);
  delete schemaWithoutOwnerDecisionMinLength.properties.authorization.properties.ownerDecisionId.minLength;
  for (const status of ["VERIFIED", "INCONCLUSIVE_READ_ONLY"]) {
    const changed = clone(fixture(status));
    changed.authorization.ownerDecisionId = "";
    assert.throws(
      () => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schemaWithoutOwnerDecisionMinLength, changed),
      /^Error: Read-only schema verification requires exact authorization, account identity, and accepted migration evidence$/u,
    );
  }
});

test("independent review completion requires exact identified checker evidence", () => {
  const reviewed = fixture("INCONCLUSIVE_READ_ONLY");
  reviewed.independentReview = {
    completed: true,
    checkerPrincipalId: "fixture-independent-checker",
    checkerDigest: `sha256:${"d".repeat(64)}`,
    accepted: false,
  };
  assert.equal(assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, reviewed), true);

  for (const mutate of [
    (r) => { r.independentReview.checkerPrincipalId = null; },
    (r) => { r.independentReview.checkerDigest = null; },
    (r) => { r.independentReview.completed = false; },
    (r) => { r.independentReview.checkerPrincipalId = r.operator.principalId; },
  ]) {
    const changed = clone(reviewed); mutate(changed);
    assert.throws(() => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, changed));
  }

  for (const mutate of [
    (r) => { r.independentReview.checkerPrincipalId = "fixture-independent-checker"; },
    (r) => { r.independentReview.checkerDigest = `sha256:${"d".repeat(64)}`; },
  ]) {
    const changed = clone(fixture("INCONCLUSIVE_READ_ONLY")); mutate(changed);
    assert.throws(
      () => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, changed),
      /^Error: Schema verification independent review completion must match identified checker evidence$/u,
    );
  }

  const schemaWithoutCheckerMinLength = clone(schema);
  delete schemaWithoutCheckerMinLength.properties.independentReview.properties.checkerPrincipalId.minLength;
  const emptyChecker = clone(reviewed);
  emptyChecker.independentReview.checkerPrincipalId = "";
  assert.throws(
    () => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schemaWithoutCheckerMinLength, emptyChecker),
    /^Error: Schema verification independent review completion must match identified checker evidence$/u,
  );
});

test("every outcome rejects source drift and adjacent effects", () => {
  const mutations = [
    (r) => { r.source.reviewedCommit = "0".repeat(40); },
    (r) => { r.source.packetSha256 = "0".repeat(64); },
    (r) => { r.externalEffects.mutatingSqlExecuted = true; },
    (r) => { r.externalEffects.runtimeBindingInstalled = true; },
    (r) => { r.externalEffects.activationEvidenceWritten = true; },
    (r) => { r.failurePolicy.retryAttempted = true; },
    (r) => { r.conclusions.activationPlanUpdateAuthorized = true; },
    (r) => { r.unexpected = true; },
  ];
  for (const status of ["VERIFIED", "STOPPED_NO_QUERY", "INCONCLUSIVE_READ_ONLY"]) {
    for (const mutate of mutations) {
      const changed = clone(fixture(status)); mutate(changed);
      assert.throws(() => assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, changed));
    }
  }
});
