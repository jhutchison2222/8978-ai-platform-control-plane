import { validateSchema } from "../scripts/json-schema-lite.js";

export const REVIEWED_MIGRATION_PACKET_COMMIT = "b2e3188b28b7c9071e267e69e90c374650747035";
export const REVIEWED_MIGRATION_PACKET_SHA256 = "ab865340c48279e6e5654e8e6b0ed52cb9d4af28115c49b47d787ad1ec205d8a";
export const AUTHORIZED_DEVELOPMENT_ACCOUNT_ID = "de5e0273347b0b4c5f8f4e554aa2288f";
export const MIGRATION_APPLY_COMMAND = "wrangler d1 migrations apply 8978-ai-authority-dev --remote --config deployment/wrangler.authority-migrations.jsonc";
export const ORDERED_AUTHORITY_MIGRATIONS = Object.freeze([
  "0001_authority_read_model.sql",
  "0002_validation_evidence.sql",
  "0003_governing_project_knowledge.sql",
  "0004_owner_control.sql",
  "0005_development_activation_evidence.sql",
  "0006_development_activation_evidence_writes.sql",
]);

function exactList(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} must match the exact ordered migration list`);
}

function prefixLength(applied) {
  if (!Array.isArray(applied) || applied.length > ORDERED_AUTHORITY_MIGRATIONS.length) throw new Error("Applied migration list is invalid");
  exactList(applied, ORDERED_AUTHORITY_MIGRATIONS.slice(0, applied.length), "Applied migrations");
  return applied.length;
}

function assertNoAdjacentEffects(record) {
  if (Object.values(record.externalEffects).some((value) => value !== false) ||
      Object.values(record.partialFailurePolicy).some((value) => value !== false)) {
    throw new Error("Migration record cannot claim adjacent effects, restore, retry, cleanup, or deletion");
  }
  if (record.postState.remoteSchemaVerified !== false) throw new Error("Migration execution cannot certify the remote schema");
}

function assertEvidenceConsistency(record) {
  const bookmarkPresent = typeof record.backup.bookmark === "string" && record.backup.bookmark.length > 0;
  const exportPresent = typeof record.backup.exportSha256 === "string" &&
    Number.isInteger(record.backup.exportSizeBytes) && record.backup.exportSizeBytes > 0;
  if (record.backup.bookmarkCaptured !== bookmarkPresent || record.backup.exportCaptured !== exportPresent) {
    throw new Error("Backup capture flags must match the recorded backup evidence");
  }
  if (!record.preflight.completed && (record.preflight.identityMatched || record.preflight.emptyStateMatched)) {
    throw new Error("Incomplete preflight cannot claim matched identity or empty state");
  }
  if (!record.postState.retrieved && (record.postState.tableCount !== null || record.postState.fileSizeBytes !== null)) {
    throw new Error("Unavailable post-state cannot contain retrieved metadata");
  }
  if (record.postState.retrieved && (!Number.isInteger(record.postState.tableCount) ||
      !Number.isInteger(record.postState.fileSizeBytes))) throw new Error("Retrieved post-state requires table count and file size");
}

function assertInvocationPrerequisites(record) {
  if (record.operator.authenticatedAccountId !== AUTHORIZED_DEVELOPMENT_ACCOUNT_ID ||
      !record.preflight.completed || record.preflight.databaseName !== "8978-ai-authority-dev" ||
      record.preflight.databaseId !== "741ade94-8539-4fc8-b6be-24884720dee8" || record.preflight.region !== "WNAM" ||
      record.preflight.jurisdiction !== null || record.preflight.version !== "production" ||
      !record.preflight.identityMatched || !record.preflight.emptyStateMatched ||
      record.preflight.tableCount !== 0 || !record.backup.bookmarkCaptured || !record.backup.bookmark ||
      !record.backup.exportCaptured || !record.backup.exportSha256 || !Number.isInteger(record.backup.exportSizeBytes) ||
      record.backup.exportSizeBytes <= 0) {
    throw new Error("Migration invocation requires exact preflight and both completed backup artifacts");
  }
  exactList(record.migration.pendingBefore, ORDERED_AUTHORITY_MIGRATIONS, "Pending migrations before application");
}

export function assertDevelopmentAuthorityMigrationExecutionRecord(schema, record) {
  const errors = validateSchema(schema, record);
  if (errors.length) throw new Error(`Development authority migration execution record schema failed: ${errors.join("; ")}`);
  if (record.source.reviewedCommit !== REVIEWED_MIGRATION_PACKET_COMMIT ||
      record.source.packetSha256 !== REVIEWED_MIGRATION_PACKET_SHA256 ||
      record.authorization.accountId !== AUTHORIZED_DEVELOPMENT_ACCOUNT_ID ||
      record.authorization.executionAuthorized !== true || record.authorization.authorizedAttemptLimit !== 1) {
    throw new Error("Migration record source, authorization, or account identity drifted");
  }
  if (record.migration.applyCommand !== MIGRATION_APPLY_COMMAND || !Number.isInteger(record.migration.attemptCount) ||
      record.migration.attemptCount < 0 || record.migration.attemptCount > 1) throw new Error("Migration attempt boundary is invalid");
  assertNoAdjacentEffects(record);
  assertEvidenceConsistency(record);
  const appliedCount = prefixLength(record.migration.applied);
  if (appliedCount > 0 && !record.postState.migrationBookkeepingRowsCreated) {
    throw new Error("Applied migration filenames require migration bookkeeping evidence");
  }
  if (record.migration.pendingAfter !== null) {
    exactList(record.migration.pendingAfter, ORDERED_AUTHORITY_MIGRATIONS.slice(appliedCount), "Pending migrations after application");
  }

  if (record.status === "COMPLETED") {
    assertInvocationPrerequisites(record);
    if (record.migration.attemptCount !== 1 || !record.migration.invoked || record.migration.outcome !== "SUCCEEDED" ||
        appliedCount !== ORDERED_AUTHORITY_MIGRATIONS.length || record.migration.pendingAfter === null ||
        record.migration.pendingAfter.length !== 0 || !record.postState.retrieved || record.postState.tableCount !== 11 ||
        !record.postState.migrationsApplied || !record.postState.migrationBookkeepingRowsCreated || record.errors.length !== 0) {
      throw new Error("Completed migration record lacks exact successful post-application evidence");
    }
  } else if (record.status === "STOPPED_NO_MUTATION") {
    if (record.migration.attemptCount !== 0 || record.migration.invoked || record.migration.outcome !== "NOT_INVOKED" ||
        appliedCount !== 0 || record.postState.migrationsApplied || record.postState.migrationBookkeepingRowsCreated ||
        record.errors.length === 0) throw new Error("No-mutation stop record contradicts its execution state");
  } else {
    assertInvocationPrerequisites(record);
    if (record.migration.attemptCount !== 1 || !record.migration.invoked ||
        !["FAILED", "INTERRUPTED", "AMBIGUOUS"].includes(record.migration.outcome) ||
        appliedCount >= ORDERED_AUTHORITY_MIGRATIONS.length || record.postState.migrationsApplied ||
        record.errors.length === 0) {
      throw new Error("Partial-stop record must preserve an uncertain one-attempt failure without promotion");
    }
  }
  return true;
}
