import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CloudflareAdminV7Service } from "../src/cloudflare-admin-v7-service.js";
import { ManagedSecretCredentialCustodian } from "../src/cloudflare-admin-v7-custodian.js";
import { CLOUDFLARE_ADMIN_V7, WRITE_APPROVALS } from "../src/cloudflare-admin-v7-contracts.js";

const apiSource = await readFile("src/cloudflare-admin-v7-api.js", "utf8");
const serviceSource = await readFile("src/cloudflare-admin-v7-service.js", "utf8");
const custodianSource = await readFile("src/cloudflare-admin-v7-custodian.js", "utf8");
const mcpSource = await readFile("src/cloudflare-admin-v7-mcp.js", "utf8");

const WORKER_ID = "7d8fe11595134e5980a2c888a805ff03";
const TOKEN_ID = "abcdefab-1234-1234-1234-abcdefabcdef";
const VERSION_ID = "11111111-2222-3333-4444-555555555555";
const ACCESS_RECEIPT = `managed-secret:${CLOUDFLARE_ADMIN_V7.accessCredentialSecretName}`;
const PRINCIPAL_RECEIPT = `managed-secret:${CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName}`;
const KEY_ID = "canary-2026-09-23";

function accessApp() {
  return {
    id: TOKEN_ID,
    name: CLOUDFLARE_ADMIN_V7.accessApplicationName,
    type: "self_hosted",
    destinations: [{ type: "worker", worker_id: WORKER_ID }],
  };
}

function accessPolicy() {
  return [{ id: "p1", decision: "non_identity", include: [{ service_token: { token_id: TOKEN_ID } }], exclude: [], require: [] }];
}

function baseApi(overrides = {}) {
  const calls = { setWorkerSubdomain: 0, getWorkerSubdomain: 0 };
  // The default mock reflects a successful transition: disabled until the single POST, enabled after it.
  let enabled = false;
  const api = {
    calls,
    get enabledState() { return enabled; },
    markEnabled() { enabled = true; },
    async listWorkers() { return [{ name: CLOUDFLARE_ADMIN_V7.workerName, id: WORKER_ID }]; },
    async getWorkerById() { return { id: WORKER_ID, name: CLOUDFLARE_ADMIN_V7.workerName }; },
    async listWorkerScripts() { return [{ id: CLOUDFLARE_ADMIN_V7.workerName, tag: WORKER_ID }]; },
    async listAccessApplications() { return [accessApp()]; },
    async listAccessApplicationPolicies() { return accessPolicy(); },
    async listAccessServiceTokens() { return [{ id: TOKEN_ID, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }]; },
    async listWorkerDeployments() {
      return [
        { id: "d2", is_active: true, versions: [{ version_id: VERSION_ID, percentage: 100 }] },
        { id: "d1", versions: [{ version_id: "old", percentage: 100 }] },
      ];
    },
    async getWorkerSubdomain() { calls.getWorkerSubdomain += 1; return { enabled, previews_enabled: false }; },
    async setWorkerSubdomain() { calls.setWorkerSubdomain += 1; enabled = true; return { enabled: true, previews_enabled: false }; },
    ...overrides,
  };
  return api;
}

function custodianStub({ principal } = {}) {
  return {
    async readAccessCredential(receiptId) {
      assert.equal(receiptId, ACCESS_RECEIPT);
      return { clientId: "cid", clientSecret: "csecret" };
    },
    async readServiceAuthPrincipal(receiptId, binding) {
      assert.equal(receiptId, PRINCIPAL_RECEIPT);
      assert.equal(binding.workerId, WORKER_ID);
      assert.equal(binding.keyId, KEY_ID);
      return principal ?? { principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: KEY_ID, secret: "s".repeat(43) };
    },
  };
}

function enableInput(overrides = {}) {
  return {
    enableApproval: WRITE_APPROVALS.enableSubdomain,
    canaryApproval: WRITE_APPROVALS.runCanary,
    accessCredentialReceiptId: ACCESS_RECEIPT,
    serviceAuthReceiptId: PRINCIPAL_RECEIPT,
    serviceTokenId: TOKEN_ID,
    workerId: WORKER_ID,
    keyId: KEY_ID,
    activatedVersionId: VERSION_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------- capability ---

test("version upload cannot enable workers.dev: no subdomain writer exists on any upload path", () => {
  assert.ok(/async setWorkerSubdomain\(/u.test(apiSource));
  // The only subdomain writer is reachable from the dedicated enablement method, never from activation.
  const activation = serviceSource.slice(serviceSource.indexOf("async activateReviewedWorker("), serviceSource.indexOf("async #readBackSubdomain("));
  assert.ok(!activation.includes("setWorkerSubdomain"));
  assert.ok(activation.includes("assertSubdomainState"));
});

test("version deployment cannot enable workers.dev: the deployment body carries only versions", () => {
  const block = apiSource.slice(apiSource.indexOf("async createWorkerDeployment("), apiSource.indexOf("async listWorkers("));
  assert.ok(block.includes("versions: [{ percentage: 100, version_id: versionId }]"));
  assert.ok(!block.includes("subdomain"));
  assert.ok(!block.includes("enabled"));
});

test("preview URLs stay disabled: the writer refuses any shape but enabled true previews false", async () => {
  const { CloudflareAdminV7Api } = await import("../src/cloudflare-admin-v7-api.js");
  const api = new CloudflareAdminV7Api({ apiToken: "x".repeat(40), fetchImpl: async () => { throw new Error("must not be called"); } });
  await assert.rejects(() => api.setWorkerSubdomain({ enabled: true, previews_enabled: true }), /reviewed subdomain transition/u);
  await assert.rejects(() => api.setWorkerSubdomain({ enabled: false, previews_enabled: false }), /reviewed subdomain transition/u);
  await assert.rejects(() => api.setWorkerSubdomain({}), /reviewed subdomain transition/u);
  assert.equal(CLOUDFLARE_ADMIN_V7.subdomainAfterEnablement.previews_enabled, false);
});

test("no route, DNS, custom-domain, delete, disable, or rollback capability exists", () => {
  for (const forbidden of [/workers\/routes/u, /\/dns/u, /"DELETE"/u, /deleteWorkerSubdomain/u, /disableWorkerSubdomain/u, /rollback\(/u]) {
    assert.ok(!forbidden.test(apiSource), `API adapter must not expose ${forbidden}`);
  }
  assert.ok(apiSource.includes("workers/domains"));
  assert.ok(!custodianSource.includes("async delete"));
  assert.ok(!/rotate|revoke/iu.test(custodianSource));
});

// ------------------------------------------------------------------ ordering ---

test("exactly one subdomain POST is issued and one read-back GET follows it", async () => {
  const api = baseApi();
  const service = new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
  assert.equal(api.calls.setWorkerSubdomain, 1);
});

test("no canary runs when the POST fails, and the Worker remains unreachable", async () => {
  let canaryCalls = 0;
  const api = baseApi({ async setWorkerSubdomain() { api.calls.setWorkerSubdomain += 1; throw new Error("cloudflare rejected"); } });
  const service = new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /remains unreachable/u);
  assert.equal(canaryCalls, 0);
  assert.equal(api.calls.setWorkerSubdomain, 1);
});

test("an ambiguous POST never repeats and never reaches the canary", async () => {
  let canaryCalls = 0;
  const api = baseApi({ async setWorkerSubdomain() { api.calls.setWorkerSubdomain += 1; return { enabled: true }; } });
  const service = new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /ambiguous result and was not repeated/u);
  assert.equal(canaryCalls, 0);
  assert.equal(api.calls.setWorkerSubdomain, 1);
});

test("a read-back reporting previews enabled is a security stop before any canary request", async () => {
  let canaryCalls = 0;
  let posted = false;
  const api = baseApi({
    async getWorkerSubdomain() {
      api.calls.getWorkerSubdomain += 1;
      return posted ? { enabled: true, previews_enabled: true } : { enabled: false, previews_enabled: false };
    },
    async setWorkerSubdomain() { api.calls.setWorkerSubdomain += 1; posted = true; return { enabled: true, previews_enabled: false }; },
  });
  const service = new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /unexpected preview surface/u);
  assert.equal(canaryCalls, 0);
  assert.equal(api.calls.setWorkerSubdomain, 1);
});

test("a failed or ambiguous read-back assumes reachability and stops before the canary", async () => {
  let canaryCalls = 0;
  let posted = false;
  const api = baseApi({
    async getWorkerSubdomain() {
      if (posted) throw new Error("read-back unavailable");
      return { enabled: false, previews_enabled: false };
    },
    async setWorkerSubdomain() { api.calls.setWorkerSubdomain += 1; posted = true; return { enabled: true, previews_enabled: false }; },
  });
  const service = new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /reachability may exist/u);
  assert.equal(canaryCalls, 0);
});

test("enablement stops before the POST when the subdomain is not already disabled", async () => {
  const api = baseApi({ async getWorkerSubdomain() { return { enabled: true, previews_enabled: false }; } });
  const service = new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /pre-enablement/u);
  assert.equal(api.calls.setWorkerSubdomain, 0);
});

// ------------------------------------------------ phase 8 authorization gates ---

test("phase 8 requires its own exact literal approvals", async () => {
  const service = new CloudflareAdminV7Service({ api: baseApi(), custodian: custodianStub() });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput({ enableApproval: WRITE_APPROVALS.runCanary })), /Exact approval required/u);
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput({ canaryApproval: WRITE_APPROVALS.enableSubdomain })), /Exact approval required/u);
  assert.notEqual(WRITE_APPROVALS.enableSubdomain, WRITE_APPROVALS.runCanary);
  assert.notEqual(WRITE_APPROVALS.enableSubdomain, WRITE_APPROVALS.deployReviewedWorker);
  assert.notEqual(WRITE_APPROVALS.enableSubdomain, WRITE_APPROVALS.installServiceAuth);
});

test("phase 8 reverifies the immutable Worker ID, the active deployment, and the Access shape", async () => {
  const service = (api) => new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });

  await assert.rejects(() => service(baseApi()).enableSubdomainAndRunCanary(enableInput({ workerId: "a".repeat(32) })), /independently resolved immutable Worker ID/u);
  await assert.rejects(() => service(baseApi()).enableSubdomainAndRunCanary(enableInput({ activatedVersionId: "99999999-2222-3333-4444-555555555555" })), /100 percent to exactly the expected activated version/u);

  const wrongDestination = baseApi({ async listAccessApplications() { return [{ ...accessApp(), destinations: [{ type: "worker", worker_id: "b".repeat(32) }] }]; } });
  await assert.rejects(() => service(wrongDestination).enableSubdomainAndRunCanary(enableInput()), /Worker-level Access application identity is missing/u);

  const hostnameApp = baseApi({ async listAccessApplications() { return [{ ...accessApp(), destinations: [{ type: "hostname", worker_id: WORKER_ID }] }]; } });
  await assert.rejects(() => service(hostnameApp).enableSubdomainAndRunCanary(enableInput()), /Worker-level Access application identity is missing/u);

  const broadPolicy = baseApi({ async listAccessApplicationPolicies() { return [...accessPolicy(), { id: "p2", decision: "allow", include: [] }]; } });
  await assert.rejects(() => service(broadPolicy).enableSubdomainAndRunCanary(enableInput()), /exactly one Service Auth policy/u);

  const identityPolicy = baseApi({ async listAccessApplicationPolicies() { return [{ id: "p1", decision: "allow", include: [{ service_token: { token_id: TOKEN_ID } }], exclude: [], require: [] }]; } });
  await assert.rejects(() => service(identityPolicy).enableSubdomainAndRunCanary(enableInput()), /non_identity Service Auth action/u);

  const extraRule = baseApi({ async listAccessApplicationPolicies() { return [{ ...accessPolicy()[0], require: [{ email_domain: { domain: "example.com" } }] }]; } });
  await assert.rejects(() => service(extraRule).enableSubdomainAndRunCanary(enableInput()), /no additional exclude or require rules/u);
});

test("phase 8 cannot retrieve the principal without the exact key ID binding", async () => {
  const api = baseApi();
  const strict = {
    async readAccessCredential() { return { clientId: "cid", clientSecret: "csecret" }; },
    async readServiceAuthPrincipal(receiptId, binding) {
      if (binding.keyId !== KEY_ID) throw new Error("Service-auth principal is bound to a different service-auth key ID");
      return { principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: KEY_ID, secret: "s".repeat(43) };
    },
  };
  const service = new CloudflareAdminV7Service({ api, custodian: strict, canaryFetch: async () => { throw new Error("canary reached"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput({ keyId: "canary-wrong" })), /different service-auth key ID/u);
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput({ keyId: "" })), /Exact service-auth key ID is required/u);
});

// ----------------------------------------------------- credential isolation ---

function custodianApi() {
  const stored = {};
  return {
    stored,
    async installConnectorAccessCredential(json) { stored[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName] = json; },
    async installConnectorServiceAuthPrincipal(json) { stored[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName] = json; },
    async listConnectorSecrets() { return Object.keys(stored).map((name) => ({ name })); },
  };
}

test("the two credential kinds use distinct slots and cannot overwrite each other", async () => {
  const api = custodianApi();
  const custodian = new ManagedSecretCredentialCustodian(api, {});
  const accessReceipt = await custodian.store("access-service-token", {
    tokenId: TOKEN_ID, target: CLOUDFLARE_ADMIN_V7.workerUrl, clientId: "cid", clientSecret: "csecret", expiresAt: null,
  });
  const principalReceipt = await custodian.store("service-auth-principal", {
    principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: KEY_ID, secret: "s".repeat(43), workerId: WORKER_ID,
  });
  assert.notEqual(CLOUDFLARE_ADMIN_V7.accessCredentialSecretName, CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName);
  assert.notEqual(accessReceipt.receiptId, principalReceipt.receiptId);
  assert.equal(Object.keys(api.stored).length, 2);
  // Storing either kind again leaves the other slot byte-identical.
  const beforePrincipal = api.stored[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName];
  await custodian.store("access-service-token", { tokenId: TOKEN_ID, target: CLOUDFLARE_ADMIN_V7.workerUrl, clientId: "c2", clientSecret: "s2", expiresAt: null });
  assert.equal(api.stored[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName], beforePrincipal);
  const beforeAccess = api.stored[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName];
  await custodian.store("service-auth-principal", { principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: "canary-2", secret: "t".repeat(43), workerId: WORKER_ID });
  assert.equal(api.stored[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName], beforeAccess);
});

test("retrieving one kind can never return the other", async () => {
  const api = custodianApi();
  const env = {};
  const custodian = new ManagedSecretCredentialCustodian(api, env);
  env[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName] = JSON.stringify({ target: CLOUDFLARE_ADMIN_V7.workerUrl, clientId: "cid", clientSecret: "csecret" });
  env[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName] = JSON.stringify({
    accountId: CLOUDFLARE_ADMIN_V7.accountId, workerName: CLOUDFLARE_ADMIN_V7.workerName, workerId: WORKER_ID,
    principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: KEY_ID, secret: "s".repeat(43), purpose: "development-activation-canary",
  });
  const access = await custodian.readAccessCredential(ACCESS_RECEIPT);
  assert.deepEqual(Object.keys(access).sort(), ["clientId", "clientSecret"]);
  const principal = await custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, { workerId: WORKER_ID, keyId: KEY_ID });
  assert.deepEqual(Object.keys(principal).sort(), ["keyId", "principalId", "secret"]);
  // Cross-receipt retrieval is refused.
  await assert.rejects(() => custodian.readAccessCredential(PRINCIPAL_RECEIPT), /receipt does not match/u);
  await assert.rejects(() => custodian.readServiceAuthPrincipal(ACCESS_RECEIPT, {}), /receipt does not match/u);
});

test("an unknown credential kind is refused and the custodian is not a generic secret store", async () => {
  const custodian = new ManagedSecretCredentialCustodian(custodianApi(), {});
  for (const kind of ["arbitrary", "", undefined, "constructor", "__proto__", "toString"]) {
    await assert.rejects(() => custodian.store(kind, {}), /Unrecognized credential kind is refused/u);
    await assert.rejects(() => custodian.confirmCustody(kind), /Unrecognized credential kind is refused/u);
  }
});

test("principal binding rejects a wrong account, Worker, Worker ID, key ID, or malformed metadata", async () => {
  const env = {};
  const custodian = new ManagedSecretCredentialCustodian(custodianApi(), env);
  const good = {
    accountId: CLOUDFLARE_ADMIN_V7.accountId, workerName: CLOUDFLARE_ADMIN_V7.workerName, workerId: WORKER_ID,
    principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: KEY_ID, secret: "s".repeat(43), purpose: "development-activation-canary",
  };
  const withBinding = (patch) => { env[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName] = JSON.stringify({ ...good, ...patch }); };

  withBinding({ accountId: "00000000000000000000000000000000" });
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, {}), /authorized development account/u);
  withBinding({ workerName: "another-worker" });
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, {}), /pinned development Worker/u);
  withBinding({ workerId: "zz" });
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, {}), /32-character lowercase/u);
  withBinding({ purpose: "something-else" });
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, {}), /approved development activation canary purpose/u);
  withBinding({ keyId: "" });
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, {}), /key ID is missing or malformed/u);
  withBinding({});
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, { workerId: "a".repeat(32) }), /different immutable Worker ID/u);
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, { keyId: "other" }), /different service-auth key ID/u);
  env[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName] = "not json";
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, {}), /unavailable or invalid/u);
});

test("custody confirmation proves storage by name only and never exposes a secret value", async () => {
  const api = custodianApi();
  const custodian = new ManagedSecretCredentialCustodian(api, {});
  await assert.rejects(() => custodian.confirmCustody("service-auth-principal"), /custody of service-auth-principal was not confirmed/u);
  const receipt = await custodian.store("service-auth-principal", {
    principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: KEY_ID, secret: "s".repeat(43), workerId: WORKER_ID,
  });
  const confirmed = await custodian.confirmCustody("service-auth-principal");
  assert.equal(confirmed.confirmed, true);
  assert.ok(!JSON.stringify(receipt).includes("s".repeat(43)));
  assert.ok(!JSON.stringify(confirmed).includes("s".repeat(43)));
});

test("no secret value can reach connector output: results are receipts and metadata only", () => {
  // The MCP layer redacts every result and the service returns receipts, never secret material.
  assert.ok(mcpSource.includes("redactSensitive"));
  const activation = serviceSource.slice(serviceSource.indexOf("async activateReviewedWorker("), serviceSource.indexOf("async #readBackSubdomain("));
  const returnBlock = activation.slice(activation.indexOf("return {"));
  assert.ok(!/\bsecret\b\s*,/u.test(returnBlock), "the activation result must not return the secret");
  assert.ok(returnBlock.includes("serviceAuthCredential: custodyReceipt"));
  assert.ok(returnBlock.includes("installedSecret: { name:"));
});

test("custody is established and confirmed before any secret-bearing version is created", () => {
  const activation = serviceSource.slice(serviceSource.indexOf("async activateReviewedWorker("), serviceSource.indexOf("async #readBackSubdomain("));
  const storeAt = activation.indexOf('this.custodian.store("service-auth-principal"');
  const confirmAt = activation.indexOf('this.custodian.confirmCustody("service-auth-principal")');
  const createAt = activation.indexOf("this.api.createServiceAuthVersion(");
  const deployAt = activation.indexOf("this.api.createWorkerDeployment(");
  assert.ok(storeAt > 0 && confirmAt > storeAt, "store must precede custody confirmation");
  assert.ok(createAt > confirmAt, "the secret-bearing version must follow custody confirmation");
  assert.ok(deployAt > createAt, "deployment must follow version creation");
});

test("activation ends with the subdomain still confirmed false/false and reports unreachable", () => {
  const activation = serviceSource.slice(serviceSource.indexOf("async activateReviewedWorker("), serviceSource.indexOf("async #readBackSubdomain("));
  assert.ok(activation.includes("subdomainBeforeEnablement"), "activation must assert the pre-enablement subdomain state");
  assert.ok(activation.includes("\"post-deployment\""), "activation must re-assert the subdomain state after deployment");
  assert.ok(activation.includes("reachable: false"), "activation must report the Worker as unreachable");
  assert.ok(!activation.includes("subdomainAfterEnablement"), "activation must never assert the enabled state");
});
