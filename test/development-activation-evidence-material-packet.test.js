import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const packet = await load("deployment/development-activation-evidence-material-packet.json");
const schema = await load("schemas/development-activation-evidence-material-packet.schema.json");

const expectedMaterials = [
  ["maker_validation_attestation", "maker", "maker_validation", "identity_attestation"],
  ["checker_validation_attestation", "checker", "checker_validation", "identity_attestation"],
  ["rollback_attestation", "checker", "rollback_evidence", "identity_attestation"],
  ["backup_attestation", "maker", "backup_evidence", "identity_attestation"],
  ["resource_activation_decision", "owner", "resource_activation_authorization", "owner_decision"],
  ["worker_deployment_decision", "owner", "worker_deployment_authorization", "owner_decision"],
];

test("evidence material packet is exact and non-materializing", async () => {
  assert.deepEqual(validateSchema(schema, packet), []);
  assert.equal(packet.governing, false);
  assert.equal(packet.materializationAuthorized, false);
  assert.equal(packet.target.reviewedCommit, null);
  assert.equal(createHash("sha256").update(await readFile(packet.sourceReadinessPacket.path)).digest("hex"), packet.sourceReadinessPacket.sha256);
  assert.equal(createHash("sha256").update(await readFile(packet.target.activationPlanPath)).digest("hex"), packet.target.activationPlanSha256);
});

test("packet defines six unique role and purpose-bound pending materials", () => {
  assert.deepEqual(packet.materials.map(({ id, role, purpose, kind }) => [id, role, purpose, kind]), expectedMaterials);
  assert.equal(new Set(packet.materials.map((material) => material.purpose)).size, 6);
  assert.equal(packet.materials.every((material) => material.status === "PENDING" && material.actionDigest === null && material.evidenceDigest === null && material.signedMaterial === null), true);
  assert.equal(packet.roles.pairwiseDistinctPrincipalsRequired, true);
  assert.equal(packet.roles.maker.samePrincipalRequired, true);
  assert.equal(packet.roles.checker.samePrincipalRequired, true);
  assert.equal(packet.roles.owner.samePrincipalRequired, true);
  assert.equal(packet.roles.owner.distinctDecisionIdsRequired, true);
});

test("private material stays out of repository D1 logs and artifacts", () => {
  assert.deepEqual({ ...packet.storageBoundary }, {
    publicIdentityAndOwnerKeysMayBeStoredInAuthorityD1:true,
    privateKeysMayBeStoredInRepository:false,
    privateKeysMayBeStoredInD1:false,
    privateKeysRequireManagedSecrets:true,
    credentialValuesMayAppearInLogsOrArtifacts:false,
    authorityD1WriteDeferred:true,
    managedSecretInstallationDeferred:true,
  });
  assert.equal(Object.values(packet.partialFailurePolicy).some((value) => value === true), false);
});

test("schema rejects materialization secret exposure and fabricated evidence", () => {
  const mutations = [
    (value) => { value.materializationAuthorized = true; },
    (value) => { value.environment = "production"; },
    (value) => { value.target.reviewedCommit = "a".repeat(40); },
    (value) => { value.materials[0].status = "SIGNED"; },
    (value) => { value.materials[0].evidenceDigest = `sha256:${"a".repeat(64)}`; },
    (value) => { value.storageBoundary.privateKeysMayBeStoredInRepository = true; },
    (value) => { value.storageBoundary.authorityD1WriteDeferred = false; },
    (value) => { value.partialFailurePolicy.automaticRetry = true; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(packet); mutate(changed);
    assert.notDeepEqual(validateSchema(schema, changed), []);
  }
});
