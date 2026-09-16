import test from "node:test";
import assert from "node:assert/strict";
import {
  CLOUDFLARE_ADMIN_V7,
  WRITE_APPROVALS,
  assertPinnedTarget,
  requireExactApproval,
} from "../src/cloudflare-admin-v7-contracts.js";
import { CloudflareAdminV7Api } from "../src/cloudflare-admin-v7-api.js";
import { ManagedSecretCredentialCustodian } from "../src/cloudflare-admin-v7-custodian.js";
import { redactSensitive, secretMetadataOnly } from "../src/cloudflare-admin-v7-redaction.js";
import { CloudflareAdminV7Service } from "../src/cloudflare-admin-v7-service.js";

function response(result, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, result }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("v7 target contract rejects arbitrary and production targets", () => {
  assert.equal(assertPinnedTarget({ workerName: CLOUDFLARE_ADMIN_V7.workerName }).workerName, CLOUDFLARE_ADMIN_V7.workerName);
  assert.throws(() => assertPinnedTarget({ workerName: "8978-ai-control-plane-prod" }), /Pinned target mismatch/);
  assert.throws(() => assertPinnedTarget({ zoneId: "arbitrary-zone" }), /Arbitrary target field/);
  assert.throws(() => requireExactApproval("runCanary", "yes"), /Exact approval required/);
  assert.doesNotThrow(() => requireExactApproval("runCanary", WRITE_APPROVALS.runCanary));
});

test("Cloudflare API adapter pins account and exposes only fixed operations with redirect rejection", async () => {
  assert.throws(() => new CloudflareAdminV7Api({ apiToken: "x".repeat(30), accountId: "wrong" }), /pinned development account/);
  const requests = [];
  const api = new CloudflareAdminV7Api({
    apiToken: "x".repeat(30),
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response([]);
    },
  });
  assert.equal("request" in api, false);
  assert.equal("accountPath" in api, false);
  await api.listWorkerSecrets();
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].url.includes(CLOUDFLARE_ADMIN_V7.accountId), true);
  await api.createServiceAuthVersion("{}", "a".repeat(40), "b".repeat(64));
  assert.equal(requests[1].init.method, "PATCH");
  assert.equal(requests[1].init.headers.get("content-type"), "application/merge-patch+json");
});

test("secret metadata and nested responses are redacted", () => {
  assert.deepEqual(secretMetadataOnly([
    { name: "SAFE", type: "plain_text", text: "visible" },
    { name: "SERVICE_AUTH_KEYS_JSON", type: "secret_text", text: "must-not-escape" },
  ]), [{ name: "SERVICE_AUTH_KEYS_JSON", type: "secret_text" }]);
  const redacted = redactSensitive({ authorization: "Bearer very-secret-value", nested: { client_secret: "abc", note: "Bearer abcdefghijklmnopqrstuvwxyz1234" } });
  assert.deepEqual(redacted, { authorization: "[REDACTED]", nested: { client_secret: "[REDACTED]", note: "Bearer [REDACTED]" } });
  assert.deepEqual(redactSensitive({ secretMetadata: [{ name: "SERVICE_AUTH_KEYS_JSON", type: "secret_text" }], reviewedCommit: "a".repeat(40) }), {
    secretMetadata: [{ name: "SERVICE_AUTH_KEYS_JSON", type: "secret_text" }],
    reviewedCommit: "a".repeat(40),
  });
});

test("preflight proves exact resource identities, no Queue consumer, and required bindings", async () => {
  const service = new CloudflareAdminV7Service({
    api: {
      async verifyIdentity() { return { tokenStatus: "active", account: { id: CLOUDFLARE_ADMIN_V7.accountId } }; },
      async getD1Database() { return { uuid: CLOUDFLARE_ADMIN_V7.d1Id, name: CLOUDFLARE_ADMIN_V7.d1Name }; },
      async getWorkerSettings() { return { bindings: [
        { name: "AUTHORITY_DB", type: "d1", id: CLOUDFLARE_ADMIN_V7.d1Id },
        { name: "ORCHESTRATOR_QUEUE", type: "queue", queue_name: CLOUDFLARE_ADMIN_V7.queueName },
        { name: "ORCHESTRATOR_WORKFLOW", type: "workflow", workflow_name: CLOUDFLARE_ADMIN_V7.workflowName },
        { name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text", text: "not-returned" },
      ] }; },
      async listWorkerDeployments() { return []; },
      async listQueues() { return [{ queue_id: "queue-id", queue_name: CLOUDFLARE_ADMIN_V7.queueName, consumers_total_count: 0 }]; },
      async listWorkflows() { return [{ id: "workflow-id", name: CLOUDFLARE_ADMIN_V7.workflowName, class_name: CLOUDFLARE_ADMIN_V7.workflowClass, script_name: CLOUDFLARE_ADMIN_V7.workerName }]; },
      async listAccessApplications() { return []; },
      async listWorkerSecrets() { return [{ name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text", text: "not-returned" }]; },
    },
  });
  const result = await service.preflight();
  assert.equal(result.target.workflow.name, CLOUDFLARE_ADMIN_V7.workflowName);
  assert.equal(result.target.queue.id, "queue-id");
  assert.equal(result.worker.bindings.some(({ type }) => type === "secret_text"), false);
  assert.deepEqual(result.worker.secretMetadata, [{ name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }]);
});

test("preflight stops on a Queue consumer or Workflow association drift", async () => {
  const base = {
    async verifyIdentity() { return {}; },
    async getD1Database() { return { uuid: CLOUDFLARE_ADMIN_V7.d1Id, name: CLOUDFLARE_ADMIN_V7.d1Name }; },
    async getWorkerSettings() { return { bindings: [
      { name: "AUTHORITY_DB", type: "d1" },
      { name: "ORCHESTRATOR_QUEUE", type: "queue" },
      { name: "ORCHESTRATOR_WORKFLOW", type: "workflow" },
    ] }; },
    async listWorkerDeployments() { return []; },
    async listQueues() { return [{ queue_name: CLOUDFLARE_ADMIN_V7.queueName, consumers_total_count: 1 }]; },
    async listWorkflows() { return [{ name: CLOUDFLARE_ADMIN_V7.workflowName, class_name: CLOUDFLARE_ADMIN_V7.workflowClass, script_name: CLOUDFLARE_ADMIN_V7.workerName }]; },
    async listAccessApplications() { return []; },
    async listWorkerSecrets() { return []; },
  };
  await assert.rejects(() => new CloudflareAdminV7Service({ api: base }).preflight(), /consumer state/);
  base.listQueues = async () => [{ queue_name: CLOUDFLARE_ADMIN_V7.queueName, consumers_total_count: 0 }];
  base.listWorkflows = async () => [{ name: CLOUDFLARE_ADMIN_V7.workflowName, class_name: "WrongClass", script_name: CLOUDFLARE_ADMIN_V7.workerName }];
  await assert.rejects(() => new CloudflareAdminV7Service({ api: base }).preflight(), /association mismatch/);
});

test("service-token creation requires exact approval, refuses duplicates, and never returns credentials", async () => {
  let created = false;
  let custodyInput;
  const api = {
    async listAccessServiceTokens() { return []; },
    async createAccessServiceToken(hours) {
      created = true;
      assert.equal(hours, 24);
      return { id: "token-id", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, client_id: "client-" + "fixture", client_secret: "secret-" + "fixture", duration: "24h" };
    },
  };
  const custodian = { async store(kind, value) { custodyInput = { kind, value }; return { receiptId: "receipt-123", custodian: "managed" }; } };
  const service = new CloudflareAdminV7Service({ api, custodian });
  await assert.rejects(() => service.createServiceToken({ approval: "yes" }), /Exact approval required/);
  const result = await service.createServiceToken({ approval: WRITE_APPROVALS.createServiceToken });
  assert.equal(created, true);
  assert.equal(custodyInput.value.clientSecret, "secret-fixture");
  assert.doesNotMatch(JSON.stringify(result), /client-fixture|secret-fixture/);

  api.listAccessServiceTokens = async () => [{ id: "existing", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }];
  await assert.rejects(() => service.createServiceToken({ approval: WRITE_APPROVALS.createServiceToken }), /automatic retry is prohibited/);
});

test("service-token partial custody failure stops without exposing the returned secret", async () => {
  const service = new CloudflareAdminV7Service({
    api: {
      async listAccessServiceTokens() { return []; },
      async createAccessServiceToken() { return { id: "token-id", client_id: "client-" + "fixture", client_secret: "secret-" + "fixture" }; },
    },
    custodian: { async store() { throw new Error("storage failed with secret fixture"); } },
  });
  await assert.rejects(
    () => service.createServiceToken({ approval: WRITE_APPROVALS.createServiceToken }),
    (error) => /partial state requires owner review/.test(error.message) && !/sensitive/.test(error.message),
  );
});

test("Access protection verifies exact pre-existing service token and exact hostname", async () => {
  let policyInput;
  const service = new CloudflareAdminV7Service({
    api: {
      async listAccessServiceTokens() { return [{ id: "12345678-1234-1234-1234-123456789abc", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }]; },
      async listAccessApplications() { return []; },
      async createAccessApplication() { return { id: "abcdefab-1234-1234-1234-abcdefabcdef", name: CLOUDFLARE_ADMIN_V7.accessApplicationName, domain: new URL(CLOUDFLARE_ADMIN_V7.workerUrl).hostname, type: "self_hosted" }; },
      async createAccessServiceTokenPolicy(appId, tokenId) { policyInput = { appId, tokenId }; return { id: "policy-id", decision: "non_identity" }; },
    },
  });
  const result = await service.ensureAccessProtection({
    approval: WRITE_APPROVALS.ensureAccess,
    serviceTokenId: "12345678-1234-1234-1234-123456789abc",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(policyInput, { appId: "abcdefab-1234-1234-1234-abcdefabcdef", tokenId: "12345678-1234-1234-1234-123456789abc" });
});

test("Access protection confirms one exact existing policy and rejects broader policy state", async () => {
  const app = { id: "abcdefab-1234-1234-1234-abcdefabcdef", name: CLOUDFLARE_ADMIN_V7.accessApplicationName, domain: new URL(CLOUDFLARE_ADMIN_V7.workerUrl).hostname, type: "self_hosted" };
  const token = { id: "12345678-1234-1234-1234-123456789abc", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName };
  const api = {
    async listAccessServiceTokens() { return [token]; },
    async listAccessApplications() { return [app]; },
    async listAccessApplicationPolicies() { return [{ id: "policy", decision: "non_identity", include: [{ service_token: { token_id: token.id } }] }]; },
  };
  const service = new CloudflareAdminV7Service({ api });
  const confirmed = await service.ensureAccessProtection({ approval: WRITE_APPROVALS.ensureAccess, serviceTokenId: token.id });
  assert.equal(confirmed.created, false);
  api.listAccessApplicationPolicies = async () => [
    { id: "policy", decision: "non_identity", include: [{ service_token: { token_id: token.id } }] },
    { id: "broader", decision: "allow", include: [{ everyone: {} }] },
  ];
  await assert.rejects(() => service.ensureAccessProtection({ approval: WRITE_APPROVALS.ensureAccess, serviceTokenId: token.id }), /ambiguous or broader/);
});

test("managed-secret custodian stores the Access credential without returning it", async () => {
  let installed;
  const credential = { tokenId: "token-id", target: CLOUDFLARE_ADMIN_V7.workerUrl, clientId: "client-" + "fixture", clientSecret: "secret-" + "fixture", expiresAt: null };
  const env = {};
  const custodian = new ManagedSecretCredentialCustodian({ async installConnectorAccessCredential(value) { installed = value; } }, env);
  const receipt = await custodian.store("access-service-token", credential);
  assert.doesNotMatch(JSON.stringify(receipt), /client-fixture|secret-fixture/);
  env[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName] = installed;
  assert.deepEqual(await custodian.readAccessCredential(receipt.receiptId), { clientId: "client-fixture", clientSecret: "secret-fixture" });
  await assert.rejects(() => custodian.readAccessCredential("managed-secret:WRONG"), /pinned managed secret/);
});

test("one-shot activation derives a secret-bearing version, deploys it, and validates five exact responses", async () => {
  const reviewed = { reviewedCommit: "a".repeat(40), configurationSha256: "b".repeat(64), versionId: "12345678-1234-1234-1234-123456789abc" };
  const activatedVersionId = "abcdefab-1234-1234-1234-abcdefabcdef";
  const baseResources = {
    bindings: [{ name: "AUTHORITY_DB", type: "d1", id: CLOUDFLARE_ADMIN_V7.d1Id }],
    script: { etag: "reviewed-script-etag" },
    script_runtime: { compatibility_date: "2026-09-16", compatibility_flags: ["nodejs_compat"] },
  };
  let installed;
  let deployed;
  let activated = false;
  let requestIndex = 0;
  const replies = [
    [401, { outcome: "denied", reason: "service_authentication_failed" }],
    [200, { ready: false, mode: "development", externalWritesEnabled: false, missingAuthoritativeDependencies: [] }],
    [401, { outcome: "denied", reason: "service_authentication_failed" }],
    [200, { outcome: "denied", reason: "authoritative_resolution_unavailable" }],
    [503, { outcome: "denied", reason: "execution_disabled" }],
  ];
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: reviewed,
    api: {
      async listWorkerDeployments() { return []; },
      async getWorkerVersion(id) {
        return id === reviewed.versionId
          ? { id, resources: baseResources }
          : { id, resources: { ...baseResources, bindings: [...baseResources.bindings, { name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }] } };
      },
      async getLatestWorkerVersion() {
        return activated
          ? { id: activatedVersionId, annotations: { "workers/message": `8978-activated:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` } }
          : { id: reviewed.versionId, annotations: { "workers/message": `8978-reviewed:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` }, resources: baseResources };
      },
      async listWorkerSecrets() { return []; },
      async createServiceAuthVersion(value, commit, digest) {
        installed = value;
        activated = true;
        assert.equal(commit, reviewed.reviewedCommit);
        assert.equal(digest, reviewed.configurationSha256);
        return { id: activatedVersionId };
      },
      async createWorkerDeployment(id, commit) {
        deployed = { id, commit };
        return { id: "deployment-id", created_on: "2026-09-16T20:00:00Z", versions: [{ version_id: id, percentage: 100 }] };
      },
    },
    custodian: { async readAccessCredential() { return { clientId: "access-" + "client", clientSecret: "access-" + "secret" }; } },
    canaryFetch: async (request) => {
      assert.equal(request.headers.get("cf-access-client-id"), "access-client");
      assert.equal(request.headers.get("cf-access-client-secret"), "access-secret");
      const [status, body] = replies[requestIndex++];
      return Response.json(body, { status });
    },
    now: () => new Date("2026-09-16T20:00:00Z"),
  });
  const result = await service.activateReviewedWorkerAndRunCanary({
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    canaryApproval: WRITE_APPROVALS.runCanary,
    accessCredentialReceiptId: "receipt-123",
    ...reviewed,
  });
  assert.equal(requestIndex, 5);
  assert.equal(result.evidence.length, 5);
  assert.deepEqual(deployed, { id: activatedVersionId, commit: reviewed.reviewedCommit });
  assert.equal(result.deployment.baseReviewedVersionId, reviewed.versionId);
  assert.equal(result.deployment.activatedVersionId, activatedVersionId);
  const secret = JSON.parse(installed)["development-canary-v1"]["canary-2026-09-16"];
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(result), /access-client|access-secret/);
});

test("canary stops after the first unexpected result and does not retry", async () => {
  const reviewed = { reviewedCommit: "a".repeat(40), configurationSha256: "b".repeat(64), versionId: "12345678-1234-1234-1234-123456789abc" };
  const activatedVersionId = "abcdefab-1234-1234-1234-abcdefabcdef";
  const baseResources = { bindings: [], script: { etag: "etag" }, script_runtime: { compatibility_date: "2026-09-16" } };
  let calls = 0;
  let activated = false;
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: reviewed,
    api: {
      async listWorkerDeployments() { return []; },
      async getWorkerVersion(id) { return { id, resources: { ...baseResources, bindings: id === reviewed.versionId ? [] : [{ name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }] } }; },
      async getLatestWorkerVersion() { return activated
        ? { id: activatedVersionId, annotations: { "workers/message": `8978-activated:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` } }
        : { id: reviewed.versionId, annotations: { "workers/message": `8978-reviewed:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` }, resources: baseResources }; },
      async listWorkerSecrets() { return []; },
      async createServiceAuthVersion() { activated = true; return { id: activatedVersionId }; },
      async createWorkerDeployment() { return { id: "deployment-id", versions: [{ version_id: activatedVersionId, percentage: 100 }] }; },
    },
    custodian: { async readAccessCredential() { return { clientId: "client", clientSecret: "secret" }; } },
    canaryFetch: async () => { calls += 1; return Response.json({ unexpected: true }, { status: 500 }); },
  });
  await assert.rejects(() => service.activateReviewedWorkerAndRunCanary({
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    canaryApproval: WRITE_APPROVALS.runCanary,
    accessCredentialReceiptId: "receipt-123",
    ...reviewed,
  }), /no retry, cleanup, rollback, or restore was attempted/);
  assert.equal(calls, 1);
});

test("canary refuses to overwrite existing service authentication before any request", async () => {
  const reviewed = { reviewedCommit: "a".repeat(40), configurationSha256: "b".repeat(64), versionId: "12345678-1234-1234-1234-123456789abc" };
  let calls = 0;
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: reviewed,
    api: {
      async listWorkerDeployments() { return []; },
      async getWorkerVersion() { return { id: reviewed.versionId, resources: { bindings: [], script: { etag: "etag" }, script_runtime: {} } }; },
      async getLatestWorkerVersion() { return { id: reviewed.versionId, annotations: { "workers/message": `8978-reviewed:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` }, resources: { bindings: [] } }; },
      async listWorkerSecrets() { return [{ name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }]; },
    },
    custodian: { async readAccessCredential() { throw new Error("must not read"); } },
    canaryFetch: async () => { calls += 1; return Response.json({}); },
  });
  await assert.rejects(() => service.activateReviewedWorkerAndRunCanary({
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    canaryApproval: WRITE_APPROVALS.runCanary,
    accessCredentialReceiptId: "receipt-123",
    ...reviewed,
  }), /retry or overwrite is prohibited/);
  assert.equal(calls, 0);
});

test("activation refuses caller-selected or no-longer-latest reviewed versions before mutation", async () => {
  const reviewed = { reviewedCommit: "a".repeat(40), configurationSha256: "b".repeat(64), versionId: "12345678-1234-1234-1234-123456789abc" };
  let mutations = 0;
  const api = {
    async listWorkerDeployments() { return []; },
    async getWorkerVersion() { return { id: reviewed.versionId, resources: { bindings: [], script: { etag: "etag" }, script_runtime: {} } }; },
    async getLatestWorkerVersion() { return { id: "abcdefab-1234-1234-1234-abcdefabcdef", annotations: {} }; },
    async listWorkerSecrets() { return []; },
    async createServiceAuthVersion() { mutations += 1; },
  };
  const service = new CloudflareAdminV7Service({ api, reviewedDeployment: reviewed, custodian: {} });
  const approved = {
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    canaryApproval: WRITE_APPROVALS.runCanary,
    accessCredentialReceiptId: "receipt-123",
    ...reviewed,
  };
  await assert.rejects(() => service.activateReviewedWorkerAndRunCanary({ ...approved, versionId: "abcdefab-1234-1234-1234-abcdefabcdef" }), /do not match/);
  await assert.rejects(() => service.activateReviewedWorkerAndRunCanary(approved), /not the unmodified latest version/);
  assert.equal(mutations, 0);
});

test("activation refuses a secret-derived version that changed reviewed code before deployment", async () => {
  const reviewed = { reviewedCommit: "a".repeat(40), configurationSha256: "b".repeat(64), versionId: "12345678-1234-1234-1234-123456789abc" };
  const activatedVersionId = "abcdefab-1234-1234-1234-abcdefabcdef";
  let activated = false;
  let deployments = 0;
  const baseResources = { bindings: [], script: { etag: "reviewed-etag" }, script_runtime: { compatibility_date: "2026-09-16" } };
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: reviewed,
    api: {
      async listWorkerDeployments() { return []; },
      async getWorkerVersion(id) { return { id, resources: id === reviewed.versionId ? baseResources : {
        ...baseResources,
        bindings: [{ name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }],
        script: { etag: "changed-etag" },
      } }; },
      async getLatestWorkerVersion() { return activated
        ? { id: activatedVersionId, annotations: { "workers/message": `8978-activated:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` } }
        : { id: reviewed.versionId, annotations: { "workers/message": `8978-reviewed:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` }, resources: baseResources }; },
      async listWorkerSecrets() { return []; },
      async createServiceAuthVersion() { activated = true; return { id: activatedVersionId }; },
      async createWorkerDeployment() { deployments += 1; },
    },
    custodian: { async readAccessCredential() { return { clientId: "client", clientSecret: "secret" }; } },
  });
  await assert.rejects(() => service.activateReviewedWorkerAndRunCanary({
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    canaryApproval: WRITE_APPROVALS.runCanary,
    accessCredentialReceiptId: "receipt-123",
    ...reviewed,
  }), /changed reviewed code or configuration/);
  assert.equal(deployments, 0);
});
