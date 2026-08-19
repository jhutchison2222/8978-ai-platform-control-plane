import { validateSchema } from "../scripts/json-schema-lite.js";

export const REVIEWED_SCHEMA_INVENTORY_PACKET_COMMIT = "fb0812cf84508602904dc556ebde5f1f6c88c7a3";
export const REVIEWED_SCHEMA_INVENTORY_PACKET_SHA256 = "0d4db909103fffbc81b70d09335dcf44f84261fd8593234b242f035cde49c0c8";
export const AUTHORIZED_DEVELOPMENT_ACCOUNT_ID = "de5e0273347b0b4c5f8f4e554aa2288f";
export const ORDERED_SCHEMA_INVENTORY_QUERIES = Object.freeze([
  "databaseInfo", "definitions", "appliedMigrations", "foreignKeys", "integrity", "authorityRows",
]);
export const EXPECTED_AUTHORITY_TABLES = Object.freeze([
  "authority_development_activation_evidence_bundles",
  "authority_development_activation_evidence_writes",
  "authority_identity_keys",
  "authority_limits",
  "authority_owner_keys",
  "authority_project_knowledge",
  "authority_resources",
  "authority_rollbacks",
  "authority_standing_state",
  "authority_test_evidence",
  "d1_migrations",
]);
export const EXPECTED_AUTHORITY_INDEXES = Object.freeze([
  "authority_activation_evidence_active_commit",
  "authority_activation_evidence_write_nonce",
  "authority_identity_keys_active_key",
  "authority_limits_active_resource_operation",
  "authority_owner_keys_active_key",
  "authority_project_knowledge_active_scope",
  "authority_resources_active_locator",
  "authority_rollbacks_active_reference",
  "authority_standing_state_active_policy",
  "authority_test_evidence_active_action",
]);
export const EXPECTED_AUTHORITY_MIGRATIONS = Object.freeze([
  "0001_authority_read_model.sql",
  "0002_validation_evidence.sql",
  "0003_governing_project_knowledge.sql",
  "0004_owner_control.sql",
  "0005_development_activation_evidence.sql",
  "0006_development_activation_evidence_writes.sql",
]);
const OBSERVATION_BY_QUERY = Object.freeze({
  databaseInfo: "database",
  definitions: "definitions",
  appliedMigrations: "migrations",
  foreignKeys: "foreignKey",
  integrity: "integrity",
  authorityRows: "authorityData",
});

function exactList(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} must match the exact reviewed order`);
}

function assertObservationConsistency(record) {
  const pairs = [
    [record.observations.database.retrieved, ["name", "databaseId", "region", "version"]],
    [record.observations.definitions.retrieved, ["tables", "indexes", "definitionsSha256"]],
    [record.observations.migrations.retrieved, ["names"]],
    [record.observations.foreignKey.retrieved, ["fromTable", "toTable", "fromColumn", "toColumn", "onUpdate", "onDelete"]],
    [record.observations.integrity.retrieved, ["result"]],
    [record.observations.authorityData.retrieved, ["rowCount"]],
  ];
  const objects = [record.observations.database, record.observations.definitions, record.observations.migrations,
    record.observations.foreignKey, record.observations.integrity, record.observations.authorityData];
  for (let index = 0; index < pairs.length; index += 1) {
    const [retrieved, fields] = pairs[index];
    if (!retrieved && fields.some((field) => objects[index][field] !== null)) {
      throw new Error("Unavailable schema observation cannot contain retrieved evidence");
    }
    if (retrieved && fields.some((field) => objects[index][field] === null)) {
      throw new Error("Retrieved schema observation must contain complete evidence");
    }
  }
  if (!record.observations.database.retrieved && (record.observations.database.jurisdiction !== null ||
      record.observations.database.identityMatched)) throw new Error("Unavailable database metadata cannot claim identity evidence");
  if (!record.observations.foreignKey.retrieved && record.observations.foreignKey.matched) {
    throw new Error("Unavailable foreign-key evidence cannot claim a match");
  }
}

function assertQueryEvidenceConsistency(record) {
  for (const queryName of ORDERED_SCHEMA_INVENTORY_QUERIES) {
    const digested = typeof record.evidence.queryResultSha256[queryName] === "string";
    const retrieved = record.observations[OBSERVATION_BY_QUERY[queryName]].retrieved;
    if (digested !== retrieved) {
      throw new Error("Schema query result evidence must match its retrieved observation");
    }
  }
  if (record.execution.outcome === "SUCCEEDED" &&
      (record.execution.commandsInvoked.length !== ORDERED_SCHEMA_INVENTORY_QUERIES.length ||
       ORDERED_SCHEMA_INVENTORY_QUERIES.some((queryName) =>
         typeof record.evidence.queryResultSha256[queryName] !== "string"))) {
    throw new Error("Successful schema verification execution must carry every reviewed query result");
  }
}

function assertNoAdjacentEffects(record) {
  if (Object.values(record.externalEffects).some((value) => value !== false) ||
      Object.values(record.failurePolicy).some((value) => value !== false)) {
    throw new Error("Schema verification record cannot claim writes, adjacent effects, retries, or cleanup");
  }
  if (record.conclusions.activationPlanUpdateAuthorized || record.conclusions.activationPlanUpdated) {
    throw new Error("Schema verification record cannot authorize or perform activation-plan updates");
  }
}

function assertIndependentReviewConsistency(record) {
  const identified = typeof record.independentReview.checkerPrincipalId === "string" &&
    record.independentReview.checkerPrincipalId.length > 0;
  const digested = typeof record.independentReview.checkerDigest === "string";
  if (identified !== digested || record.independentReview.completed !== (identified && digested)) {
    throw new Error("Schema verification independent review completion must match identified checker evidence");
  }
  if (record.independentReview.accepted && !record.independentReview.completed) {
    throw new Error("Schema verification cannot claim acceptance without completed independent review");
  }
  if (identified && record.independentReview.checkerPrincipalId === record.operator.principalId) {
    throw new Error("Schema verification checker must be independent of the operator");
  }
}

function assertInvocationPrerequisites(record) {
  if (!record.authorization.readOnlyVerificationAuthorized || record.authorization.authorizedAttemptLimit !== 1 ||
      typeof record.authorization.ownerDecisionId !== "string" ||
      record.authorization.ownerDecisionId.length === 0 ||
      typeof record.authorization.ownerAuthorizationDigest !== "string" ||
      record.authorization.accountId !== AUTHORIZED_DEVELOPMENT_ACCOUNT_ID ||
      record.operator.authenticatedAccountId !== AUTHORIZED_DEVELOPMENT_ACCOUNT_ID ||
      !record.prerequisite.independentlyAccepted || record.prerequisite.status !== "COMPLETED" ||
      typeof record.prerequisite.executionRecordSha256 !== "string") {
    throw new Error("Read-only schema verification requires exact authorization, account identity, and accepted migration evidence");
  }
}

function assertVerified(record) {
  assertInvocationPrerequisites(record);
  exactList(record.execution.commandsInvoked, ORDERED_SCHEMA_INVENTORY_QUERIES, "Invoked schema queries");
  if (record.execution.attemptCount !== 1 || !record.execution.invoked || record.execution.outcome !== "SUCCEEDED" ||
      Object.values(record.evidence.queryResultSha256).some((value) => typeof value !== "string") ||
      !record.observations.database.retrieved || record.observations.database.name !== "8978-ai-authority-dev" ||
      record.observations.database.databaseId !== "741ade94-8539-4fc8-b6be-24884720dee8" ||
      record.observations.database.region !== "WNAM" || record.observations.database.jurisdiction !== null ||
      record.observations.database.version !== "production" || !record.observations.database.identityMatched ||
      !record.observations.definitions.retrieved || !record.observations.migrations.retrieved ||
      !record.observations.foreignKey.retrieved || !record.observations.foreignKey.matched ||
      record.observations.foreignKey.fromTable !== "authority_development_activation_evidence_writes" ||
      record.observations.foreignKey.toTable !== "authority_development_activation_evidence_bundles" ||
      record.observations.foreignKey.fromColumn !== "record_id" || record.observations.foreignKey.toColumn !== "record_id" ||
      record.observations.foreignKey.onUpdate !== "RESTRICT" || record.observations.foreignKey.onDelete !== "RESTRICT" ||
      !record.observations.integrity.retrieved || record.observations.integrity.result !== "ok" ||
      !record.observations.authorityData.retrieved || record.observations.authorityData.rowCount !== 0 ||
      !record.independentReview.completed || !record.independentReview.accepted ||
      typeof record.independentReview.checkerPrincipalId !== "string" ||
      record.independentReview.checkerPrincipalId.length === 0 ||
      record.independentReview.checkerPrincipalId === record.operator.principalId ||
      typeof record.independentReview.checkerDigest !== "string" || record.errors.length !== 0) {
    throw new Error("Verified schema record lacks exact read-only evidence or independent acceptance");
  }
  exactList(record.observations.definitions.tables, EXPECTED_AUTHORITY_TABLES, "Observed tables");
  exactList(record.observations.definitions.indexes, EXPECTED_AUTHORITY_INDEXES, "Observed indexes");
  exactList(record.observations.migrations.names, EXPECTED_AUTHORITY_MIGRATIONS, "Observed migrations");
  if (Object.entries(record.conclusions).some(([key, value]) =>
    ["activationPlanUpdateAuthorized", "activationPlanUpdated"].includes(key) ? value !== false : value !== true)) {
    throw new Error("Verified schema record must establish every reviewed conclusion without updating activation state");
  }
}

export function assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, record) {
  const errors = validateSchema(schema, record);
  if (errors.length) throw new Error(`Development authority schema inventory verification record schema failed: ${errors.join("; ")}`);
  if (record.source.reviewedCommit !== REVIEWED_SCHEMA_INVENTORY_PACKET_COMMIT ||
      record.source.packetSha256 !== REVIEWED_SCHEMA_INVENTORY_PACKET_SHA256 ||
      record.source.authorizedAccountId !== AUTHORIZED_DEVELOPMENT_ACCOUNT_ID) {
    throw new Error("Schema verification record source or authorized account drifted");
  }
  assertNoAdjacentEffects(record);
  assertObservationConsistency(record);
  assertQueryEvidenceConsistency(record);
  const invokedCount = record.execution.commandsInvoked.length;
  exactList(record.execution.commandsInvoked, ORDERED_SCHEMA_INVENTORY_QUERIES.slice(0, invokedCount), "Invoked schema queries");
  for (let index = invokedCount; index < ORDERED_SCHEMA_INVENTORY_QUERIES.length; index += 1) {
    if (record.evidence.queryResultSha256[ORDERED_SCHEMA_INVENTORY_QUERIES[index]] !== null) {
      throw new Error("Uninvoked schema queries cannot carry result evidence");
    }
  }
  const observationOrder = ["database", "definitions", "migrations", "foreignKey", "integrity", "authorityData"];
  for (let index = invokedCount; index < observationOrder.length; index += 1) {
    if (record.observations[observationOrder[index]].retrieved) {
      throw new Error("Uninvoked schema queries cannot carry retrieved observations");
    }
  }
  if (record.status === "VERIFIED") {
    assertVerified(record);
  } else if (record.status === "STOPPED_NO_QUERY") {
    if (record.execution.attemptCount !== 0 || record.execution.invoked || record.execution.outcome !== "NOT_INVOKED" ||
        invokedCount !== 0 || Object.values(record.evidence.queryResultSha256).some((value) => value !== null) ||
        Object.values(record.conclusions).some((value) => value !== false) || record.independentReview.completed ||
        record.independentReview.accepted || record.independentReview.checkerPrincipalId !== null ||
        record.independentReview.checkerDigest !== null || record.errors.length === 0) {
      throw new Error("No-query stop record contradicts its read-only execution state");
    }
  } else if (record.status === "INCONCLUSIVE_READ_ONLY") {
    assertInvocationPrerequisites(record);
    assertIndependentReviewConsistency(record);
    if (record.execution.attemptCount !== 1 || !record.execution.invoked || invokedCount < 1 ||
        !["SUCCEEDED", "FAILED", "INTERRUPTED", "AMBIGUOUS"].includes(record.execution.outcome) ||
        Object.values(record.conclusions).some((value) => value !== false) || record.independentReview.accepted ||
        record.errors.length === 0) {
      throw new Error("Inconclusive read-only record cannot promote schema verification");
    }
  } else {
    throw new Error("Unsupported schema verification record status");
  }
  return true;
}
