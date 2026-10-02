import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { developmentActivationPreflight } from "../src/development-activation-preflight.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const resourceReconciled = await load("deployment/development-activation-plan-resource-reconciled.json");
const schemaReconciled = await load("deployment/development-activation-plan-schema-reconciled.json");
const schema = await load("schemas/development-activation-plan.schema.json");

test("schema-reconciled successor changes exactly two verified schema values", () => {
  assert.deepEqual(validateSchema(schema, schemaReconciled), []);
  const expected = structuredClone(resourceReconciled);
  expected.authorityDatabase.migrationsApplied = true;
  expected.authorityDatabase.remoteSchemaVerified = true;
  assert.equal(JSON.stringify(schemaReconciled), JSON.stringify(expected));
});

test("schema reconciliation source records remain digest-pinned", async () => {
  const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
  assert.equal(await digest("deployment/development-activation-plan-resource-reconciled.json"), "3621dc92abf5c309d4a92a86cf4dc3f01da473d88c273697c9e91e9e7d092825");
  assert.equal(await digest("deployment/development-authority-migration-execution-record.json"), "627dcf833b0ba5db15729e3916c246724f4f90c2919e374a4c3e4faeafaf16f1");
  assert.equal(await digest("deployment/development-authority-schema-inventory-verification-record.json"), "253a4e87adbd56daed27e6b6080592544e60fb7b9d2c2a72e9d6f379601e67b6");
});

test("schema-reconciled successor remains blocked by exactly 15 gates", async () => {
  const report = await developmentActivationPreflight(schemaReconciled);
  assert.equal(report.ready, false);
  assert.equal(report.blockers.length, 15);
  for (const resolved of ["authority_database_not_created", "authority_database_id_unavailable", "authority_migrations_not_applied", "authority_schema_not_verified", "queue_not_created"]) {
    assert.equal(report.blockers.includes(resolved), false);
  }
  for (const required of ["workflow_not_created", "authority_binding_not_installed", "queue_binding_not_installed", "activation_not_authorized", "worker_deployment_not_authorized", "independent_evidence_verifier_unavailable"]) {
    assert.equal(report.blockers.includes(required), true);
  }
});

test("schema reconciliation does not expand bindings, evidence, or authorization", () => {
  assert.equal(schemaReconciled.status, "PLANNED");
  assert.equal(schemaReconciled.governing, false);
  assert.equal(schemaReconciled.activationAuthorized, false);
  assert.equal(schemaReconciled.workerDeploymentAuthorized, false);
  assert.equal(schemaReconciled.authorityDatabase.resourceCreated, true);
  assert.equal(schemaReconciled.authorityDatabase.migrationsApplied, true);
  assert.equal(schemaReconciled.authorityDatabase.remoteSchemaVerified, true);
  for (const value of [
    schemaReconciled.authorityDatabase.bindingInstalled, schemaReconciled.workflow.resourceCreated,
    schemaReconciled.workflow.bindingInstalled, schemaReconciled.queue.bindingInstalled,
  ]) assert.equal(value, false);
  assert.equal(Object.values(schemaReconciled.evidence).every((value) => value === null), true);
  assert.equal(schemaReconciled.rollback.backupDigest, null);
  assert.equal(schemaReconciled.rollback.automaticResourceDeletion, false);
});
