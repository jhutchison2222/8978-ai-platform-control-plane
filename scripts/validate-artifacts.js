import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { digestCanonicalValue, parseJsonStrict } from "../src/canonical-digest.js";
import { AUTHORITY_MIGRATIONS, developmentActivationPreflight } from "../src/development-activation-preflight.js";
import {
  assertDevelopmentAuthorityMigrationExecutionRecord,
  AUTHORIZED_DEVELOPMENT_ACCOUNT_ID, MIGRATION_APPLY_COMMAND, ORDERED_AUTHORITY_MIGRATIONS,
  REVIEWED_MIGRATION_PACKET_COMMIT, REVIEWED_MIGRATION_PACKET_SHA256,
} from "../src/development-authority-migration-execution-record.js";
import {
  assertDevelopmentAuthoritySchemaInventoryVerificationRecord,
  EXPECTED_AUTHORITY_INDEXES, EXPECTED_AUTHORITY_MIGRATIONS, EXPECTED_AUTHORITY_TABLES,
  ORDERED_SCHEMA_INVENTORY_QUERIES, REVIEWED_SCHEMA_INVENTORY_PACKET_COMMIT,
  REVIEWED_SCHEMA_INVENTORY_PACKET_SHA256,
} from "../src/development-authority-schema-inventory-verification-record.js";
import { TRUSTED_POLICY_SET_DIGESTS } from "../src/trusted-policy-sets.js";
import { validateSchema } from "./json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
for (const directory of ["schemas", "policies"]) for (const file of await readdir(directory)) if (file.endsWith(".json")) await load(`${directory}/${file}`);

const policies = await load("policies/development-standing-policies.json");
const policySchema = await load("schemas/standing-policy.schema.json");
const resourceSchema = await load("schemas/resource-target.schema.json");
const actionSchema = await load("schemas/requested-action.schema.json");
const decisionSchema = await load("schemas/owner-approval-decision.schema.json");
const eventSchema = await load("schemas/execution-record.schema.json");
const envelopeSchema = await load("schemas/orchestrator-envelope.schema.json");
const runtimeSchema = await load("schemas/runtime-readiness.schema.json");
const isolationSchema = await load("schemas/customer-isolation.schema.json");
const customerBindingsSchema = await load("schemas/customer-runtime-bindings.schema.json");
const activationPlanSchema = await load("schemas/development-activation-plan.schema.json");
const activationEvidenceSchema = await load("schemas/development-activation-evidence-bundle.schema.json");
const activationPlan = await load("deployment/development-activation-plan.json");
const activationResourceReconciledPlan = await load("deployment/development-activation-plan-resource-reconciled.json");
const resourceCreationPacketSchema = await load("schemas/development-resource-creation-packet.schema.json");
const resourceCreationPacket = await load("deployment/development-resource-creation-packet.json");
const resourceCreationRecordSchema = await load("schemas/development-resource-creation-partial-execution-record.schema.json");
const resourceCreationRecord = await load("deployment/development-resource-creation-partial-execution-record.json");
const resourceCreationCompletionSchema = await load("schemas/development-resource-creation-completion-record.schema.json");
const resourceCreationCompletion = await load("deployment/development-resource-creation-completion-record.json");
const authorityMigrationPacketSchema = await load("schemas/development-authority-migration-execution-packet.schema.json");
const authorityMigrationPacket = await load("deployment/development-authority-migration-execution-packet.json");
const authorityMigrationWrangler = await load("deployment/wrangler.authority-migrations.jsonc");
const authorityMigrationRecordSchema = await load("schemas/development-authority-migration-execution-record.schema.json");
const authorityMigrationRecord = await load("deployment/development-authority-migration-execution-record.json");
const authoritySchemaInventoryPacketSchema = await load("schemas/development-authority-schema-inventory-verification-packet.schema.json");
const authoritySchemaInventoryPacket = await load("deployment/development-authority-schema-inventory-verification-packet.json");
const authoritySchemaInventoryRecordSchema = await load("schemas/development-authority-schema-inventory-verification-record.schema.json");
const authoritySchemaInventoryRecord = await load("deployment/development-authority-schema-inventory-verification-record.json");
const wrangler = await load("wrangler.jsonc");
const workerSource = await readFile("src/control-plane-worker.js", "utf8");
const durableStateSource = await readFile("src/control-plane-state-durable-objects.js", "utf8");
const durableAdapterSource = await readFile("src/cloudflare-runtime-stores.js", "utf8");
const authorityAdapterSource = await readFile("src/d1-authority-runtime.js", "utf8");
const authorityMigration = await readFile("migrations/authority/0001_authority_read_model.sql", "utf8");
const validationAdapterSource = await readFile("src/d1-validation-runtime.js", "utf8");
const validationMigration = await readFile("migrations/authority/0002_validation_evidence.sql", "utf8");
const projectKnowledgeAdapterSource = await readFile("src/d1-project-knowledge-runtime.js", "utf8");
const projectKnowledgeMigration = await readFile("migrations/authority/0003_governing_project_knowledge.sql", "utf8");
const ownerControlAdapterSource = await readFile("src/d1-owner-control-runtime.js", "utf8");
const ownerControlMigration = await readFile("migrations/authority/0004_owner_control.sql", "utf8");
const authorityRuntimeCompositionSource = await readFile("src/d1-authority-runtime-composition.js", "utf8");
const orchestratorAdapterSource = await readFile("src/cloudflare-orchestrator-adapters.js", "utf8");
const orchestratorWorkflowSource = await readFile("src/orchestrator-workflow.js", "utf8");
const developmentRuntimeSource = await readFile("src/development-runtime.js", "utf8");
const policyGatewaySource = await readFile("src/policy-gateway.js", "utf8");
const runtimeContractsSource = await readFile("src/runtime-contracts.js", "utf8");
const activationPreflightSource = await readFile("src/development-activation-preflight.js", "utf8");
const activationEvidenceVerifierSource = await readFile("src/development-activation-evidence-verifier.js", "utf8");
const activationEvidenceProviderSource = await readFile("src/d1-development-activation-evidence-provider.js", "utf8");
const activationEvidenceMigration = await readFile("migrations/authority/0005_development_activation_evidence.sql", "utf8");
const activationEvidenceWriterSource = await readFile("src/authenticated-development-activation-evidence-writer.js", "utf8");
const activationEvidenceWriteMigration = await readFile("migrations/authority/0006_development_activation_evidence_writes.sql", "utf8");
const activationEvidenceWriteVerifierSource = await readFile("src/d1-development-activation-evidence-write-verifier.js", "utf8");
const activationEvidenceChainVerifierSource = await readFile("src/development-activation-evidence-chain-verifier.js", "utf8");
const activationEvidenceRuntimeCompositionSource = await readFile("src/d1-development-activation-evidence-runtime-composition.js", "utf8");
const activationPreflightEvaluatorSource = await readFile("src/d1-development-activation-preflight-evaluator.js", "utf8");
const activationEvidenceVerifierTestSource = await readFile("test/worker/development-activation-evidence-verifier.test.js", "utf8");
const activationEvidenceWriterTestSource = await readFile("test/worker/authenticated-development-activation-evidence-writer.test.js", "utf8");
const activationEvidenceWriteVerifierTestSource = await readFile("test/worker/d1-development-activation-evidence-write-verifier.test.js", "utf8");
const activationEvidenceChainVerifierTestSource = await readFile("test/development-activation-evidence-chain-verifier.test.js", "utf8");
const activationEvidenceRuntimeCompositionTestSource = await readFile("test/d1-development-activation-evidence-runtime-composition.test.js", "utf8");
const activationPreflightEvaluatorTestSource = await readFile("test/d1-development-activation-preflight-evaluator.test.js", "utf8");
const vitestSource = await readFile("vitest.config.js", "utf8");
const secretScanSource = await readFile("scripts/secret-scan.js", "utf8");
const authorityMigrationRecordValidatorSource = await readFile("src/development-authority-migration-execution-record.js", "utf8");
const authoritySchemaInventoryRecordValidatorSource = await readFile("src/development-authority-schema-inventory-verification-record.js", "utf8");
const deploymentFiles = await readdir("deployment");

const batch1Proposed = await load("docs/project-knowledge/proposed/batch-1/proposed-records.json");
const batch1Review = await load("docs/reviews/pr-3/PR-3-Batch-1-Master-Prompt-Architecture-Review.json");
const batch1DataDictionary = await readFile("docs/source-material/master-prompts/batch-1/04-data-dictionary-architecture.md", "utf8");

const batch2Proposed = await load("docs/project-knowledge/proposed/batch-2/proposed-records.json");
const batch2Manifest = await load("docs/source-material/master-prompts/batch-2/manifest.json");
const batch2Review = await readFile("docs/project-knowledge/proposed/batch-2/normalization-review.md", "utf8");
const batch2Readme = await readFile("docs/source-material/master-prompts/batch-2/README.md", "utf8");
const batch2DirectInbound = await readFile("docs/source-material/master-prompts/batch-2/01-direct-inbound-phone-sales-specialist.md", "utf8");
const batch2NoTransfer = await readFile("docs/source-material/master-prompts/batch-2/02-phone-receptionist-no-ai-sales-rep.md", "utf8");

const batch3Proposed = await load("docs/project-knowledge/proposed/batch-3/proposed-records.json");
const batch3Manifest = await load("docs/source-material/master-prompts/batch-3/manifest.json");
const batch3Review = await readFile("docs/project-knowledge/proposed/batch-3/normalization-review.md", "utf8");
const batch3Readme = await readFile("docs/source-material/master-prompts/batch-3/README.md", "utf8");
const batch3Sources = await Promise.all([
  "01-smartsite-optional-transfer-assistant.md",
  "02-smartsite-standalone-sales-assistant.md",
  "03-smartsite-traditional-lead-warmer.md",
  "04-smartsite-downstream-sales-specialist.md",
  "05-shared-sales-capable-agent-framework.md",
].map((name) => readFile(`docs/source-material/master-prompts/batch-3/${name}`, "utf8")));

function assertValid(name, schema, value) {
  const errors = validateSchema(schema, value); if (errors.length) throw new Error(`${name} schema validation failed:\n${errors.join("\n")}`);
}

assertValid("policy set", policySchema, policies);
const ids = new Set();
for (const policy of policies.policies) {
  const key = `${policy.id}@${policy.version}`; if (ids.has(key)) throw new Error(`Duplicate policy version: ${key}`); ids.add(key);
  for (const resource of policy.resources) {
    assertValid(`${key} resource`, resourceSchema, resource);
    assertValid(`${key} isolation`, isolationSchema, resource.isolation);
    if (resource.environment === "production") throw new Error(`Development bootstrap includes production: ${key}`);
    const unresolved = JSON.stringify(resource).includes("__UNRESOLVED_");
    if (unresolved && policy.enabled) throw new Error(`Unresolved identifiers require a disabled policy: ${key}`);
  }
}
const byId = Object.fromEntries(policies.policies.map((policy) => [policy.id, policy]));
for (const id of ["dev-cloudflare-workers-unresolved-account","dev-cloudflare-data-unresolved-account-runtime","dev-ghl-sandbox-unresolved-account","dev-autocalls-test-unresolved-identifiers"]) {
  if (byId[id]?.enabled !== false) throw new Error(`${id} must remain disabled until authoritative identifiers resolve`);
}
const serialized = JSON.stringify(policies);
for (const fact of ["pk-d1-dev","9cd8094c-f334-44e6-bdd1-b325802474d5","pk-r2-dev","8978-ai-orchestrator-dev","project-knowledge-worker-dev","GtErr1MjPdjYDGU8gUd6","jhutchison2222/8978-ai-platform-control-plane"]) {
  if (!serialized.includes(fact)) throw new Error(`Approved development fact missing: ${fact}`);
}

const digest = "sha256:" + "a".repeat(64);
assertValid("requested action", actionSchema, { actionId:"a",operation:"read",requestedTarget:{locator:"repo"},correlationId:"c",idempotencyKey:"i",rollbackRef:"r",evidence:{makerAttestation:"m",checkerAttestation:"c"},productionSensitive:false,destructiveProductionOrCustomerData:false,credentialScopeExpansion:false,newProductionExternalWriteIntegration:false,finalOwnerDecisionChange:false,legalPrivacyComplianceContractualDecision:false });
assertValid("owner decision", decisionSchema, { decisionId:"d",requestedActionDigest:digest,decision:"approved",decidedBy:"owner",decidedAt:"2026-08-11T18:00:00Z",expiresAt:"2026-08-11T19:00:00Z",issuerKeyId:"owner-key",signatureAlgorithm:"Ed25519",signature:"fixture" });
assertValid("audit event", eventSchema, { schemaVersion:"2.0.0",eventType:"execution_succeeded",actionDigest:digest,correlationId:"c",idempotencyScope:digest,leaseId:"l",resultDigest:digest,recordedAt:"2026-08-11T19:00:00Z" });
assertValid("orchestrator envelope", envelopeSchema, { messageId:"m",actionDigest:digest,correlationId:"c",idempotencyKey:"i",workflowName:"unresolved-disabled",queueName:"unresolved-disabled",projectKnowledgeRef:{recordId:"pk",status:"CURRENT",version:"1",digest} });
assertValid("runtime readiness", runtimeSchema, Object.fromEntries(["resourceResolver","identityVerifier","evidenceProvider","rollbackVerifier","limitProvider","ownerVerifier","ownerDecisionStore","idempotencyStore","auditStore","projectKnowledge","workflowDispatcher","queuePublisher"].map((key) => [key, {}]).concat([["revalidateStandingState", "injected-function"]])));
assertValid("customer runtime bindings", customerBindingsSchema, { customerId:"customer-1",dedicatedWorkerName:"worker-customer-1",dedicatedD1DatabaseId:"d1-customer-1",sharedProductionD1:false });
assertValid("development activation plan", activationPlanSchema, activationPlan);
assertValid("development activation resource-reconciled plan", activationPlanSchema, activationResourceReconciledPlan);
assertValid("development resource creation packet", resourceCreationPacketSchema, resourceCreationPacket);
assertValid("development resource creation partial execution record", resourceCreationRecordSchema, resourceCreationRecord);
assertValid("development resource creation completion record", resourceCreationCompletionSchema, resourceCreationCompletion);
assertValid("development authority migration execution packet", authorityMigrationPacketSchema, authorityMigrationPacket);
assertValid("development authority migration execution record", authorityMigrationRecordSchema, authorityMigrationRecord);
assertDevelopmentAuthorityMigrationExecutionRecord(authorityMigrationRecordSchema, authorityMigrationRecord);
assertValid("development authority schema inventory verification packet", authoritySchemaInventoryPacketSchema, authoritySchemaInventoryPacket);
assertValid("development authority schema inventory verification record", authoritySchemaInventoryRecordSchema, authoritySchemaInventoryRecord);
assertDevelopmentAuthoritySchemaInventoryVerificationRecord(authoritySchemaInventoryRecordSchema, authoritySchemaInventoryRecord);
if (activationEvidenceSchema.additionalProperties !== false || activationEvidenceSchema.properties?.schemaVersion?.const !== "1.0.0" ||
    activationEvidenceSchema.properties?.resourceActivationDecision?.properties?.decision?.const !== "approved" ||
    activationEvidenceSchema.properties?.workerDeploymentDecision?.properties?.signatureAlgorithm?.const !== "Ed25519") {
  throw new Error("Development activation evidence bundle schema boundary changed");
}
if (validateSchema(customerBindingsSchema, { customerId:"customer-1",dedicatedWorkerName:"worker",dedicatedD1DatabaseId:"d1",sharedProductionD1:true }).length === 0) throw new Error("Shared production D1 negative fixture unexpectedly passed");
if (validateSchema(resourceSchema, { kind:"github_repository",provider:"cloudflare",repository:"x",environment:"development",isolation:{} }).length === 0) throw new Error("Resource discriminator negative fixture unexpectedly passed");
if (validateSchema({ type:"string", format:"date-time" }, "2026-08-19").length === 0) throw new Error("JSON Schema date-time shape negative fixture unexpectedly passed");
if (validateSchema({ type:"string", format:"date-time" }, "2026-02-30T00:00:00Z").length === 0) throw new Error("JSON Schema date-time calendar negative fixture unexpectedly passed");
if (validateSchema({ type:"string", minLength:2, maxLength:2 }, "😀").length === 0) throw new Error("JSON Schema Unicode minLength negative fixture unexpectedly passed");
if (validateSchema({ type:"string", minLength:2, maxLength:2 }, "😀a").length !== 0) throw new Error("JSON Schema Unicode maxLength boundary fixture unexpectedly failed");
if (validateSchema({ type:"string", maxLength:1 }, "too long").length === 0) throw new Error("JSON Schema maxLength negative fixture unexpectedly passed");
if (validateSchema({ type:"integer", maximum:1 }, 2).length === 0) throw new Error("JSON Schema maximum negative fixture unexpectedly passed");
if (validateSchema({ type:"array", maxItems:1 }, ["one", "two"]).length === 0) throw new Error("JSON Schema maxItems negative fixture unexpectedly passed");

const activationReport = await developmentActivationPreflight(activationPlan);
if (activationReport.ready !== false || activationReport.blockers.length !== 20 ||
    !activationReport.blockers.includes("independent_evidence_verifier_unavailable")) {
  throw new Error("Development activation plan must remain blocked by exactly 20 gates including independent evidence verification");
}
if (activationPlan.status !== "PLANNED" || activationPlan.governing !== false || activationPlan.environment !== "development" ||
    activationPlan.activationAuthorized !== false || activationPlan.workerDeploymentAuthorized !== false ||
    activationPlan.authorityDatabase.databaseId !== null) throw new Error("Development activation plan cannot self-promote or install an authority identifier");
for (const value of [
  activationPlan.authorityDatabase.resourceCreated, activationPlan.authorityDatabase.bindingInstalled,
  activationPlan.authorityDatabase.migrationsApplied, activationPlan.authorityDatabase.remoteSchemaVerified,
  activationPlan.workflow.resourceCreated, activationPlan.workflow.bindingInstalled,
  activationPlan.queue.resourceCreated, activationPlan.queue.bindingInstalled,
]) if (value !== false) throw new Error("Development activation resource state must remain false before infrastructure authorization");
if (Object.values(activationPlan.evidence).some((value) => value !== null) || activationPlan.rollback.backupDigest !== null) {
  throw new Error("Development activation evidence cannot be fabricated in the planning foundation");
}
if (activationPlan.rollback.restoreCommit !== "848190a3517c7b23c537450a5f1e6832f1690f8d" ||
    activationPlan.rollback.strategy !== "unbind_before_delete" || activationPlan.rollback.unbindFirst !== true ||
    activationPlan.rollback.automaticResourceDeletion !== false) throw new Error("Development activation rollback must restore PR #14 and unbind before any manual deletion");
if (JSON.stringify(activationPlan.authorityDatabase.migrations) !== JSON.stringify(AUTHORITY_MIGRATIONS)) {
  throw new Error("Development activation migration manifest drifted from source constants");
}
const reconciledActivationReport = await developmentActivationPreflight(activationResourceReconciledPlan);
if (reconciledActivationReport.ready !== false || reconciledActivationReport.blockers.length !== 17 ||
    !reconciledActivationReport.blockers.includes("independent_evidence_verifier_unavailable") ||
    ["authority_database_not_created", "authority_database_id_unavailable", "queue_not_created"].some((blocker) => reconciledActivationReport.blockers.includes(blocker))) {
  throw new Error("Resource-reconciled activation plan must remain blocked by exactly 17 gates after resolving only D1 and Queue creation state");
}
const expectedReconciledPlan = structuredClone(activationPlan);
expectedReconciledPlan.authorityDatabase.databaseId = "741ade94-8539-4fc8-b6be-24884720dee8";
expectedReconciledPlan.authorityDatabase.resourceCreated = true;
expectedReconciledPlan.queue.resourceCreated = true;
if (JSON.stringify(activationResourceReconciledPlan) !== JSON.stringify(expectedReconciledPlan)) {
  throw new Error("Resource-reconciled activation plan may differ from the historical plan in exactly three resource facts");
}
if (createHash("sha256").update(await readFile("deployment/development-activation-plan.json")).digest("hex") !==
    "0d6345c6537184e08f69f0953cfdc3de42c8456114fcccd4d71be08fda641fac" ||
    createHash("sha256").update(await readFile("deployment/development-resource-creation-completion-record.json")).digest("hex") !==
    "98f9c0623e2240aad87d68f9fdc7b3fe895d0853308d272c9398ec6858815747") {
  throw new Error("Resource reconciliation source evidence drifted");
}
if (resourceCreationPacket.status !== "PLANNED" || resourceCreationPacket.governing !== false ||
    resourceCreationPacket.executionAuthorized !== false || resourceCreationPacket.account.accountId !== null ||
    resourceCreationPacket.foundationBaseline !== "ff8134db56272ba52f985f6fda7247e4e35ea90a") {
  throw new Error("Development resource creation packet must remain non-governing, execution-disabled, and account-unresolved");
}
if (createHash("sha256").update(await readFile("deployment/development-resource-creation-packet.json")).digest("hex") !==
    "a3dd1fe2657818a068bdb1095df82eeed00af8642d412b65b2e6b1aad5720f0a") {
  throw new Error("Development resource creation packet bytes drifted from the reviewed execution boundary");
}
if (resourceCreationPacket.sourcePlan.path !== "deployment/development-activation-plan.json" ||
    createHash("sha256").update(await readFile(resourceCreationPacket.sourcePlan.path)).digest("hex") !== resourceCreationPacket.sourcePlan.sha256) {
  throw new Error("Development resource creation packet must pin the unchanged activation plan bytes");
}
if (JSON.stringify(resourceCreationPacket.authorityDatabase) !== JSON.stringify({
  operation:"create", name:"8978-ai-authority-dev", binding:"AUTHORITY_DB", locationPolicy:"cloudflare_automatic",
  requireAbsent:true, empty:true, bind:false, migrate:false, seed:false, writeEvidence:false, updateConfig:false,
}) || JSON.stringify(resourceCreationPacket.queue) !== JSON.stringify({
  operation:"create", name:"8978-ai-orchestrator-dev", binding:"ORCHESTRATOR_QUEUE", requireAbsent:true,
  deliveryDelaySeconds:0, messageRetentionSeconds:86400, bind:false, addProducer:false, addConsumer:false, publish:false,
}) || resourceCreationPacket.workflow.operation !== "deferred") {
  throw new Error("Development resource creation packet expanded beyond empty unbound D1 and unconnected Queue creation");
}
for (const prohibited of [
  "create_or_deploy_worker", "create_or_trigger_workflow", "install_or_update_binding", "modify_wrangler_config",
  "apply_or_create_migration", "execute_d1_sql", "insert_update_or_delete_d1_data", "seed_authority_or_project_knowledge",
  "write_activation_evidence", "install_or_rotate_secret_or_key", "add_queue_producer", "add_queue_consumer",
  "publish_queue_message", "create_or_modify_route", "deploy_or_activate_runtime", "touch_production_or_customer_resource",
  "reuse_pk_d1_dev", "delete_or_automatically_clean_up_resource",
]) if (!resourceCreationPacket.prohibitedOperations.includes(prohibited)) {
  throw new Error(`Development resource creation packet prohibition missing: ${prohibited}`);
}
if (resourceCreationPacket.stopConditions.length !== 7 || resourceCreationPacket.requiredEvidence.length !== 12 ||
    resourceCreationPacket.partialFailurePolicy.automaticDeletion !== false ||
    resourceCreationPacket.partialFailurePolicy.automaticRetry !== false ||
    resourceCreationPacket.partialFailurePolicy.action !== "stop_and_report_exact_remote_state") {
  throw new Error("Development resource creation packet stop, evidence, or partial-failure boundary weakened");
}
for (const source of [workerSource, developmentRuntimeSource, activationPreflightSource, activationPreflightEvaluatorSource]) {
  if (source.includes("development-resource-creation-packet")) throw new Error("Development resource creation packet cannot be imported by runtime or preflight code");
  if (source.includes("development-resource-creation-partial-execution-record")) throw new Error("Development resource creation record cannot be imported by runtime or preflight code");
  if (source.includes("development-resource-creation-completion-record")) throw new Error("Development resource creation completion record cannot be imported by runtime or preflight code");
  if (source.includes("development-activation-plan-resource-reconciled")) throw new Error("Development activation resource-reconciled plan cannot be imported by runtime or preflight code");
  if (source.includes("development-authority-migration-execution-packet")) throw new Error("Development authority migration execution packet cannot be imported by runtime or preflight code");
  if (source.includes("wrangler.authority-migrations")) throw new Error("Development authority migration configuration cannot be imported by runtime or preflight code");
  if (source.includes("development-authority-migration-execution-record")) throw new Error("Development authority migration execution record contract cannot be imported by runtime or preflight code");
  if (source.includes("development-authority-schema-inventory-verification-packet")) throw new Error("Development authority schema inventory packet cannot be imported by runtime or preflight code");
  if (source.includes("development-authority-schema-inventory-verification-record")) throw new Error("Development authority schema inventory verification record contract cannot be imported by runtime or preflight code");
}
if (resourceCreationRecord.status !== "STOPPED_PARTIAL" || resourceCreationRecord.governing !== false ||
    resourceCreationRecord.continuation.authorized !== false || resourceCreationRecord.locationDeviation.ownerAccepted !== false ||
    resourceCreationRecord.locationDeviation.deleteAuthorized !== false || resourceCreationRecord.locationDeviation.automaticCleanupAuthorized !== false) {
  throw new Error("Development resource creation record cannot promote, continue, accept, delete, or clean up");
}
if (resourceCreationRecord.sourcePacket.path !== "deployment/development-resource-creation-packet.json" ||
    createHash("sha256").update(await readFile(resourceCreationRecord.sourcePacket.path)).digest("hex") !== resourceCreationRecord.sourcePacket.sha256 ||
    resourceCreationRecord.sourcePacket.sha256 !== "a3dd1fe2657818a068bdb1095df82eeed00af8642d412b65b2e6b1aad5720f0a") {
  throw new Error("Development resource creation record must bind the immutable reviewed PR #24 packet");
}
if (JSON.stringify(resourceCreationRecord.authorityDatabase) !== JSON.stringify({
  operation:"create", outcome:"CREATED", name:"8978-ai-authority-dev", databaseId:"741ade94-8539-4fc8-b6be-24884720dee8",
  createdAt:"2026-08-18T17:17:23.103Z", requestedLocationPolicy:"cloudflare_automatic", actualRegion:"WNAM",
  jurisdiction:null, readReplication:"disabled", numTables:0, fileSizeBytes:12288, sqlExecuted:false,
  migrationsApplied:false, dataInserted:false, bindingInstalled:false,
  bindingVerification:{status:"INFERRED_UNBOUND", basis:"all_eight_workers_predate_database_creation", latestWorkerModifiedAt:"2026-08-11T16:43:02Z"},
}) || JSON.stringify(resourceCreationRecord.queue) !== JSON.stringify({
  operation:"create", outcome:"NOT_ATTEMPTED", name:"8978-ai-orchestrator-dev", expectedDeliveryDelaySeconds:0,
  expectedMessageRetentionSeconds:86400, postStopExistence:"UNVERIFIED", bindingInstalled:false,
  producerAdded:false, consumerAdded:false, messagePublished:false,
})) {
  throw new Error("Development resource creation partial result or stopped Queue state drifted");
}
if (!Object.values(resourceCreationRecord.externalEffects).every((value) => value === false) ||
    resourceCreationRecord.workflow.outcome !== "NOT_ATTEMPTED") {
  throw new Error("Development resource creation record cannot claim adjacent external effects");
}
if (resourceCreationCompletion.status !== "RESOURCE_CREATION_COMPLETED_UNBOUND" || resourceCreationCompletion.governing !== false ||
    resourceCreationCompletion.continuation.authorized !== false || resourceCreationCompletion.continuation.activationAuthorized !== false ||
    resourceCreationCompletion.continuation.workerDeploymentAuthorized !== false ||
    resourceCreationCompletion.ownerDecision.activationAuthorized !== false || resourceCreationCompletion.ownerDecision.workerDeploymentAuthorized !== false) {
  throw new Error("Development resource completion record cannot govern, activate, deploy, or continue");
}
for (const source of [resourceCreationCompletion.sourcePacket, resourceCreationCompletion.sourcePartialRecord]) {
  if (createHash("sha256").update(await readFile(source.path)).digest("hex") !== source.sha256) {
    throw new Error(`Development resource completion source drifted: ${source.path}`);
  }
}
if (resourceCreationCompletion.authorityDatabase.outcome !== "CREATED_UNCHANGED" ||
    resourceCreationCompletion.authorityDatabase.ownerAccepted !== true ||
    resourceCreationCompletion.authorityDatabase.deleteAuthorized !== false ||
    !["sqlExecuted", "migrationsApplied", "dataInserted", "bindingInstalled"].every((field) => resourceCreationCompletion.authorityDatabase[field] === false)) {
  throw new Error("Development resource completion cannot drift or expand D1 authorization");
}
if (JSON.stringify(resourceCreationCompletion.queue) !== JSON.stringify({
  operation:"create", outcome:"CREATED_OWNER_ATTESTED", name:"8978-ai-orchestrator-dev",
  queueId:"fe649364dd804ebd984297b68da6a534", createdAt:null, exactNameMatchCount:"UNVERIFIED_BY_TOOL",
  deliveryDelaySeconds:0, messageRetentionSeconds:86400, operationalStatus:"INACTIVE",
  inactivityAssessment:"EXPECTED_UNCONNECTED", bindingStatus:"OWNER_ATTESTED_NONE_WITH_TIMESTAMP_INFERENCE",
  producerStatus:"OWNER_ATTESTED_NONE", consumerStatus:"OWNER_ATTESTED_NONE",
  messagePublicationStatus:"UNVERIFIED", independentVerificationStatus:"TOOLING_UNAVAILABLE",
})) {
  throw new Error("Development Queue owner attestation or verification limitation drifted");
}
if (resourceCreationCompletion.sameNamedWorker.separateResourceNamespace !== true ||
    resourceCreationCompletion.sameNamedWorker.technicalCollision !== false ||
    resourceCreationCompletion.sameNamedWorker.renameAuthorized !== false ||
    resourceCreationCompletion.workflow.operation !== "NOT_ATTEMPTED" ||
    resourceCreationCompletion.workflow.existence !== "UNVERIFIED_TOOLING_UNAVAILABLE") {
  throw new Error("Development resource completion cannot fabricate Workflow state, collision, or rename authority");
}
if (resourceCreationCompletion.externalEffects.queueCreated !== true ||
    !Object.entries(resourceCreationCompletion.externalEffects).filter(([key]) => key !== "queueCreated").every(([, value]) => value === false)) {
  throw new Error("Development resource completion may record only the owner-attested Queue creation effect");
}
for (const migration of activationPlan.authorityDatabase.migrations) {
  const actual = createHash("sha256").update(await readFile(migration.path)).digest("hex");
  if (actual !== migration.sha256) throw new Error(`Development activation migration digest mismatch: ${migration.path}`);
}
if (authorityMigrationPacket.status !== "PLANNED" || authorityMigrationPacket.governing !== false ||
    authorityMigrationPacket.executionAuthorized !== false || authorityMigrationPacket.account.accountId !== null ||
    authorityMigrationPacket.foundationBaseline !== "ebd7a82dc47095814de2dc663c5615d60e87b0e1") {
  throw new Error("Development authority migration packet must remain non-governing, execution-disabled, and account-unresolved");
}
for (const source of [authorityMigrationPacket.sourcePlan, authorityMigrationPacket.sourceCompletionRecord]) {
  if (createHash("sha256").update(await readFile(source.path)).digest("hex") !== source.sha256) {
    throw new Error(`Development authority migration source drifted: ${source.path}`);
  }
}
if (createHash("sha256").update(await readFile(authorityMigrationPacket.migrationConfiguration.path)).digest("hex") !==
    authorityMigrationPacket.migrationConfiguration.sha256) {
  throw new Error("Development authority migration-only Wrangler configuration digest drifted");
}
if (JSON.stringify(authorityMigrationWrangler) !== JSON.stringify({
  $schema:"../node_modules/wrangler/config-schema.json", name:"8978-ai-authority-migrations-dev", compatibility_date:"2026-08-18",
  d1_databases:[{ binding:"AUTHORITY_DB", database_name:"8978-ai-authority-dev",
    database_id:"741ade94-8539-4fc8-b6be-24884720dee8", migrations_dir:"../migrations/authority" }],
}) || "main" in authorityMigrationWrangler) {
  throw new Error("Development authority migration configuration must remain migration-only and exact");
}
for (const forbidden of ["queues", "workflows", "routes", "services", "vars", "durable_objects"]) {
  if (forbidden in authorityMigrationWrangler) throw new Error(`Development authority migration configuration cannot include ${forbidden}`);
}
if (Array.isArray(wrangler.d1_databases) || JSON.stringify(authorityMigrationPacket.migration.migrations) !== JSON.stringify(AUTHORITY_MIGRATIONS)) {
  throw new Error("Development authority migrations cannot install a deployable binding or drift from the activation manifest");
}
let authorityTableCount = 0;
for (const migration of authorityMigrationPacket.migration.migrations) {
  const sql = await readFile(migration.path, "utf8");
  if (createHash("sha256").update(sql).digest("hex") !== migration.sha256 ||
      /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ATTACH|DETACH|VACUUM)\b/imu.test(sql)) {
    throw new Error(`Development authority migration is not the pinned DDL-only source: ${migration.path}`);
  }
  authorityTableCount += (sql.match(/\bCREATE\s+TABLE\b/giu) ?? []).length;
}
if (authorityTableCount !== 10 || authorityMigrationPacket.postMigrationBoundary.expectedTableCountIncludingMigrationBookkeeping !== 11) {
  throw new Error("Development authority migration expected table boundary drifted");
}
if (!authorityMigrationPacket.backup.timeTravelBookmarkRequired || !authorityMigrationPacket.backup.sqlExportRequired ||
    !authorityMigrationPacket.backup.exportSha256Required || authorityMigrationPacket.backup.commitExportToRepository ||
    authorityMigrationPacket.backup.restoreAuthorized || authorityMigrationPacket.backup.automaticRestoreAuthorized ||
    authorityMigrationPacket.migration.attemptLimit !== 1 || authorityMigrationPacket.migration.insertsAuthorityData ||
    authorityMigrationPacket.migration.seedsProjectKnowledge || authorityMigrationPacket.migration.writesActivationEvidence ||
    authorityMigrationPacket.postMigrationBoundary.remoteSchemaVerified ||
    !authorityMigrationPacket.postMigrationBoundary.activationPlanUpdateDeferred ||
    authorityMigrationPacket.partialFailurePolicy.automaticRestore || authorityMigrationPacket.partialFailurePolicy.automaticRetry ||
    authorityMigrationPacket.partialFailurePolicy.automaticCleanup) {
  throw new Error("Development authority migration backup, one-attempt, or post-migration boundary weakened");
}
for (const prohibited of [
  "install_or_update_runtime_binding", "create_or_deploy_worker", "create_or_trigger_workflow",
  "add_queue_producer_or_consumer", "publish_queue_message", "install_or_rotate_secret_or_key",
  "insert_update_or_delete_authority_data", "seed_project_knowledge", "write_activation_evidence",
  "certify_remote_schema", "update_activation_plan", "restore_database", "retry_migration_application",
  "delete_or_automatically_clean_up_resource", "touch_production_or_customer_resource", "reuse_or_modify_pk_d1_dev",
]) if (!authorityMigrationPacket.prohibitedOperations.includes(prohibited)) {
  throw new Error(`Development authority migration prohibition missing: ${prohibited}`);
}
if (createHash("sha256").update(await readFile("deployment/development-authority-migration-execution-packet.json")).digest("hex") !==
    REVIEWED_MIGRATION_PACKET_SHA256 || REVIEWED_MIGRATION_PACKET_COMMIT !== "b2e3188b28b7c9071e267e69e90c374650747035" ||
    AUTHORIZED_DEVELOPMENT_ACCOUNT_ID !== "de5e0273347b0b4c5f8f4e554aa2288f" ||
    MIGRATION_APPLY_COMMAND !== authorityMigrationPacket.commands.applyOnce) {
  throw new Error("Development migration execution-record contract source boundary drifted");
}
if (deploymentFiles.filter((file) => file === "development-authority-migration-execution-record.json").length !== 1) {
  throw new Error("Exactly one development authority migration execution record is required after authorized execution");
}
if (createHash("sha256").update(await readFile("deployment/development-authority-migration-execution-record.json")).digest("hex") !==
    "627dcf833b0ba5db15729e3916c246724f4f90c2919e374a4c3e4faeafaf16f1") {
  throw new Error("Development authority migration execution record digest drifted");
}
if (authorityMigrationRecordSchema.additionalProperties !== false ||
    JSON.stringify(authorityMigrationRecordSchema.properties?.status?.enum) !==
      JSON.stringify(["COMPLETED", "STOPPED_NO_MUTATION", "STOPPED_PARTIAL"]) ||
    authorityMigrationRecordSchema.properties?.governing?.const !== false ||
    authorityMigrationRecordSchema.properties?.source?.properties?.reviewedCommit?.const !== REVIEWED_MIGRATION_PACKET_COMMIT ||
    authorityMigrationRecordSchema.properties?.source?.properties?.packetSha256?.const !== REVIEWED_MIGRATION_PACKET_SHA256 ||
    authorityMigrationRecordSchema.properties?.authorization?.properties?.accountId?.const !== AUTHORIZED_DEVELOPMENT_ACCOUNT_ID ||
    authorityMigrationRecordSchema.properties?.authorization?.properties?.authorizedAttemptLimit?.const !== 1 ||
    authorityMigrationRecordSchema.properties?.postState?.properties?.remoteSchemaVerified?.const !== false) {
  throw new Error("Development authority migration execution-record schema boundary weakened");
}
if (JSON.stringify(ORDERED_AUTHORITY_MIGRATIONS) !== JSON.stringify(AUTHORITY_MIGRATIONS.map(({ path }) => path.split("/").at(-1)))) {
  throw new Error("Development authority migration execution-record filename order drifted");
}
for (const required of [
  "assertInvocationPrerequisites", "assertNoAdjacentEffects", "prefixLength", "authorizedAttemptLimit !== 1",
  "assertEvidenceConsistency", "Applied migration filenames require migration bookkeeping evidence",
  'record.status === "COMPLETED"', 'record.status === "STOPPED_NO_MUTATION"',
  '["FAILED", "INTERRUPTED", "AMBIGUOUS"]', "record.postState.migrationsApplied",
  "appliedCount >= ORDERED_AUTHORITY_MIGRATIONS.length",
  "record.postState.remoteSchemaVerified !== false", "Object.values(record.externalEffects)",
  "Object.values(record.partialFailurePolicy)", "record.errors.length === 0",
]) if (!authorityMigrationRecordValidatorSource.includes(required)) {
  throw new Error(`Development authority migration execution-record invariant missing: ${required}`);
}
if (/\bfetch\s*\(|\b(?:exec|spawn)\s*\(|process\.env|\.prepare\s*\(|\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM)\b/iu.test(authorityMigrationRecordValidatorSource)) {
  throw new Error("Development authority migration execution-record validator must remain pure and operation-free");
}
for (const source of [authoritySchemaInventoryPacket.sourceMigrationPacket,
  { path: authoritySchemaInventoryPacket.sourceExecutionRecordContract.schemaPath, sha256: authoritySchemaInventoryPacket.sourceExecutionRecordContract.schemaSha256 },
  { path: authoritySchemaInventoryPacket.sourceExecutionRecordContract.validatorPath, sha256: authoritySchemaInventoryPacket.sourceExecutionRecordContract.validatorSha256 }]) {
  if (createHash("sha256").update(await readFile(source.path)).digest("hex") !== source.sha256) {
    throw new Error(`Development authority schema inventory source drifted: ${source.path}`);
  }
}
if (authoritySchemaInventoryPacket.status !== "PLANNED" || authoritySchemaInventoryPacket.governing !== false ||
    authoritySchemaInventoryPacket.executionAuthorized !== false || authoritySchemaInventoryPacket.account.accountId !== null ||
    authoritySchemaInventoryPacket.prerequisite.recordSha256 !==
      "627dcf833b0ba5db15729e3916c246724f4f90c2919e374a4c3e4faeafaf16f1" ||
    authoritySchemaInventoryPacket.prerequisite.satisfied !== true ||
    authoritySchemaInventoryPacket.foundationBaseline !== "de948d58cd95328bbabb757b08d88bb75fea9d73") {
  throw new Error("Development authority schema inventory packet must preserve its accepted prerequisite and remain non-governing and execution-disabled");
}
if (authorityMigrationRecord.status !== authoritySchemaInventoryPacket.prerequisite.requiredStatus ||
    createHash("sha256").update(await readFile(authoritySchemaInventoryPacket.prerequisite.executionRecordPath)).digest("hex") !==
      authoritySchemaInventoryPacket.prerequisite.recordSha256) {
  throw new Error("Development authority schema inventory prerequisite drifted from the accepted migration record");
}
const derivedAuthorityTables = [];
const derivedAuthorityIndexes = [];
for (const migration of AUTHORITY_MIGRATIONS) {
  const sql = await readFile(migration.path, "utf8");
  derivedAuthorityTables.push(...[...sql.matchAll(/^CREATE TABLE ([a-z0-9_]+)/gimu)].map((match) => match[1]));
  derivedAuthorityIndexes.push(...[...sql.matchAll(/^CREATE (?:UNIQUE )?INDEX ([a-z0-9_]+)/gimu)].map((match) => match[1]));
}
const expectedInventoryTables = [...derivedAuthorityTables.sort(), "d1_migrations"];
if (JSON.stringify(authoritySchemaInventoryPacket.expectedInventory.tables) !== JSON.stringify(expectedInventoryTables) ||
    JSON.stringify(authoritySchemaInventoryPacket.expectedInventory.indexes) !== JSON.stringify(derivedAuthorityIndexes.sort()) ||
    JSON.stringify(authoritySchemaInventoryPacket.expectedInventory.appliedMigrations) !==
      JSON.stringify(AUTHORITY_MIGRATIONS.map(({ path }) => path.split("/").at(-1))) ||
    authoritySchemaInventoryPacket.expectedInventory.authorityTableRowCount !== 0) {
  throw new Error("Development authority schema inventory drifted from the six immutable migrations");
}
for (const [name, command] of Object.entries(authoritySchemaInventoryPacket.queries)) {
  if (name === "databaseInfo") {
    if (command !== "wrangler d1 info 8978-ai-authority-dev --json") throw new Error("Schema inventory D1 info command drifted");
    continue;
  }
  if (!command.startsWith("wrangler d1 execute 8978-ai-authority-dev --remote --config deployment/wrangler.authority-migrations.jsonc --command ") ||
      !command.endsWith(" --json") || /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM)\b/iu.test(command) ||
      !/(?:SELECT|PRAGMA)/u.test(command)) throw new Error(`Schema inventory query is not exact read-only D1 evidence: ${name}`);
}
if (Object.entries(authoritySchemaInventoryPacket.resultBoundary).some(([key, value]) =>
  ["activationPlanUpdateDeferred", "verificationRecordRequired"].includes(key) ? value !== true : value !== false)) {
  throw new Error("Development authority schema inventory packet cannot fabricate verification or update the activation plan");
}
for (const prohibited of [
  "execute_mutating_sql", "apply_or_create_migration", "insert_update_or_delete_authority_data",
  "install_or_update_runtime_binding", "create_or_deploy_worker", "create_or_trigger_workflow",
  "add_queue_producer_or_consumer", "publish_queue_message", "install_or_rotate_secret_or_key",
  "seed_project_knowledge", "write_activation_evidence", "certify_remote_schema_without_definition_evidence",
  "update_activation_plan", "restore_database", "retry_query_automatically",
  "delete_or_automatically_clean_up_resource", "touch_production_or_customer_resource",
]) if (!authoritySchemaInventoryPacket.prohibitedOperations.includes(prohibited)) {
  throw new Error(`Development authority schema inventory prohibition missing: ${prohibited}`);
}
if (deploymentFiles.filter((file) => file === "development-authority-schema-inventory-verification-record.json").length !== 1) {
  throw new Error("Exactly one development authority schema inventory verification record is required after authorized execution");
}
if (createHash("sha256").update(await readFile("deployment/development-authority-schema-inventory-verification-record.json")).digest("hex") !==
    "161550f81891b93205c7019bc55a3aaa26bead5c48abd61aeb6f6d4479b9acc5") {
  throw new Error("Development authority schema inventory verification candidate digest drifted");
}
if (!authoritySchemaInventoryRecord.independentReview.completed ||
    authoritySchemaInventoryRecord.independentReview.checkerPrincipalId !== "github-app:claude" ||
    authoritySchemaInventoryRecord.independentReview.checkerDigest !==
      "sha256:79de2cba03825223608e72da9f75440265177fa37e3db2ae82d828f070f8c16f" ||
    authoritySchemaInventoryRecord.independentReview.accepted ||
    authoritySchemaInventoryRecord.status !== "INCONCLUSIVE_READ_ONLY" || authoritySchemaInventoryRecord.governing ||
    Object.values(authoritySchemaInventoryRecord.conclusions).some(Boolean)) {
  throw new Error("Development authority schema inventory review deferral boundary drifted");
}
if (authoritySchemaInventoryRecordSchema.additionalProperties !== false ||
    authoritySchemaInventoryRecordSchema.properties?.source?.properties?.reviewedCommit?.const !== REVIEWED_SCHEMA_INVENTORY_PACKET_COMMIT ||
    authoritySchemaInventoryRecordSchema.properties?.source?.properties?.packetSha256?.const !== REVIEWED_SCHEMA_INVENTORY_PACKET_SHA256 ||
    authoritySchemaInventoryRecordSchema.properties?.source?.properties?.authorizedAccountId?.const !== AUTHORIZED_DEVELOPMENT_ACCOUNT_ID ||
    authoritySchemaInventoryRecordSchema.properties?.authorization?.properties?.ownerDecisionId?.minLength !== 1 ||
    authoritySchemaInventoryRecordSchema.properties?.independentReview?.properties?.checkerPrincipalId?.minLength !== 1 ||
    authoritySchemaInventoryRecordSchema.properties?.conclusions?.properties?.activationPlanUpdateAuthorized?.const !== false ||
    authoritySchemaInventoryRecordSchema.properties?.conclusions?.properties?.activationPlanUpdated?.const !== false) {
  throw new Error("Development authority schema inventory verification record schema boundary weakened");
}
if (createHash("sha256").update(await readFile(authoritySchemaInventoryPacket.sourceMigrationPacket.path)).digest("hex") !==
      authoritySchemaInventoryPacket.sourceMigrationPacket.sha256 ||
    createHash("sha256").update(await readFile("deployment/development-authority-schema-inventory-verification-packet.json")).digest("hex") !==
      REVIEWED_SCHEMA_INVENTORY_PACKET_SHA256) {
  throw new Error("Development authority schema inventory verification record source packet drifted");
}
if (JSON.stringify(ORDERED_SCHEMA_INVENTORY_QUERIES) !== JSON.stringify(Object.keys(authoritySchemaInventoryPacket.queries)) ||
    JSON.stringify(EXPECTED_AUTHORITY_TABLES) !== JSON.stringify(authoritySchemaInventoryPacket.expectedInventory.tables) ||
    JSON.stringify(EXPECTED_AUTHORITY_INDEXES) !== JSON.stringify(authoritySchemaInventoryPacket.expectedInventory.indexes) ||
    JSON.stringify(EXPECTED_AUTHORITY_MIGRATIONS) !== JSON.stringify(authoritySchemaInventoryPacket.expectedInventory.appliedMigrations)) {
  throw new Error("Development authority schema inventory verification record expectations drifted from its packet");
}
for (const required of [
  "assertInvocationPrerequisites", "assertNoAdjacentEffects", "assertObservationConsistency",
  "assertQueryEvidenceConsistency(record);", "assertIndependentReviewConsistency", "assertVerified",
  "record.authorization.ownerDecisionId.length === 0",
  "typeof record.authorization.ownerAuthorizationDigest !== \"string\"",
  "record.status === \"VERIFIED\"", "record.status === \"STOPPED_NO_QUERY\"",
  "INCONCLUSIVE_READ_ONLY", "ORDERED_SCHEMA_INVENTORY_QUERIES.slice(0, invokedCount)",
  "Uninvoked schema queries cannot carry result evidence", "Uninvoked schema queries cannot carry retrieved observations",
  "Schema query result evidence must match its retrieved observation",
  "digested && missingResultSeen",
  "Schema query result evidence must form an ordered prefix",
  "record.execution.outcome === \"SUCCEEDED\"",
  "Successful schema verification execution must carry every reviewed query result",
  "record.independentReview.checkerPrincipalId === record.operator.principalId",
  "record.observations.authorityData.rowCount !== 0", "record.observations.integrity.result !== \"ok\"",
  "typeof record.independentReview.checkerPrincipalId !== \"string\"",
  "record.independentReview.checkerPrincipalId.length === 0",
  "identified !== digested",
  "record.independentReview.completed !== (identified && digested)",
  "record.independentReview.accepted && !record.independentReview.completed",
  "Object.values(record.externalEffects)", "Object.values(record.failurePolicy)",
  "record.conclusions.activationPlanUpdateAuthorized", "record.conclusions.activationPlanUpdated",
]) if (!authoritySchemaInventoryRecordValidatorSource.includes(required)) {
  throw new Error(`Development authority schema inventory verification record invariant missing: ${required}`);
}
if (/\bfetch\s*\(|\b(?:exec|spawn)\s*\(|process\.env|\.prepare\s*\(|\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM)\b/iu.test(authoritySchemaInventoryRecordValidatorSource)) {
  throw new Error("Development authority schema inventory verification record validator must remain pure and operation-free");
}
for (const required of [
  '"pk-d1-dev"', '"9cd8094c-f334-44e6-bdd1-b325802474d5"', 'databaseName !== "8978-ai-authority-dev"',
  'Existing authority database reuse is prohibited',
  'binding !== "AUTHORITY_DB"', 'binding !== "ORCHESTRATOR_WORKFLOW"', 'binding !== "ORCHESTRATOR_QUEUE"',
  'plan.status !== "READY"', 'plan.activationAuthorized', 'plan.workerDeploymentAuthorized',
  'plan.rollback.backupDigest === null', 'maker and checker evidence must be independent',
  'Resource activation and Worker deployment authorizations must be distinct',
  'typeof evidenceVerifier.verify !== "function"', 'independent_evidence_verifier_unavailable',
  'independent_evidence_verification_failed', 'verification.makerPrincipalId === verification.checkerPrincipalId',
  'verification.ownerPrincipalId === verification.makerPrincipalId',
  'verification.resourceActivationAuthorizationDigest !== evidence.resourceActivationAuthorizationDigest',
]) if (!activationPreflightSource.includes(required)) throw new Error(`Development activation preflight invariant missing: ${required}`);
const activationDangerousPattern = /\bfetch\s*\(|\b(?:exec|spawn)\s*\(|\bwrangler\b|\.prepare\s*\(|\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/iu;
if (activationDangerousPattern.test(activationPreflightSource)) throw new Error("Development activation preflight must remain validation-only");
if (workerSource.includes("development-activation-preflight") || developmentRuntimeSource.includes("development-activation-preflight")) {
  throw new Error("Development activation preflight cannot be imported by the Worker runtime");
}
for (const required of [
  "AuthenticatedDevelopmentActivationEvidenceVerifier", "developmentActivationPurposeDigest",
  "digestDevelopmentActivationOwnerDecision", 'structuredClone(await this.bundleProvider.read(requestedEvidence, { now }))',
  "function verificationTime(value)", 'now: requestedNow = this.now()',
  "const now = verificationTime(requestedNow)",
  '"maker_validation"', '"checker_validation"', '"resource_activation_authorization"',
  '"worker_deployment_authorization"', '"rollback_evidence"', '"backup_evidence"',
  "Development activation evidence digests must be unique",
  "Development activation evidence bundle provider is unavailable",
  "Development activation identity verifier is unavailable", "Development activation owner verifier is unavailable",
  'role: "maker", actionDigest: purposes.maker_validation',
  'role: "checker", actionDigest: purposes.checker_validation',
  'role: "checker", actionDigest: purposes.rollback_evidence',
  'role: "maker", actionDigest: purposes.backup_evidence',
  "purposes.resource_activation_authorization", "purposes.worker_deployment_authorization",
  "this.ownerVerifier.verify(bundle.resourceActivationDecision",
  "this.ownerVerifier.verify(bundle.workerDeploymentDecision",
  "resourcePayload.decisionId === workerPayload.decisionId", "resourceApproved !== true || workerApproved !== true",
  "resourceDigest !== evidence.resourceActivationAuthorizationDigest",
  "workerDigest !== evidence.workerDeploymentAuthorizationDigest",
  "maker.principalId !== backup.principalId", "checker.principalId !== rollback.principalId",
  "resourcePayload.decidedBy !== workerPayload.decidedBy",
  "new Set(principals).size !== principals.length", "verificationDigest = await digestCanonicalValue",
]) if (!activationEvidenceVerifierSource.includes(required)) {
  throw new Error(`Development activation evidence verifier invariant missing: ${required}`);
}
if ((activationEvidenceVerifierSource.match(/this\.now\(\)/gu) ?? []).length !== 1 ||
    !/function verificationTime\(value\) \{\s*if \(!\(value instanceof Date\) \|\| !Number\.isSafeInteger\(value\.valueOf\(\)\)\)/u.test(activationEvidenceVerifierSource) ||
    !/async verify\(evidence, \{ now: requestedNow = this\.now\(\) \} = \{\}\) \{\s*assertEvidence\(evidence\);\s*const now = verificationTime\(requestedNow\);/u.test(activationEvidenceVerifierSource) ||
    !/this\.bundleProvider\.read\(requestedEvidence, \{ now \}\)/u.test(activationEvidenceVerifierSource)) {
  throw new Error("Development activation evidence verifier must capture and propagate exactly one verification time");
}
const activationIdentityPurposePatterns = [
  ["maker validation", /identityVerifier\.verify\(bundle\.makerValidationAttestation, \{\s*role: "maker", actionDigest: purposes\.maker_validation, now,/u],
  ["checker validation", /identityVerifier\.verify\(bundle\.checkerValidationAttestation, \{\s*role: "checker", actionDigest: purposes\.checker_validation, now,/u],
  ["rollback evidence", /identityVerifier\.verify\(bundle\.rollbackAttestation, \{\s*role: "checker", actionDigest: purposes\.rollback_evidence, now,/u],
  ["backup evidence", /identityVerifier\.verify\(bundle\.backupAttestation, \{\s*role: "maker", actionDigest: purposes\.backup_evidence, now,/u],
];
for (const [label, pattern] of activationIdentityPurposePatterns) {
  if (!pattern.test(activationEvidenceVerifierSource)) {
    throw new Error(`Development activation identity purpose binding missing: ${label}`);
  }
}
if (activationDangerousPattern.test(activationEvidenceVerifierSource) ||
    /privateKey|SERVICE_AUTH_KEYS_JSON|Proxy-Authorization/u.test(activationEvidenceVerifierSource)) {
  throw new Error("Development activation evidence verifier must remain validation-only and public-key-only");
}
if (workerSource.includes("development-activation-evidence-verifier") ||
    developmentRuntimeSource.includes("development-activation-evidence-verifier")) {
  throw new Error("Development activation evidence verifier cannot be imported by the Worker runtime");
}
if (!secretScanSource.includes('"deployment"')) throw new Error("Deployment manifests must remain inside the default secret-scan roots");

if (wrangler.name !== "8978-ai-control-plane-dev" || wrangler.main !== "src/control-plane-worker.js") throw new Error("Worker must remain development-scoped with the reviewed entry point");
if (wrangler.compatibility_date !== "2026-08-12" || !wrangler.compatibility_flags?.includes("nodejs_compat")) throw new Error("Worker compatibility configuration changed without review");
if (wrangler.workers_dev !== false || wrangler.preview_urls !== false) throw new Error("Development Worker cannot expose workers.dev or preview URLs");
if (wrangler.vars?.CONTROL_PLANE_MODE !== "development" || wrangler.vars?.ALLOW_EXTERNAL_WRITES !== "false") throw new Error("Worker external-write boundary must remain fail closed");
if (Object.hasOwn(wrangler.vars ?? {}, "SERVICE_AUTH_KEYS_JSON")) throw new Error("Service-auth keys must be secret bindings, never plaintext vars");
for (const binding of ["d1_databases", "r2_buckets", "queues", "workflows", "services", "hyperdrive", "vectorize"]) {
  if (wrangler[binding] !== undefined) throw new Error(`Development Worker cannot add ${binding} bindings in this foundation`);
}
const durableBindings = wrangler.durable_objects?.bindings ?? [];
const expectedDurableBindings = [
  ["SERVICE_AUTH_REPLAY", "ServiceAuthReplayDurableObject"],
  ["IDEMPOTENCY_STORE", "IdempotencyStateDurableObject"],
  ["OWNER_DECISION_STORE", "OwnerDecisionStateDurableObject"],
  ["AUDIT_STORE", "AuditStateDurableObject"],
];
if (JSON.stringify(durableBindings.map(({ name, class_name: className }) => [name, className])) !== JSON.stringify(expectedDurableBindings)) throw new Error("Worker Durable Object bindings must remain exact and ordered");
if (wrangler.migrations?.length !== 2 || wrangler.migrations[0].tag !== "v1" || JSON.stringify(wrangler.migrations[0].new_sqlite_classes) !== JSON.stringify(["ServiceAuthReplayDurableObject"]) ||
    wrangler.migrations[1].tag !== "v2" || JSON.stringify(wrangler.migrations[1].new_sqlite_classes) !== JSON.stringify(["IdempotencyStateDurableObject", "OwnerDecisionStateDurableObject", "AuditStateDurableObject"])) throw new Error("Worker SQLite Durable Object migrations must preserve v1 replay and exact v2 durable state classes");
for (const required of ["authenticateServiceRequest", "CloudflareDurableReplayStore", "PolicyGateway.create", "execution_disabled", "authorization", "proxy-authorization"]) {
  if (!workerSource.includes(required)) throw new Error(`Worker fail-closed invariant missing: ${required}`);
}
for (const required of ["IDEMPOTENCY_STORE", "OWNER_DECISION_STORE", "AUDIT_STORE", "createDevelopmentRuntime", "durableDependencies"]) {
  if (!workerSource.includes(required)) throw new Error(`Worker durable-state wiring missing: ${required}`);
}
for (const required of ["transactionSync", "this.ctx.id.name !== decisionId", "ON CONFLICT(id) DO NOTHING", "UPDATE audit_head SET scope=COALESCE(scope", "Audit append contention limit exceeded"]) {
  if (!durableStateSource.includes(required)) throw new Error(`Durable-state atomicity invariant missing: ${required}`);
}
if (/DELETE FROM audit_events/iu.test(durableStateSource) || /\bfetch\s*\(/u.test(durableStateSource + durableAdapterSource)) throw new Error("Durable state cannot delete audit events or use external fetch");

for (const required of [
  "D1AuthoritativeResourceResolver", "D1TrustedLimitProvider", "status IN ('CURRENT', 'FINAL')",
  "valid_from_ms <= ?2", "valid_from_ms <= ?3", ".bind(...bindings).all()", "digestCanonicalValue(resource)",
  "resourceKey(resource) !== row.resource_key", "Authoritative ${label} is ambiguous", "actionDigest",
]) if (!authorityAdapterSource.includes(required)) throw new Error(`Authoritative D1 read invariant missing: ${required}`);
const writeSqlPattern = /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE\s+[A-Za-z_]|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|INDEX|VIEW|TRIGGER)|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE|PRAGMA\b|ATTACH\s+(?:DATABASE\s+)?|DETACH\s+(?:DATABASE\s+)?|VACUUM\b|REINDEX\b)/iu;
for (const required of [
  "D1DevelopmentActivationEvidenceBundleProvider",
  "FROM authority_development_activation_evidence_bundles",
  "reviewed_commit = ?1", "maker_validation_digest = ?2", "checker_validation_digest = ?3",
  "resource_activation_authorization_digest = ?4", "worker_deployment_authorization_digest = ?5",
  "rollback_evidence_digest = ?6", "backup_digest = ?7",
  "enabled = 1 AND status IN ('CURRENT', 'FINAL')", "issued_at_ms <= ?8 AND expires_at_ms > ?8",
  "evidence.reviewedCommit", "evidence.makerValidationDigest", "evidence.checkerValidationDigest",
  "evidence.resourceActivationAuthorizationDigest", "evidence.workerDeploymentAuthorizationDigest",
  "evidence.rollbackEvidenceDigest", "evidence.backupDigest", ").all()",
  "Development activation evidence bundle unavailable", "Development activation evidence bundle is ambiguous",
  "parseJsonStrict(row.bundle_json)", "canonicalize(bundle) !== row.bundle_json",
  "const MAX_BUNDLE_BYTES = 65_536", "encoder.encode(row.bundle_json).byteLength > MAX_BUNDLE_BYTES",
  'component(row.record_id, "evidence bundle record ID")',
  "digestCanonicalValue(bundle) !== row.bundle_digest", "digestCanonicalValue(record) !== row.record_digest",
  "Development activation evidence digests must be unique", "return freeze(bundle)",
]) if (!activationEvidenceProviderSource.includes(required)) {
  throw new Error(`Development activation evidence provider invariant missing: ${required}`);
}
if (writeSqlPattern.test(activationEvidenceProviderSource) || /\bfetch\s*\(/u.test(activationEvidenceProviderSource) ||
    /privateKey|SERVICE_AUTH_KEYS_JSON|Proxy-Authorization/u.test(activationEvidenceProviderSource)) {
  throw new Error("Development activation evidence provider must remain read-only, fetch-free, and public-key-only");
}
if (workerSource.includes("d1-development-activation-evidence-provider") ||
    developmentRuntimeSource.includes("d1-development-activation-evidence-provider")) {
  throw new Error("Development activation evidence provider cannot be imported by the Worker runtime");
}
for (const required of [
  "AuthenticatedDevelopmentActivationEvidenceWriter", "authenticateServiceRequest",
  "const MAX_BODY_BYTES = 65_536", "const MAX_VALIDITY_MS = 86_400_000",
  'typeof secretResolver.resolve !== "function"', "replayStore.atomic !== true",
  'replayStore.durability !== "durable"', 'typeof replayStore.consume !== "function"',
  'typeof identityVerifier.verify !== "function"', 'typeof ownerVerifier.verify !== "function"',
  "!COMMIT.test(reviewedCommit)",
  'request.method !== "POST"', 'target.pathname !== "/v1/development-activation/evidence"', 'target.search !== ""',
  'request.headers.has("authorization")', 'request.headers.has("proxy-authorization")',
  'request.headers.get("content-type") !== "application/json"', "maxBodyBytes: MAX_BODY_BYTES",
  "identity.principalId !== this.authorizedWriter.principalId", "identity.keyId !== this.authorizedWriter.keyId",
  "allowedClockSkewMs > 300_000", "Object.freeze(this)",
  'new TextDecoder("utf-8", { fatal: true })', "parseJsonStrict(text)", "canonicalize(value) !== text",
  'request.status !== "CURRENT"', "request.version !== 1",
  "request.evidence?.reviewedCommit !== expectedCommit", "expiresAtMs - issuedAtMs > MAX_VALIDITY_MS",
  "AuthenticatedDevelopmentActivationEvidenceVerifier", "canonicalize(evidence) !== canonicalize(value.evidence)",
  "structuredClone(value.bundle)", "verified.makerPrincipalId",
  "verified.checkerPrincipalId", "verified.ownerPrincipalId", "includes(identity.principalId)",
  "digestCanonicalValue(value.bundle)", "digestCanonicalValue(record)", "digestCanonicalValue(writeRecord)",
  "this.database.batch([", "INSERT INTO authority_development_activation_evidence_bundles",
  "WHERE NOT EXISTS (", "WHERE reviewed_commit = ?2 AND enabled = 1 AND status IN ('CURRENT', 'FINAL')",
  "INSERT INTO authority_development_activation_evidence_writes", "identity.bodyDigest",
  "identity.principalId", "identity.keyId", "identity.nonce", "Date.parse(identity.issuedAt)",
  "return freeze({", "inserted: true", 'status: "CURRENT"',
]) if (!activationEvidenceWriterSource.includes(required)) {
  throw new Error(`Development activation evidence writer invariant missing: ${required}`);
}
for (const [label, pattern] of [
  ["HMAC authentication call", /\bconst authenticated = await authenticateServiceRequest\(\{/u],
  ["authorized principal and key", /identity\.principalId !== this\.authorizedWriter\.principalId \|\| identity\.keyId !== this\.authorizedWriter\.keyId/u],
  ["maker/checker/owner independence", /\[verified\.makerPrincipalId, verified\.checkerPrincipalId, verified\.ownerPrincipalId\]\s*\.includes\(identity\.principalId\)/u],
  ["atomic D1 batch", /await this\.database\.batch\(\[\s*this\.database\.prepare\(`/u],
]) if (!pattern.test(activationEvidenceWriterSource)) {
  throw new Error(`Development activation evidence writer ${label} invariant missing`);
}
const writerInsertions = activationEvidenceWriterSource.match(/\bINSERT\s+INTO\s+authority_development_activation_evidence_(?:bundles|writes)\b/gu) ?? [];
if (writerInsertions.length !== 2 || /\b(?:UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/iu.test(activationEvidenceWriterSource) ||
    /\bfetch\s*\(|privateKey|SERVICE_AUTH_KEYS_JSON|\bwrangler\b/iu.test(activationEvidenceWriterSource)) {
  throw new Error("Development activation evidence writer must remain two-insert-only, fetch-free, and secret-binding-independent");
}
if (workerSource.includes("authenticated-development-activation-evidence-writer") ||
    developmentRuntimeSource.includes("authenticated-development-activation-evidence-writer")) {
  throw new Error("Development activation evidence writer cannot be imported by the Worker runtime");
}
for (const required of [
  "D1DevelopmentActivationEvidenceWriteVerifier", 'typeof database.prepare !== "function"',
  "assertAuthorizedWriter(authorizedWriter)", "!COMMIT.test(reviewedCommit)",
  "assertEvidence(evidence, this.reviewedCommit)", "Development activation evidence digests must be unique",
  "FROM authority_development_activation_evidence_bundles AS bundles",
  "INNER JOIN authority_development_activation_evidence_writes AS writes",
  "ON writes.record_id = bundles.record_id", "bundles.reviewed_commit = ?1",
  "bundles.maker_validation_digest = ?2", "bundles.checker_validation_digest = ?3",
  "bundles.resource_activation_authorization_digest = ?4",
  "bundles.worker_deployment_authorization_digest = ?5", "bundles.rollback_evidence_digest = ?6",
  "bundles.backup_digest = ?7", "bundles.enabled = 1 AND bundles.status = 'CURRENT'",
  "bundles.issued_at_ms <= ?8 AND bundles.expires_at_ms > ?8", ").all()",
  "Development activation evidence write receipt unavailable",
  "Development activation evidence write receipt is ambiguous",
  "row.write_id !== row.record_id", "row.write_record_digest !== row.record_digest",
  "row.service_principal_id !== this.authorizedWriter.principalId",
  "row.service_key_id !== this.authorizedWriter.keyId", 'row.status !== "CURRENT"',
  "row.record_version !== 1", "row.write_version !== 1", "row.authenticated_at_ms > row.inserted_at_ms",
  "row.inserted_at_ms < row.issued_at_ms", "row.inserted_at_ms >= row.expires_at_ms",
  "digestCanonicalValue(record) !== row.record_digest",
  "digestCanonicalValue(writeRecord) !== row.write_digest", "verificationDigest = await digestCanonicalValue",
  "evidence,", "recordDigest: row.record_digest", "writeDigest: row.write_digest", "return freeze({",
]) if (!activationEvidenceWriteVerifierSource.includes(required)) {
  throw new Error(`Development activation evidence write verifier invariant missing: ${required}`);
}
for (const [label, pattern] of [
  ["exact join", /FROM authority_development_activation_evidence_bundles AS bundles\s+INNER JOIN authority_development_activation_evidence_writes AS writes\s+ON writes\.record_id = bundles\.record_id/u],
  ["exact cardinality", /if \(response\.results\.length !== 1\) \{\s*throw new Error\("Development activation evidence write receipt is ambiguous"\);\s*\}/u],
  ["current validity", /bundles\.enabled = 1 AND bundles\.status = 'CURRENT'\s+AND bundles\.issued_at_ms <= \?8 AND bundles\.expires_at_ms > \?8/u],
  ["authorized writer binding", /row\.service_principal_id !== this\.authorizedWriter\.principalId \|\|\s*row\.service_key_id !== this\.authorizedWriter\.keyId/u],
  ["record and write binding", /row\.write_id !== row\.record_id \|\| row\.write_record_digest !== row\.record_digest/u],
  ["exact versions", /row\.status !== "CURRENT" \|\| row\.record_version !== 1 \|\| row\.write_version !== 1/u],
  ["temporal ordering", /row\.expires_at_ms <= row\.issued_at_ms \|\| row\.inserted_at_ms < row\.issued_at_ms \|\|\s*row\.inserted_at_ms >= row\.expires_at_ms \|\| row\.authenticated_at_ms > row\.inserted_at_ms/u],
  ["record integrity", /if \(await digestCanonicalValue\(record\) !== row\.record_digest\)/u],
  ["write integrity", /if \(await digestCanonicalValue\(writeRecord\) !== row\.write_digest\)/u],
  ["verification digest", /digestCanonicalValue\(\{\s*evidence,\s*recordDigest: row\.record_digest,\s*writeDigest: row\.write_digest,\s*schemaVersion: "1\.0\.0",\s*\}\)/u],
]) if (!pattern.test(activationEvidenceWriteVerifierSource)) {
  throw new Error(`Development activation evidence write verifier ${label} invariant missing`);
}
if ((activationEvidenceWriteVerifierSource.match(/this\.database\.prepare\(/gu) ?? []).length !== 1 ||
    writeSqlPattern.test(activationEvidenceWriteVerifierSource) || /\.(?:run|batch)\s*\(/u.test(activationEvidenceWriteVerifierSource) ||
    /\bfetch\s*\(|privateKey|SERVICE_AUTH_KEYS_JSON|Bearer|OAuth|headers\.has|\bwrangler\b/iu.test(activationEvidenceWriteVerifierSource)) {
  throw new Error("Development activation evidence write verifier must remain one-query, read-only, fetch-free, and secret-independent");
}
if (workerSource.includes("d1-development-activation-evidence-write-verifier") ||
    developmentRuntimeSource.includes("d1-development-activation-evidence-write-verifier")) {
  throw new Error("Development activation evidence write verifier cannot be imported by the Worker runtime");
}
for (const required of [
  "new D1DevelopmentActivationEvidenceWriteVerifier(env.AUTHORITY_DB", "authorizedWriter:",
  "recordDigest: receipt.recordDigest", "requestBodyDigest: receipt.requestBodyDigest",
  "writeDigest: receipt.writeDigest", "servicePrincipalId: WRITER.principalId",
]) if (!activationEvidenceWriterTestSource.includes(required)) {
  throw new Error(`Actual activation evidence writer interoperability test missing: ${required}`);
}
for (const required of [
  'status: "FINAL"', 'principalId: "wrong-writer"', "rejects.toThrow(/ambiguous/)",
  "rejects.toThrow(/record integrity/)", "rejects.toThrow(/receipt integrity/)",
  'SET request_body_digest = \'invalid\'', 'SET service_nonce = \'invalid nonce\'',
  'SET service_key_id = \'wrong-key\'', "rejects.toThrow(/receipt is invalid/)",
]) if (!activationEvidenceWriteVerifierTestSource.includes(required)) {
  throw new Error(`Development activation evidence write verifier negative coverage missing: ${required}`);
}
for (const required of [
  "AuthenticatedDevelopmentActivationEvidenceChainVerifier",
  'assertVerifier(evidenceVerifier, "verify", "evidence verifier")',
  'assertVerifier(writeReceiptVerifier, "verify", "write receipt verifier")',
  'typeof now !== "function"', "assertEvidence(evidence)",
  "Development activation evidence digests must be unique", "const requestedEvidence = Object.freeze({ ...evidence })",
  "this.evidenceVerifier.verify(requestedEvidence, { now })", "this.writeReceiptVerifier.verify(requestedEvidence, { now })",
  "structuredClone(result)", "assertEvidenceResult(evidenceResult, requestedEvidence)",
  "assertWriteResult(writeResult, requestedEvidence)", "result.valid !== true",
  "result[field] !== evidence[field]", "result.reviewedCommit !== evidence.reviewedCommit",
  "Development activation maker, checker, and owner must be distinct principals",
  ".includes(writeResult.servicePrincipalId)",
  "Development activation writer must be independent of maker, checker, and owner",
  "evidenceVerificationDigest: evidenceResult.verificationDigest",
  "writeReceiptVerificationDigest: writeResult.verificationDigest",
  "authenticatedAt: writeResult.authenticatedAt", "insertedAt: writeResult.insertedAt",
  "recordDigest: writeResult.recordDigest", "recordId: writeResult.recordId",
  "requestBodyDigest: writeResult.requestBodyDigest", "writeDigest: writeResult.writeDigest",
  "writerKeyId: writeResult.serviceKeyId", "writerPrincipalId: writeResult.servicePrincipalId",
  'schemaVersion: "1.0.0"',
  "return Object.freeze({", "verificationDigest,",
]) if (!activationEvidenceChainVerifierSource.includes(required)) {
  throw new Error(`Development activation evidence chain verifier invariant missing: ${required}`);
}
for (const [label, pattern] of [
  ["dual verification", /Promise\.all\(\[\s*this\.evidenceVerifier\.verify\(requestedEvidence, \{ now \}\),\s*this\.writeReceiptVerifier\.verify\(requestedEvidence, \{ now \}\),\s*\]\)/u],
  ["clock validation", /if \(!\(now instanceof Date\) \|\| !Number\.isSafeInteger\(now\.valueOf\(\)\)\)/u],
  ["evidence result validity", /function assertEvidenceResult\(result, evidence\) \{[\s\S]*?if \(result\.valid !== true\) throw new Error\("Development activation evidence verification failed"\);/u],
  ["write result validity", /function assertWriteResult\(result, evidence\) \{[\s\S]*?if \(result\.valid !== true \|\| result\.reviewedCommit !== evidence\.reviewedCommit\)/u],
  ["evidence binding", /for \(const field of EVIDENCE_FIELDS\) \{\s*if \(result\[field\] !== evidence\[field\]\)/u],
  ["role independence", /new Set\(\[result\.makerPrincipalId, result\.checkerPrincipalId, result\.ownerPrincipalId\]\)\.size !== 3/u],
  ["writer independence", /\[evidenceResult\.makerPrincipalId, evidenceResult\.checkerPrincipalId, evidenceResult\.ownerPrincipalId\]\s*\.includes\(writeResult\.servicePrincipalId\)/u],
  ["chain digest", /digestCanonicalValue\(\{\s*authenticatedAt: writeResult\.authenticatedAt,\s*evidence: requestedEvidence,\s*evidenceVerificationDigest: evidenceResult\.verificationDigest,\s*insertedAt: writeResult\.insertedAt,[\s\S]*?recordDigest: writeResult\.recordDigest,\s*recordId: writeResult\.recordId,\s*requestBodyDigest: writeResult\.requestBodyDigest,\s*schemaVersion: "1\.0\.0",\s*writeDigest: writeResult\.writeDigest,\s*writeReceiptVerificationDigest: writeResult\.verificationDigest,\s*writerKeyId: writeResult\.serviceKeyId,\s*\}\)/u],
]) if (!pattern.test(activationEvidenceChainVerifierSource)) {
  throw new Error(`Development activation evidence chain verifier ${label} invariant missing`);
}
if (activationDangerousPattern.test(activationEvidenceChainVerifierSource) ||
    /\bSELECT\b|privateKey|SERVICE_AUTH_KEYS_JSON|Bearer|OAuth|headers\.|\bwrangler\b/iu.test(activationEvidenceChainVerifierSource)) {
  throw new Error("Development activation evidence chain verifier must remain composition-only, validation-only, and secret-independent");
}
if (workerSource.includes("development-activation-evidence-chain-verifier") ||
    developmentRuntimeSource.includes("development-activation-evidence-chain-verifier") ||
    activationPreflightSource.includes("development-activation-evidence-chain-verifier")) {
  throw new Error("Development activation evidence chain verifier cannot be imported by runtime or preflight");
}
for (const required of [
  "createD1DevelopmentActivationEvidenceChainVerifier(env.AUTHORITY_DB, {",
  "authorizedWriter: { principalId: WRITER.principalId, keyId: WRITER.keyId }",
  "reviewedCommit: COMMIT", "now: () => now", "makerPrincipalId: \"activation-maker\"",
  "checkerPrincipalId: \"activation-checker\"", "ownerPrincipalId: \"activation-owner\"",
]) if (!activationEvidenceWriterTestSource.includes(required)) {
  throw new Error(`Actual activation evidence chain interoperability test missing: ${required}`);
}
for (const required of [
  "binds both independent verification receipts", "constructors, requests, and clocks fail closed",
  "rejects malformed or mismatched dependency receipts", "re-enforces all four principal independence boundaries",
  "assert.equal(evidenceRequest, writeRequest)", "Object.isFrozen(evidenceRequest)",
  'evidenceValue: evidenceResult({ valid: false })', 'writeValue: writeResult({ valid: false })',
  'servicePrincipalId of ["maker-principal", "checker-principal", "owner-principal"]',
  "assert.equal(evidenceNow, NOW)", "assert.equal(writeNow, NOW)",
]) if (!activationEvidenceChainVerifierTestSource.includes(required)) {
  throw new Error(`Development activation evidence chain verifier behavioral coverage missing: ${required}`);
}
for (const required of [
  "propagates one exact validated verification instant through every evidence dependency",
  "expect(providerNow).toBe(NOW)", "expect(identityNows).toHaveLength(4)",
  "expect(ownerNows).toHaveLength(2)", "value === NOW", 'now: new Date("invalid")',
  "now: { valueOf: () => NOW.valueOf() }",
]) if (!activationEvidenceVerifierTestSource.includes(required)) {
  throw new Error(`Development activation single-clock behavioral coverage missing: ${required}`);
}
for (const required of [
  "evidenceVerifier.verify(value.evidence, { now })", "now: () => now",
]) if (!activationEvidenceWriterTestSource.includes(required)) {
  throw new Error(`Actual activation evidence single-clock interoperability missing: ${required}`);
}
for (const required of [
  "createD1DevelopmentActivationEvidenceChainVerifier", "exactOptions(options)",
  'Object.freeze(["authorizedWriter", "now", "reviewedCommit"])',
  'typeof now !== "function"', "new D1DevelopmentActivationEvidenceBundleProvider(database)",
  "new D1Ed25519IdentityVerifier(database)", "new D1Ed25519OwnerDecisionVerifier(database)",
  "new AuthenticatedDevelopmentActivationEvidenceVerifier({", "bundleProvider:", "identityVerifier:",
  "ownerVerifier:", "new D1DevelopmentActivationEvidenceWriteVerifier(database, {",
  "authorizedWriter,", "reviewedCommit,", "new AuthenticatedDevelopmentActivationEvidenceChainVerifier({",
  "evidenceVerifier,", "writeReceiptVerifier,", "now,",
]) if (!activationEvidenceRuntimeCompositionSource.includes(required)) {
  throw new Error(`D1 development activation evidence composition invariant missing: ${required}`);
}
for (const [label, pattern] of [
  ["exact options", /JSON\.stringify\(Object\.keys\(value\)\.sort\(\)\) !== JSON\.stringify\(OPTION_FIELDS\)/u],
  ["single database", /new D1DevelopmentActivationEvidenceBundleProvider\(database\)[\s\S]*?new D1Ed25519IdentityVerifier\(database\)[\s\S]*?new D1Ed25519OwnerDecisionVerifier\(database\)[\s\S]*?new D1DevelopmentActivationEvidenceWriteVerifier\(database,/u],
  ["single clock", /new AuthenticatedDevelopmentActivationEvidenceVerifier\(\{[\s\S]*?now,[\s\S]*?new AuthenticatedDevelopmentActivationEvidenceChainVerifier\(\{[\s\S]*?now,/u],
]) if (!pattern.test(activationEvidenceRuntimeCompositionSource)) {
  throw new Error(`D1 development activation evidence composition ${label} invariant missing`);
}
if (activationDangerousPattern.test(activationEvidenceRuntimeCompositionSource) ||
    /privateKey|secretResolver|SERVICE_AUTH_KEYS_JSON|Bearer|OAuth|headers\.|Request\b|globalThis|__DEFAULT_AUTHORITY_DB__|process\.env/iu.test(activationEvidenceRuntimeCompositionSource)) {
  throw new Error("D1 development activation evidence composition must remain construction-only, ambient-state-independent, and secret-independent");
}
if (workerSource.includes("d1-development-activation-evidence-runtime-composition") ||
    developmentRuntimeSource.includes("d1-development-activation-evidence-runtime-composition") ||
    activationPreflightSource.includes("d1-development-activation-evidence-runtime-composition")) {
  throw new Error("D1 development activation evidence composition cannot be imported by runtime or preflight");
}
for (const required of [
  "constructs the exact reviewed single-clock chain", "rejects missing, extra, or malformed authority inputs",
  'chain.now, now', 'chain.evidenceVerifier.now, now',
  'chain.evidenceVerifier.bundleProvider.database, database',
  'chain.evidenceVerifier.identityVerifier.database, database',
  'chain.evidenceVerifier.ownerVerifier.database, database',
  'chain.writeReceiptVerifier.database, database', 'unexpected: true', 'now: null',
  'reviewedCommit: "invalid"', 'authorizedWriter: { principalId: "activation-writer" }',
  'globalThis.__DEFAULT_AUTHORITY_DB__ = database', 'delete globalThis.__DEFAULT_AUTHORITY_DB__',
]) if (!activationEvidenceRuntimeCompositionTestSource.includes(required)) {
  throw new Error(`D1 development activation evidence composition coverage missing: ${required}`);
}
for (const required of [
  "D1DevelopmentActivationPreflightEvaluator",
  "createD1DevelopmentActivationEvidenceChainVerifier(database, options)",
  "Object.freeze(this)", "async evaluate(plan)",
  "developmentActivationPreflight(plan, { evidenceVerifier: this.evidenceVerifier })",
]) if (!activationPreflightEvaluatorSource.includes(required)) {
  throw new Error(`D1 development activation preflight evaluator invariant missing: ${required}`);
}
if ((activationPreflightEvaluatorSource.match(/createD1DevelopmentActivationEvidenceChainVerifier\(/gu) ?? []).length !== 1 ||
    (activationPreflightEvaluatorSource.match(/developmentActivationPreflight\(/gu) ?? []).length !== 1 ||
    activationDangerousPattern.test(activationPreflightEvaluatorSource) ||
    /privateKey|secretResolver|SERVICE_AUTH_KEYS_JSON|Bearer|OAuth|headers\.|Request\b|globalThis|process\.env|return\s+\{\s*ready:\s*true/iu.test(activationPreflightEvaluatorSource)) {
  throw new Error("D1 development activation preflight evaluator must remain one-chain, one-preflight, validation-only, ambient-state-independent, and secret-independent");
}
if (workerSource.includes("d1-development-activation-preflight-evaluator") ||
    developmentRuntimeSource.includes("d1-development-activation-preflight-evaluator") ||
    activationPreflightSource.includes("d1-development-activation-preflight-evaluator") ||
    JSON.stringify(activationPlan).includes("d1-development-activation-preflight-evaluator")) {
  throw new Error("D1 development activation preflight evaluator cannot be imported by runtime, preflight, or plan");
}
for (const required of [
  "injects only the reviewed evidence chain", "rejects invalid construction and malformed plans",
  'evaluator.evidenceVerifier.constructor.name, "AuthenticatedDevelopmentActivationEvidenceChainVerifier"',
  "evaluator.evidenceVerifier.now, now", "report.blockers.length, 19",
  'report.blockers.includes("independent_evidence_verifier_unavailable"), false', "queries, 0",
  "new D1DevelopmentActivationPreflightEvaluator(null, options)", "unexpected: true",
  "evaluator.evaluate({ ...plan, unexpected: true })",
]) if (!activationPreflightEvaluatorTestSource.includes(required)) {
  throw new Error(`D1 development activation preflight evaluator coverage missing: ${required}`);
}
for (const required of [
  "function readyPlan(evidence)", 'status: "READY"', "AUTHORITY_MIGRATIONS.map",
  "new D1DevelopmentActivationPreflightEvaluator(env.AUTHORITY_DB, {",
  "evaluate(readyPlan(value.evidence))", "ready: true, environment: \"development\", blockers: []",
]) if (!activationEvidenceWriterTestSource.includes(required)) {
  throw new Error(`Actual D1 development activation preflight interoperability missing: ${required}`);
}
if (writeSqlPattern.test(authorityAdapterSource) || /\bfetch\s*\(/u.test(authorityAdapterSource)) {
  throw new Error("Authoritative D1 adapter must remain read-only and cannot use external fetch");
}
for (const required of [
  "CREATE TABLE authority_resources", "CREATE TABLE authority_limits", "record_id TEXT PRIMARY KEY",
  "status IN ('CURRENT', 'FINAL')", "enabled IN (0, 1)", "valid_until_ms > valid_from_ms",
  "authority_resources_active_locator", "authority_limits_active_resource_operation",
]) if (!authorityMigration.includes(required)) throw new Error(`Authoritative D1 migration invariant missing: ${required}`);
function assertTableConstraints(source, tableName, required) {
  const marker = `CREATE TABLE ${tableName} (`;
  const start = source.indexOf(marker);
  const end = start === -1 ? -1 : source.indexOf("\n);", start + marker.length);
  if (start === -1 || end === -1) throw new Error(`SQL table definition unavailable: ${tableName}`);
  const body = source.slice(start + marker.length, end);
  for (const constraint of required) {
    if (!body.includes(constraint)) throw new Error(`${tableName} constraint missing: ${constraint}`);
  }
}
const commonAuthorityConstraints = ["record_id TEXT PRIMARY KEY", "status IN ('CURRENT', 'FINAL')", "enabled IN (0, 1)", "version > 0"];
assertTableConstraints(authorityMigration, "authority_resources", [...commonAuthorityConstraints, "valid_until_ms > valid_from_ms"]);
assertTableConstraints(authorityMigration, "authority_limits", [...commonAuthorityConstraints, "valid_until_ms > valid_from_ms", "cost_usd >= 0", "record_count >= 0"]);
for (const required of [
  "CREATE TABLE authority_development_activation_evidence_bundles",
  "CREATE INDEX authority_activation_evidence_active_commit",
]) if (!activationEvidenceMigration.includes(required)) {
  throw new Error(`Development activation evidence migration invariant missing: ${required}`);
}
assertTableConstraints(activationEvidenceMigration, "authority_development_activation_evidence_bundles", [
  "record_id TEXT PRIMARY KEY", "status IN ('CURRENT', 'FINAL')", "enabled IN (0, 1)",
  "version > 0", "expires_at_ms > issued_at_ms",
]);
if (/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu.test(activationEvidenceMigration)) {
  throw new Error("Development activation evidence migration cannot seed or mutate authority data");
}
for (const required of [
  "CREATE TABLE authority_development_activation_evidence_writes",
  "request_body_digest TEXT NOT NULL UNIQUE", "write_digest TEXT NOT NULL UNIQUE",
  "FOREIGN KEY (record_id)", "ON UPDATE RESTRICT ON DELETE RESTRICT",
  "inserted_at_ms >= authenticated_at_ms", "CREATE UNIQUE INDEX authority_activation_evidence_write_nonce",
]) if (!activationEvidenceWriteMigration.includes(required)) {
  throw new Error(`Development activation evidence write migration invariant missing: ${required}`);
}
assertTableConstraints(activationEvidenceWriteMigration, "authority_development_activation_evidence_writes", [
  "write_id TEXT PRIMARY KEY", "record_id TEXT NOT NULL UNIQUE", "version > 0",
  "FOREIGN KEY (record_id)", "ON UPDATE RESTRICT ON DELETE RESTRICT",
  "inserted_at_ms >= authenticated_at_ms",
]);
if (/\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z_]|DELETE\s+FROM|REPLACE\s+INTO)\b/iu.test(activationEvidenceWriteMigration)) {
  throw new Error("Development activation evidence write migration cannot seed or mutate authority data");
}
if (!vitestSource.includes('d1Databases: ["AUTHORITY_DB"]') || !vitestSource.includes("readD1Migrations(\"migrations/authority\")") ||
    !vitestSource.includes("AUTHORITY_TEST_MIGRATIONS")) throw new Error("Authority D1 must be migration-backed in the Workers test runtime");
if (workerSource.includes("AUTHORITY_DB")) throw new Error("Worker entrypoint cannot directly access authority D1 before its reviewed deployment binding step");
if (!secretScanSource.includes('"migrations"')) throw new Error("D1 migrations must remain inside the default secret-scan roots");

for (const required of [
  "D1Ed25519IdentityVerifier", "D1TestEvidenceProvider", "D1RollbackVerifier", "crypto.subtle.importKey",
  'crypto.subtle.verify("Ed25519"', "canonicalize(payload) !== payloadText", "expiresAtMs - issuedAtMs > MAX_ATTESTATION_MS",
  "payload.role !== role", "payload.actionDigest !== actionDigest", "row.principal_id !== payload.principalId",
  "await digestCanonicalValue(keyRecord) !== row.key_digest", "await digestCanonicalValue(record) !== row.evidence_digest",
  "Validation ${label} is ambiguous", "status IN ('CURRENT', 'FINAL')", ".bind(...bindings).all()",
]) if (!validationAdapterSource.includes(required)) throw new Error(`Validation evidence invariant missing: ${required}`);
if (writeSqlPattern.test(validationAdapterSource) || /\bfetch\s*\(/u.test(validationAdapterSource)) {
  throw new Error("Validation evidence adapter must remain read-only and cannot use external fetch");
}
for (const required of [
  "CREATE TABLE authority_identity_keys", "CREATE TABLE authority_test_evidence", "CREATE TABLE authority_rollbacks",
  "algorithm = 'Ed25519'", "status IN ('CURRENT', 'FINAL')", "enabled IN (0, 1)",
  "expires_at_ms > issued_at_ms", "authority_identity_keys_active_key", "authority_test_evidence_active_action",
  "authority_rollbacks_active_reference",
]) if (!validationMigration.includes(required)) throw new Error(`Validation evidence migration invariant missing: ${required}`);
assertTableConstraints(validationMigration, "authority_identity_keys", [
  ...commonAuthorityConstraints, "algorithm = 'Ed25519'", "valid_until_ms > valid_from_ms",
]);
assertTableConstraints(validationMigration, "authority_test_evidence", [
  ...commonAuthorityConstraints, "result IN ('passed', 'failed')", "expires_at_ms > issued_at_ms",
]);
assertTableConstraints(validationMigration, "authority_rollbacks", [
  ...commonAuthorityConstraints, "valid IN (0, 1)", "executable IN (0, 1)", "expires_at_ms > issued_at_ms",
]);
if (workerSource.includes("D1Ed25519IdentityVerifier") || workerSource.includes("D1TestEvidenceProvider") || workerSource.includes("D1RollbackVerifier") ||
    developmentRuntimeSource.includes("D1Ed25519IdentityVerifier") || developmentRuntimeSource.includes("D1TestEvidenceProvider") ||
    developmentRuntimeSource.includes("D1RollbackVerifier")) throw new Error("Validation evidence adapters cannot be activated before the reviewed D1 binding step");

for (const required of [
  "D1GoverningProjectKnowledgeReader", "authority_project_knowledge", "governing = 1", "enabled = 1",
  "status = 'CURRENT'", "status = 'FINAL'", ".bind(this.scope, statuses.current, statuses.final, lookup.timestamp).all()",
  "canonicalize(knowledge) !== row.knowledge_json", "MAX_KNOWLEDGE_BYTES", "assertNoSecretFields(knowledge)",
  "await digestCanonicalValue(digestRecord) !== row.knowledge_digest", "actionDigest: request.actionDigest",
]) if (!projectKnowledgeAdapterSource.includes(required)) throw new Error(`Project Knowledge read invariant missing: ${required}`);
if (writeSqlPattern.test(projectKnowledgeAdapterSource) || /\bfetch\s*\(/u.test(projectKnowledgeAdapterSource)) {
  throw new Error("Project Knowledge adapter must remain read-only and cannot use external fetch");
}
for (const required of [
  "CREATE TABLE authority_project_knowledge", "status IN ('CURRENT', 'FINAL')", "governing = 1",
  "enabled IN (0, 1)", "valid_until_ms > valid_from_ms", "length(version) > 0",
  "authority_project_knowledge_active_scope",
]) if (!projectKnowledgeMigration.includes(required)) throw new Error(`Project Knowledge migration invariant missing: ${required}`);
assertTableConstraints(projectKnowledgeMigration, "authority_project_knowledge", [
  "record_id TEXT PRIMARY KEY", "status IN ('CURRENT', 'FINAL')", "governing = 1",
  "enabled IN (0, 1)", "valid_until_ms > valid_from_ms", "length(version) > 0",
]);
if (/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bREPLACE\b/iu.test(projectKnowledgeMigration)) {
  throw new Error("Project Knowledge migration must create empty schema without seed or mutation statements");
}
for (const prohibitedStatus of ["PROPOSED", "DRAFT", "SOURCE_MATERIAL_ONLY"]) {
  if (projectKnowledgeMigration.includes(prohibitedStatus)) throw new Error(`Project Knowledge migration cannot admit ${prohibitedStatus}`);
}
for (const secretKey of ["apikey", "authorization", "credential", "credentials", "privatekey", "proxyauthorization", "refreshtoken", "secret", "secrets", "token", "tokens", "accesstoken"]) {
  if (!projectKnowledgeAdapterSource.includes(`\"${secretKey}\"`)) throw new Error(`Project Knowledge recursive secret-field guard missing: ${secretKey}`);
}
if (!policyGatewaySource.includes("knowledge.actionDigest !== actionDigest") || !runtimeContractsSource.includes('"actionDigest", "scope"') ||
    !runtimeContractsSource.includes("Project Knowledge digest binding is invalid") || !runtimeContractsSource.includes("const pending = [record]") ||
    !runtimeContractsSource.includes('key.toLowerCase().replace(/[^a-z0-9]/g, "")')) {
  throw new Error("Project Knowledge must remain independently bound to the gateway-computed action digest");
}
if (workerSource.includes("D1GoverningProjectKnowledgeReader") || developmentRuntimeSource.includes("D1GoverningProjectKnowledgeReader")) {
  throw new Error("Project Knowledge adapter cannot be activated before the reviewed D1 binding and promotion step");
}

for (const required of [
  "D1Ed25519OwnerDecisionVerifier", "D1StandingStateRevalidator", "DECISION_FIELDS", "MAX_OWNER_DECISION_MS",
  "Owner decision fields must be exact", 'payload.signatureAlgorithm !== "Ed25519"',
  "expiresAtMs - decidedAtMs > MAX_OWNER_DECISION_MS", "crypto.subtle.importKey", 'crypto.subtle.verify(',
  "await digestCanonicalValue(keyRecord) !== row.key_digest", "digestRequestedAction(action, authorization.resolvedTarget)",
  "authorization.authorizingPolicy?.policyId", "authorization.authorizingPolicy?.policyVersion",
  "await digestCanonicalValue(record) !== row.evidence_digest", 'row.state === "enabled" && row.kill_switch === 0',
  "status IN ('CURRENT', 'FINAL')", ".bind(...bindings).all()",
]) if (!ownerControlAdapterSource.includes(required)) throw new Error(`Owner-control runtime invariant missing: ${required}`);
if (writeSqlPattern.test(ownerControlAdapterSource) || /\bfetch\s*\(/u.test(ownerControlAdapterSource) || ownerControlAdapterSource.includes("privateKey")) {
  throw new Error("Owner-control runtime must remain read-only, fetch-free, and public-key-only");
}
for (const required of [
  "CREATE TABLE authority_owner_keys", "CREATE TABLE authority_standing_state", "algorithm = 'Ed25519'",
  "state IN ('enabled', 'disabled')", "kill_switch IN (0, 1)", "status IN ('CURRENT', 'FINAL')",
  "enabled IN (0, 1)", "valid_until_ms > valid_from_ms", "authority_owner_keys_active_key",
  "authority_standing_state_active_policy",
]) if (!ownerControlMigration.includes(required)) throw new Error(`Owner-control migration invariant missing: ${required}`);
assertTableConstraints(ownerControlMigration, "authority_owner_keys", [
  ...commonAuthorityConstraints, "algorithm = 'Ed25519'", "valid_until_ms > valid_from_ms",
]);
assertTableConstraints(ownerControlMigration, "authority_standing_state", [
  ...commonAuthorityConstraints, "state IN ('enabled', 'disabled')", "kill_switch IN (0, 1)",
  "valid_until_ms > valid_from_ms",
]);
if (/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bREPLACE\b/iu.test(ownerControlMigration)) {
  throw new Error("Owner-control migration must create empty schema without seed or mutation statements");
}
const ownerControlGatewayPatterns = [
  ["initial owner verification must fail closed", /let ownerSignatureValid = false;\s*try \{ ownerSignatureValid = await this\.#runtime\.ownerVerifier\.verify\(decision, \{ actionDigest: prepared\.actionDigest, now \}\); \} catch \{\}\s*if \(!ownerSignatureValid\) return \{ outcome: "denied", reason: "invalid_owner_signature" \};/u],
  ["pre-execution owner verification must fail closed", /let ownerSignatureValid = false;\s*try \{ ownerSignatureValid = await this\.#runtime\.ownerVerifier\.verify\(context\.decision, \{ actionDigest: authorization\.actionDigest, now \}\); \} catch \{\}\s*if \(!ownerSignatureValid\) throw new Error\("Execution denied: owner signature invalid"\);/u],
  ["standing-state revalidation must fail closed", /let standingStateValid = false;\s*try \{ standingStateValid = await this\.#runtime\.revalidateStandingState\(action, authorization, \{ now \}\); \} catch \{\}\s*if \(!standingStateValid\) throw new Error\("Execution denied: kill switch or state revalidation failed"\);/u],
];
for (const [label, pattern] of ownerControlGatewayPatterns) {
  if (!pattern.test(policyGatewaySource)) throw new Error(`Owner-control gateway invariant missing: ${label}`);
}
for (const required of [
  "D1AuthoritativeResourceResolver", "D1TrustedLimitProvider", "D1Ed25519IdentityVerifier",
  "D1TestEvidenceProvider", "D1RollbackVerifier", "D1GoverningProjectKnowledgeReader",
  "D1Ed25519OwnerDecisionVerifier", "D1StandingStateRevalidator", "Object.freeze({",
  "standingState.revalidate.bind(standingState)", 'projectKnowledgeScope = "control-plane"',
]) if (!authorityRuntimeCompositionSource.includes(required)) throw new Error(`Authority runtime composition invariant missing: ${required}`);
if (writeSqlPattern.test(authorityRuntimeCompositionSource) || /\bfetch\s*\(/u.test(authorityRuntimeCompositionSource)) {
  throw new Error("Authority runtime composition must remain read-only and cannot use external fetch");
}
for (const required of [
  'typeof env?.AUTHORITY_DB?.prepare === "function"',
  "createD1AuthorityRuntimeDependencies(env.AUTHORITY_DB)", "...authorityDependencies",
  "D1_AUTHORITY_RUNTIME_DEPENDENCIES", "developmentUnavailableRuntimeDependencies(env)",
]) if (!developmentRuntimeSource.includes(required) && !workerSource.includes(required)) {
  throw new Error(`Development authority composition invariant missing: ${required}`);
}
if (writeSqlPattern.test(developmentRuntimeSource) || /\bfetch\s*\(/u.test(developmentRuntimeSource)) {
  throw new Error("Development runtime must remain read-only and cannot use external fetch");
}
for (const required of [
  "CloudflareWorkflowDispatcher", "CloudflareQueuePublisher", "MAX_ENVELOPE_BYTES = 131_072",
  "assertOrchestratorEnvelope(envelope)", "canonicalize(envelope)",
  "encoder.encode(canonical).byteLength > MAX_ENVELOPE_BYTES", "message.workflowName !== this.workflowName",
  "message.queueName !== this.queueName", "const instance = await this.binding.create({ id: message.messageId, params: message })",
  "instance.id !== message.messageId", 'await this.binding.send(message, { contentType: "json" })',
]) if (!orchestratorAdapterSource.includes(required)) throw new Error(`Orchestrator adapter invariant missing: ${required}`);
const orchestratorConstructorGuards = [
  ["Workflow", /export class CloudflareWorkflowDispatcher \{[\s\S]*?constructor\(binding, \{ workflowName \} = \{\}\) \{\s*if \(!binding \|\| typeof binding\.create !== "function"\) throw new TypeError\("Workflow binding is unavailable"\);/u],
  ["Queue", /export class CloudflareQueuePublisher \{[\s\S]*?constructor\(binding, \{ queueName \} = \{\}\) \{\s*if \(!binding \|\| typeof binding\.send !== "function"\) throw new TypeError\("Queue binding is unavailable"\);/u],
];
for (const [label, pattern] of orchestratorConstructorGuards) {
  if (!pattern.test(orchestratorAdapterSource)) throw new Error(`${label} adapter constructor must reject an unavailable binding method`);
}
if (/\bfetch\s*\(/u.test(orchestratorAdapterSource) || writeSqlPattern.test(orchestratorAdapterSource)) {
  throw new Error("Orchestrator adapters must use bindings only and remain authority-read-only");
}
for (const required of [
  "extends WorkflowEntrypoint", 'step.do("validate-orchestrator-envelope"', "assertOrchestratorEnvelope(envelope)",
  'outcome: "execution_disabled"',
]) if (!orchestratorWorkflowSource.includes(required)) throw new Error(`Orchestrator Workflow invariant missing: ${required}`);
if (/\bfetch\s*\(/u.test(orchestratorWorkflowSource) || writeSqlPattern.test(orchestratorWorkflowSource)) {
  throw new Error("Orchestrator Workflow cannot perform external or authority writes");
}
for (const required of [
  'typeof env?.ORCHESTRATOR_WORKFLOW?.create === "function"',
  'typeof env?.ORCHESTRATOR_QUEUE?.send === "function"', "...orchestratorDependencies",
  'workflowName: "8978-ai-orchestrator-dev"', 'queueName: "8978-ai-orchestrator-dev"',
]) if (!developmentRuntimeSource.includes(required)) throw new Error(`Orchestrator composition invariant missing: ${required}`);
if (!developmentRuntimeSource.includes('return typeof env?.ORCHESTRATOR_WORKFLOW?.create === "function" && typeof env?.ORCHESTRATOR_QUEUE?.send === "function";')) {
  throw new Error("Orchestrator bindings must be composed only as a complete Workflow-and-Queue pair");
}
for (const required of [
  'const fields = ["actionDigest", "correlationId", "idempotencyKey", "messageId", "projectKnowledgeRef", "queueName", "workflowName"]',
  'const referenceFields = ["digest", "recordId", "status", "version"]', 'new Set(["CURRENT", "FINAL"])',
  '/^sha256:[a-f0-9]{64}$/.test(reference.digest', 'envelope.messageId.length > 100',
]) if (!runtimeContractsSource.includes(required)) throw new Error(`Orchestrator envelope invariant missing: ${required}`);
if (envelopeSchema.properties.messageId.maxLength !== 100 || envelopeSchema.properties.correlationId.maxLength !== 256 ||
    envelopeSchema.properties.projectKnowledgeRef.properties.recordId.maxLength !== 256) {
  throw new Error("Orchestrator envelope schema must enforce Cloudflare and component identifier limits");
}
if (!vitestSource.includes('queueProducers: ["ORCHESTRATOR_QUEUE"]') ||
    !vitestSource.includes("ORCHESTRATOR_WORKFLOW") || !vitestSource.includes('className: "OrchestratorWorkflow"')) {
  throw new Error("Orchestrator bindings must remain local-test-only and platform-shaped");
}
if (!workerSource.includes('ready: false') ||
    !workerSource.includes('if (path === "/v1/actions/execute") return response(503, { outcome: "denied", reason: "execution_disabled" });')) {
  throw new Error("Authority composition cannot enable runtime readiness or action execution");
}
if (workerSource.includes("D1Ed25519OwnerDecisionVerifier") || workerSource.includes("D1StandingStateRevalidator") ||
    developmentRuntimeSource.includes("D1Ed25519OwnerDecisionVerifier") || developmentRuntimeSource.includes("D1StandingStateRevalidator")) {
  throw new Error("Owner-control adapters cannot be activated before the reviewed D1 binding and key/state installation step");
}

if (batch1Proposed.status !== "PROPOSED" || batch1Proposed.governing !== false) throw new Error("Batch 1 package must remain PROPOSED and non-governing");
if (!Array.isArray(batch1Proposed.records) || batch1Proposed.records.length !== 19) throw new Error("Batch 1 must contain exactly 19 proposed records");
const expectedBatch1Ids = Array.from({ length: 19 }, (_, index) => `PK-PROP-${String(index + 1).padStart(3, "0")}`);
const batch1Ids = batch1Proposed.records.map((record) => record.recordId);
if (new Set(batch1Ids).size !== 19 || JSON.stringify(batch1Ids) !== JSON.stringify(expectedBatch1Ids)) throw new Error("Batch 1 record IDs must be unique and exactly PK-PROP-001 through PK-PROP-019");
for (const record of batch1Proposed.records) {
  if (record.status !== "PROPOSED" || record.governing !== false) throw new Error(`Batch 1 record ${record.recordId} must remain PROPOSED and non-governing`);
}
const expectedBatch1Counts = { sources:7, components:24, conflicts:14, missingMaterialItems:22, dependencyGroups:16, proposedProjectKnowledgeRecords:19 };
for (const [key, value] of Object.entries(expectedBatch1Counts)) if (batch1Review.summaryCounts?.[key] !== value) throw new Error(`Batch 1 review count mismatch for ${key}`);
if (!Array.isArray(batch1Review.projectKnowledgeRecords) || batch1Review.projectKnowledgeRecords.length !== 19) throw new Error("Batch 1 review export must contain exactly 19 Project Knowledge candidates");
for (const record of batch1Review.projectKnowledgeRecords) {
  if (record.status !== "PROPOSED" || record.governing !== false) throw new Error(`Batch 1 review record ${record.recordId} must remain PROPOSED and non-governing`);
}
if (!batch1Proposed.nonBatch1RuntimeConstraints?.every((constraint) => constraint.changesBatch1RecordCount === false)) throw new Error("Non-Batch-1 runtime constraints cannot alter the Batch 1 record count");
if (/each paying production customer/i.test(batch1DataDictionary)) throw new Error("Production isolation must apply to every production customer without a paying qualifier");


if (batch2Proposed.status !== "PROPOSED" || batch2Proposed.governing !== false) throw new Error("Batch 2 package must remain PROPOSED and non-governing");
if (!Array.isArray(batch2Proposed.records) || batch2Proposed.records.length !== 10) throw new Error("Batch 2 must contain exactly 10 proposed records");
const expectedBatch2Ids = Array.from({ length: 10 }, (_, index) => `PK-B2-PROP-${String(index + 1).padStart(3, "0")}`);
const batch2Ids = batch2Proposed.records.map((record) => record.recordId);
if (new Set(batch2Ids).size !== 10 || JSON.stringify(batch2Ids) !== JSON.stringify(expectedBatch2Ids)) throw new Error("Batch 2 record IDs must be unique and exactly PK-B2-PROP-001 through PK-B2-PROP-010");
for (const record of batch2Proposed.records) {
  if (record.status !== "PROPOSED" || record.governing !== false) throw new Error(`Batch 2 record ${record.recordId} must remain PROPOSED and non-governing`);
}
const expectedBatch2Counts = { sources:4, componentDeltaItems:10, conflicts:8, missingMaterialItems:12, dependencyGroups:9, proposedProjectKnowledgeRecords:10 };
for (const [key, value] of Object.entries(expectedBatch2Counts)) if (batch2Proposed.summaryCounts?.[key] !== value) throw new Error(`Batch 2 summary count mismatch for ${key}`);
if (batch2Manifest.status !== "SOURCE_MATERIAL_ONLY" || batch2Manifest.source_policy?.promote_to_final_automatically !== false || batch2Manifest.source_policy?.secrets_allowed !== false || batch2Manifest.sources?.length !== 2) throw new Error("Batch 2 manifest source and promotion boundaries changed");
for (const [name, value] of [["README", batch2Readme], ["direct inbound", batch2DirectInbound], ["no-transfer receptionist", batch2NoTransfer]]) {
  if (!/Status: SOURCE MATERIAL ONLY/u.test(value)) throw new Error(`Batch 2 ${name} must remain source material only`);
}
const countIds = (prefix, expected) => {
  const matches = [...batch2Review.matchAll(new RegExp(`\\| ${prefix}\\d{2} \\|`, "gu"))].map((match) => match[0]);
  if (matches.length !== expected || new Set(matches).size !== expected) throw new Error(`Batch 2 review must contain exactly ${expected} unique ${prefix} entries`);
};
countIds("B2-T", 10);
countIds("B2-C", 8);
countIds("B2-M", 12);
countIds("B2-D", 9);
if (!/no-AI-sales-specialist-transfer receptionist as a distinct versioned profile/iu.test(JSON.stringify(batch2Proposed))) throw new Error("Batch 2 no-transfer rule must remain variant-scoped");
if (!/candidate action families only/iu.test(JSON.stringify(batch2Proposed)) || !/no candidate action family establishes an implemented AutoCalls capability/iu.test(JSON.stringify(batch2Proposed))) throw new Error("Batch 2 must not claim unsupported AutoCalls action capability");
if (/Apply Batch 1 current overrides only/iu.test(batch2Readme)) throw new Error("Batch 2 must not treat Batch 1 source overrides as governing authority");

if (batch3Proposed.status !== "PROPOSED" || batch3Proposed.governing !== false) throw new Error("Batch 3 package must remain PROPOSED and non-governing");
if (!Array.isArray(batch3Proposed.records) || batch3Proposed.records.length !== 12) throw new Error("Batch 3 must contain exactly 12 proposed records");
const expectedBatch3Ids = Array.from({ length: 12 }, (_, index) => `PK-B3-PROP-${String(index + 1).padStart(3, "0")}`);
const batch3Ids = batch3Proposed.records.map((record) => record.recordId);
if (new Set(batch3Ids).size !== 12 || JSON.stringify(batch3Ids) !== JSON.stringify(expectedBatch3Ids)) throw new Error("Batch 3 record IDs must be unique and exactly PK-B3-PROP-001 through PK-B3-PROP-012");
for (const record of batch3Proposed.records) {
  if (record.status !== "PROPOSED" || record.governing !== false) throw new Error(`Batch 3 record ${record.recordId} must remain PROPOSED and non-governing`);
}
const expectedBatch3Counts = { sources:7, sourceOriginals:5, provenanceReconciliations:1, componentDeltaItems:12, conflicts:10, missingMaterialItems:13, dependencyGroups:10, proposedProjectKnowledgeRecords:12 };
for (const [key, value] of Object.entries(expectedBatch3Counts)) if (batch3Proposed.summaryCounts?.[key] !== value) throw new Error(`Batch 3 summary count mismatch for ${key}`);
if (batch3Manifest.status !== "SOURCE_MATERIAL_ONLY" || batch3Manifest.sourcePolicy?.promoteToFinalAutomatically !== false || batch3Manifest.sourcePolicy?.secretsAllowed !== false || batch3Manifest.sourcePolicy?.rawFullPromptsCommitted !== false || batch3Manifest.sourcePolicy?.runtimeAuthority !== false) throw new Error("Batch 3 manifest authority or security boundary changed");
if (!Array.isArray(batch3Manifest.sources) || batch3Manifest.sources.length !== 5) throw new Error("Batch 3 manifest must contain exactly five source originals");
const expectedBatch3Digests = [
  "fbaf2e9dfcb62a4ec4cec9ee4b8d57c0e86f3ddb7bce71ad2e6aeb22578cfef7",
  "f2bd4c2b15e0a3ea96064505f8460928711a93541a933c18737d24b8f10d7707",
  "761dc42853d37a5e5dec8678ebd8992fab801c185d2b88c65b58c654fd7921c2",
  "143941ddd2fd4bcd7513c43103e18509dcdbf6158ca19369716c9cca5f6bfdb0",
  "7a0baf4c728d19f53598ee36975ec8bc639396c0b8b23d2a3122937c06114351",
];
const batch3Digests = batch3Manifest.sources.map((source) => source.sha256);
if (new Set(batch3Digests).size !== 5 || JSON.stringify(batch3Digests) !== JSON.stringify(expectedBatch3Digests)) throw new Error("Batch 3 source digests must remain exact, unique, and ordered");
for (const source of batch3Manifest.sources) {
  if (!/^libfile_[a-f0-9]{32}$/u.test(source.libraryFileId) || !Number.isInteger(source.sizeBytes) || source.sizeBytes <= 0 || !Number.isInteger(source.lineCount) || source.lineCount <= 0) throw new Error(`Batch 3 source provenance is incomplete for ${source.sourceId}`);
}
if (!Array.isArray(batch3Manifest.provenanceReconciliations) || batch3Manifest.provenanceReconciliations.length !== 1 || batch3Manifest.provenanceReconciliations[0].effect !== "Adds immutable source identity and digest evidence only; creates no new Batch 3 record and promotes nothing.") throw new Error("Batch 3 database-reactivation reconciliation must remain provenance-only");
for (const [name, value] of [["README", batch3Readme], ...batch3Sources.map((value, index) => [`source ${index + 1}`, value])]) {
  if (!/Status: SOURCE MATERIAL ONLY/u.test(value)) throw new Error(`Batch 3 ${name} must remain source material only`);
}
const countBatch3Ids = (prefix, expected) => {
  const matches = [...batch3Review.matchAll(new RegExp(`\\| ${prefix}\\d{2} \\|`, "gu"))].map((match) => match[0]);
  if (matches.length !== expected || new Set(matches).size !== expected) throw new Error(`Batch 3 review must contain exactly ${expected} unique ${prefix} entries`);
};
countBatch3Ids("B3-T", 12);
countBatch3Ids("B3-C", 10);
countBatch3Ids("B3-M", 13);
countBatch3Ids("B3-D", 10);
const batch3Serialized = JSON.stringify(batch3Proposed);
if (!/Janet2 assumed-transfer versus standalone conflict/iu.test(batch3Serialized) || !/never through Janet\/Steve labels or ordinal names/iu.test(batch3Serialized)) throw new Error("Batch 3 internal-label conflict must remain quarantined");
if (!/candidate action families only and fail closed without verified AutoCalls contracts/iu.test(batch3Serialized)) throw new Error("Batch 3 must not claim unsupported AutoCalls action capability");
const batch3ServiceAuthRule = "Cloudflare service authentication remains HMAC-based with replay defense and no OAuth dependency.";
if (!batch3Proposed.normalizationRules?.includes("Service authentication remains HMAC-based with replay defense and no OAuth dependency.") || batch3Proposed.nonBatch3RuntimeConstraints?.length !== 1 || batch3Proposed.nonBatch3RuntimeConstraints[0].constraint !== batch3ServiceAuthRule || !batch3Proposed.nonBatch3RuntimeConstraints.every((constraint) => constraint.changesBatch3RecordCount === false)) throw new Error("Batch 3 must preserve service-auth independence without changing its record count");
if (/Status: (?:CURRENT|FINAL)/u.test([batch3Readme, ...batch3Sources].join("\n"))) throw new Error("Batch 3 source files cannot self-promote to CURRENT or FINAL");

const trustKey = `${policies.policySetId}@${policies.policySetVersion}`;
if (await digestCanonicalValue(policies) !== TRUSTED_POLICY_SET_DIGESTS[trustKey]) throw new Error(`Policy trust-anchor digest mismatch: ${trustKey}`);
console.log(`Validated ${ids.size} policy versions, 8 discriminated resource kinds, runtime contracts, six applied authority migrations, one non-executing authority migration packet, one completed non-governing migration execution record, one prerequisite-satisfied execution-disabled schema inventory verification packet, one successful non-governing schema inventory candidate with completed non-accepting independent review, 8 code-composed authority dependencies, one historical 20-gate blocked development activation plan, one resource-reconciled 17-gate blocked successor plan, one non-executing development resource-creation packet, one stopped partial resource-creation record, one completed unbound resource-creation record, one authenticated but unwired activation evidence verifier, one read-only unbound activation evidence provider, one HMAC-authenticated unbound activation evidence writer, one read-only unbound activation evidence write verifier, one unwired single-clock dual evidence-chain verifier, one unwired D1 evidence-chain composition, one unwired D1 preflight evaluator, fixtures, trust anchor, 19 non-governing Batch 1 records, 10 non-governing Batch 2 records, and 12 non-governing Batch 3 records.`);
