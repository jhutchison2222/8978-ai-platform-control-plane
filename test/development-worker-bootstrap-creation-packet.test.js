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

// Independent restatement of the exact pinned commands; the schema, packet, validator, and docs must all agree.
const PINNED_COMMANDS = {
  routeAudit: "node scripts/audit-development-worker-routes.js",
  bootstrapDeploy: `npx wrangler deploy --config wrangler.bootstrap.jsonc --strict --message "8978-bootstrap:${TARGET_WORKER_COMMIT}:9f9cd5ee1a388d0a50959f9fc68a2c2efecdb6e05ed7bdac1bfae9559d434e8d"`,
  bootstrapVerification: "node scripts/verify-development-worker-bootstrap.js --remediation-commit <AUTHORIZED_REMEDIATION_SHA> --bootstrap-version-id <BOOTSTRAP_VERSION_ID>",
};

test("the three owner-run commands are pinned exactly in the schema, packet, validator, and documentation", async () => {
  const validator = await readFile("scripts/validate-artifacts.js", "utf8");
  const docs = [
    await readFile("docs/development-worker-bootstrap-creation.md", "utf8"),
    await readFile("docs/development-worker-route-audit.md", "utf8"),
    await readFile("docs/cloudflare-admin-v7.md", "utf8"),
  ].join("\n");
  for (const [name, command] of Object.entries(PINNED_COMMANDS)) {
    const pinned = schema.properties.authorizedCommands.properties[name];
    assert.deepEqual(Object.keys(pinned), ["const"], `${name} must be a single schema const`);
    assert.equal(pinned.const, command);
    assert.equal(packet.authorizedCommands[name], command);
    assert.ok(docs.includes(command), `documentation must state the exact ${name} command`);
  }
  assert.ok(validator.includes("PINNED_BOOTSTRAP_COMMANDS"));
  assert.ok(validator.includes("--bootstrap-version-id <BOOTSTRAP_VERSION_ID>"));
});

test("the remediation checkout installs the target-runtime verifier sub-package before invoking it", async () => {
  // Confirmed review finding: verify-target-runtime-closure.js's parserClosure() execFileSync's
  // tools/target-runtime-verifier/parser.mjs and hard-fails if that sub-package was never installed.
  // The documented remediation checkout runs verify-target-runtime-closure.js but, before this test,
  // never ran npm ci there — an operator following the runbook verbatim would hit that hard failure.
  const doc = await readFile("docs/development-worker-bootstrap-creation.md", "utf8");
  const remediationSection = doc.slice(doc.indexOf("**Remediation checkout**"), doc.indexOf("**Reviewed target checkout**"));
  assert.match(remediationSection, /cd tools\/target-runtime-verifier.*npm ci/su);
  const installIndex = remediationSection.search(/cd tools\/target-runtime-verifier.*npm ci/su);
  const verifyIndex = remediationSection.indexOf("verify-target-runtime-closure.js");
  assert.ok(installIndex >= 0 && installIndex < verifyIndex, "the install step must come before the verifier is invoked");
});

test("an altered, weakened, or substituted command is rejected by the schema", () => {
  const altered = {
    routeAudit: [
      "node scripts/audit-development-worker-routes.js --skip-pagination",
      "node scripts/audit-development-worker-routes.jsx",
      "node  scripts/audit-development-worker-routes.js",
    ],
    bootstrapDeploy: [
      PINNED_COMMANDS.bootstrapDeploy.replace("--config wrangler.bootstrap.jsonc", "--config wrangler.jsonc"),
      PINNED_COMMANDS.bootstrapDeploy.replace(" --strict", ""),
      PINNED_COMMANDS.bootstrapDeploy.replace("npx wrangler deploy", "npx wrangler versions upload"),
      PINNED_COMMANDS.bootstrapDeploy.replace("8978-bootstrap:", "8978-reviewed:"),
      PINNED_COMMANDS.bootstrapDeploy.replace("9f9cd5ee", "0f9cd5ee"),
      `${PINNED_COMMANDS.bootstrapDeploy} --name 8978-ai-control-plane-prod`,
      "npx wrangler deploy --config wrangler.bootstrap.jsonc --strict",
    ],
    bootstrapVerification: [
      "node scripts/verify-development-worker-bootstrap.js --remediation-commit <AUTHORIZED_REMEDIATION_SHA>",
      PINNED_COMMANDS.bootstrapVerification.replace(" --bootstrap-version-id <BOOTSTRAP_VERSION_ID>", ""),
      PINNED_COMMANDS.bootstrapVerification.replace("<BOOTSTRAP_VERSION_ID>", "11111111-2222-3333-4444-555555555555"),
      PINNED_COMMANDS.bootstrapVerification.replace("<AUTHORIZED_REMEDIATION_SHA>", "0".repeat(40)),
    ],
  };
  for (const [name, variants] of Object.entries(altered)) {
    for (const variant of variants) {
      const tampered = { ...packet, authorizedCommands: { ...packet.authorizedCommands, [name]: variant } };
      assert.notDeepEqual(validateSchema(schema, tampered), [], `${name} variant must be rejected: ${variant}`);
    }
  }
  const missing = { ...packet, authorizedCommands: { ...packet.authorizedCommands } };
  delete missing.authorizedCommands.bootstrapVerification;
  assert.notDeepEqual(validateSchema(schema, missing), []);
});

test("the bootstrap phase is satisfiable while the target Worker does not exist", () => {
  assert.equal(packet.requiresWorkerExists, false);
  assert.equal(packet.partialFailurePolicy.automaticRetry, false);
  assert.equal(packet.partialFailurePolicy.automaticRollback, false);
  assert.equal(packet.authorizedCommands.maximumAttempts, 1);
});
