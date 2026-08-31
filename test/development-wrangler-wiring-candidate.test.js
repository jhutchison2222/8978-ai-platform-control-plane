import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const wrangler = await load("wrangler.jsonc");
const packet = await load("deployment/development-runtime-wiring-execution-packet.json");
const workerSource = await readFile("src/control-plane-worker.js", "utf8");
const workflowSource = await readFile("src/orchestrator-workflow.js", "utf8");
const generatedTypes = await readFile("worker-configuration.d.ts", "utf8");

test("development bindings match the independently reviewed wiring packet", () => {
  assert.equal(packet.currentConfiguration.sha256, "f89a62bacd64f303c3ced7eef52dbc481e6a50900220222291701e82044dbdcc");
  assert.deepEqual(wrangler.d1_databases, [packet.reviewCandidate.authorityDatabase]);
  assert.deepEqual(wrangler.workflows, [packet.reviewCandidate.workflow]);
  assert.deepEqual({ ...wrangler.queues }, { producers:[packet.reviewCandidate.queueProducer] });
});

test("wiring adds no route consumer account or secret value", () => {
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.equal(wrangler.vars.CONTROL_PLANE_MODE, "development");
  assert.equal(wrangler.vars.ALLOW_EXTERNAL_WRITES, "false");
  assert.equal(Object.hasOwn(wrangler.vars, "SERVICE_AUTH_KEYS_JSON"), false);
  assert.equal(Object.hasOwn(wrangler, "routes"), false);
  assert.equal(Object.hasOwn(wrangler, "account_id"), false);
  assert.equal(Object.hasOwn(wrangler.queues, "consumers"), false);
});

test("Worker and Workflow remain execution-disabled", () => {
  assert.match(workerSource, /if \(path === "\/v1\/actions\/execute"\) return response\(503, \{ outcome: "denied", reason: "execution_disabled" \}\);/u);
  assert.match(workflowSource, /outcome: "execution_disabled"/u);
  assert.doesNotMatch(workerSource, /ALLOW_EXTERNAL_WRITES\s*!==\s*"true"/u);
});

test("generated Worker types expose only the reviewed new bindings", () => {
  assert.match(generatedTypes, /AUTHORITY_DB: D1Database;/u);
  assert.match(generatedTypes, /ORCHESTRATOR_QUEUE: Queue;/u);
  assert.match(generatedTypes, /ORCHESTRATOR_WORKFLOW: Workflow</u);
  assert.doesNotMatch(generatedTypes, /SERVICE_AUTH_KEYS_JSON:/u);
});
