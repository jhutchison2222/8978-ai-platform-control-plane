import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const record = await load("deployment/development-resource-creation-partial-execution-record.json");
const schema = await load("schemas/development-resource-creation-partial-execution-record.schema.json");

test("partial execution record is exact, non-governing, and stopped", async () => {
  assert.deepEqual(validateSchema(schema, record), []);
  assert.equal(record.status, "STOPPED_PARTIAL");
  assert.equal(record.governing, false);
  assert.equal(record.continuation.authorized, false);
  const packet = await readFile(record.sourcePacket.path);
  assert.equal(createHash("sha256").update(packet).digest("hex"), record.sourcePacket.sha256);
});

test("record binds the exact empty WNAM D1 result without overstating verification", () => {
  assert.deepEqual({ ...record.authorityDatabase, bindingVerification: { ...record.authorityDatabase.bindingVerification } }, {
    operation: "create", outcome: "CREATED", name: "8978-ai-authority-dev",
    databaseId: "741ade94-8539-4fc8-b6be-24884720dee8", createdAt: "2026-08-18T17:17:23.103Z",
    requestedLocationPolicy: "cloudflare_automatic", actualRegion: "WNAM", jurisdiction: null,
    readReplication: "disabled", numTables: 0, fileSizeBytes: 12288, sqlExecuted: false,
    migrationsApplied: false, dataInserted: false, bindingInstalled: false,
    bindingVerification: {
      status: "INFERRED_UNBOUND", basis: "all_eight_workers_predate_database_creation",
      latestWorkerModifiedAt: "2026-08-11T16:43:02Z",
    },
  });
  assert.equal(record.locationDeviation.operationalAssessment, "ACCEPTABLE");
  assert.equal(record.locationDeviation.ownerAccepted, false);
  assert.equal(record.locationDeviation.deleteAuthorized, false);
});

test("Queue and every adjacent external effect remain stopped", () => {
  assert.deepEqual({ ...record.queue }, {
    operation: "create", outcome: "NOT_ATTEMPTED", name: "8978-ai-orchestrator-dev",
    expectedDeliveryDelaySeconds: 0, expectedMessageRetentionSeconds: 86400,
    postStopExistence: "UNVERIFIED", bindingInstalled: false, producerAdded: false,
    consumerAdded: false, messagePublished: false,
  });
  assert.ok(Object.values(record.externalEffects).every((value) => value === false));
  assert.equal(record.workflow.outcome, "NOT_ATTEMPTED");
});

test("schema rejects promotion, cleanup, invented Queue state, and D1 drift", () => {
  const mutations = [
    (value) => { value.status = "COMPLETED"; },
    (value) => { value.governing = true; },
    (value) => { value.continuation.authorized = true; },
    (value) => { value.locationDeviation.ownerAccepted = true; },
    (value) => { value.locationDeviation.deleteAuthorized = true; },
    (value) => { value.authorityDatabase.databaseId = "invented"; },
    (value) => { value.authorityDatabase.actualRegion = "automatic"; },
    (value) => { value.authorityDatabase.numTables = 1; },
    (value) => { value.authorityDatabase.sqlExecuted = true; },
    (value) => { value.queue.outcome = "CREATED"; },
    (value) => { value.queue.postStopExistence = "ABSENT"; },
    (value) => { value.externalEffects.automaticCleanupPerformed = true; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(record); mutate(changed);
    assert.notDeepEqual(validateSchema(schema, changed), []);
  }
});
