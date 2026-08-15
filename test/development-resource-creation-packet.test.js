import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const packet = await load("deployment/development-resource-creation-packet.json");
const schema = await load("schemas/development-resource-creation-packet.schema.json");
const planBytes = await readFile(packet.sourcePlan.path);

test("resource-creation packet is exact, non-governing, and execution-disabled", () => {
  assert.deepEqual(validateSchema(schema, packet), []);
  assert.equal(packet.status, "PLANNED");
  assert.equal(packet.governing, false);
  assert.equal(packet.executionAuthorized, false);
  assert.equal(packet.account.accountId, null);
  assert.equal(createHash("sha256").update(planBytes).digest("hex"), packet.sourcePlan.sha256);
});

test("packet permits only an empty unbound D1 and an unconnected Queue", () => {
  assert.deepEqual({ ...packet.authorityDatabase }, {
    operation: "create", name: "8978-ai-authority-dev", binding: "AUTHORITY_DB",
    locationPolicy: "cloudflare_automatic", requireAbsent: true, empty: true,
    bind: false, migrate: false, seed: false, writeEvidence: false, updateConfig: false,
  });
  assert.deepEqual({ ...packet.queue }, {
    operation: "create", name: "8978-ai-orchestrator-dev", binding: "ORCHESTRATOR_QUEUE",
    requireAbsent: true, deliveryDelaySeconds: 0, messageRetentionSeconds: 86400,
    bind: false, addProducer: false, addConsumer: false, publish: false,
  });
  assert.equal(packet.workflow.operation, "deferred");
  assert.match(packet.workflow.reason, /no standalone Wrangler create command/u);
});

test("packet stops on collisions and forbids every adjacent side effect", () => {
  const stops = packet.stopConditions.join("\n");
  assert.match(stops, /D1 database named 8978-ai-authority-dev already exists/u);
  assert.match(stops, /Queue named 8978-ai-orchestrator-dev already exists/u);
  assert.match(stops, /owner-authorized account ID/u);
  assert.deepEqual(packet.prohibitedOperations, [
    "create_or_deploy_worker", "create_or_trigger_workflow", "install_or_update_binding",
    "modify_wrangler_config", "apply_or_create_migration", "execute_d1_sql",
    "insert_update_or_delete_d1_data", "seed_authority_or_project_knowledge",
    "write_activation_evidence", "install_or_rotate_secret_or_key", "add_queue_producer",
    "add_queue_consumer", "publish_queue_message", "create_or_modify_route",
    "deploy_or_activate_runtime", "touch_production_or_customer_resource", "reuse_pk_d1_dev",
    "delete_or_automatically_clean_up_resource",
  ]);
  assert.deepEqual({ ...packet.partialFailurePolicy }, {
    automaticDeletion: false, automaticRetry: false, action: "stop_and_report_exact_remote_state",
  });
});

test("schema rejects authorization, account, resource, and side-effect drift", () => {
  const mutations = [
    (value) => { value.executionAuthorized = true; },
    (value) => { value.account.accountId = "unauthorized"; },
    (value) => { value.environment = "production"; },
    (value) => { value.authorityDatabase.name = "pk-d1-dev"; },
    (value) => { value.authorityDatabase.migrate = true; },
    (value) => { value.authorityDatabase.updateConfig = true; },
    (value) => { value.queue.addConsumer = true; },
    (value) => { value.queue.publish = true; },
    (value) => { value.workflow.operation = "create"; },
    (value) => { value.partialFailurePolicy.automaticDeletion = true; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(packet); mutate(changed);
    assert.notDeepEqual(validateSchema(schema, changed), []);
  }
});
