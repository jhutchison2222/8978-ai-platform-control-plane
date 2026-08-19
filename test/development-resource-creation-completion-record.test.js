import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const record = await load("deployment/development-resource-creation-completion-record.json");
const schema = await load("schemas/development-resource-creation-completion-record.schema.json");

test("completion record is exact, non-governing, unbound, and activation-disabled", async () => {
  assert.deepEqual(validateSchema(schema, record), []);
  assert.equal(record.status, "RESOURCE_CREATION_COMPLETED_UNBOUND");
  assert.equal(record.governing, false);
  assert.equal(record.continuation.authorized, false);
  for (const source of [record.sourcePacket, record.sourcePartialRecord]) {
    assert.equal(createHash("sha256").update(await readFile(source.path)).digest("hex"), source.sha256);
  }
});

test("D1 is accepted and unchanged without expanding authorization", () => {
  assert.equal(record.ownerDecision.wnamAccepted, true);
  assert.equal(record.authorityDatabase.ownerAccepted, true);
  assert.equal(record.authorityDatabase.outcome, "CREATED_UNCHANGED");
  assert.equal(record.authorityDatabase.databaseId, "741ade94-8539-4fc8-b6be-24884720dee8");
  assert.equal(record.authorityDatabase.deleteAuthorized, false);
  for (const field of ["sqlExecuted", "migrationsApplied", "dataInserted", "bindingInstalled"]) {
    assert.equal(record.authorityDatabase[field], false);
  }
});

test("Queue evidence stays owner-attested and tooling limitations remain explicit", () => {
  assert.equal(record.queue.outcome, "CREATED_OWNER_ATTESTED");
  assert.equal(record.queue.queueId, "fe649364dd804ebd984297b68da6a534");
  assert.equal(record.queue.deliveryDelaySeconds, 0);
  assert.equal(record.queue.messageRetentionSeconds, 86400);
  assert.equal(record.queue.operationalStatus, "INACTIVE");
  assert.equal(record.queue.inactivityAssessment, "EXPECTED_UNCONNECTED");
  assert.equal(record.queue.messagePublicationStatus, "UNVERIFIED");
  assert.equal(record.queue.independentVerificationStatus, "TOOLING_UNAVAILABLE");
  assert.equal(record.sameNamedWorker.technicalCollision, false);
  assert.equal(record.sameNamedWorker.renameAuthorized, false);
});

test("schema rejects evidence promotion, drift, rename, deletion, and activation", () => {
  const mutations = [
    (value) => { value.governing = true; },
    (value) => { value.queue.outcome = "CREATED_VERIFIED"; },
    (value) => { value.queue.exactNameMatchCount = 1; },
    (value) => { value.queue.messagePublicationStatus = "NONE_VERIFIED"; },
    (value) => { value.queue.bindingStatus = "VERIFIED_NONE"; },
    (value) => { value.queue.producerStatus = "VERIFIED_NONE"; },
    (value) => { value.queue.consumerStatus = "VERIFIED_NONE"; },
    (value) => { value.queue.independentVerificationStatus = "VERIFIED"; },
    (value) => { value.authorityDatabase.databaseId = "invented"; },
    (value) => { value.authorityDatabase.deleteAuthorized = true; },
    (value) => { value.sameNamedWorker.renameAuthorized = true; },
    (value) => { value.ownerDecision.activationAuthorized = true; },
    (value) => { value.continuation.authorized = true; },
    (value) => { value.verification.limitations.push("unexpected extra limitation"); },
    (value) => { value.externalEffects.workerDeployed = true; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(record); mutate(changed);
    assert.notDeepEqual(validateSchema(schema, changed), []);
  }
});
