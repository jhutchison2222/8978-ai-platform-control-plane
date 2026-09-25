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
    async getAccountWorkersSubdomain() { return { subdomain: "jhutchison" }; },
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

// ------------------------------------------------- Access precedence (B1) ---

const TARGET_HOST = "8978-ai-control-plane-dev.jhutchison.workers.dev";

function otherApp(patch) {
  return { id: "other-app", name: "Unrelated application", type: "self_hosted", ...patch };
}

// Runs phase 8 against the supplied API and asserts it stopped before any POST or canary request.
async function assertStopsBeforePost(api, pattern) {
  let canaryCalls = 0;
  const service = new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { canaryCalls += 1; return new Response("{}"); } });
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
  const service = new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
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
  const service = new CloudflareAdminV7Service({ api: unrelated, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
  await assert.rejects(() => service.enableSubdomainAndRunCanary(enableInput()), /canary reached/u);
});

test("enablement stops before the POST when the expected Access application enables options_preflight_bypass", async () => {
  for (const value of [true, "true", 1]) {
    const api = baseApi({ async listAccessApplications() { return [{ ...accessApp(), options_preflight_bypass: value }]; } });
    await assertStopsBeforePost(api, /must not enable options_preflight_bypass/u);
  }
  for (const value of [false, undefined, null]) {
    const api = baseApi({ async listAccessApplications() { return [{ ...accessApp(), options_preflight_bypass: value }]; } });
    const service = new CloudflareAdminV7Service({ api, custodian: custodianStub(), canaryFetch: async () => { throw new Error("canary reached"); } });
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
