import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { validateSchema } from "../scripts/json-schema-lite.js";

const load = async (path) => parseJsonStrict(await readFile(path, "utf8"));
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const packet = await load("deployment/development-live-test-execution-packet.json");
const schema = await load("schemas/development-live-test-execution-packet.schema.json");
const wrangler = await load("wrangler.jsonc");

test("live-test packet is immutable, non-governing, and not authorized", async () => {
  assert.deepEqual(validateSchema(schema, packet), []);
  assert.equal(packet.governing, false);
  for (const field of ["executionAuthorized", "workerDeploymentAuthorized", "secretInstallationAuthorized", "accessSurfaceChangeAuthorized", "canaryInvocationAuthorized"]) assert.equal(packet[field], false);
  for (const source of [packet.source.wranglerConfiguration, packet.source.resourceCreationRecord, packet.source.migrationRecord, packet.source.schemaVerificationRecord]) assert.equal(await digest(source.path), source.sha256);
});

test("packet pins targets and distinguishes declarations from remote facts", () => {
  assert.deepEqual({ ...packet.target.authorityDatabase }, { binding:"AUTHORITY_DB", name:"8978-ai-authority-dev", databaseId:"741ade94-8539-4fc8-b6be-24884720dee8" });
  assert.deepEqual({ ...packet.target.workflow }, { binding:"ORCHESTRATOR_WORKFLOW", name:"8978-ai-orchestrator-dev", className:"OrchestratorWorkflow" });
  assert.deepEqual({ ...packet.target.queueProducer }, { binding:"ORCHESTRATOR_QUEUE", name:"8978-ai-orchestrator-dev" });
  assert.equal(packet.target.workerName, "8978-ai-control-plane-dev");
  assert.equal(packet.stateDistinction.configurationDeclared.authorityDatabaseBinding, true);
  assert.equal(packet.stateDistinction.configurationDeclared.workflowBinding, true);
  assert.equal(packet.stateDistinction.configurationDeclared.queueProducerBinding, true);
  assert.equal(packet.stateDistinction.remotelyRecorded.workflowExistence, "UNVERIFIED");
  assert.equal(packet.stateDistinction.remotelyRecorded.runtimeBindingsInstalled, "UNVERIFIED_NOT_CLAIMED");
  assert.equal(packet.stateDistinction.declarationDoesNotProveRemoteInstallation, true);
});

test("packet matches the current fail-closed Wrangler configuration", () => {
  assert.equal(wrangler.name, packet.target.workerName);
  assert.deepEqual(wrangler.d1_databases.map((binding) => ({ ...binding })), [{ binding:"AUTHORITY_DB", database_name:"8978-ai-authority-dev", database_id:"741ade94-8539-4fc8-b6be-24884720dee8", migrations_dir:"migrations/authority" }]);
  assert.deepEqual(wrangler.workflows.map((binding) => ({ ...binding })), [{ binding:"ORCHESTRATOR_WORKFLOW", name:"8978-ai-orchestrator-dev", class_name:"OrchestratorWorkflow" }]);
  assert.deepEqual({ producers:wrangler.queues.producers.map((binding) => ({ ...binding })) }, { producers:[{ binding:"ORCHESTRATOR_QUEUE", queue:"8978-ai-orchestrator-dev" }] });
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.equal(Object.hasOwn(wrangler, "routes"), false);
  assert.equal(Object.hasOwn(wrangler.queues, "consumers"), false);
  assert.equal(wrangler.vars.CONTROL_PLANE_MODE, "development");
  assert.equal(wrangler.vars.ALLOW_EXTERNAL_WRITES, "false");
  assert.equal(Object.hasOwn(wrangler.vars, "SERVICE_AUTH_KEYS_JSON"), false);
});

test("owner decisions remain unresolved and a new exact review is required", () => {
  assert.deepEqual(packet.unresolvedOwnerDecisions.map(({ id }) => id), ["development_access_surface", "development_access_policy", "access_policy_credential", "service_auth_identity"]);
  assert.equal(packet.unresolvedOwnerDecisions.every((decision) => decision.required && decision.selected === null), true);
  assert.equal(packet.candidateExternalOperations.maximumExecutionAttempts, 1);
  assert.equal(packet.candidateExternalOperations.requiresNewExactReviewedHeadAfterOwnerDecisions, true);
  assert.match(packet.requiredOwnerAuthorizationTemplate, /exact head <FULL_SHA>/u);
  assert.match(packet.requiredOwnerAuthorizationTemplate, /<EXACT_ACCESS_SURFACE>/u);
  assert.match(packet.requiredOwnerAuthorizationTemplate, /<EXACT_ACCESS_POLICY>/u);
  assert.match(packet.requiredOwnerAuthorizationTemplate, /<EXACT_ACCESS_SERVICE_TOKEN_IDENTITY_AND_CUSTODIAN>/u);
});

test("canary proves authentication, D1 reads, replay denial, and execution denial with bounded effects", () => {
  assert.deepEqual(packet.canary.requests.map(({ sequence }) => sequence), [1, 2, 3, 4, 5]);
  assert.deepEqual(packet.canary.requests.map(({ expectedStatus }) => expectedStatus), [401, 200, 401, 200, 503]);
  assert.deepEqual(packet.canary.requests.map(({ expectedResult }) => expectedResult), ["service_authentication_failed", "ready_false_mode_development_external_writes_false_no_missing_authoritative_dependencies", "service_authentication_failed_replay_denied", "authoritative_resolution_unavailable", "execution_disabled"]);
  assert.deepEqual({ ...packet.canary.boundedEffects }, { authorityD1ReadsExpected:true, authorityD1WritesMaximum:0, durableReplayNonceRecordsMaximum:3, queueMessagesMaximum:0, workflowInstancesMaximum:0, externalBusinessActionsMaximum:0, customerRecordsMaximum:0 });
  assert.deepEqual({ ...packet.canary.syntheticAction.requestedTarget }, { locator:"live-canary://missing-resource" });
  assert.equal(packet.canary.syntheticAction.operation, "read");
});

test("schema rejects authorization, exposure, write, retry, and target weakening", () => {
  const mutations = [
    (value) => { value.executionAuthorized = true; },
    (value) => { value.workerDeploymentAuthorized = true; },
    (value) => { value.secretInstallationAuthorized = true; },
    (value) => { value.accessSurfaceChangeAuthorized = true; },
    (value) => { value.canaryInvocationAuthorized = true; },
    (value) => { value.environment = "production"; },
    (value) => { value.target.authorityDatabase.databaseId = "wrong"; },
    (value) => { value.preservedFailClosedBoundary.allowExternalWrites = "true"; },
    (value) => { value.preservedFailClosedBoundary.queuePublicationPermitted = true; },
    (value) => { value.canary.boundedEffects.authorityD1WritesMaximum = 1; },
    (value) => { value.candidateExternalOperations.maximumExecutionAttempts = 2; },
    (value) => { value.unresolvedOwnerDecisions[0].selected = "invented"; },
    (value) => { value.partialFailurePolicy.automaticRetry = true; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(packet); mutate(changed); assert.notDeepEqual(validateSchema(schema, changed), []); }
});
