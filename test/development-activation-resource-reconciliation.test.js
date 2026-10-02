import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { developmentActivationPreflight } from "../src/development-activation-preflight.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const historical = await load("deployment/development-activation-plan.json");
const reconciled = await load("deployment/development-activation-plan-resource-reconciled.json");
const schema = await load("schemas/development-activation-plan.schema.json");

test("resource-reconciled successor changes exactly three historical plan values", () => {
  assert.deepEqual(validateSchema(schema, reconciled), []);
  const expected = structuredClone(historical);
  expected.authorityDatabase.databaseId = "741ade94-8539-4fc8-b6be-24884720dee8";
  expected.authorityDatabase.resourceCreated = true;
  expected.queue.resourceCreated = true;
  assert.equal(JSON.stringify(reconciled), JSON.stringify(expected));
});

test("historical plan and completion evidence remain digest-pinned", async () => {
  const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
  assert.equal(await digest("deployment/development-activation-plan.json"), "0d6345c6537184e08f69f0953cfdc3de42c8456114fcccd4d71be08fda641fac");
  assert.equal(await digest("deployment/development-resource-creation-completion-record.json"), "98f9c0623e2240aad87d68f9fdc7b3fe895d0853308d272c9398ec6858815747");
});

test("resource-reconciled successor remains blocked by exactly 17 gates", async () => {
  const report = await developmentActivationPreflight(reconciled);
  assert.equal(report.ready, false);
  assert.equal(report.blockers.length, 17);
  for (const resolved of ["authority_database_not_created", "authority_database_id_unavailable", "queue_not_created"]) {
    assert.equal(report.blockers.includes(resolved), false);
  }
  for (const required of ["workflow_not_created", "authority_binding_not_installed", "queue_binding_not_installed", "activation_not_authorized", "worker_deployment_not_authorized", "independent_evidence_verifier_unavailable"]) {
    assert.equal(report.blockers.includes(required), true);
  }
});

test("reconciliation does not expand bindings, migration, evidence, or authorization", () => {
  assert.equal(reconciled.status, "PLANNED");
  assert.equal(reconciled.governing, false);
  assert.equal(reconciled.activationAuthorized, false);
  assert.equal(reconciled.workerDeploymentAuthorized, false);
  for (const value of [
    reconciled.authorityDatabase.bindingInstalled, reconciled.authorityDatabase.migrationsApplied,
    reconciled.authorityDatabase.remoteSchemaVerified, reconciled.workflow.resourceCreated,
    reconciled.workflow.bindingInstalled, reconciled.queue.bindingInstalled,
  ]) assert.equal(value, false);
  assert.equal(Object.values(reconciled.evidence).every((value) => value === null), true);
  assert.equal(reconciled.rollback.backupDigest, null);
  assert.equal(reconciled.rollback.automaticResourceDeletion, false);
});
