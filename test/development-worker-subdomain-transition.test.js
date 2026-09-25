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
const REVIEWED_VERSION_ID = "aaaaaaaa-2222-3333-4444-555555555555";
const REVIEWED = {
  reviewedCommit: CLOUDFLARE_ADMIN_V7.targetWorkerCommit,
  configurationSha256: CLOUDFLARE_ADMIN_V7.targetConfigurationSha256,
  versionId: REVIEWED_VERSION_ID,
};
const REVIEWED_MESSAGE = `8978-reviewed:${REVIEWED.reviewedCommit}:${REVIEWED.configurationSha256}`;
const ACTIVATED_MESSAGE = `8978-activated:${REVIEWED.reviewedCommit}:${REVIEWED.configurationSha256}`;
const BASE_RESOURCES = {
  bindings: [{ name: "CONTROL_PLANE_MODE", type: "plain_text", text: "development" }],
  script: { etag: "reviewed-etag" },
  script_runtime: { compatibility_date: "2026-08-12" },
};

function reviewedVersion(patch = {}) {
  return { id: REVIEWED_VERSION_ID, annotations: { "workers/message": REVIEWED_MESSAGE }, resources: BASE_RESOURCES, ...patch };
}

function activatedVersion(patch = {}) {
  return {
    id: VERSION_ID,
    annotations: { "workers/message": ACTIVATED_MESSAGE },
    resources: { ...BASE_RESOURCES, bindings: [...BASE_RESOURCES.bindings, { name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }] },
    ...patch,
  };
}

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
  const calls = { setWorkerSubdomain: 0, getWorkerSubdomain: 0, listWorkerDeployments: 0 };
  // The default mock reflects a successful transition: disabled until the single POST, enabled after it.
  let enabled = false;
  const api = {
    calls,
    get enabledState() { return enabled; },
    markEnabled() { enabled = true; },
    async listWorkers() { return [{ name: CLOUDFLARE_ADMIN_V7.workerName, id: WORKER_ID }]; },
    async getWorkerById() { return { id: WORKER_ID, name: CLOUDFLARE_ADMIN_V7.workerName }; },
    async listWorkerScripts() { return [{ id: CLOUDFLARE_ADMIN_V7.workerName, tag: WORKER_ID }]; },
    async getAccountWorkersSubdomain() { return { subdomain: "jhutchison" }; },
    async listAccessApplications() { return [accessApp()]; },
    async listAccessApplicationPolicies() { return accessPolicy(); },
    async listAccessServiceTokens() { return [{ id: TOKEN_ID, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }]; },
    async listWorkerDeployments() {
      calls.listWorkerDeployments += 1;
      return [
        { id: "d2", is_active: true, versions: [{ version_id: VERSION_ID, percentage: 100 }] },
        { id: "d1", versions: [{ version_id: "old", percentage: 100 }] },
      ];
    },
    async getWorkerVersion(id) {
      if (id === REVIEWED_VERSION_ID) return reviewedVersion();
      if (id === VERSION_ID) return activatedVersion();
      throw new Error(`unexpected version ${id}`);
    },
    async getLatestWorkerVersion() { return activatedVersion(); },
    async getWorkerSubdomain() { calls.getWorkerSubdomain += 1; return { enabled, previews_enabled: false }; },
    async setWorkerSubdomain() { calls.setWorkerSubdomain += 1; enabled = true; return { enabled: true, previews_enabled: false }; },
    ...overrides,
  };
  return api;
}

function custodianStub({ principal } = {}) {
  return {
    async readAccessCredential(receiptId, binding) {
      assert.equal(receiptId, ACCESS_RECEIPT);
      assert.equal(binding.tokenId, TOKEN_ID);
      assert.ok(binding.now instanceof Date);
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
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
  assert.equal(api.calls.setWorkerSubdomain, 1);
});

test("no canary runs when the POST fails, and the Worker remains unreachable", async () => {
  let canaryCalls = 0;
  const api = baseApi({ async setWorkerSubdomain() { api.calls.setWorkerSubdomain += 1; throw new Error("cloudflare rejected"); } });
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /remains unreachable/u);
  assert.equal(canaryCalls, 0);
  assert.equal(api.calls.setWorkerSubdomain, 1);
});

test("an ambiguous POST never repeats and never reaches the canary", async () => {
  let canaryCalls = 0;
  const api = baseApi({ async setWorkerSubdomain() { api.calls.setWorkerSubdomain += 1; return { enabled: true }; } });
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
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
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
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
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /reachability may exist/u);
  assert.equal(canaryCalls, 0);
});

test("enablement stops before the POST when the subdomain is not already disabled", async () => {
  const api = baseApi({ async getWorkerSubdomain() { return { enabled: true, previews_enabled: false }; } });
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /pre-enablement/u);
  assert.equal(api.calls.setWorkerSubdomain, 0);
});

// ------------------------------------------------ phase 8 authorization gates ---

test("phase 8 requires its own exact literal approvals", async () => {
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api: baseApi(), custodian: custodianStub() });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput({ enableApproval: WRITE_APPROVALS.runCanary })), /Exact approval required/u);
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput({ canaryApproval: WRITE_APPROVALS.enableSubdomain })), /Exact approval required/u);
  assert.notEqual(WRITE_APPROVALS.enableSubdomain, WRITE_APPROVALS.runCanary);
  assert.notEqual(WRITE_APPROVALS.enableSubdomain, WRITE_APPROVALS.deployReviewedWorker);
  assert.notEqual(WRITE_APPROVALS.enableSubdomain, WRITE_APPROVALS.installServiceAuth);
});

test("phase 8 reverifies the immutable Worker ID, the active deployment, and the Access shape", async () => {
  const service = (api) => new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });

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
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: strict, canaryFetch: async () => { throw new Error("canary reached"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput({ keyId: "canary-wrong" })), /different service-auth key ID/u);
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput({ keyId: "" })), /Exact service-auth key ID is required/u);
});

// ------------------------------------------------- Access precedence (B1) ---

const TARGET_HOST = "8978-ai-control-plane-dev.jhutchison.workers.dev";

function otherApp(patch) {
  return { id: "other-app", name: "Unrelated application", type: "self_hosted", ...patch };
}

// Runs phase 8 against the supplied API and asserts it stopped before any POST or canary request.
async function assertStopsBeforePost(api, pattern) {
  let canaryCalls = 0;
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), pattern);
  assert.equal(api.calls.setWorkerSubdomain, 0, "no subdomain POST may be issued");
  assert.equal(canaryCalls, 0, "no canary request may be issued");
}

const conflictCases = [
  ["exact-hostname self-hosted application", otherApp({ domain: TARGET_HOST })],
  ["exact-hostname application declared with a scheme", otherApp({ domain: `https://${TARGET_HOST}` })],
  ["path-scoped application", otherApp({ domain: `${TARGET_HOST}/admin` })],
  ["workers.dev account wildcard", otherApp({ domain: "*.jhutchison.workers.dev" })],
  ["partial-label wildcard", otherApp({ domain: "8978-*.jhutchison.workers.dev/v1/*" })],
  ["global wildcard", otherApp({ domain: "*" })],
  ["self_hosted_domains entry", otherApp({ domain: "unrelated.example.com", self_hosted_domains: ["unrelated.example.com", TARGET_HOST] })],
  ["public destination", otherApp({ destinations: [{ type: "public", uri: `${TARGET_HOST}/v1/actions` }] })],
  ["public wildcard destination", otherApp({ destinations: [{ type: "public", uri: "*.workers.dev" }] })],
  ["bypass application on the exact hostname", otherApp({ domain: TARGET_HOST, policies: [{ decision: "bypass", include: [{ everyone: {} }] }] })],
  ["upper-case hostname declaration", otherApp({ domain: TARGET_HOST.toUpperCase() })],
];

for (const [label, conflict] of conflictCases) {
  test(`phase 8 stops before the POST on a conflicting ${label}`, async () => {
    const api = baseApi({ async listAccessApplications() { return [accessApp(), conflict]; } });
    await assertStopsBeforePost(api, /could cover 8978-ai-control-plane-dev\.jhutchison\.workers\.dev with precedence/u);
  });
}

test("phase 8 treats an application with undeterminable coverage as a conflict", async () => {
  for (const undetermined of [
    otherApp({}),
    otherApp({ destinations: [{ type: "public" }] }),
    otherApp({ self_hosted_domains: "not-a-list" }),
    otherApp({ domain: { unexpected: true } }),
    otherApp({ domain: "white space.example" }),
  ]) {
    const api = baseApi({ async listAccessApplications() { return [accessApp(), undetermined]; } });
    await assertStopsBeforePost(api, /could cover|coverage undetermined/u);
  }
});

test("phase 8 accepts exactly one valid Worker-level application alongside non-overlapping applications", async () => {
  const unrelated = [
    otherApp({ id: "a1", domain: "app.example.com" }),
    otherApp({ id: "a2", domain: "*.example.com/admin" }),
    otherApp({ id: "a3", domain: "other-worker.jhutchison.workers.dev" }),
    otherApp({ id: "a4", self_hosted_domains: ["dash.example.com"] }),
    otherApp({ id: "a5", destinations: [{ type: "worker", worker_id: "c".repeat(32) }] }),
    otherApp({ id: "a6", type: "saas", domain: undefined }),
  ];
  const api = baseApi({ async listAccessApplications() { return [...unrelated, accessApp()]; } });
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
  // Reaching the canary proves every pre-POST check passed and exactly one POST was made.
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
  assert.equal(api.calls.setWorkerSubdomain, 1);
});

test("phase 8 requires exactly one Worker-level application for the immutable Worker ID", async () => {
  const none = baseApi({ async listAccessApplications() { return [otherApp({ domain: "app.example.com" })]; } });
  await assertStopsBeforePost(none, /Worker-level Access application identity is missing/u);
  const two = baseApi({ async listAccessApplications() { return [accessApp(), { ...accessApp(), id: "duplicate" }]; } });
  await assertStopsBeforePost(two, /Worker-level Access application identity is ambiguous/u);
  const mixed = baseApi({ async listAccessApplications() {
    return [{ ...accessApp(), destinations: [{ type: "worker", worker_id: WORKER_ID }, { type: "public", uri: TARGET_HOST }] }];
  } });
  await assertStopsBeforePost(mixed, /exactly one destination/u);
  const unidentified = baseApi({ async listAccessApplications() { return [accessApp(), { domain: "app.example.com" }]; } });
  await assertStopsBeforePost(unidentified, /has no identifier/u);
});

test("phase 8 derives the target hostname from verified account state and stops on any mismatch", async () => {
  for (const account of [{ subdomain: "someone-else" }, {}, null, { subdomain: "" }, { subdomain: "Bad_Sub" }]) {
    let accessListed = false;
    const api = baseApi({
      async getAccountWorkersSubdomain() { return account; },
      async listAccessApplications() { accessListed = true; return [accessApp()]; },
    });
    await assertStopsBeforePost(api, /workers\.dev (?:subdomain is missing or malformed|hostname .* does not equal the pinned)/u);
    assert.equal(accessListed, false, "Access state must not be judged against an unverified hostname");
  }
  const failing = baseApi({ async getAccountWorkersSubdomain() { throw new Error("account subdomain unavailable"); } });
  await assertStopsBeforePost(failing, /account subdomain unavailable/u);
});

test("phase 8 stops before the POST when the Access listing is incomplete or ambiguous", async () => {
  const failing = baseApi({ async listAccessApplications() { throw new Error("Access application listing page 2 is truncated before the final page; completeness cannot be proven"); } });
  await assertStopsBeforePost(failing, /completeness cannot be proven/u);
});

// Adapter-level pagination: the real listing code against a paged fetch fixture.
async function pagedApi(pages, pathPattern) {
  const { CloudflareAdminV7Api } = await import("../src/cloudflare-admin-v7-api.js");
  const requested = [];
  const api = new CloudflareAdminV7Api({
    apiToken: "x".repeat(40),
    fetchImpl: async (url, init) => {
      requested.push({ url: String(url), method: init.method });
      assert.match(String(url), pathPattern);
      const page = Number(new URL(url).searchParams.get("page"));
      const body = pages[page - 1];
      if (body === undefined) throw new Error(`unexpected page ${page}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  return { api, requested };
}

const envelope = (result, info) => ({ success: true, result, result_info: info });
const appPage = (items, page, totalPages, totalCount, perPage = 2) => envelope(items, { page, per_page: perPage, count: items.length, total_pages: totalPages, total_count: totalCount });

test("Access applications are enumerated across every page and a later-page conflict stops phase 8", async () => {
  const pages = [
    appPage([otherApp({ id: "p1a", domain: "a.example.com" }), otherApp({ id: "p1b", domain: "b.example.com" })], 1, 3, 5),
    appPage([accessApp(), otherApp({ id: "p2b", domain: "c.example.com" })], 2, 3, 5),
    appPage([otherApp({ id: "p3a", domain: `${TARGET_HOST}/late` })], 3, 3, 5),
  ];
  const { api: adapter, requested } = await pagedApi(pages, /\/access\/apps\?page=\d+&per_page=50$/u);
  const listed = await adapter.listAccessApplications();
  assert.equal(listed.length, 5);
  assert.deepEqual(requested.map(({ method }) => method), ["GET", "GET", "GET"]);
  const api = baseApi({ listAccessApplications: () => adapter.listAccessApplications() });
  await assertStopsBeforePost(api, /p3a \(hostname, path, or wildcard coverage\)/u);
});

test("Access application pagination fails closed on missing, inconsistent, repeated, or truncated metadata", async () => {
  const app = (id) => otherApp({ id, domain: `${id}.example.com` });
  const malformed = [
    ["missing result_info", [{ success: true, result: [app("a")] }], /did not return pagination metadata/u],
    ["missing total_pages and total_count", [envelope([app("a")], { page: 1, per_page: 2 })], /invalid total_count/u],
    ["missing total_count", [envelope([app("a")], { page: 1, per_page: 2, total_pages: 1 })], /invalid total_count/u],
    ["wrong page index", [envelope([app("a")], { page: 2, per_page: 2, total_pages: 1, total_count: 1 })], /returned page 2 when page 1/u],
    ["count disagrees", [envelope([app("a")], { page: 1, per_page: 2, count: 3, total_pages: 1, total_count: 1 })], /count does not equal/u],
    ["truncated middle page", [appPage([app("a")], 1, 2, 3), appPage([app("b"), app("c")], 2, 2, 3)], /truncated before the final page/u],
    ["totals change between pages", [appPage([app("a"), app("b")], 1, 2, 3), appPage([app("c")], 2, 3, 3)], /totals changed between pages/u],
    ["repeated identifier", [appPage([app("a"), app("b")], 1, 2, 3), appPage([app("b")], 2, 2, 3)], /more than once/u],
    ["short total_count", [appPage([app("a"), app("b")], 1, 2, 4), appPage([app("c")], 2, 2, 4)], /collected 3 items but total_count is 4/u],
    ["item without identifier", [appPage([{ domain: "x.example.com" }], 1, 1, 1)], /without an identifier/u],
    ["result is not a list", [{ success: true, result: { apps: [] }, result_info: { page: 1, per_page: 2, total_pages: 1, total_count: 0 } }], /did not return a result list/u],
    ["inconsistent zero pages", [envelope([app("a")], { page: 1, per_page: 2, total_pages: 0, total_count: 0 })], /zero pages inconsistently/u],
  ];
  for (const [label, pages, pattern] of malformed) {
    const { api } = await pagedApi(pages, /\/access\/apps\?/u);
    await assert.rejects(() => api.listAccessApplications(), pattern, label);
  }
});

test("Access application pagination does not terminate silently", async () => {
  const { CloudflareAdminV7Api } = await import("../src/cloudflare-admin-v7-api.js");
  let page = 0;
  const api = new CloudflareAdminV7Api({
    apiToken: "x".repeat(40),
    fetchImpl: async () => {
      page += 1;
      return new Response(JSON.stringify(appPage([otherApp({ id: `x${page}`, domain: "x.example.com" })], page, 1000, 1000, 1)));
    },
  });
  await assert.rejects(() => api.listAccessApplications(), /did not terminate within 100 pages/u);
});

// ------------------------------------ B1-R1: both V4 page-pagination forms ---

// Omits total_pages: the V4 form from which the page count must be derived.
const derivedPage = (items, page, totalCount, perPage = 2) => envelope(items, { page, per_page: perPage, count: items.length, total_count: totalCount });

test("Access pagination accepts an explicit total_pages and a safely derived total_pages identically", async () => {
  const items = [otherApp({ id: "e1", domain: "a.example.com" }), otherApp({ id: "e2", domain: "b.example.com" }), accessApp()];
  const explicit = await pagedApi([appPage(items.slice(0, 2), 1, 2, 3), appPage(items.slice(2), 2, 2, 3)], /\/access\/apps\?/u);
  const derived = await pagedApi([derivedPage(items.slice(0, 2), 1, 3), derivedPage(items.slice(2), 2, 3)], /\/access\/apps\?/u);
  assert.deepEqual((await explicit.api.listAccessApplications()).map(({ id }) => id), ["e1", "e2", TOKEN_ID]);
  assert.deepEqual((await derived.api.listAccessApplications()).map(({ id }) => id), ["e1", "e2", TOKEN_ID]);
  assert.equal(explicit.requested.length, 2);
  assert.equal(derived.requested.length, 2, "ceil(3 / 2) = 2 pages are requested and no more");
  // An exact multiple derives no phantom trailing page.
  const exact = await pagedApi([derivedPage(items.slice(0, 2), 1, 2)], /\/access\/apps\?/u);
  assert.equal((await exact.api.listAccessApplications()).length, 2);
  assert.equal(exact.requested.length, 1);
  // An empty listing is one empty page in either form.
  for (const info of [{ page: 1, per_page: 50, total_count: 0 }, { page: 1, per_page: 50, total_count: 0, total_pages: 0 }, { page: 1, per_page: 50, total_count: 0, total_pages: 1 }]) {
    const empty = await pagedApi([envelope([], info)], /\/access\/apps\?/u);
    assert.deepEqual(await empty.api.listAccessApplications(), []);
  }
});

test("Access pagination fails closed on conflicting, missing, invalid, or changing metadata in either form", async () => {
  const app = (id) => otherApp({ id, domain: `${id}.example.com` });
  const cases = [
    ["supplied total_pages below derived", [appPage([app("a"), app("b")], 1, 1, 3)], /total_pages 1 conflicts with 2 derived from total_count 3 and per_page 2/u],
    ["supplied total_pages above derived", [appPage([app("a")], 1, 2, 1)], /total_pages 2 conflicts with 1 derived/u],
    ["non-empty listing claiming zero pages", [appPage([app("a")], 1, 0, 1)], /total_pages 0 conflicts with 1 derived/u],
    ["invalid supplied total_pages", [envelope([app("a")], { page: 1, per_page: 2, total_count: 1, total_pages: "1" })], /invalid total_pages/u],
    ["missing total_count, total_pages supplied", [envelope([app("a")], { page: 1, per_page: 2, total_pages: 1 })], /invalid total_count/u],
    ["missing total_count, total_pages omitted", [envelope([app("a")], { page: 1, per_page: 2 })], /invalid total_count/u],
    ["missing per_page", [envelope([app("a")], { page: 1, total_count: 1 })], /invalid per_page/u],
    ["zero per_page", [envelope([app("a")], { page: 1, per_page: 0, total_count: 1 })], /invalid per_page/u],
    ["string per_page", [envelope([app("a")], { page: 1, per_page: "2", total_count: 1 })], /invalid per_page/u],
    ["fractional per_page", [envelope([app("a")], { page: 1, per_page: 1.5, total_count: 1 })], /invalid per_page/u],
    ["missing page", [envelope([app("a")], { per_page: 2, total_count: 1 })], /returned page undefined when page 1/u],
    ["result_info is a list", [{ success: true, result: [app("a")], result_info: [] }], /did not return pagination metadata/u],
    ["per_page changes between pages", [derivedPage([app("a"), app("b")], 1, 3), derivedPage([app("c")], 2, 3, 3)], /totals changed between pages/u],
    ["total_count changes between pages", [derivedPage([app("a"), app("b")], 1, 3), derivedPage([app("c")], 2, 4)], /totals changed between pages/u],
    ["total_pages appears on a later page", [derivedPage([app("a"), app("b")], 1, 3), appPage([app("c")], 2, 2, 3)], /totals changed between pages/u],
    ["total_pages disappears on a later page", [appPage([app("a"), app("b")], 1, 2, 3), derivedPage([app("c")], 2, 3)], /totals changed between pages/u],
    ["short intermediate page, derived form", [derivedPage([app("a")], 1, 3), derivedPage([app("b"), app("c")], 2, 3)], /truncated before the final page/u],
    ["repeated record across pages, derived form", [derivedPage([app("a"), app("b")], 1, 3), derivedPage([app("a")], 2, 3)], /more than once/u],
    ["repeated record within a page", [derivedPage([app("a"), app("a")], 1, 2)], /more than once/u],
    ["final count below total_count, derived form", [derivedPage([app("a"), app("b")], 1, 4), derivedPage([app("c")], 2, 4)], /collected 3 items but total_count is 4/u],
    ["items on an empty listing", [envelope([app("a")], { page: 1, per_page: 2, total_count: 0 })], /zero pages inconsistently/u],
  ];
  for (const [label, pages, pattern] of cases) {
    const { api } = await pagedApi(pages, /\/access\/apps\?/u);
    await assert.rejects(() => api.listAccessApplications(), pattern, label);
  }
});

test("Access pagination refuses a derived page count beyond the limit before paging through it", async () => {
  const { api, requested } = await pagedApi([derivedPage([otherApp({ id: "x1", domain: "x.example.com" })], 1, 10_000, 1)], /\/access\/apps\?/u);
  await assert.rejects(() => api.listAccessApplications(), /did not terminate within 100 pages/u);
  assert.equal(requested.length, 1);
});

for (const [label, conflict] of conflictCases) {
  test(`a ${label} on the final page of a derived-form listing stops phase 8 before the POST`, async () => {
    const pages = [
      derivedPage([otherApp({ id: "q1", domain: "a.example.com" }), accessApp()], 1, 3),
      derivedPage([{ ...conflict, id: "late-conflict" }], 2, 3),
    ];
    const { api: adapter } = await pagedApi(pages, /\/access\/apps\?page=\d+&per_page=50$/u);
    const api = baseApi({ listAccessApplications: () => adapter.listAccessApplications() });
    await assertStopsBeforePost(api, /late-conflict \(hostname, path, or wildcard coverage\)/u);
  });
}

// ------------------------------------------- trailing-dot and preflight bypass ---

test("a fully qualified trailing-dot hostname cannot evade overlap detection", async () => {
  for (const domain of [`${TARGET_HOST}.`, `${TARGET_HOST.toUpperCase()}.`, `https://${TARGET_HOST}./admin`, `${TARGET_HOST}.:443`, "*.jhutchison.workers.dev.", "*.workers.dev."]) {
    const api = baseApi({ async listAccessApplications() { return [accessApp(), otherApp({ domain })]; } });
    await assertStopsBeforePost(api, /could cover 8978-ai-control-plane-dev\.jhutchison\.workers\.dev with precedence/u);
  }
  // Malformed empty labels are uninterpretable and therefore conflicts, never silently ignored.
  for (const domain of [`${TARGET_HOST}..`, `8978-ai-control-plane-dev..jhutchison.workers.dev`, ".", ".jhutchison.workers.dev"]) {
    const api = baseApi({ async listAccessApplications() { return [accessApp(), otherApp({ domain })]; } });
    await assertStopsBeforePost(api, /could cover/u);
  }
  // A fully qualified unrelated hostname is still not a conflict.
  const unrelated = baseApi({ async listAccessApplications() { return [accessApp(), otherApp({ domain: "app.example.com." })]; } });
  const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api: unrelated, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
});

test("enablement stops before the POST when the expected Access application enables options_preflight_bypass", async () => {
  for (const value of [true, "true", 1]) {
    const api = baseApi({ async listAccessApplications() { return [{ ...accessApp(), options_preflight_bypass: value }]; } });
    await assertStopsBeforePost(api, /must not enable options_preflight_bypass/u);
  }
  for (const value of [false, undefined, null]) {
    const api = baseApi({ async listAccessApplications() { return [{ ...accessApp(), options_preflight_bypass: value }]; } });
    const service = new CloudflareAdminV7Service({ reviewedDeployment: REVIEWED, api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
    await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
    assert.equal(api.calls.setWorkerSubdomain, 1);
  }
});

test("Worker listing uses documented page/per_page pagination with no cursor", async () => {
  const worker = (id, name) => ({ id, name });
  const pages = [
    envelope([worker("a".repeat(32), "one"), worker("b".repeat(32), "two")], { page: 1, per_page: 2, count: 2, total_pages: 2, total_count: 3 }),
    envelope([worker(WORKER_ID, CLOUDFLARE_ADMIN_V7.workerName)], { page: 2, per_page: 2, count: 1, total_pages: 2, total_count: 3, cursor: "ignored" }),
  ];
  const { api, requested } = await pagedApi(pages, /\/workers\/workers\?page=\d+&per_page=100$/u);
  const workers = await api.listWorkers();
  assert.deepEqual(workers.map(({ name }) => name), ["one", "two", CLOUDFLARE_ADMIN_V7.workerName]);
  assert.equal(requested.length, 2);
  assert.ok(requested.every(({ url }) => !url.includes("cursor")));
  assert.ok(!/cursor/u.test(apiSource.slice(apiSource.indexOf("async listWorkers("), apiSource.indexOf("async getWorkerById("))));
});

test("Worker listing fails closed on malformed pagination", async () => {
  const worker = (id) => ({ id, name: `w-${id.slice(0, 4)}` });
  for (const [pages, pattern] of [
    [[{ success: true, result: [worker("a".repeat(32))] }], /did not return pagination metadata/u],
    [[envelope([worker("a".repeat(32))], { page: 1, per_page: 1, total_pages: 2, total_count: 2 }), envelope([worker("a".repeat(32))], { page: 2, per_page: 1, total_pages: 2, total_count: 2 })], /more than once/u],
    [[envelope([worker("a".repeat(32))], { page: 1, per_page: 1, total_pages: 2, total_count: 2 }), envelope([], { page: 2, per_page: 1, total_pages: 2, total_count: 2 })], /collected 1 items but total_count is 2/u],
    [[envelope([worker("a".repeat(32))], { page: 3, per_page: 1, total_pages: 1, total_count: 1 })], /returned page 3 when page 1/u],
  ]) {
    const { api } = await pagedApi(pages, /\/workers\/workers\?/u);
    await assert.rejects(() => api.listWorkers(), pattern);
  }
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
  const custodian = new ManagedSecretCredentialCustodian(api, {}, { now: () => new Date("2026-09-25T00:00:00Z") });
  const accessReceipt = await custodian.store("access-service-token", {
    tokenId: TOKEN_ID, target: CLOUDFLARE_ADMIN_V7.workerUrl, clientId: "cid", clientSecret: "csecret", expiresAt: "2099-01-01T00:00:00Z",
  });
  const principalReceipt = await custodian.store("service-auth-principal", {
    principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: KEY_ID, secret: "s".repeat(43), workerId: WORKER_ID,
  });
  assert.notEqual(CLOUDFLARE_ADMIN_V7.accessCredentialSecretName, CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName);
  assert.notEqual(accessReceipt.receiptId, principalReceipt.receiptId);
  assert.equal(Object.keys(api.stored).length, 2);
  // Storing either kind again leaves the other slot byte-identical.
  const beforePrincipal = api.stored[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName];
  await custodian.store("access-service-token", { tokenId: TOKEN_ID, target: CLOUDFLARE_ADMIN_V7.workerUrl, clientId: "c2", clientSecret: "s2", expiresAt: "2099-01-01T00:00:00Z" });
  assert.equal(api.stored[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName], beforePrincipal);
  const beforeAccess = api.stored[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName];
  await custodian.store("service-auth-principal", { principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: "canary-2", secret: "t".repeat(43), workerId: WORKER_ID });
  assert.equal(api.stored[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName], beforeAccess);
});

test("retrieving one kind can never return the other", async () => {
  const api = custodianApi();
  const env = {};
  const custodian = new ManagedSecretCredentialCustodian(api, env);
  env[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName] = JSON.stringify({
    accountId: CLOUDFLARE_ADMIN_V7.accountId, workerName: CLOUDFLARE_ADMIN_V7.workerName, target: CLOUDFLARE_ADMIN_V7.workerUrl,
    tokenId: TOKEN_ID, clientId: "cid", clientSecret: "csecret", expiresAt: "2099-01-01T00:00:00Z",
  });
  env[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName] = JSON.stringify({
    accountId: CLOUDFLARE_ADMIN_V7.accountId, workerName: CLOUDFLARE_ADMIN_V7.workerName, workerId: WORKER_ID,
    principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: KEY_ID, secret: "s".repeat(43), purpose: "development-activation-canary",
  });
  const access = await custodian.readAccessCredential(ACCESS_RECEIPT, { tokenId: TOKEN_ID, now: new Date() });
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

// ============================================================================
// Phase 8 blocker 1: all custody is retrieved and bound before the POST.
// ============================================================================

const SECRET = "s".repeat(43);

function accessCustody(patch = {}) {
  return {
    accountId: CLOUDFLARE_ADMIN_V7.accountId,
    workerName: CLOUDFLARE_ADMIN_V7.workerName,
    target: CLOUDFLARE_ADMIN_V7.workerUrl,
    tokenId: TOKEN_ID,
    clientId: "cid",
    clientSecret: "csecret",
    expiresAt: "2099-01-01T00:00:00Z",
    ...patch,
  };
}

function principalCustody(patch = {}) {
  return {
    accountId: CLOUDFLARE_ADMIN_V7.accountId,
    workerName: CLOUDFLARE_ADMIN_V7.workerName,
    workerId: WORKER_ID,
    principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId,
    keyId: KEY_ID,
    secret: SECRET,
    purpose: "development-activation-canary",
    ...patch,
  };
}

// Real custodian over a managed-secret env; null leaves a slot unavailable.
function realCustodian({ access = accessCustody(), principal = principalCustody(), rawAccess, rawPrincipal } = {}) {
  const env = {};
  if (rawAccess !== undefined) env[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName] = rawAccess;
  else if (access !== null) env[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName] = JSON.stringify(access);
  if (rawPrincipal !== undefined) env[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName] = rawPrincipal;
  else if (principal !== null) env[CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName] = JSON.stringify(principal);
  return new ManagedSecretCredentialCustodian({ async listConnectorSecrets() { return []; } }, env);
}

// Runs phase 8 and proves: no POST, no read-back (only the single pre-enablement state read), no canary.
async function assertPhase8StopsWithoutExposure({ api = baseApi(), custodian = realCustodian(), input = {}, reviewedDeployment = REVIEWED }, pattern) {
  let canaryCalls = 0;
  const service = new CloudflareAdminV7Service({
    reviewedDeployment,
    api,
    custodian,
    canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); },
    now: () => new Date("2026-09-25T00:00:00Z"),
  });
  const error = await service.enableSubdomainAndRunCanary(enableInput(input)).then(() => null, (caught) => caught);
  assert.ok(error instanceof Error, "phase 8 must stop");
  assert.match(error.message, pattern);
  assert.ok(!error.message.includes(SECRET) && !error.message.includes("csecret"), "no secret value may appear in an error");
  assert.equal(api.calls.setWorkerSubdomain, 0, "setWorkerSubdomain must be called 0 times");
  assert.ok(api.calls.getWorkerSubdomain <= 1, "no subdomain read-back may occur; only the pre-enablement state read is permitted");
  assert.equal(canaryCalls, 0, "the canary must be called 0 times");
}

test("phase 8 succeeds through the real custodian when every custody binding is exact", async () => {
  const api = baseApi();
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: REVIEWED, api, custodian: realCustodian(),
    canaryFetch: async () => { throw new Error("canary reached"); }, now: () => new Date("2026-09-25T00:00:00Z"),
  });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
  assert.equal(api.calls.setWorkerSubdomain, 1);
  assert.equal(api.calls.getWorkerSubdomain, 2, "one pre-enablement read and exactly one read-back");
});

const custodyFailures = [
  ["incorrect keyId", { input: { keyId: "canary-wrong" } }, /different service-auth key ID/u],
  ["principal bound to a different Worker ID", { custodian: realCustodian({ principal: principalCustody({ workerId: "b".repeat(32) }) }) }, /different immutable Worker ID/u],
  ["principal bound to a different account", { custodian: realCustodian({ principal: principalCustody({ accountId: "0".repeat(32) }) }) }, /authorized development account/u],
  ["principal bound to a different Worker name", { custodian: realCustodian({ principal: principalCustody({ workerName: "8978-ai-control-plane-prod" }) }) }, /pinned development Worker/u],
  ["principal with a different principal ID", { custodian: realCustodian({ principal: principalCustody({ principalId: "someone-else" }) }) }, /pinned development principal/u],
  ["principal with a different purpose", { custodian: realCustodian({ principal: principalCustody({ purpose: "production" }) }) }, /activation canary purpose/u],
  ["principal with short secret material", { custodian: realCustodian({ principal: principalCustody({ secret: "short" }) }) }, /secret material is unavailable/u],
  ["Access credential bound to a different account", { custodian: realCustodian({ access: accessCustody({ accountId: "0".repeat(32) }) }) }, /Access credential is not bound to the authorized development account/u],
  ["Access credential bound to a different Worker name", { custodian: realCustodian({ access: accessCustody({ workerName: "another" }) }) }, /Access credential is not bound to the pinned development Worker/u],
  ["Access credential for a different target", { custodian: realCustodian({ access: accessCustody({ target: "https://elsewhere.example" }) }) }, /pinned development target/u],
  ["incorrect Access receipt", { input: { accessCredentialReceiptId: `managed-secret:${CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName}` } }, /Access credential receipt does not match/u],
  ["incorrect service-auth receipt", { input: { serviceAuthReceiptId: `managed-secret:${CLOUDFLARE_ADMIN_V7.accessCredentialSecretName}` } }, /principal receipt does not match/u],
  ["unavailable Access credential", { custodian: realCustodian({ access: null }) }, /Access credential secret is unavailable or invalid/u],
  ["unavailable service-auth principal", { custodian: realCustodian({ principal: null }) }, /principal secret is unavailable or invalid/u],
  ["malformed Access credential JSON", { custodian: realCustodian({ rawAccess: "{not json" }) }, /Access credential secret is unavailable or invalid/u],
  ["malformed service-auth principal JSON", { custodian: realCustodian({ rawPrincipal: "[]" }) }, /principal/u],
  ["Access credential without client material", { custodian: realCustodian({ access: accessCustody({ clientSecret: "" }) }) }, /credential material is unavailable or malformed/u],
  ["stale Access credential for a different service token", { custodian: realCustodian({ access: accessCustody({ tokenId: "99999999-1234-1234-1234-abcdefabcdef" }) }) }, /different Access service-token ID/u],
  ["expired Access credential", { custodian: realCustodian({ access: accessCustody({ expiresAt: "2026-09-24T00:00:00Z" }) }) }, /expired and is stale/u],
  ["malformed Access credential expiry", { custodian: realCustodian({ access: accessCustody({ expiresAt: "tomorrow" }) }) }, /expiry is malformed/u],
];

for (const [label, scenario, pattern] of custodyFailures) {
  test(`phase 8 stops before any exposure on ${label}`, async () => {
    await assertPhase8StopsWithoutExposure(scenario, pattern);
  });
}

test("phase 8 stops before any exposure when the pinned service token is absent or duplicated", async () => {
  for (const tokens of [[], [{ id: TOKEN_ID, name: "renamed" }], [{ id: TOKEN_ID, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }, { id: TOKEN_ID, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }]]) {
    await assertPhase8StopsWithoutExposure({ api: baseApi({ async listAccessServiceTokens() { return tokens; } }) }, /Pinned development Access service token identity is (?:missing|ambiguous)/u);
  }
});

test("phase 8 stops before any exposure when a custodian returns malformed material", async () => {
  const malformed = [
    [{ async readAccessCredential() { return { clientId: "cid" }; }, async readServiceAuthPrincipal() { return principalCustody(); } }, /Access credential custody is malformed/u],
    [{ async readAccessCredential() { return { clientId: "cid", clientSecret: "x" }; }, async readServiceAuthPrincipal() { return { principalId: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId, keyId: "other", secret: SECRET }; } }, /not bound to the exact phase-8 inputs/u],
    [{ async readAccessCredential() { return { clientId: "cid", clientSecret: "x" }; }, async readServiceAuthPrincipal() { return { principalId: "other", keyId: KEY_ID, secret: SECRET }; } }, /not bound to the exact phase-8 inputs/u],
    [{ async readAccessCredential() { throw new Error("custody store unreachable"); }, async readServiceAuthPrincipal() { return principalCustody(); } }, /custody store unreachable/u],
  ];
  for (const [custodian, pattern] of malformed) await assertPhase8StopsWithoutExposure({ custodian }, pattern);
});

test("the custodian requires explicit bindings and never falls back to an unbound read", async () => {
  const custodian = realCustodian();
  await assert.rejects(() => custodian.readAccessCredential(ACCESS_RECEIPT), /requires the exact service-token ID binding/u);
  await assert.rejects(() => custodian.readAccessCredential(ACCESS_RECEIPT, { tokenId: TOKEN_ID }), /requires a valid current time/u);
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, {}), /requires the exact immutable Worker ID and key ID binding/u);
  await assert.rejects(() => custodian.readServiceAuthPrincipal(PRINCIPAL_RECEIPT, { workerId: WORKER_ID }), /requires the exact immutable Worker ID and key ID binding/u);
});

test("successful ordering: every check and both custody reads precede the single POST, then one read-back, then the canary", async () => {
  const log = [];
  const api = baseApi();
  const wrap = (name) => { const original = api[name]; api[name] = async (...args) => { log.push(name); return original.apply(api, args); }; };
  for (const name of ["listWorkers", "getWorkerSubdomain", "listWorkerDeployments", "getWorkerVersion", "getLatestWorkerVersion",
    "getAccountWorkersSubdomain", "listAccessApplications", "listAccessApplicationPolicies", "listAccessServiceTokens", "setWorkerSubdomain"]) wrap(name);
  const custodian = realCustodian();
  for (const name of ["readAccessCredential", "readServiceAuthPrincipal"]) {
    const original = custodian[name].bind(custodian);
    custodian[name] = async (...args) => { log.push(name); return original(...args); };
  }
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: REVIEWED, api, custodian, now: () => new Date("2026-09-25T00:00:00Z"),
    canaryFetch: async () => { log.push("canary"); throw new Error("canary reached"); },
  });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
  const post = log.indexOf("setWorkerSubdomain");
  const at = (name) => log.indexOf(name);
  const last = (name) => log.lastIndexOf(name);
  assert.equal(log.filter((name) => name === "setWorkerSubdomain").length, 1);
  for (const name of ["listWorkers", "getAccountWorkersSubdomain", "listAccessApplications", "listAccessApplicationPolicies", "listAccessServiceTokens", "getWorkerVersion"]) {
    assert.ok(at(name) >= 0 && at(name) < post, `${name} must precede the POST`);
  }
  assert.ok(at("readAccessCredential") < post && at("readServiceAuthPrincipal") < post, "both custody reads must precede the POST");
  assert.ok(at("readAccessCredential") > last("listAccessApplicationPolicies"), "custody is read after Access isolation");
  // The final deployment and latest-version re-reads follow custody and immediately precede the POST.
  assert.ok(last("listWorkerDeployments") > at("readServiceAuthPrincipal") && last("listWorkerDeployments") < post);
  assert.ok(last("getLatestWorkerVersion") > at("readServiceAuthPrincipal") && last("getLatestWorkerVersion") < post);
  assert.deepEqual(log.slice(post), ["setWorkerSubdomain", "getWorkerSubdomain", "canary"], "exactly one read-back, then the canary");
});

// ============================================================================
// Phase 8 blocker 2: exact activated-version provenance before exposure.
// ============================================================================

const reviewedMessageFor = (commit, digest) => `8978-reviewed:${commit}:${digest}`;
const activatedMessageFor = (commit, digest) => `8978-activated:${commit}:${digest}`;

function versionsApi({ reviewed = reviewedVersion(), activated = activatedVersion(), latest = activatedVersion(), extra = {} } = {}) {
  return baseApi({
    async getWorkerVersion(id) {
      if (id === REVIEWED_VERSION_ID) return reviewed;
      if (id === VERSION_ID) return activated;
      return extra[id];
    },
    async getLatestWorkerVersion() { return latest; },
  });
}

const provenanceFailures = [
  ["a different version is active", {
    api: baseApi({ async listWorkerDeployments() { return [{ id: "d3", is_active: true, versions: [{ version_id: "bbbbbbbb-2222-3333-4444-555555555555", percentage: 100 }] }]; } }),
  }, /does not allocate 100 percent to exactly the expected activated version/u],
  ["a split deployment", {
    api: baseApi({ async listWorkerDeployments() { return [{ id: "d3", is_active: true, versions: [{ version_id: VERSION_ID, percentage: 50 }, { version_id: "bbbbbbbb-2222-3333-4444-555555555555", percentage: 50 }] }]; } }),
  }, /does not allocate 100 percent/u],
  ["an active deployment without an identifier", {
    api: baseApi({ async listWorkerDeployments() { return [{ is_active: true, versions: [{ version_id: VERSION_ID, percentage: 100 }] }]; } }),
  }, /does not allocate 100 percent/u],
  ["two active deployments", {
    api: baseApi({ async listWorkerDeployments() { return [{ id: "a", is_active: true, versions: [{ version_id: VERSION_ID, percentage: 100 }] }, { id: "b", is_active: true, versions: [{ version_id: VERSION_ID, percentage: 100 }] }]; } }),
  }, /Active deployment state is ambiguous/u],
  ["a caller-supplied active version without the activation annotation", {
    api: versionsApi({ activated: activatedVersion({ annotations: { "workers/message": "unrelated deploy" } }) }),
  }, /Activated Worker version annotation does not bind/u],
  ["an activated version with no annotation", {
    api: versionsApi({ activated: activatedVersion({ annotations: undefined }) }),
  }, /Activated Worker version carries no workers\/message annotation/u],
  ["an activated version with contradictory annotation sources", {
    api: versionsApi({ activated: activatedVersion({ metadata: { annotations: { "workers/message": "other" } } }) }),
  }, /Activated Worker version annotation is ambiguous/u],
  ["versions/latest identifying a different version", {
    api: versionsApi({ latest: activatedVersion({ id: "cccccccc-2222-3333-4444-555555555555" }) }),
  }, /versions\/latest does not identify exactly the activated Worker version/u],
  ["versions/latest with a different annotation", {
    api: versionsApi({ latest: activatedVersion({ annotations: { "workers/message": reviewedMessageFor(REVIEWED.reviewedCommit, REVIEWED.configurationSha256) } }) }),
  }, /Latest Worker version annotation does not bind/u],
  ["an annotation naming a different commit", {
    api: versionsApi({ activated: activatedVersion({ annotations: { "workers/message": activatedMessageFor("0".repeat(40), REVIEWED.configurationSha256) } }) }),
  }, /Activated Worker version annotation does not bind/u],
  ["an annotation naming a different configuration digest", {
    api: versionsApi({ activated: activatedVersion({ annotations: { "workers/message": activatedMessageFor(REVIEWED.reviewedCommit, "0".repeat(64)) } }) }),
  }, /Activated Worker version annotation does not bind/u],
  ["a changed script etag", {
    api: versionsApi({ activated: activatedVersion({ resources: { ...activatedVersion().resources, script: { etag: "different-etag" } } }) }),
  }, /changed reviewed code or configuration/u],
  ["a changed script runtime", {
    api: versionsApi({ activated: activatedVersion({ resources: { ...activatedVersion().resources, script_runtime: { compatibility_date: "2020-01-01" } } }) }),
  }, /changed reviewed code or configuration/u],
  ["an added non-secret binding", {
    api: versionsApi({ activated: activatedVersion({ resources: { ...activatedVersion().resources, bindings: [...activatedVersion().resources.bindings, { name: "EXTRA", type: "plain_text", text: "x" }] } }) }),
  }, /changed reviewed code or configuration/u],
  ["an activated version without the service-auth secret", {
    api: versionsApi({ activated: activatedVersion({ resources: BASE_RESOURCES }) }),
  }, /exactly one SERVICE_AUTH_KEYS_JSON secret binding/u],
  ["a reviewed version without a script etag", {
    api: versionsApi({ reviewed: reviewedVersion({ resources: { ...BASE_RESOURCES, script: {} } }), activated: activatedVersion({ resources: { ...activatedVersion().resources, script: {} } }) }),
  }, /does not expose a script etag/u],
  ["a reviewed version returned under a different identity", {
    api: versionsApi({ reviewed: reviewedVersion({ id: "dddddddd-2222-3333-4444-555555555555" }) }),
  }, /did not return the pinned reviewed Worker version/u],
  ["a reviewed version whose annotation is not the reviewed annotation", {
    api: versionsApi({ reviewed: reviewedVersion({ annotations: { "workers/message": activatedMessageFor(REVIEWED.reviewedCommit, REVIEWED.configurationSha256) } }) }),
  }, /Reviewed Worker version annotation does not bind/u],
  ["missing activated version metadata", {
    api: versionsApi({ activated: null }),
  }, /did not return the activated Worker version/u],
  ["a pinned reviewed commit that differs from the target provenance", {
    reviewedDeployment: { ...REVIEWED, reviewedCommit: "0".repeat(40) },
  }, /Pinned reviewed Worker provenance is unavailable or does not match/u],
  ["a pinned configuration digest that differs from the target provenance", {
    reviewedDeployment: { ...REVIEWED, configurationSha256: "0".repeat(64) },
  }, /Pinned reviewed Worker provenance is unavailable or does not match/u],
  ["an unavailable pinned reviewed deployment", { reviewedDeployment: null }, /Pinned reviewed Worker provenance is unavailable/u],
  ["a malformed pinned reviewed version ID", { reviewedDeployment: { ...REVIEWED, versionId: "not-a-version" } }, /Pinned reviewed Worker provenance is unavailable/u],
  ["an activated version ID equal to the reviewed base version", { input: { activatedVersionId: REVIEWED_VERSION_ID } }, /cannot be the reviewed base version/u],
  ["a malformed activated version ID", { input: { activatedVersionId: "latest" } }, /Activated Worker version ID is malformed/u],
];

for (const [label, scenario, pattern] of provenanceFailures) {
  test(`phase 8 stops before any exposure on ${label}`, async () => {
    await assertPhase8StopsWithoutExposure(scenario, pattern);
  });
}

test("a caller cannot authorize an unrelated active version by supplying its ID", async () => {
  const unrelatedId = "eeeeeeee-2222-3333-4444-555555555555";
  const unrelated = { id: unrelatedId, annotations: { "workers/message": "manual dashboard deploy" }, resources: activatedVersion().resources };
  const api = baseApi({
    async listWorkerDeployments() { return [{ id: "d9", is_active: true, versions: [{ version_id: unrelatedId, percentage: 100 }] }]; },
    async getWorkerVersion(id) { return id === REVIEWED_VERSION_ID ? reviewedVersion() : id === unrelatedId ? unrelated : undefined; },
    async getLatestWorkerVersion() { return unrelated; },
  });
  await assertPhase8StopsWithoutExposure({ api, input: { activatedVersionId: unrelatedId } }, /Activated Worker version annotation does not bind/u);
});

test("phase 8 stops before any exposure when the deployment changes during the pre-POST sequence", async () => {
  const deployments = [
    [{ id: "d2", is_active: true, versions: [{ version_id: VERSION_ID, percentage: 100 }] }],
    [{ id: "d7", is_active: true, versions: [{ version_id: VERSION_ID, percentage: 100 }] }],
  ];
  const redeployed = baseApi({ async listWorkerDeployments() { redeployed.calls.listWorkerDeployments += 1; return deployments[Math.min(redeployed.calls.listWorkerDeployments, 2) - 1]; } });
  await assertPhase8StopsWithoutExposure({ api: redeployed }, /Active deployment changed during pre-enablement verification/u);

  const replaced = [
    [{ id: "d2", is_active: true, versions: [{ version_id: VERSION_ID, percentage: 100 }] }],
    [{ id: "d2", is_active: true, versions: [{ version_id: "ffffffff-2222-3333-4444-555555555555", percentage: 100 }] }],
  ];
  const swapped = baseApi({ async listWorkerDeployments() { swapped.calls.listWorkerDeployments += 1; return replaced[Math.min(swapped.calls.listWorkerDeployments, 2) - 1]; } });
  await assertPhase8StopsWithoutExposure({ api: swapped }, /final pre-enablement check does not allocate 100 percent/u);

  let latestReads = 0;
  const newerLatest = baseApi({ async getLatestWorkerVersion() { latestReads += 1; return latestReads === 1 ? activatedVersion() : activatedVersion({ id: "abababab-2222-3333-4444-555555555555" }); } });
  await assertPhase8StopsWithoutExposure({ api: newerLatest }, /versions\/latest does not identify exactly the activated Worker version/u);
});

// ============================================================================
// Review B1: the Access-credential expiry is mandatory at storage and at retrieval.
// ============================================================================

const CLOCK_NOW = new Date("2026-09-25T00:00:00Z");
const clock = () => CLOCK_NOW;
const INVALID_EXPIRIES = [
  ["missing", undefined],
  ["null", null],
  ["empty", ""],
  ["numeric", 4102444800000],
  ["malformed", "tomorrow"],
  ["impossible calendar date", "2099-02-30T00:00:00Z"],
  ["offset-less", "2099-01-01T00:00:00"],
  ["already expired", "2026-09-24T23:59:59Z"],
  ["exactly now", "2026-09-25T00:00:00Z"],
];

// Service-token creation harness. The documented creation response carries no expires_at; the
// exact-token read (GET /access/service_tokens/{id}) does. Every adapter call is recorded so the
// tests prove there is exactly one write (the creation POST) and nothing else.
const CREATED_CLIENT_ID = "cid-fixture";
const CREATED_SECRET = "csecret-fixture-value";
const createResponse = (overrides = {}) => ({
  id: TOKEN_ID, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, client_id: CREATED_CLIENT_ID, client_secret: CREATED_SECRET,
  duration: "24h", enabled: true, created_at: "2026-09-25T00:00:00Z", updated_at: "2026-09-25T00:00:00Z", ...overrides,
});
const exactToken = (overrides = {}) => ({
  id: TOKEN_ID, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, client_id: CREATED_CLIENT_ID, enabled: true,
  duration: "24h", expires_at: "2026-09-26T00:00:00Z", ...overrides,
});

function creationHarness({ create = createResponse(), exact = () => exactToken(), listAfter = null, listAfterStore = null, custodyFails = false, listErrorAfterCreate = null } = {}) {
  const writes = [];
  let created = false;
  let stored = false;
  const listing = () => {
    if (!created) return [];
    if (listErrorAfterCreate) throw new Error(listErrorAfterCreate);
    if (stored && listAfterStore) return listAfterStore;
    return listAfter ?? [{ id: TOKEN_ID, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, client_id: CREATED_CLIENT_ID }];
  };
  const target = {
    ...baseApi(),
    async listAccessServiceTokens() { return listing(); },
    async createAccessServiceToken() { created = true; return typeof create === "function" ? create() : create; },
    async getAccessServiceToken(id) { assert.equal(id, TOKEN_ID); return exact(); },
  };
  const api = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== "function") return value;
      return (...args) => {
        if (!/^(get|list|verify)[A-Z]/u.test(String(property))) writes.push(String(property));
        return value.apply(object, args);
      };
    },
  });
  const custody = [];
  const custodian = {
    async store(kind, value) {
      custody.push({ kind, value });
      if (custodyFails) throw new Error(`storage failed for ${value.clientSecret}`);
      stored = true;
      return { receiptId: ACCESS_RECEIPT };
    },
  };
  let canaryCalls = 0;
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: REVIEWED, api, custodian, now: clock,
    canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); },
  });
  const run = () => service.createServiceToken({ approval: WRITE_APPROVALS.createServiceToken }).then((value) => ({ value }), (error) => ({ error }));
  return { run, writes, custody, calls: target.calls, get canaryCalls() { return canaryCalls; } };
}

// After any stop following creation: one POST only, no retry, cleanup, Access installation,
// subdomain POST, or canary, and no secret in the error.
function assertStoppedAfterSingleCreate(harness, outcome, pattern, { stored = false } = {}) {
  assert.ok(outcome.error instanceof Error, "creation must stop");
  assert.match(outcome.error.message, pattern);
  assert.ok(!outcome.error.message.includes(CREATED_SECRET), "no secret value may appear in an error");
  assert.deepEqual(harness.writes, ["createAccessServiceToken"], "exactly one write: the creation POST, with no retry, cleanup, deletion, or Access installation");
  assert.equal(harness.calls.setWorkerSubdomain, 0);
  assert.equal(harness.canaryCalls, 0);
  if (!stored) assert.equal(harness.custody.length, 0, "no unverified credential may be stored");
}

test("a documented creation response without expires_at, followed by a valid read-back, succeeds", async () => {
  const harness = creationHarness();
  const outcome = await harness.run();
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.value.created, true);
  assert.equal(harness.custody.length, 1);
  assert.deepEqual(harness.custody[0].value, {
    target: CLOUDFLARE_ADMIN_V7.workerUrl, tokenId: TOKEN_ID, clientId: CREATED_CLIENT_ID, clientSecret: CREATED_SECRET, expiresAt: "2026-09-26T00:00:00Z",
  });
  assert.equal(outcome.value.token.expiresAt, "2026-09-26T00:00:00Z", "the stored expiry is the one read back, not taken from the creation response");
  assert.deepEqual(harness.writes, ["createAccessServiceToken"]);
  assert.equal(harness.calls.setWorkerSubdomain, 0);
  assert.equal(harness.canaryCalls, 0);
  assert.ok(!JSON.stringify(outcome.value).includes(CREATED_SECRET));
  assert.ok(!JSON.stringify(outcome.value).includes(CREATED_CLIENT_ID));
});

test("a read-back without an enabled field still succeeds when every documented identity matches", async () => {
  const harness = creationHarness({ exact: () => { const token = exactToken(); delete token.enabled; return token; } });
  const outcome = await harness.run();
  assert.equal(outcome.error, undefined);
  assert.equal(harness.custody.length, 1);
});

const PARTIAL_CREATION = /partial or mismatched Access service-token creation result; the credential was not stored; stop without retry or cleanup; partial state requires owner review/u;
for (const [label, create] of [
  ["no token ID", createResponse({ id: undefined })],
  ["an empty token ID", createResponse({ id: "" })],
  ["no client ID", createResponse({ client_id: undefined })],
  ["no client secret", createResponse({ client_secret: undefined })],
  ["an empty client secret", createResponse({ client_secret: "" })],
  ["a different name", createResponse({ name: "another-token" })],
  ["no name", createResponse({ name: undefined })],
  ["a disabled token", createResponse({ enabled: false })],
  ["a null result", null],
]) {
  test(`token creation stops when the creation response has ${label}`, async () => {
    const harness = creationHarness({ create });
    assertStoppedAfterSingleCreate(harness, await harness.run(), PARTIAL_CREATION);
  });
}

const READ_BACK_STOP = (reason) => new RegExp(`created but read-back did not verify it: ${reason}; the credential was not stored; stop without retry or cleanup; partial state requires owner review`, "u");
const exactReadFailures = [
  ["a missing exact token", () => null, "the exact token read returned no token"],
  ["an exact token with the wrong ID", () => exactToken({ id: "99999999-1234-1234-1234-abcdefabcdef" }), "the exact token read does not carry the created immutable ID"],
  ["an exact token with the wrong name", () => exactToken({ name: "another-token" }), "the exact token read does not carry the pinned name"],
  ["an exact token with the wrong client ID", () => exactToken({ client_id: "other-client" }), "the exact token read does not carry the created client ID"],
  ["an exact token that is disabled", () => exactToken({ enabled: false }), "the exact token read reports the token is not enabled"],
  ["an exact token read that fails", () => { throw new Error("Cloudflare API request failed"); }, "Cloudflare API request failed"],
];
for (const [label, exact, reason] of exactReadFailures) {
  test(`token creation stops before custody on ${label}`, async () => {
    const harness = creationHarness({ exact });
    assertStoppedAfterSingleCreate(harness, await harness.run(), READ_BACK_STOP(reason));
  });
}

for (const [label, value] of INVALID_EXPIRIES) {
  test(`token creation stops before custody when the read-back has a ${label} expires_at`, async () => {
    const harness = creationHarness({ exact: () => { const token = exactToken({ expires_at: value }); if (label === "missing") delete token.expires_at; return token; } });
    const reason = /already expired|exactly now/u.test(label)
      ? "the exact token read reports an expires_at that is not later than the current time"
      : "the exact token read does not carry a strict RFC 3339 expires_at";
    assertStoppedAfterSingleCreate(harness, await harness.run(), READ_BACK_STOP(reason));
  });

  test(`the managed-secret custodian refuses to store a ${label} expiry`, async () => {
    let installs = 0;
    const custodian = new ManagedSecretCredentialCustodian({ async installConnectorAccessCredential() { installs += 1; } }, {}, { now: clock });
    const credential = { tokenId: TOKEN_ID, target: CLOUDFLARE_ADMIN_V7.workerUrl, clientId: "cid", clientSecret: "csecret" };
    if (label !== "missing") credential.expiresAt = value;
    const error = await custodian.store("access-service-token", credential).then(() => null, (caught) => caught);
    assert.ok(error instanceof Error);
    assert.match(error.message, /the credential is not stored/u);
    assert.ok(!error.message.includes("csecret"));
    assert.equal(installs, 0);
  });
}

for (const [label, listAfter, reason] of [
  ["a duplicate same-name token", [{ id: TOKEN_ID, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }, { id: "99999999-1234-1234-1234-abcdefabcdef", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }], "Pinned development Access service token identity is ambiguous"],
  ["no same-name token", [], "Pinned development Access service token identity is missing"],
  ["only a different same-name token", [{ id: "99999999-1234-1234-1234-abcdefabcdef", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }], "Pinned development Access service token does not carry the expected immutable ID"],
  ["a listed token with a different client ID", [{ id: TOKEN_ID, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, client_id: "other-client" }], "the pinned-name listing does not carry the created client ID"],
]) {
  test(`token creation stops before custody when the complete listing shows ${label}`, async () => {
    const harness = creationHarness({ listAfter });
    assertStoppedAfterSingleCreate(harness, await harness.run(), READ_BACK_STOP(reason));
  });
}

test("token creation stops before custody when the complete read-back listing is incomplete", async () => {
  const harness = creationHarness({ listErrorAfterCreate: "Access service-token listing page 1 is truncated before the final page; completeness cannot be proven" });
  assertStoppedAfterSingleCreate(harness, await harness.run(), READ_BACK_STOP("Access service-token listing page 1 is truncated before the final page; completeness cannot be proven"));
});

test("a custody failure after a verified read-back stops as owner-review partial state without exposing the secret", async () => {
  const harness = creationHarness({ custodyFails: true });
  const outcome = await harness.run();
  assertStoppedAfterSingleCreate(harness, outcome, /created but credential custody was not confirmed; partial state requires owner review/u, { stored: true });
  assert.equal(harness.custody.length, 1, "custody is attempted once, only after the read-back verified the token");
  assert.equal(harness.custody[0].value.expiresAt, "2026-09-26T00:00:00Z");
});

test("a read-back failure after custody stops as owner-review partial state with no further action", async () => {
  const harness = creationHarness({ listAfterStore: [] });
  const outcome = await harness.run();
  assertStoppedAfterSingleCreate(harness, outcome,
    /created and its credential stored, but read-back did not confirm it: Pinned development Access service token identity is missing; stop without retry or cleanup; partial state requires owner review/u,
    { stored: true });
  assert.equal(harness.custody.length, 1);
});

test("a later invocation after any partial state detects the created token and never creates a second one", async () => {
  const harness = creationHarness({ exact: () => exactToken({ expires_at: null }) });
  assertStoppedAfterSingleCreate(harness, await harness.run(), READ_BACK_STOP("the exact token read does not carry a strict RFC 3339 expires_at"));
  const retry = await harness.run();
  assert.match(retry.error.message, /already exists or is ambiguous; automatic retry is prohibited/u);
  assert.deepEqual(harness.writes, ["createAccessServiceToken"], "the second invocation made no POST");
  assert.equal(harness.custody.length, 0);
});

const storedExpiryFailures = [
  ["missing stored expiresAt", accessCustody({ expiresAt: undefined }), /expiry is missing/u],
  ["null stored expiresAt", accessCustody({ expiresAt: null }), /expiry is missing/u],
  ["empty stored expiresAt", accessCustody({ expiresAt: "" }), /expiry is missing/u],
  ["numeric stored expiresAt", accessCustody({ expiresAt: 4102444800000 }), /expiry is missing/u],
  ["malformed stored expiresAt", accessCustody({ expiresAt: "next week" }), /expiry is malformed/u],
  ["impossible stored calendar date", accessCustody({ expiresAt: "2099-02-30T00:00:00Z" }), /expiry is malformed/u],
  ["offset-less stored expiresAt", accessCustody({ expiresAt: "2099-01-01T00:00:00" }), /expiry is malformed/u],
  ["expired stored expiresAt", accessCustody({ expiresAt: "2026-09-24T23:59:59Z" }), /expired and is stale/u],
  ["stored expiresAt equal to now", accessCustody({ expiresAt: "2026-09-25T00:00:00Z" }), /expired and is stale/u],
];

for (const [label, access, pattern] of storedExpiryFailures) {
  test(`phase 8 stops before any exposure on a ${label}`, async () => {
    await assertPhase8StopsWithoutExposure({ custodian: realCustodian({ access }) }, pattern);
  });
}

test("a valid future stored expiry reaches exactly one POST, one read-back, and the canary", async () => {
  const api = baseApi();
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: REVIEWED, api, custodian: realCustodian({ access: accessCustody({ expiresAt: "2026-09-25T00:00:01Z" }) }),
    canaryFetch: async () => { throw new Error("canary reached"); }, now: clock,
  });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
  assert.equal(api.calls.setWorkerSubdomain, 1);
  assert.equal(api.calls.getWorkerSubdomain, 2);
});

// ============================================================================
// Review B2: Access service tokens are enumerated completely before any decision.
// ============================================================================

const TOKEN_NAME = CLOUDFLARE_ADMIN_V7.accessServiceTokenName;
const OTHER_TOKEN_ID = "99999999-1234-1234-1234-abcdefabcdef";
const tokenItem = (id, name = TOKEN_NAME) => ({ id, name });
const fillerTokens = (count, prefix) => Array.from({ length: count }, (_, index) => tokenItem(`${prefix}${index}`, `${TOKEN_NAME}-lookalike-${prefix}${index}`));

// A real adapter serving the given service-token pages, wired into the service mock.
async function tokenListing(pages) {
  const { api, requested } = await pagedApi(pages, /\/access\/service_tokens\?/u);
  return { listAccessServiceTokens: () => api.listAccessServiceTokens(), requested };
}

test("the service-token listing uses the documented name filter and page/per_page on every page", async () => {
  const { listAccessServiceTokens, requested } = await tokenListing([
    appPage(fillerTokens(2, "a"), 1, 2, 3),
    appPage([tokenItem(TOKEN_ID)], 2, 2, 3),
  ]);
  const tokens = await listAccessServiceTokens();
  assert.equal(tokens.length, 3);
  assert.deepEqual(requested.map(({ url }) => new URL(url).search), [
    `?name=${encodeURIComponent(TOKEN_NAME)}&page=1&per_page=50`,
    `?name=${encodeURIComponent(TOKEN_NAME)}&page=2&per_page=50`,
  ]);
  assert.ok(requested.every(({ method }) => method === "GET"));
});

test("phase 8 finds the pinned token on a later page and proceeds only with exactly one match", async () => {
  const { listAccessServiceTokens } = await tokenListing([appPage(fillerTokens(2, "a"), 1, 2, 3), appPage([tokenItem(TOKEN_ID)], 2, 2, 3)]);
  const api = baseApi({ listAccessServiceTokens });
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: REVIEWED, api, custodian: realCustodian(), now: clock,
    canaryFetch: async () => { throw new Error("canary reached"); },
  });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
  assert.equal(api.calls.setWorkerSubdomain, 1);
});

const tokenListingFailures = [
  ["a same-name duplicate on a later page", [appPage([tokenItem(TOKEN_ID), tokenItem("p1b", "unrelated")], 1, 2, 3), appPage([tokenItem(OTHER_TOKEN_ID)], 2, 2, 3)], /service token identity is ambiguous/u],
  ["the only same-name token carrying a different ID", [appPage([tokenItem(OTHER_TOKEN_ID)], 1, 1, 1)], /does not carry the expected immutable ID/u],
  ["no same-name token on any page", [appPage(fillerTokens(2, "a"), 1, 2, 3), appPage(fillerTokens(1, "b"), 2, 2, 3)], /service token identity is missing/u],
  ["missing pagination metadata", [{ success: true, result: [tokenItem(TOKEN_ID)] }], /did not return pagination metadata/u],
  ["a truncated page before the final page", [appPage([tokenItem(TOKEN_ID)], 1, 2, 3), appPage([tokenItem("b0", "x")], 2, 2, 3)], /truncated before the final page/u],
  ["an incomplete listing", [appPage([tokenItem(TOKEN_ID), tokenItem("a1", "x")], 1, 2, 4), appPage([tokenItem("b0", "x")], 2, 2, 4)], /collected 3 items but total_count is 4/u],
  ["a repeated token across pages", [appPage([tokenItem(TOKEN_ID), tokenItem("a1", "x")], 1, 2, 3), appPage([tokenItem(TOKEN_ID)], 2, 2, 3)], /more than once/u],
  ["changing totals between pages", [appPage([tokenItem(TOKEN_ID), tokenItem("a1", "x")], 1, 2, 3), appPage([tokenItem("b0", "x"), tokenItem("b1", "x")], 2, 2, 4)], /totals changed between pages/u],
  ["a malformed total_count", [envelope([tokenItem(TOKEN_ID)], { page: 1, per_page: 50, total_count: "1" })], /invalid total_count/u],
];

for (const [label, pages, pattern] of tokenListingFailures) {
  test(`phase 8 stops before any exposure on ${label} in the service-token listing`, async () => {
    const { listAccessServiceTokens } = await tokenListing(pages);
    await assertPhase8StopsWithoutExposure({ api: baseApi({ listAccessServiceTokens }) }, pattern);
  });
}

test("token creation refuses when a same-name token exists on a later page or the listing is incomplete", async () => {
  for (const [pages, pattern] of [
    [[appPage(fillerTokens(2, "a"), 1, 2, 3), appPage([tokenItem(OTHER_TOKEN_ID)], 2, 2, 3)], /automatic retry is prohibited/u],
    [[{ success: true, result: [] }], /did not return pagination metadata/u],
    [[appPage(fillerTokens(1, "a"), 1, 2, 3), appPage(fillerTokens(1, "b"), 2, 2, 3)], /truncated before the final page/u],
  ]) {
    const { listAccessServiceTokens } = await tokenListing(pages);
    let createCalls = 0;
    const service = new CloudflareAdminV7Service({
      api: { ...baseApi(), listAccessServiceTokens, async createAccessServiceToken() { createCalls += 1; return {}; } },
      custodian: { async store() { throw new Error("must not store"); } },
      now: clock,
    });
    await assert.rejects(() => service.createServiceToken({ approval: WRITE_APPROVALS.createServiceToken }), pattern);
    assert.equal(createCalls, 0, "an incomplete or non-empty listing may never authorize creation");
  }
});

test("token creation stops when read-back does not show exactly the created token", async () => {
  for (const [after, pattern] of [
    [[tokenItem(TOKEN_ID), tokenItem(OTHER_TOKEN_ID)], /read-back did not verify it: Pinned development Access service token identity is ambiguous; the credential was not stored/u],
    [[tokenItem(OTHER_TOKEN_ID)], /read-back did not verify it: .*does not carry the expected immutable ID; the credential was not stored/u],
    [[], /read-back did not verify it: Pinned development Access service token identity is missing; the credential was not stored/u],
  ]) {
    let created = false;
    let stores = 0;
    const service = new CloudflareAdminV7Service({
      api: {
        ...baseApi(),
        async listAccessServiceTokens() { return created ? after : []; },
        async createAccessServiceToken() { created = true; return { id: TOKEN_ID, name: TOKEN_NAME, client_id: "cid", client_secret: "csecret" }; },
        async getAccessServiceToken() { return { id: TOKEN_ID, name: TOKEN_NAME, client_id: "cid", enabled: true, expires_at: "2026-09-26T00:00:00Z" }; },
      },
      custodian: { async store() { stores += 1; return { receiptId: ACCESS_RECEIPT }; } },
      now: clock,
    });
    const error = await service.createServiceToken({ approval: WRITE_APPROVALS.createServiceToken }).then(() => null, (caught) => caught);
    assert.ok(error instanceof Error);
    assert.match(error.message, pattern);
    assert.ok(!error.message.includes("csecret"));
    assert.equal(stores, 0, "an unverified credential is never stored");
  }
});

test("Access protection requires exactly one same-name token carrying the supplied ID", async () => {
  for (const [tokens, pattern] of [
    [[tokenItem(TOKEN_ID), tokenItem(OTHER_TOKEN_ID)], /identity is ambiguous/u],
    [[tokenItem(OTHER_TOKEN_ID)], /does not carry the expected immutable ID/u],
  ]) {
    let creates = 0;
    const service = new CloudflareAdminV7Service({
      api: { ...baseApi(), async listAccessServiceTokens() { return tokens; }, async createAccessApplication() { creates += 1; return {}; } },
    });
    await assert.rejects(() => service.ensureAccessProtection({ approval: WRITE_APPROVALS.ensureAccess, serviceTokenId: TOKEN_ID, workerId: WORKER_ID }), pattern);
    assert.equal(creates, 0);
  }
});

// ============================================================================
// Additional hardening: Access policies are enumerated completely.
// ============================================================================

async function policyListing(pages) {
  const { api, requested } = await pagedApi(pages, new RegExp(`/access/apps/${TOKEN_ID}/policies\\?`, "u"));
  return { listAccessApplicationPolicies: (id) => api.listAccessApplicationPolicies(id), requested };
}

const exactPolicy = accessPolicy()[0];

test("the Access policy listing uses page/per_page and accepts exactly one policy across all pages", async () => {
  const { listAccessApplicationPolicies, requested } = await policyListing([appPage([exactPolicy], 1, 1, 1)]);
  const api = baseApi({ listAccessApplicationPolicies });
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: REVIEWED, api, custodian: realCustodian(), now: clock,
    canaryFetch: async () => { throw new Error("canary reached"); },
  });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
  assert.equal(api.calls.setWorkerSubdomain, 1);
  assert.equal(new URL(requested[0].url).search, "?page=1&per_page=50");
});

const policyListingFailures = [
  ["a second policy on a later page", [appPage([exactPolicy], 1, 2, 2, 1), appPage([{ id: "p2", decision: "allow", include: [{ everyone: {} }] }], 2, 2, 2, 1)], /exactly one Service Auth policy/u],
  ["a duplicate policy across pages", [appPage([exactPolicy], 1, 2, 2, 1), appPage([exactPolicy], 2, 2, 2, 1)], /more than once/u],
  ["no policy", [appPage([], 1, 0, 0)], /exactly one Service Auth policy/u],
  ["missing pagination metadata", [{ success: true, result: [exactPolicy] }], /did not return pagination metadata/u],
  ["an incomplete policy listing", [appPage([exactPolicy], 1, 1, 2)], /conflicts with 1 derived|collected 1 items but total_count is 2/u],
];

for (const [label, pages, pattern] of policyListingFailures) {
  test(`phase 8 stops before any exposure on ${label} in the Access policy listing`, async () => {
    const { listAccessApplicationPolicies } = await policyListing(pages);
    await assertPhase8StopsWithoutExposure({ api: baseApi({ listAccessApplicationPolicies }) }, pattern);
  });
}
