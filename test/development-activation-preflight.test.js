import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import {
  assertDevelopmentActivationPlan,
  developmentActivationBlockers,
  developmentActivationPreflight,
} from "../src/development-activation-preflight.js";

const plan = parseJsonStrict(await readFile("deployment/development-activation-plan.json", "utf8"));
const digest = (character) => `sha256:${character.repeat(64)}`;
const clone = (value) => structuredClone(value);

function readyPlan() {
  const candidate = clone(plan);
  candidate.status = "READY";
  candidate.activationAuthorized = true;
  candidate.workerDeploymentAuthorized = true;
  Object.assign(candidate.authorityDatabase, {
    databaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    resourceCreated: true,
    bindingInstalled: true,
    migrationsApplied: true,
    remoteSchemaVerified: true,
  });
  Object.assign(candidate.workflow, { resourceCreated: true, bindingInstalled: true });
  Object.assign(candidate.queue, { resourceCreated: true, bindingInstalled: true });
  Object.assign(candidate.evidence, {
    reviewedCommit: "a".repeat(40),
    makerValidationDigest: digest("a"),
    checkerValidationDigest: digest("b"),
    resourceActivationAuthorizationDigest: digest("c"),
    workerDeploymentAuthorizationDigest: digest("d"),
    rollbackEvidenceDigest: digest("e"),
  });
  candidate.rollback.backupDigest = digest("f");
  return candidate;
}

test("development activation plan remains deliberately blocked and non-governing", async () => {
  assert.equal(assertDevelopmentActivationPlan(plan), true);
  const report = await developmentActivationPreflight(plan);
  assert.equal(report.ready, false);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.blockers), true);
  assert.deepEqual(report.blockers, [
    "plan_not_ready", "activation_not_authorized", "worker_deployment_not_authorized",
    "authority_database_not_created", "authority_database_id_unavailable", "authority_binding_not_installed",
    "authority_migrations_not_applied", "authority_schema_not_verified", "workflow_not_created",
    "workflow_binding_not_installed", "queue_not_created", "queue_binding_not_installed",
    "reviewed_commit_unavailable", "maker_validation_unavailable", "checker_validation_unavailable",
    "resource_activation_authorization_unavailable", "worker_deployment_authorization_unavailable",
    "rollback_evidence_unavailable", "rollback_backup_unavailable", "independent_evidence_verifier_unavailable",
  ]);
});

test("preflight requires every resource, review, authorization, rollback, and independent-verifier gate", async () => {
  const candidate = readyPlan();
  assert.deepEqual(await developmentActivationPreflight(candidate), {
    ready: false, environment: "development", blockers: ["independent_evidence_verifier_unavailable"],
  });
  const evidenceVerifier = {
    async verify(evidence) {
      return {
        ...evidence,
        valid: evidence.reviewedCommit === candidate.evidence.reviewedCommit,
        makerPrincipalId: "maker-principal",
        checkerPrincipalId: "checker-principal",
        ownerPrincipalId: "owner-principal",
        verificationDigest: digest("9"),
      };
    },
  };
  assert.deepEqual(await developmentActivationPreflight(candidate, { evidenceVerifier }), { ready: true, environment: "development", blockers: [] });
  const invalidVerificationMutations = [
    (value) => { value.reviewedCommit = "b".repeat(40); },
    (value) => { value.makerValidationDigest = digest("0"); },
    (value) => { value.makerPrincipalId = value.checkerPrincipalId; },
    (value) => { value.ownerPrincipalId = value.makerPrincipalId; },
    (value) => { value.verificationDigest = "invalid"; },
  ];
  for (const mutate of invalidVerificationMutations) {
    const invalidVerifier = {
      async verify(evidence) {
        const result = await evidenceVerifier.verify(evidence); mutate(result); return result;
      },
    };
    const failed = await developmentActivationPreflight(candidate, { evidenceVerifier: invalidVerifier });
    assert.deepEqual(failed.blockers, ["independent_evidence_verification_failed"]);
  }
  const requiredFlags = [
    ["activationAuthorized"], ["workerDeploymentAuthorized"],
    ["authorityDatabase", "resourceCreated"], ["authorityDatabase", "bindingInstalled"],
    ["authorityDatabase", "migrationsApplied"], ["authorityDatabase", "remoteSchemaVerified"],
    ["workflow", "resourceCreated"], ["workflow", "bindingInstalled"],
    ["queue", "resourceCreated"], ["queue", "bindingInstalled"],
  ];
  for (const path of requiredFlags) {
    const changed = clone(candidate);
    const target = path.length === 1 ? changed : changed[path[0]];
    target[path.at(-1)] = false;
    assert.equal((await developmentActivationPreflight(changed, { evidenceVerifier })).ready, false, path.join("."));
  }
  for (const field of ["reviewedCommit", "makerValidationDigest", "checkerValidationDigest", "resourceActivationAuthorizationDigest", "workerDeploymentAuthorizationDigest", "rollbackEvidenceDigest"]) {
    const changed = clone(candidate); changed.evidence[field] = null;
    assert.equal((await developmentActivationPreflight(changed, { evidenceVerifier })).ready, false, field);
  }
  candidate.rollback.backupDigest = null;
  assert.equal((await developmentActivationPreflight(candidate, { evidenceVerifier })).ready, false);
  await assert.doesNotReject(async () => {
    const failed = await developmentActivationPreflight(readyPlan(), { evidenceVerifier: { async verify() { throw new Error("unavailable"); } } });
    assert.deepEqual(failed.blockers, ["independent_evidence_verification_failed"]);
  });
});

test("preflight rejects mixed-purpose authority storage, migration drift, and weakened rollback", () => {
  const cases = [
    (value) => { value.environment = "production"; },
    (value) => { value.authorityDatabase.databaseName = "pk-d1-dev"; },
    (value) => { value.authorityDatabase.databaseId = "9cd8094c-f334-44e6-bdd1-b325802474d5"; },
    (value) => { value.authorityDatabase.migrations[0].sha256 = "0".repeat(64); },
    (value) => { value.authorityDatabase.migrations.reverse(); },
    (value) => { value.workflow.name = "production-workflow"; },
    (value) => { value.queue.binding = "WRONG_QUEUE"; },
    (value) => { value.evidence.checkerValidationDigest = value.evidence.makerValidationDigest; },
    (value) => { value.evidence.workerDeploymentAuthorizationDigest = value.evidence.resourceActivationAuthorizationDigest; },
    (value) => { value.rollback.unbindFirst = false; },
    (value) => { value.rollback.automaticResourceDeletion = true; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of cases) {
    const changed = readyPlan(); mutate(changed);
    assert.throws(() => developmentActivationBlockers(changed));
  }
});

test("preflight directly enforces both existing authority database reuse prohibitions", () => {
  const prohibitedName = readyPlan();
  prohibitedName.authorityDatabase.databaseName = "pk-d1-dev";
  assert.throws(
    () => assertDevelopmentActivationPlan(prohibitedName),
    /Existing authority database reuse is prohibited/,
  );

  const prohibitedId = readyPlan();
  prohibitedId.authorityDatabase.databaseId = "9cd8094c-f334-44e6-bdd1-b325802474d5";
  assert.throws(
    () => assertDevelopmentActivationPlan(prohibitedId),
    /Existing authority database reuse is prohibited/,
  );
});
