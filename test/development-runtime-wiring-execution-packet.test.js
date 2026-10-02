import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const packet = await load("deployment/development-runtime-wiring-execution-packet.json");
const schema = await load("schemas/development-runtime-wiring-execution-packet.schema.json");
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

test("runtime-wiring packet is exact, non-governing, and execution-disabled", async () => {
  assert.deepEqual(validateSchema(schema, packet), []);
  assert.equal(packet.governing, false);
  assert.equal(packet.executionAuthorized, false);
  assert.equal(packet.configurationMutationAuthorized, false);
  assert.equal(packet.externalExecutionAuthorized, false);
  assert.equal(await digest(packet.sourceReadinessPacket.path), packet.sourceReadinessPacket.sha256);
  assert.equal(await digest(packet.sourceEvidenceMaterialPacket.path), packet.sourceEvidenceMaterialPacket.sha256);
  assert.equal(packet.currentConfiguration.path, "wrangler.jsonc");
  assert.equal(packet.currentConfiguration.sha256, "f89a62bacd64f303c3ced7eef52dbc481e6a50900220222291701e82044dbdcc");
});

test("packet pins the exact future development bindings without consumers routes or secrets", () => {
  assert.deepEqual({ ...packet.reviewCandidate.authorityDatabase }, {
    binding:"AUTHORITY_DB", database_name:"8978-ai-authority-dev",
    database_id:"741ade94-8539-4fc8-b6be-24884720dee8", migrations_dir:"migrations/authority",
  });
  assert.deepEqual({ ...packet.reviewCandidate.workflow }, {
    binding:"ORCHESTRATOR_WORKFLOW", name:"8978-ai-orchestrator-dev", class_name:"OrchestratorWorkflow",
  });
  assert.deepEqual({ ...packet.reviewCandidate.queueProducer }, {
    binding:"ORCHESTRATOR_QUEUE", queue:"8978-ai-orchestrator-dev",
  });
  assert.deepEqual(packet.reviewCandidate.queueConsumers, []);
  assert.deepEqual(packet.reviewCandidate.routes, []);
  assert.deepEqual(packet.reviewCandidate.secretValues, []);
});

test("packet preserves fail-closed runtime and exact prohibitions", () => {
  assert.deepEqual({ ...packet.preservedRuntimeBoundary }, {
    workersDev:false, previewUrls:false, controlPlaneMode:"development", allowExternalWrites:"false",
    executeRouteEnabled:false, workflowExecutionEnabled:false, queuePublishingPerformed:false,
    authorityD1WritesEnabled:false,
  });
  assert.deepEqual(packet.prohibitedOperations, [
    "modify_wrangler_configuration_in_this_packet", "install_or_update_binding", "create_or_trigger_workflow",
    "add_queue_consumer", "publish_queue_message", "execute_d1_sql_or_write",
    "install_or_rotate_secret_or_key", "deploy_or_activate_worker", "create_or_modify_route",
    "delete_cleanup_retry_or_restore", "production_or_customer_operation", "unreviewed_scope_expansion",
  ]);
  assert.deepEqual(packet.stopConditions, [
    "the source readiness or evidence-material packet bytes change",
    "the current wrangler configuration bytes change before the wiring candidate is prepared",
    "the development D1 UUID name or binding does not match the verified authority database",
    "the Workflow or Queue name class or binding differs from the reviewed activation plan",
    "a route Queue consumer secret value or external-write enablement would be added",
    "the execute route or Workflow implementation would become executable",
    "an operation would contact Cloudflare or mutate any remote resource",
    "any result or repository state is ambiguous partial or inconsistent",
  ]);
  assert.equal(packet.requiredReview.finalReviewedWiringCommitRequired, true);
});

test("schema rejects execution, remote effects, exposure, and boundary weakening", () => {
  const mutations = [
    (value) => { value.executionAuthorized = true; },
    (value) => { value.configurationMutationAuthorized = true; },
    (value) => { value.externalExecutionAuthorized = true; },
    (value) => { value.environment = "production"; },
    (value) => { value.reviewCandidate.authorityDatabase.database_id = "wrong"; },
    (value) => { value.reviewCandidate.queueConsumers.push({ queue:"8978-ai-orchestrator-dev" }); },
    (value) => { value.reviewCandidate.routes.push("example.com/*"); },
    (value) => { value.reviewCandidate.secretValues.push("secret"); },
    (value) => { value.preservedRuntimeBoundary.allowExternalWrites = "true"; },
    (value) => { value.requiredReview.independentExactHeadReview = false; },
    (value) => { value.partialFailurePolicy.automaticRetry = true; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(packet); mutate(changed);
    assert.notDeepEqual(validateSchema(schema, changed), []);
  }
});
