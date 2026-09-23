import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { validateSchema } from "../scripts/json-schema-lite.js";
import { CLOUDFLARE_ADMIN_V7, WRITE_APPROVALS } from "../src/cloudflare-admin-v7-contracts.js";
import { TARGET_WORKER_COMMIT } from "../src/target-runtime-manifest.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const loadJsonc = async (path) => parseJsonStrict((await readFile(path, "utf8")).replace(/^\s*\/\/.*$/gmu, ""));
import { normalizedFileDigest } from "../scripts/verify-target-runtime-closure.js";

const blobDigest = (file) => normalizedFileDigest(file);

const packet = await load("deployment/development-worker-bootstrap-creation-packet.json");
const schema = await load("schemas/development-worker-bootstrap-creation-packet.schema.json");
const bootstrapConfig = await loadJsonc("wrangler.bootstrap.jsonc");
const targetConfig = await loadJsonc("wrangler.jsonc");

test("bootstrap packet is schema-valid, non-governing, and authorizes no execution", () => {
  assert.deepEqual(validateSchema(schema, packet), []);
  assert.equal(packet.governing, false);
  assert.equal(packet.executionAuthorized, false);
  assert.equal(packet.workerDeploymentAuthorized, false);
  assert.equal(packet.subdomainEnablementAuthorized, false);
  assert.equal(packet.secretInstallationAuthorized, false);
  assert.equal(packet.canaryInvocationAuthorized, false);
});

test("the tracked packet does not claim to contain its own final commit SHA", () => {
  assert.equal(packet.remediationCommit, null);
  assert.equal(packet.remediationCommitBinding, "supplied_externally_in_owner_authorization_never_written_to_reviewed_tree");
  // The only 40-hex value anywhere in the tracked packet is the reviewed target commit.
  const commits = JSON.stringify(packet).match(/(?<![a-f0-9])[a-f0-9]{40}(?![a-f0-9])/gu) ?? [];
  assert.deepEqual([...new Set(commits)], [TARGET_WORKER_COMMIT]);
});

test("the schema rejects a 40-hex remediation commit SHA in the tracked field", () => {
  assert.notDeepEqual(validateSchema(schema, { ...packet, remediationCommit: "0".repeat(40) }), []);
  assert.notDeepEqual(validateSchema(schema, { ...packet, remediationCommit: TARGET_WORKER_COMMIT }), []);
});

test("bootstrap configuration differs from the reviewed target configuration only in workers_dev", () => {
  assert.deepEqual(Object.keys(bootstrapConfig).sort(), Object.keys(targetConfig).sort());
  for (const key of Object.keys(targetConfig)) {
    if (key === "workers_dev") continue;
    assert.deepEqual(bootstrapConfig[key], targetConfig[key], `${key} must be identical`);
  }
  assert.equal(targetConfig.workers_dev, true);
  assert.equal(bootstrapConfig.workers_dev, false);
});

test("bootstrap configuration declares workers_dev and preview_urls explicitly and no public surface", () => {
  // Wrangler defaults workers_dev to true when the key is absent and no route exists.
  assert.ok(Object.prototype.hasOwnProperty.call(bootstrapConfig, "workers_dev"));
  assert.ok(Object.prototype.hasOwnProperty.call(bootstrapConfig, "preview_urls"));
  assert.equal(bootstrapConfig.preview_urls, false);
  for (const key of ["routes", "route", "rules", "alias", "build", "find_additional_modules", "no_bundle", "site", "assets"]) {
    assert.ok(!Object.prototype.hasOwnProperty.call(bootstrapConfig, key), `${key} must not be declared`);
  }
  assert.equal(packet.bootstrapSurface.publicSurface, "none");
});

test("bootstrap configuration preserves the exact reviewed bindings and Durable Object migrations", () => {
  assert.equal(bootstrapConfig.main, "src/control-plane-worker.js");
  assert.equal(bootstrapConfig.d1_databases.length, 1);
  assert.equal(bootstrapConfig.d1_databases[0].database_id, "741ade94-8539-4fc8-b6be-24884720dee8");
  assert.equal(bootstrapConfig.workflows.length, 1);
  assert.equal(bootstrapConfig.workflows[0].class_name, "OrchestratorWorkflow");
  assert.equal(bootstrapConfig.queues.producers.length, 1);
  assert.equal(bootstrapConfig.durable_objects.bindings.length, 4);
  assert.deepEqual(bootstrapConfig.migrations.map((m) => m.tag), ["v1", "v2"]);
  assert.deepEqual(packet.bootstrapSurface.migrationTags, ["v1", "v2"]);
  assert.equal(bootstrapConfig.vars.ALLOW_EXTERNAL_WRITES, "false");
  assert.equal(bootstrapConfig.vars.CONTROL_PLANE_MODE, "development");
});

test("bootstrap digest is identical in the file, the connector contracts, and the packet", () => {
  const fromGit = blobDigest("wrangler.bootstrap.jsonc");
  assert.equal(fromGit, CLOUDFLARE_ADMIN_V7.bootstrapConfigurationSha256);
  assert.equal(fromGit, packet.bootstrapConfiguration.sha256);
  assert.equal(packet.targetConfigurationSha256, blobDigest("wrangler.jsonc"));
  assert.equal(packet.targetWorkerCommit, TARGET_WORKER_COMMIT);
});

test("bootstrap authorization lives in the packet and never in connector write approvals", () => {
  assert.ok(!Object.prototype.hasOwnProperty.call(WRITE_APPROVALS, "bootstrapCreateWorker"));
  assert.match(packet.requiredOwnerAuthorizationTemplate, /exactly one bootstrap deployment/u);
  assert.match(packet.requiredOwnerAuthorizationTemplate, /9f9cd5ee1a388d0a50959f9fc68a2c2efecdb6e05ed7bdac1bfae9559d434e8d/u);
  assert.match(packet.preBootstrapRouteAudit.requiredOwnerAuthorizationTemplate, /Workers Routes Read only, never Workers Routes Write/u);
});

test("the route audit is a separate read-only zone credential with no write permission", () => {
  assert.equal(packet.preBootstrapRouteAudit.required, true);
  assert.equal(packet.preBootstrapRouteAudit.credential, "separate_temporary_read_only_zone_credential");
  assert.deepEqual(packet.preBootstrapRouteAudit.requiredPermissions, ["Zone Read", "Workers Routes Read"]);
  assert.deepEqual(packet.preBootstrapRouteAudit.permittedMethods, ["GET"]);
  assert.ok(packet.preBootstrapRouteAudit.prohibitedPermissions.includes("Workers Routes Write"));
  assert.equal(packet.credentialBoundaries.connectorRouteAccess, false);
  assert.equal(packet.credentialBoundaries.runtimeTokenZonePermissions, false);
});

test("the packet declares the two independent credential kinds and cross-invocation custody", () => {
  assert.deepEqual(packet.credentialBoundaries.credentialKinds, ["access-service-token", "service-auth-principal"]);
  assert.equal(packet.credentialBoundaries.crossInvocationCustodyRequired, true);
});

test("the bootstrap phase is satisfiable while the target Worker does not exist", () => {
  assert.equal(packet.requiresWorkerExists, false);
  assert.equal(packet.partialFailurePolicy.automaticRetry, false);
  assert.equal(packet.partialFailurePolicy.automaticRollback, false);
  assert.equal(packet.authorizedCommands.maximumAttempts, 1);
});
