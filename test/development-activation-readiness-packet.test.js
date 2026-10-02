import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { developmentActivationPreflight } from "../src/development-activation-preflight.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const packet = await load("deployment/development-activation-readiness-packet.json");
const schema = await load("schemas/development-activation-readiness-packet.schema.json");
const sourcePlan = await load(packet.sourcePlan.path);

test("readiness packet records standing development direction without executing", async () => {
  assert.deepEqual(validateSchema(schema, packet), []);
  assert.equal(packet.governing, false);
  assert.equal(packet.executionAuthorized, false);
  assert.equal(packet.ownerDirection.developmentExternalOperationsAuthorized, true);
  assert.equal(packet.ownerDirection.exactReviewedSubpacketRequired, true);
  assert.equal(packet.ownerDirection.productionOrCustomerOperationsAuthorized, false);
  assert.equal(createHash("sha256").update(await readFile(packet.sourcePlan.path)).digest("hex"), packet.sourcePlan.sha256);
});

test("packet maps each exact preflight blocker to one ordered phase", async () => {
  const report = await developmentActivationPreflight(sourcePlan);
  assert.deepEqual(packet.remainingBlockers, report.blockers);
  const mapped = packet.orderedPhases.flatMap((phase) => phase.resolves);
  assert.equal(new Set(mapped).size, mapped.length);
  assert.deepEqual([...mapped].sort(), [...packet.remainingBlockers].sort());
  assert.deepEqual(packet.orderedPhases.map((phase) => phase.sequence), [1, 2, 3, 4, 5]);
  assert.equal(packet.orderedPhases.every((phase) => phase.requiresIndependentReview && phase.requiresExactExecutionPacket && !phase.externalExecutionPermittedByThisPacket), true);
});

test("packet preserves permanent exclusions and stop-only partial failure handling", () => {
  assert.deepEqual(packet.alwaysProhibited, [
    "production_or_customer_operation", "resource_deletion", "automatic_cleanup", "automatic_retry",
    "automatic_restore", "unreviewed_scope_expansion", "credential_or_private_key_disclosure",
    "reuse_unrelated_d1_database", "customer_call_message_campaign_booking_transfer_or_payment",
  ]);
  assert.deepEqual({ ...packet.partialFailurePolicy }, {
    automaticDeletion:false, automaticCleanup:false, automaticRetry:false, automaticRestore:false,
    action:"stop_and_report_exact_state",
  });
});

test("schema rejects execution, production, review, sequencing, and recovery weakening", () => {
  const mutations = [
    (value) => { value.executionAuthorized = true; },
    (value) => { value.environment = "production"; },
    (value) => { value.ownerDirection.productionOrCustomerOperationsAuthorized = true; },
    (value) => { value.ownerDirection.exactReviewedSubpacketRequired = false; },
    (value) => { value.orderedPhases[0].requiresIndependentReview = false; },
    (value) => { value.orderedPhases[0].externalExecutionPermittedByThisPacket = true; },
    (value) => { value.orderedPhases[1].id = ""; },
    (value) => { value.partialFailurePolicy.automaticRetry = true; },
    (value) => { value.alwaysProhibited.pop(); },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(packet); mutate(changed);
    assert.notDeepEqual(validateSchema(schema, changed), []);
  }
});
