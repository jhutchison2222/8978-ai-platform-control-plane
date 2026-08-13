import { readFile, readdir } from "node:fs/promises";
import { digestCanonicalValue, parseJsonStrict } from "../src/canonical-digest.js";
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
const wrangler = await load("wrangler.jsonc");
const workerSource = await readFile("src/control-plane-worker.js", "utf8");
const durableStateSource = await readFile("src/control-plane-state-durable-objects.js", "utf8");
const durableAdapterSource = await readFile("src/cloudflare-runtime-stores.js", "utf8");

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
if (validateSchema(customerBindingsSchema, { customerId:"customer-1",dedicatedWorkerName:"worker",dedicatedD1DatabaseId:"d1",sharedProductionD1:true }).length === 0) throw new Error("Shared production D1 negative fixture unexpectedly passed");
if (validateSchema(resourceSchema, { kind:"github_repository",provider:"cloudflare",repository:"x",environment:"development",isolation:{} }).length === 0) throw new Error("Resource discriminator negative fixture unexpectedly passed");

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
for (const required of ["transactionSync", "ON CONFLICT(id) DO NOTHING", "UPDATE audit_head SET scope=COALESCE(scope", "Audit append contention limit exceeded"]) {
  if (!durableStateSource.includes(required)) throw new Error(`Durable-state atomicity invariant missing: ${required}`);
}
if (/DELETE FROM audit_events/iu.test(durableStateSource) || /\bfetch\s*\(/u.test(durableStateSource + durableAdapterSource)) throw new Error("Durable state cannot delete audit events or use external fetch");

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
console.log(`Validated ${ids.size} policy versions, 8 discriminated resource kinds, runtime contracts, fixtures, trust anchor, 19 non-governing Batch 1 records, 10 non-governing Batch 2 records, and 12 non-governing Batch 3 records.`);
