const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const DATABASE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

const EXPECTED_FIELDS = Object.freeze({
  plan: ["activationAuthorized", "authorityDatabase", "environment", "evidence", "governing", "queue", "rollback", "schemaVersion", "status", "worker", "workerDeploymentAuthorized", "workflow"],
  worker: ["executeRouteEnabled", "externalWritesEnabled", "name", "previewUrls", "workersDev"],
  database: ["binding", "bindingInstalled", "databaseId", "databaseName", "migrations", "migrationsApplied", "remoteSchemaVerified", "resourceCreated"],
  workflow: ["binding", "bindingInstalled", "className", "name", "resourceCreated"],
  queue: ["binding", "bindingInstalled", "name", "resourceCreated"],
  evidence: ["checkerValidationDigest", "makerValidationDigest", "resourceActivationAuthorizationDigest", "reviewedCommit", "rollbackEvidenceDigest", "workerDeploymentAuthorizationDigest"],
  rollback: ["automaticResourceDeletion", "backupDigest", "restoreCommit", "strategy", "unbindFirst"],
  migration: ["path", "sha256"],
});

export const AUTHORITY_MIGRATIONS = Object.freeze([
  Object.freeze({ path: "migrations/authority/0001_authority_read_model.sql", sha256: "fded8c2fe248ecd7cfbb1214d0449f012b7099220f85e80fcd3012b3b9ade424" }),
  Object.freeze({ path: "migrations/authority/0002_validation_evidence.sql", sha256: "75e03891d1b93baf4d10bb0d248b9779405b31f78458f6874e629c320ed5b4b9" }),
  Object.freeze({ path: "migrations/authority/0003_governing_project_knowledge.sql", sha256: "8383c73014a72d30fd179628b0ff8411bf0ab27572585a281279227d03fb3c7a" }),
  Object.freeze({ path: "migrations/authority/0004_owner_control.sql", sha256: "4f7d4cb7939eefb8e6c2f7f292c7e806399b3366e135d775fa317214d7f67185" }),
]);

const PROHIBITED_AUTHORITY_DATABASES = Object.freeze(new Set([
  "pk-d1-dev",
  "9cd8094c-f334-44e6-bdd1-b325802474d5",
]));

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) throw new Error(`Invalid activation ${label} fields`);
}

function nullableDigest(value, label) {
  if (value !== null && (typeof value !== "string" || !SHA256.test(value))) throw new Error(`Invalid activation ${label}`);
}

export function assertDevelopmentActivationPlan(plan) {
  exactFields(plan, EXPECTED_FIELDS.plan, "plan");
  if (plan.schemaVersion !== "1.0.0" || !new Set(["PLANNED", "REVIEWED", "READY"]).has(plan.status) ||
      plan.governing !== false || plan.environment !== "development" || typeof plan.activationAuthorized !== "boolean" ||
      typeof plan.workerDeploymentAuthorized !== "boolean") throw new Error("Invalid development activation boundary");

  exactFields(plan.worker, EXPECTED_FIELDS.worker, "worker");
  if (plan.worker.name !== "8978-ai-control-plane-dev" || plan.worker.workersDev !== false || plan.worker.previewUrls !== false ||
      plan.worker.externalWritesEnabled !== false || plan.worker.executeRouteEnabled !== false) throw new Error("Activation Worker safety boundary is invalid");

  exactFields(plan.authorityDatabase, EXPECTED_FIELDS.database, "authority database");
  const database = plan.authorityDatabase;
  if (PROHIBITED_AUTHORITY_DATABASES.has(database.databaseName) || PROHIBITED_AUTHORITY_DATABASES.has(database.databaseId)) {
    throw new Error("Existing authority database reuse is prohibited");
  }
  if (database.binding !== "AUTHORITY_DB" || database.databaseName !== "8978-ai-authority-dev" ||
      (database.databaseId !== null && (typeof database.databaseId !== "string" || !DATABASE_ID.test(database.databaseId)))) {
    throw new Error("Dedicated authority database identity is invalid");
  }
  for (const field of ["resourceCreated", "bindingInstalled", "migrationsApplied", "remoteSchemaVerified"]) {
    if (typeof database[field] !== "boolean") throw new Error(`Invalid authority database state: ${field}`);
  }
  if (!Array.isArray(database.migrations) || database.migrations.length !== AUTHORITY_MIGRATIONS.length) throw new Error("Exact authority migrations are required");
  database.migrations.forEach((migration, index) => {
    exactFields(migration, EXPECTED_FIELDS.migration, `migration ${index + 1}`);
    if (migration.path !== AUTHORITY_MIGRATIONS[index].path || migration.sha256 !== AUTHORITY_MIGRATIONS[index].sha256) {
      throw new Error(`Authority migration ${index + 1} identity mismatch`);
    }
  });

  exactFields(plan.workflow, EXPECTED_FIELDS.workflow, "Workflow");
  if (plan.workflow.binding !== "ORCHESTRATOR_WORKFLOW" || plan.workflow.name !== "8978-ai-orchestrator-dev" ||
      plan.workflow.className !== "OrchestratorWorkflow" || typeof plan.workflow.resourceCreated !== "boolean" ||
      typeof plan.workflow.bindingInstalled !== "boolean") throw new Error("Activation Workflow identity is invalid");

  exactFields(plan.queue, EXPECTED_FIELDS.queue, "Queue");
  if (plan.queue.binding !== "ORCHESTRATOR_QUEUE" || plan.queue.name !== "8978-ai-orchestrator-dev" ||
      typeof plan.queue.resourceCreated !== "boolean" || typeof plan.queue.bindingInstalled !== "boolean") {
    throw new Error("Activation Queue identity is invalid");
  }

  exactFields(plan.evidence, EXPECTED_FIELDS.evidence, "evidence");
  if (plan.evidence.reviewedCommit !== null && (typeof plan.evidence.reviewedCommit !== "string" || !COMMIT.test(plan.evidence.reviewedCommit))) {
    throw new Error("Invalid activation reviewed commit");
  }
  for (const field of ["makerValidationDigest", "checkerValidationDigest", "resourceActivationAuthorizationDigest", "workerDeploymentAuthorizationDigest", "rollbackEvidenceDigest"]) {
    nullableDigest(plan.evidence[field], `evidence ${field}`);
  }
  if (plan.evidence.makerValidationDigest !== null && plan.evidence.makerValidationDigest === plan.evidence.checkerValidationDigest) {
    throw new Error("Activation maker and checker evidence must be independent");
  }
  if (plan.evidence.resourceActivationAuthorizationDigest !== null &&
      plan.evidence.resourceActivationAuthorizationDigest === plan.evidence.workerDeploymentAuthorizationDigest) {
    throw new Error("Resource activation and Worker deployment authorizations must be distinct");
  }

  exactFields(plan.rollback, EXPECTED_FIELDS.rollback, "rollback");
  if (plan.rollback.strategy !== "unbind_before_delete" || !COMMIT.test(plan.rollback.restoreCommit ?? "") ||
      plan.rollback.unbindFirst !== true || plan.rollback.automaticResourceDeletion !== false) {
    throw new Error("Activation rollback boundary is invalid");
  }
  nullableDigest(plan.rollback.backupDigest, "rollback backup digest");
  return true;
}

export function developmentActivationBlockers(plan) {
  assertDevelopmentActivationPlan(plan);
  const blockers = [];
  if (plan.status !== "READY") blockers.push("plan_not_ready");
  if (!plan.activationAuthorized) blockers.push("activation_not_authorized");
  if (!plan.workerDeploymentAuthorized) blockers.push("worker_deployment_not_authorized");
  if (!plan.authorityDatabase.resourceCreated) blockers.push("authority_database_not_created");
  if (plan.authorityDatabase.databaseId === null) blockers.push("authority_database_id_unavailable");
  if (!plan.authorityDatabase.bindingInstalled) blockers.push("authority_binding_not_installed");
  if (!plan.authorityDatabase.migrationsApplied) blockers.push("authority_migrations_not_applied");
  if (!plan.authorityDatabase.remoteSchemaVerified) blockers.push("authority_schema_not_verified");
  if (!plan.workflow.resourceCreated) blockers.push("workflow_not_created");
  if (!plan.workflow.bindingInstalled) blockers.push("workflow_binding_not_installed");
  if (!plan.queue.resourceCreated) blockers.push("queue_not_created");
  if (!plan.queue.bindingInstalled) blockers.push("queue_binding_not_installed");
  if (plan.evidence.reviewedCommit === null) blockers.push("reviewed_commit_unavailable");
  if (plan.evidence.makerValidationDigest === null) blockers.push("maker_validation_unavailable");
  if (plan.evidence.checkerValidationDigest === null) blockers.push("checker_validation_unavailable");
  if (plan.evidence.resourceActivationAuthorizationDigest === null) blockers.push("resource_activation_authorization_unavailable");
  if (plan.evidence.workerDeploymentAuthorizationDigest === null) blockers.push("worker_deployment_authorization_unavailable");
  if (plan.evidence.rollbackEvidenceDigest === null) blockers.push("rollback_evidence_unavailable");
  if (plan.rollback.backupDigest === null) blockers.push("rollback_backup_unavailable");
  return Object.freeze(blockers);
}

export async function developmentActivationPreflight(plan, { evidenceVerifier } = {}) {
  const blockers = [...developmentActivationBlockers(plan)];
  if (!evidenceVerifier || typeof evidenceVerifier.verify !== "function") {
    blockers.push("independent_evidence_verifier_unavailable");
  } else if (blockers.length === 0) {
    let verification;
    const evidence = Object.freeze({
      ...plan.evidence,
      backupDigest: plan.rollback.backupDigest,
    });
    try {
      verification = await evidenceVerifier.verify(evidence);
      exactFields(verification, [
        "backupDigest", "checkerPrincipalId", "checkerValidationDigest", "makerPrincipalId", "makerValidationDigest",
        "ownerPrincipalId", "resourceActivationAuthorizationDigest", "reviewedCommit", "rollbackEvidenceDigest",
        "valid", "verificationDigest", "workerDeploymentAuthorizationDigest",
      ], "evidence verification");
    } catch {
      verification = null;
    }
    if (!verification || verification.valid !== true || verification.reviewedCommit !== plan.evidence.reviewedCommit ||
        verification.makerValidationDigest !== evidence.makerValidationDigest ||
        verification.checkerValidationDigest !== evidence.checkerValidationDigest ||
        verification.resourceActivationAuthorizationDigest !== evidence.resourceActivationAuthorizationDigest ||
        verification.workerDeploymentAuthorizationDigest !== evidence.workerDeploymentAuthorizationDigest ||
        verification.rollbackEvidenceDigest !== evidence.rollbackEvidenceDigest || verification.backupDigest !== evidence.backupDigest ||
        typeof verification.makerPrincipalId !== "string" || !verification.makerPrincipalId ||
        typeof verification.checkerPrincipalId !== "string" || !verification.checkerPrincipalId ||
        verification.makerPrincipalId === verification.checkerPrincipalId ||
        typeof verification.ownerPrincipalId !== "string" || !verification.ownerPrincipalId ||
        verification.ownerPrincipalId === verification.makerPrincipalId || verification.ownerPrincipalId === verification.checkerPrincipalId ||
        typeof verification.verificationDigest !== "string" || !SHA256.test(verification.verificationDigest)) {
      blockers.push("independent_evidence_verification_failed");
    }
  }
  const frozenBlockers = Object.freeze(blockers);
  return Object.freeze({ ready: frozenBlockers.length === 0, environment: "development", blockers: frozenBlockers });
}
