import test from "node:test";
import assert from "node:assert/strict";
import {
  CEILING_WARNING_THRESHOLD,
  CLOUDFLARE_ADMIN_V7,
  MAXIMUM_LISTING_PAGES,
  WRITE_APPROVALS,
  assertPinnedTarget,
  collectPagedResults,
  requireExactApproval,
} from "../src/cloudflare-admin-v7-contracts.js";
import { CloudflareAdminV7Api } from "../src/cloudflare-admin-v7-api.js";
import { ManagedSecretCredentialCustodian } from "../src/cloudflare-admin-v7-custodian.js";
import { redactSensitive, secretMetadataOnly } from "../src/cloudflare-admin-v7-redaction.js";
import { CloudflareAdminV7Service } from "../src/cloudflare-admin-v7-service.js";
import { BootstrapVerificationStop, assertNoCustomDomains } from "../scripts/verify-development-worker-bootstrap.js";

function response(result, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, result }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const WORKER_ID = "7d8fe11595134e5980a2c888a805ff03";
const TARGET_COMMIT = CLOUDFLARE_ADMIN_V7.targetWorkerCommit;
const TARGET_CONFIG_SHA = CLOUDFLARE_ADMIN_V7.targetConfigurationSha256;

// Worker identity and zero-surface reads every post-bootstrap mock needs.
const workerIdentityMocks = {
  async listWorkers() { return [{ name: CLOUDFLARE_ADMIN_V7.workerName, id: WORKER_ID }]; },
  async getWorkerById() { return { id: WORKER_ID, name: CLOUDFLARE_ADMIN_V7.workerName }; },
  async listWorkerScripts() { return [{ id: CLOUDFLARE_ADMIN_V7.workerName, tag: WORKER_ID }]; },
  async getWorkerSubdomain() { return { enabled: false, previews_enabled: false }; },
  async getAccountWorkersSubdomain() { return { subdomain: "jhutchison" }; },
  async listWorkerDomains() { return { success: true, result: [], result_info: { page: 1, per_page: 20, count: 0, total_count: 0, total_pages: 0 } }; },
};

const FUTURE_EXPIRY = "2099-01-01T00:00:00Z";
const CLOCK = () => new Date("2026-09-25T00:00:00Z");

const custodyMocks = {
  async store() { return { receiptId: "managed-secret:" + CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName, custodian: "connector" }; },
  async confirmCustody() { return { confirmed: true }; },
};

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
  const latestVersionUrl =
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ADMIN_V7.accountId}/workers/scripts/${CLOUDFLARE_ADMIN_V7.workerName}/versions/latest`;
  await api.listWorkerSecrets();
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].url.includes(CLOUDFLARE_ADMIN_V7.accountId), true);
  await api.getLatestWorkerVersion();
  assert.equal(requests[1].init.method, "GET");
  assert.equal(requests[1].url, latestVersionUrl);
  await api.createServiceAuthVersion("{}", "a".repeat(40), "b".repeat(64));
  assert.equal(requests[2].url, latestVersionUrl);
  assert.equal(requests[2].init.method, "PATCH");
  assert.equal(requests[2].init.headers.get("content-type"), "application/merge-patch+json");
  assert.equal(requests.some(({ url }) => url.includes("/workers/workers/")), false);
});

// Mirrors the bug found and fixed in the owner-run Phase 2 verifier: CLOUDFLARE_ADMIN_API_TOKEN is
// required to be an Account API Token, which Cloudflare verifies at the account-owned endpoint, not
// the user-token endpoint. No existing test exercised verifyIdentity()'s real request URL; every
// other test mocks the whole function at the service level. This is the one that would have caught
// the same class of bug here.
test("verifyIdentity() checks credential status at the account-owned-token endpoint, never the user-token endpoint", async () => {
  const requests = [];
  const api = new CloudflareAdminV7Api({
    apiToken: "x".repeat(30),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/tokens/verify")) return response({ id: "token-id", status: "active" });
      return response({ id: CLOUDFLARE_ADMIN_V7.accountId, name: "account" });
    },
  });
  const identity = await api.verifyIdentity();
  assert.equal(requests[0].url, `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ADMIN_V7.accountId}/tokens/verify`);
  assert.equal(requests.some(({ url }) => url.includes("/user/tokens/verify")), false);
  assert.equal(identity.tokenStatus, "active");
  assert.equal(identity.account.id, CLOUDFLARE_ADMIN_V7.accountId);
});

// Raises the fail-closed completeness ceiling for each unfiltered Access listing from 5,000 to
// 100,000 (MAXIMUM_LISTING_PAGES * per_page) by using Cloudflare's documented maximum per_page for
// each endpoint, with no change to pagination completeness or safety: every listing still fails
// closed, never a silent partial/false pass, past its (now much higher) ceiling.
test("every unfiltered Access listing uses Cloudflare's documented maximum per_page", async () => {
  const requests = [];
  const api = new CloudflareAdminV7Api({
    apiToken: "x".repeat(30),
    fetchImpl: async (url, init) => {
      requests.push(String(url));
      return response([], 200);
    },
  });
  // Each call is expected to reject (the stub response carries no result_info), since only the
  // exact request URL each one issued is under test here.
  for (const call of [
    () => api.listAccessApplications(),
    () => api.listAccessServiceTokens(),
    () => api.listAccessApplicationPolicies("12345678-1234-1234-1234-123456789abc"),
  ]) {
    await call().catch(() => {});
  }
  for (const url of requests) assert.match(url, /[?&]per_page=1000(&|$)/u, `${url} must use the documented maximum per_page`);
  assert.equal(MAXIMUM_LISTING_PAGES * 1000, 100000);
});

// An early, non-blocking capacity signal: once a listing's derived page count reaches
// CEILING_WARNING_THRESHOLD of the fail-closed ceiling, operators get notice well before it
// actually becomes unprovable. The listing still completes normally either way.
// A real, fully consistent multi-page generator: each requested page returns exactly the items
// that belong on it, so collectPagedResults can genuinely paginate through to completion.
function fixedPage(totalCount, perPage) {
  const totalPages = Math.ceil(totalCount / perPage) || 1;
  return async (page) => {
    const start = (page - 1) * perPage;
    const count = Math.max(0, Math.min(perPage, totalCount - start));
    const items = Array.from({ length: count }, (_, index) => ({ id: `item-${start + index}` }));
    return { success: true, result: items, result_info: { page, per_page: perPage, count: items.length, total_count: totalCount, total_pages: totalPages } };
  };
}

test("collectPagedResults warns, without failing, once a listing approaches its fail-closed ceiling", async () => {
  const warnings = [];
  const totalPages = Math.ceil(MAXIMUM_LISTING_PAGES * CEILING_WARNING_THRESHOLD);
  const result = await collectPagedResults(fixedPage(totalPages * 10, 10), "test listing", {
    onApproachingCeiling: (message) => warnings.push(message),
  });
  assert.equal(result.length, totalPages * 10, "the listing still completes fully despite the warning");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(`requires ${totalPages} of a maximum ${MAXIMUM_LISTING_PAGES} pages`));
});

test("collectPagedResults isolates synchronous and asynchronous warning callback failures", async () => {
  const totalPages = Math.ceil(MAXIMUM_LISTING_PAGES * CEILING_WARNING_THRESHOLD);
  for (const onApproachingCeiling of [
    () => { throw new Error("synchronous reporting failure"); },
    async () => { throw new Error("asynchronous reporting failure"); },
  ]) {
    const result = await collectPagedResults(fixedPage(totalPages * 10, 10), "test listing", {
      onApproachingCeiling,
    });
    assert.equal(result.length, totalPages * 10, "advisory callback failures must not affect listing completion");
  }
});

test("collectPagedResults stays silent well below the ceiling", async () => {
  const warnings = [];
  await collectPagedResults(fixedPage(5, 10), "test listing", {
    onApproachingCeiling: (message) => warnings.push(message),
  });
  assert.equal(warnings.length, 0);
});

test("collectPagedResults never warns on a listing it ultimately rejects as exceeding the ceiling", async () => {
  const warnings = [];
  await assert.rejects(
    () => collectPagedResults(fixedPage((MAXIMUM_LISTING_PAGES + 1) * 10, 10), "test listing", {
      onApproachingCeiling: (message) => warnings.push(message),
    }),
    /did not terminate within \d+ pages/u,
  );
  assert.equal(warnings.length, 0, "a listing that fails closed is reported by its own error, not a warning");
});

test("collectPagedResults warns through console.warn by default when no callback is supplied", async () => {
  const originalWarn = console.warn;
  const captured = [];
  console.warn = (message) => captured.push(message);
  try {
    // maximumPages=5, threshold 0.8 -> warning zone starts at ceil(5*0.8)=4 pages.
    await collectPagedResults(fixedPage(4 * 10, 10), "default-callback listing", { maximumPages: 5 });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(captured.length, 1);
  assert.match(captured[0], /default-callback listing requires 4 of a maximum 5 pages/u);
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
  assert.deepEqual(redactSensitive({ bindings: [
    { name: "CONTROL_PLANE_MODE", type: "plain_text", text: "development" },
    { name: "SERVICE_AUTH_KEYS_JSON", type: "secret_text", text: "must-not-escape" },
  ] }), { bindings: [
    { name: "CONTROL_PLANE_MODE", type: "plain_text", text: "development" },
    { name: "SERVICE_AUTH_KEYS_JSON", type: "secret_text", text: "[REDACTED]" },
  ] });
});

test("preflight proves exact resource identities, no Queue consumer, and required bindings", async () => {
  const service = new CloudflareAdminV7Service({
    api: {
      ...workerIdentityMocks,
      async verifyIdentity() { return { tokenStatus: "active", account: { id: CLOUDFLARE_ADMIN_V7.accountId } }; },
      async getD1Database() { return { uuid: CLOUDFLARE_ADMIN_V7.d1Id, name: CLOUDFLARE_ADMIN_V7.d1Name }; },
      async getWorkerSettings() { return { bindings: [
        { name: "AUTHORITY_DB", type: "d1", id: CLOUDFLARE_ADMIN_V7.d1Id },
        { name: "ORCHESTRATOR_QUEUE", type: "queue", queue_name: CLOUDFLARE_ADMIN_V7.queueName },
        {
          name: "ORCHESTRATOR_WORKFLOW",
          type: "workflow",
          workflow_name: CLOUDFLARE_ADMIN_V7.workflowName,
          class_name: CLOUDFLARE_ADMIN_V7.workflowClass,
          script_name: CLOUDFLARE_ADMIN_V7.workerName,
        },
        { name: "CONTROL_PLANE_MODE", type: "plain_text", text: "development" },
        { name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text", text: "not-returned" },
      ] }; },
      async listWorkerDeployments() { return { deployments: [
        { id: "deployment-id", created_on: "2026-09-17T20:00:00Z", author_email: "operator@example.invalid", source: "api" },
      ], latest: { id: "deployment-id" } }; },
      async listQueues() { return [{ queue_id: "queue-id", queue_name: CLOUDFLARE_ADMIN_V7.queueName, consumers_total_count: 0 }]; },
      async listWorkflows() { return [{ id: "workflow-id", name: CLOUDFLARE_ADMIN_V7.workflowName, class_name: CLOUDFLARE_ADMIN_V7.workflowClass, script_name: CLOUDFLARE_ADMIN_V7.workerName }]; },
      async listAccessApplications() { return [
        { id: "worker-app", name: CLOUDFLARE_ADMIN_V7.accessApplicationName, type: "self_hosted", destinations: [{ type: "worker", worker_id: WORKER_ID }], policies: ["internal"] },
        { id: "unrelated-app", name: "production admin", type: "self_hosted", destinations: [{ type: "public", uri: "admin.example.com" }] },
        { id: "other-worker-app", name: "other worker", type: "self_hosted", destinations: [{ type: "worker", worker_id: "f".repeat(32) }] },
      ]; },
      async listWorkerSecrets() { return [{ name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text", text: "not-returned" }]; },
    },
  });
  const result = await service.preflight();
  // Read scope sees only the Worker-level application for the verified Worker ID, with metadata fields only.
  assert.deepEqual(result.access, [
    { id: "worker-app", name: CLOUDFLARE_ADMIN_V7.accessApplicationName, type: "self_hosted", destinations: [{ type: "worker", worker_id: WORKER_ID }] },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /unrelated-app|production admin|admin\.example\.com|other-worker-app/u);
  assert.equal(result.target.workflow.name, CLOUDFLARE_ADMIN_V7.workflowName);
  assert.equal(result.target.queue.id, "queue-id");
  assert.equal(result.worker.bindings.some(({ type }) => type === "secret_text"), false);
  assert.equal(result.worker.bindings.find(({ name }) => name === "CONTROL_PLANE_MODE").text, "development");
  assert.deepEqual(result.worker.deployments, [{
    id: "deployment-id",
    created_on: "2026-09-17T20:00:00Z",
    author_email: "operator@example.invalid",
    source: "api",
  }]);
  assert.deepEqual(result.worker.secretMetadata, [{ name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }]);
});

// ------------------------------------ Review B3-C: documented single-response Custom Domains ---
// GET /accounts/{account_id}/workers/domains?service=<workerName> is documented as one response with
// no page parameters; result_info is optional and total_count may be unfiltered.

const DOMAIN_INFO = { page: 1, per_page: 20, count: 0, total_count: 0, total_pages: 0 };
const domainEnvelope = (result, info = DOMAIN_INFO) => ({ success: true, errors: [], messages: [], result, result_info: info });
const bareEnvelope = (result) => ({ success: true, errors: [], messages: [], result });
const targetDomain = { id: "domain-1", hostname: "x.example.com", service: CLOUDFLARE_ADMIN_V7.workerName };
const unrelatedDomain = { id: "domain-2", hostname: "y.example.com", service: "another-worker" };

// Every decision the shared rule makes: [label, envelope, expected error or null for acceptance].
const DOMAIN_CASES = [
  // Legitimate no-result responses are accepted.
  ["an empty result with no result_info", bareEnvelope([]), null],
  ["an empty result with only success and result", { success: true, result: [] }, null],
  ["an empty result with internally consistent result_info", domainEnvelope([]), null],
  ["an empty result with nonzero total_count but count 0", domainEnvelope([], { page: 1, per_page: 20, count: 0, total_count: 2000, total_pages: 100 }), null],
  ["an empty result with an empty result_info object", domainEnvelope([], {}), null],
  ["an empty result with count only", domainEnvelope([], { count: 0 }), null],
  // Every non-empty result is refused.
  ["a target-Worker domain returned", domainEnvelope([targetDomain], { ...DOMAIN_INFO, count: 1 }), /Custom Domain is attached/u],
  ["a target-Worker domain returned without result_info", bareEnvelope([targetDomain]), /Custom Domain is attached/u],
  ["a target-Worker domain alongside another Worker's", domainEnvelope([unrelatedDomain, targetDomain], { ...DOMAIN_INFO, count: 2 }), /Custom Domain is attached/u],
  ["another Worker's domain returned despite the filter", domainEnvelope([unrelatedDomain], { ...DOMAIN_INFO, count: 1 }), /service filter was not honored/u],
  ["another Worker's domain returned without result_info", bareEnvelope([unrelatedDomain]), /service filter was not honored/u],
  ["a record without a service returned", bareEnvelope([{ id: "domain-4", hostname: "w.example.com" }]), /service filter was not honored/u],
  // Malformed or contradictory envelopes are refused.
  ["a missing result", { success: true, errors: [], messages: [], result_info: DOMAIN_INFO }, /did not return a result list/u],
  ["a result that is not an array", { ...bareEnvelope([]), result: { service: "another-worker" } }, /did not return a result list/u],
  ["a null result", { ...bareEnvelope([]), result: null }, /did not return a result list/u],
  ["success false", { ...bareEnvelope([]), success: false }, /did not report success/u],
  ["a missing success flag", { result: [] }, /did not report success/u],
  ["a string success flag", { ...bareEnvelope([]), success: "true" }, /did not report success/u],
  ["success alongside errors", { ...bareEnvelope([]), errors: [{ code: 1000, message: "failure" }] }, /alongside errors/u],
  ["malformed errors", { ...bareEnvelope([]), errors: "none" }, /alongside errors/u],
  ["an envelope that is a list", [], /did not return a response envelope/u],
  ["a null envelope", null, /did not return a response envelope/u],
  ["result_info as a list", domainEnvelope([], []), /result_info that is not an object/u],
  ["result_info as null", domainEnvelope([], null), /result_info that is not an object/u],
  ["result_info as a string", domainEnvelope([], "page 1"), /result_info that is not an object/u],
  ["a string count", domainEnvelope([], { ...DOMAIN_INFO, count: "0" }), /reported count 0 for 0 returned records/u],
  ["a fractional count", domainEnvelope([], { ...DOMAIN_INFO, count: 0.5 }), /reported count 0\.5 for 0 returned records/u],
  ["a negative count", domainEnvelope([], { ...DOMAIN_INFO, count: -1 }), /reported count -1 for 0 returned records/u],
  ["a null count", domainEnvelope([], { ...DOMAIN_INFO, count: null }), /reported count null for 0 returned records/u],
  ["a count that does not equal the returned records", domainEnvelope([], { ...DOMAIN_INFO, count: 1 }), /reported count 1 for 0 returned records/u],
  ["a page other than 1", domainEnvelope([], { ...DOMAIN_INFO, page: 2 }), /reported page 2 for a single-response listing/u],
  ["a string page", domainEnvelope([], { ...DOMAIN_INFO, page: "1" }), /reported page 1 for a single-response listing/u],
  ["a zero per_page", domainEnvelope([], { ...DOMAIN_INFO, per_page: 0 }), /malformed per_page/u],
  ["a string per_page", domainEnvelope([], { ...DOMAIN_INFO, per_page: "20" }), /malformed per_page/u],
  ["a string total_count", domainEnvelope([], { ...DOMAIN_INFO, total_count: "0" }), /malformed total_count/u],
  ["a negative total_count", domainEnvelope([], { ...DOMAIN_INFO, total_count: -1 }), /malformed total_count/u],
  ["a fractional total_pages", domainEnvelope([], { ...DOMAIN_INFO, total_pages: 1.5 }), /malformed total_pages/u],
  ["a null total_pages", domainEnvelope([], { ...DOMAIN_INFO, total_pages: null }), /malformed total_pages/u],
];

function preflightApi(domains) {
  return {
    ...workerIdentityMocks,
    async verifyIdentity() { return {}; },
    async getD1Database() { return { uuid: CLOUDFLARE_ADMIN_V7.d1Id, name: CLOUDFLARE_ADMIN_V7.d1Name }; },
    async getWorkerSettings() { return { bindings: [
      { name: "AUTHORITY_DB", type: "d1", id: CLOUDFLARE_ADMIN_V7.d1Id },
      { name: "ORCHESTRATOR_QUEUE", type: "queue", queue_name: CLOUDFLARE_ADMIN_V7.queueName },
      { name: "ORCHESTRATOR_WORKFLOW", type: "workflow", workflow_name: CLOUDFLARE_ADMIN_V7.workflowName, class_name: CLOUDFLARE_ADMIN_V7.workflowClass, script_name: CLOUDFLARE_ADMIN_V7.workerName },
    ] }; },
    async listWorkerDeployments() { return []; },
    async listQueues() { return [{ queue_name: CLOUDFLARE_ADMIN_V7.queueName, consumers_total_count: 0 }]; },
    async listWorkflows() { return [{ name: CLOUDFLARE_ADMIN_V7.workflowName, class_name: CLOUDFLARE_ADMIN_V7.workflowClass, script_name: CLOUDFLARE_ADMIN_V7.workerName }]; },
    async listAccessApplications() { return []; },
    async listWorkerSecrets() { return []; },
    async listWorkerDomains() { return domains; },
  };
}

test("pre-bootstrap preflight returns no Access applications from the account-wide listing", async () => {
  const result = await new CloudflareAdminV7Service({
    api: {
      ...preflightApi(null),
      async listWorkers() { return []; },
      async listAccessApplications() { return [
        { id: "unrelated-app", name: "production admin", type: "self_hosted", destinations: [{ type: "public", uri: "admin.example.com" }] },
        { id: "other-worker-app", name: "other worker", type: "self_hosted", destinations: [{ type: "worker", worker_id: "f".repeat(32) }] },
      ]; },
    },
  }).preflight();
  assert.equal(result.phase, "pre_bootstrap");
  assert.deepEqual(result.access, []);
  assert.doesNotMatch(JSON.stringify(result), /unrelated-app|production admin|admin\.example\.com|other-worker-app/u);
});

test("the connector requests Worker domains with the documented service filter and keeps the full envelope", async () => {
  const requests = [];
  const body = domainEnvelope([]);
  const api = new CloudflareAdminV7Api({
    apiToken: "x".repeat(30),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init.method });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(await api.listWorkerDomains(), body);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ADMIN_V7.accountId}/workers/domains?service=${CLOUDFLARE_ADMIN_V7.workerName}`);
});

test("unrelated domains cause no false positive when the service filter is honored", async () => {
  const dataset = [unrelatedDomain, { id: "domain-3", hostname: "z.example.com", service: "third-worker" }];
  const api = new CloudflareAdminV7Api({
    apiToken: "x".repeat(30),
    fetchImpl: async (url) => {
      const service = new URL(url).searchParams.get("service");
      const result = dataset.filter((record) => record.service === service);
      return new Response(JSON.stringify(domainEnvelope(result, { ...DOMAIN_INFO, count: result.length, total_count: result.length })), { status: 200 });
    },
  });
  const result = await new CloudflareAdminV7Service({ api: { ...preflightApi(null), listWorkerDomains: () => api.listWorkerDomains() } }).preflight();
  assert.deepEqual(result.worker.customDomains, []);
});

test("the real adapter accepts documented zero-result bodies without result_info or with an unfiltered total_count", async () => {
  const dataset = [unrelatedDomain, { id: "domain-3", hostname: "z.example.com", service: "third-worker" }];
  const bodies = {
    "no result_info": (result) => bareEnvelope(result),
    "unfiltered total_count": (result) => domainEnvelope(result, { page: 1, per_page: 20, count: result.length, total_count: dataset.length, total_pages: 1 }),
  };
  for (const [label, shape] of Object.entries(bodies)) {
    const requests = [];
    const api = new CloudflareAdminV7Api({
      apiToken: "x".repeat(30),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), method: init.method });
        const result = dataset.filter((record) => record.service === new URL(url).searchParams.get("service"));
        return new Response(JSON.stringify(shape(result)), { status: 200 });
      },
    });
    const result = await new CloudflareAdminV7Service({ api: { ...preflightApi(null), listWorkerDomains: () => api.listWorkerDomains() } }).preflight();
    assert.equal(result.mode, "development-read-only", label);
    assert.deepEqual(requests, [{
      url: `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ADMIN_V7.accountId}/workers/domains?service=${CLOUDFLARE_ADMIN_V7.workerName}`,
      method: "GET",
    }], `${label}: exactly one filtered GET, with no invented pagination parameters`);
  }
});

test("the real adapter fails closed when Cloudflare ignores the service filter", async () => {
  const api = new CloudflareAdminV7Api({
    apiToken: "x".repeat(30),
    fetchImpl: async () => new Response(JSON.stringify(bareEnvelope([unrelatedDomain])), { status: 200 }),
  });
  await assert.rejects(
    () => new CloudflareAdminV7Service({ api: { ...preflightApi(null), listWorkerDomains: () => api.listWorkerDomains() } }).preflight(),
    /service filter was not honored/u,
  );
});

// Records every adapter method the preflight calls, so acceptance is proven to be read-only.
function recordingPreflightApi(domains) {
  const called = [];
  const api = new Proxy(preflightApi(domains), {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args) => { called.push(String(property)); return value.apply(target, args); };
    },
  });
  return { api, called };
}

for (const [label, domains, expected] of DOMAIN_CASES) {
  test(`connector preflight and bootstrap verifier decide identically on ${label}`, async () => {
    const { api, called } = recordingPreflightApi(domains);
    const service = new CloudflareAdminV7Service({ api });
    const connector = await service.preflight().then((value) => ({ value }), (error) => ({ error }));
    const verifier = (() => { try { return { value: assertNoCustomDomains(domains) }; } catch (error) { return { error }; } })();
    assert.ok(called.includes("listWorkerDomains"), "the decision is made on the Custom Domain listing");
    assert.ok(called.every((name) => /^(get|list|verify)[A-Z]/u.test(name)), `preflight called only read methods: ${called.join(", ")}`);
    if (expected === null) {
      assert.equal(connector.error, undefined);
      assert.equal(connector.value.ok, true);
      assert.equal(connector.value.mode, "development-read-only");
      assert.equal(verifier.error, undefined);
      assert.equal(verifier.value, 0);
    } else {
      assert.match(connector.error?.message ?? "", expected);
      assert.ok(verifier.error instanceof BootstrapVerificationStop);
      assert.equal(verifier.error.message, connector.error.message, "the verifier and connector must share one fail-closed rule");
    }
  });
}

test("preflight rejects drifted Worker binding targets", async () => {
  const validBindings = [
    { name: "AUTHORITY_DB", type: "d1", id: CLOUDFLARE_ADMIN_V7.d1Id },
    { name: "ORCHESTRATOR_QUEUE", type: "queue", queue_name: CLOUDFLARE_ADMIN_V7.queueName },
    {
      name: "ORCHESTRATOR_WORKFLOW",
      type: "workflow",
      workflow_name: CLOUDFLARE_ADMIN_V7.workflowName,
      class_name: CLOUDFLARE_ADMIN_V7.workflowClass,
      script_name: CLOUDFLARE_ADMIN_V7.workerName,
    },
  ];
  let bindings = validBindings;
  const api = {
    ...workerIdentityMocks,
    async verifyIdentity() { return {}; },
    async getD1Database() { return { uuid: CLOUDFLARE_ADMIN_V7.d1Id, name: CLOUDFLARE_ADMIN_V7.d1Name }; },
    async getWorkerSettings() { return { bindings }; },
    async listWorkerDeployments() { return { deployments: [] }; },
    async listQueues() { return [{ queue_name: CLOUDFLARE_ADMIN_V7.queueName, consumers_total_count: 0 }]; },
    async listWorkflows() { return [{
      name: CLOUDFLARE_ADMIN_V7.workflowName,
      class_name: CLOUDFLARE_ADMIN_V7.workflowClass,
      script_name: CLOUDFLARE_ADMIN_V7.workerName,
    }]; },
    async listAccessApplications() { return []; },
    async listWorkerSecrets() { return []; },
  };
  const service = new CloudflareAdminV7Service({ api });
  const driftCases = [
    ["AUTHORITY_DB", { id: "wrong-database-id" }],
    ["ORCHESTRATOR_QUEUE", { queue_name: "wrong-queue" }],
    ["ORCHESTRATOR_WORKFLOW", { workflow_name: "wrong-workflow" }],
    ["ORCHESTRATOR_WORKFLOW", { class_name: "WrongWorkflowClass" }],
    ["ORCHESTRATOR_WORKFLOW", { script_name: "wrong-worker" }],
  ];
  for (const [name, drift] of driftCases) {
    bindings = validBindings.map((binding) => binding.name === name ? { ...binding, ...drift } : binding);
    await assert.rejects(() => service.preflight(), new RegExp(`${name} binding identity is missing`));
  }
});

test("preflight stops on a Queue consumer or Workflow association drift", async () => {
  const base = {
    ...workerIdentityMocks,
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
  let created = null;
  let custodyInput;
  const api = {
    ...workerIdentityMocks,
    async listAccessServiceTokens() { return created ? [{ id: created.id, name: created.name }] : []; },
    // The documented creation response carries no expires_at.
    async createAccessServiceToken(hours) {
      assert.equal(hours, 24);
      created = { id: "token-id", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, client_id: "client-" + "fixture", client_secret: "secret-" + "fixture", duration: "24h", enabled: true };
      return created;
    },
    async getAccessServiceToken(id) {
      return { id, name: created.name, client_id: created.client_id, enabled: true, duration: "24h", expires_at: FUTURE_EXPIRY };
    },
  };
  const custodian = {
    async store(kind, value) { custodyInput = { kind, value }; return { receiptId: "receipt-123", custodian: "managed" }; },
    async confirmCustody(kind) { assert.equal(kind, "access-service-token"); return { confirmed: true }; },
  };
  const service = new CloudflareAdminV7Service({ api, custodian, now: CLOCK });
  await assert.rejects(() => service.createServiceToken({ approval: "yes" }), /Exact approval required/);
  const result = await service.createServiceToken({ approval: WRITE_APPROVALS.createServiceToken });
  assert.ok(created);
  assert.equal(custodyInput.value.clientSecret, "secret-fixture");
  assert.equal(custodyInput.value.expiresAt, FUTURE_EXPIRY);
  assert.doesNotMatch(JSON.stringify(result), /client-fixture|secret-fixture/);

  api.listAccessServiceTokens = async () => [{ id: "existing", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }];
  await assert.rejects(() => service.createServiceToken({ approval: WRITE_APPROVALS.createServiceToken }), /automatic retry is prohibited/);
});

test("service-token partial custody failure stops without exposing the returned secret", async () => {
  let created = false;
  const service = new CloudflareAdminV7Service({
    now: CLOCK,
    api: {
      ...workerIdentityMocks,
      async listAccessServiceTokens() { return created ? [{ id: "token-id", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }] : []; },
      async createAccessServiceToken() {
        created = true;
        return { id: "token-id", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, client_id: "client-" + "fixture", client_secret: "secret-" + "fixture" };
      },
      async getAccessServiceToken() {
        return { id: "token-id", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, client_id: "client-" + "fixture", enabled: true, expires_at: FUTURE_EXPIRY };
      },
    },
    custodian: { ...custodyMocks, async store() { throw new Error("storage failed with secret-fixture"); } },
  });
  await assert.rejects(
    () => service.createServiceToken({ approval: WRITE_APPROVALS.createServiceToken }),
    (error) => /credential custody was not confirmed; partial state requires owner review/.test(error.message) && !/secret-fixture/.test(error.message),
  );
});

test("the exact service-token read uses the documented GET by immutable ID", async () => {
  const requests = [];
  const token = { id: "12345678-1234-1234-1234-123456789abc", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, client_id: "c", enabled: true, expires_at: FUTURE_EXPIRY };
  const api = new CloudflareAdminV7Api({
    apiToken: "x".repeat(30),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init.method });
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: token }), { status: 200 });
    },
  });
  assert.deepEqual(await api.getAccessServiceToken(token.id), token);
  assert.deepEqual(requests, [{ url: `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ADMIN_V7.accountId}/access/service_tokens/${token.id}`, method: "GET" }]);
  await assert.rejects(() => api.getAccessServiceToken("../apps"), /service-token ID is invalid/u);
  assert.equal(requests.length, 1);
});

test("Access protection creates a Worker-level application pinned to the immutable Worker ID", async () => {
  let policyInput;
  let created = null;
  const token = { id: "12345678-1234-1234-1234-123456789abc", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName };
  const service = new CloudflareAdminV7Service({
    api: {
      ...workerIdentityMocks,
      async listAccessServiceTokens() { return [token]; },
      async listAccessApplications() { return created ? [created] : []; },
      async createAccessApplication(workerId) {
        created = {
          id: "abcdefab-1234-1234-1234-abcdefabcdef",
          name: CLOUDFLARE_ADMIN_V7.accessApplicationName,
          type: "self_hosted",
          destinations: [{ type: "worker", worker_id: workerId }],
        };
        return created;
      },
      async createAccessServiceTokenPolicy(appId, tokenId) { policyInput = { appId, tokenId }; return { id: "policy-id", decision: "non_identity" }; },
      async listAccessApplicationPolicies() {
        return [{ id: "policy-id", decision: "non_identity", include: [{ service_token: { token_id: token.id } }], exclude: [], require: [] }];
      },
    },
  });
  const result = await service.ensureAccessProtection({
    approval: WRITE_APPROVALS.ensureAccess,
    serviceTokenId: token.id,
    workerId: WORKER_ID,
  });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.workerId, WORKER_ID);
  // The destination pins the Worker itself, never a single hostname.
  assert.deepEqual(result.application.destinations, [{ type: "worker", worker_id: WORKER_ID }]);
  assert.deepEqual(policyInput, { appId: "abcdefab-1234-1234-1234-abcdefabcdef", tokenId: token.id });
});

test("Access protection confirms one exact Service Auth policy and rejects a broader policy state", async () => {
  const token = { id: "12345678-1234-1234-1234-123456789abc", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName };
  const app = {
    id: "abcdefab-1234-1234-1234-abcdefabcdef",
    name: CLOUDFLARE_ADMIN_V7.accessApplicationName,
    type: "self_hosted",
    destinations: [{ type: "worker", worker_id: WORKER_ID }],
  };
  const api = {
    ...workerIdentityMocks,
    async listAccessServiceTokens() { return [token]; },
    async listAccessApplications() { return [app]; },
    async listAccessApplicationPolicies() {
      return [{ id: "policy", decision: "non_identity", include: [{ service_token: { token_id: token.id } }], exclude: [], require: [] }];
    },
  };
  const service = new CloudflareAdminV7Service({ api });
  const confirmed = await service.ensureAccessProtection({ approval: WRITE_APPROVALS.ensureAccess, serviceTokenId: token.id, workerId: WORKER_ID });
  assert.equal(confirmed.created, false);
  api.listAccessApplicationPolicies = async () => [
    { id: "policy", decision: "non_identity", include: [{ service_token: { token_id: token.id } }], exclude: [], require: [] },
    { id: "broader", decision: "allow", include: [{ everyone: {} }] },
  ];
  await assert.rejects(
    () => service.ensureAccessProtection({ approval: WRITE_APPROVALS.ensureAccess, serviceTokenId: token.id, workerId: WORKER_ID }),
    /exactly one Service Auth policy/,
  );
});

test("managed-secret custodian stores the Access credential without returning it", async () => {
  let installed;
  const credential = { tokenId: "token-id", target: CLOUDFLARE_ADMIN_V7.workerUrl, clientId: "client-" + "fixture", clientSecret: "secret-" + "fixture", expiresAt: FUTURE_EXPIRY };
  const env = {};
  const custodian = new ManagedSecretCredentialCustodian({ async installConnectorAccessCredential(value) { installed = value; } }, env, { now: CLOCK });
  const receipt = await custodian.store("access-service-token", credential);
  assert.doesNotMatch(JSON.stringify(receipt), /client-fixture|secret-fixture/);
  env[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName] = installed;
  assert.deepEqual(await custodian.readAccessCredential(receipt.receiptId, { tokenId: "token-id", now: CLOCK() }), { clientId: "client-fixture", clientSecret: "secret-fixture" });
  // The stored credential is bound to the account, Worker, target, and exact service-token ID.
  assert.deepEqual(
    Object.keys(JSON.parse(installed)).sort(),
    ["accountId", "clientId", "clientSecret", "expiresAt", "target", "tokenId", "workerName"],
  );
  await assert.rejects(() => custodian.readAccessCredential(receipt.receiptId, { tokenId: "another-token", now: CLOCK() }), /different Access service-token ID/);
  await assert.rejects(() => custodian.readAccessCredential("managed-secret:WRONG"), /pinned managed secret/);
});

test("activation unwraps the Cloudflare deployment envelope and refuses an already deployed reviewed version", async () => {
  const reviewed = {
    reviewedCommit: TARGET_COMMIT,
    configurationSha256: TARGET_CONFIG_SHA,
    versionId: "12345678-1234-1234-1234-123456789abc",
  };
  let laterReads = 0;
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: reviewed,
    api: {
      ...workerIdentityMocks,
      async listWorkerDeployments() {
        return {
          deployments: [{ id: "deployment-id", versions: [{ version_id: reviewed.versionId, percentage: 100 }] }],
          latest: { id: "deployment-id" },
        };
      },
      async getWorkerVersion() { laterReads += 1; },
      async getLatestWorkerVersion() { laterReads += 1; },
    },
    custodian: { ...custodyMocks, async readAccessCredential() { laterReads += 1; } },
  });
  await assert.rejects(() => service.activateReviewedWorker({
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    ...reviewed,
  }), /already deployed/);
  assert.equal(laterReads, 0);
});

test("one-shot activation derives a secret-bearing version, deploys it, and validates five exact responses", async () => {
  const reviewed = { reviewedCommit: TARGET_COMMIT, configurationSha256: TARGET_CONFIG_SHA, versionId: "12345678-1234-1234-1234-123456789abc" };
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
  let subdomainEnabled = false;
  let subdomainPosts = 0;
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
      ...workerIdentityMocks,
      async getWorkerSubdomain() { return { enabled: subdomainEnabled, previews_enabled: false }; },
      async setWorkerSubdomain() { subdomainPosts += 1; subdomainEnabled = true; return { enabled: true, previews_enabled: false }; },
      async listAccessServiceTokens() { return [{ id: "12345678-1234-1234-1234-123456789abc", name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }]; },
      async listAccessApplications() {
        return [{
          id: "app-id",
          name: CLOUDFLARE_ADMIN_V7.accessApplicationName,
          type: "self_hosted",
          destinations: [{ type: "worker", worker_id: WORKER_ID }],
        }];
      },
      async listAccessApplicationPolicies() {
        return [{ id: "policy", decision: "non_identity", include: [{ service_token: { token_id: "12345678-1234-1234-1234-123456789abc" } }], exclude: [], require: [] }];
      },
      async listWorkerDeployments() {
        return deployed ? [{ id: "deployment-id", is_active: true, versions: [{ version_id: activatedVersionId, percentage: 100 }] }] : [];
      },
      async getWorkerVersion(id) {
        return id === reviewed.versionId
          ? { id, annotations: { "workers/message": `8978-reviewed:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` }, resources: baseResources }
          : {
            id,
            annotations: { "workers/message": `8978-activated:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` },
            resources: { ...baseResources, bindings: [...baseResources.bindings, { name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }] },
          };
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
    custodian: {
      ...custodyMocks,
      async readAccessCredential() { return { clientId: "access-" + "client", clientSecret: "access-" + "secret" }; },
      async readServiceAuthPrincipal() {
        const parsed = JSON.parse(installed);
        return { principalId: "development-canary-v1", keyId: "canary-2026-09-16", secret: parsed["development-canary-v1"]["canary-2026-09-16"] };
      },
    },
    canaryFetch: async (request) => {
      assert.equal(request.headers.get("cf-access-client-id"), "access-client");
      assert.equal(request.headers.get("cf-access-client-secret"), "access-secret");
      const [status, body] = replies[requestIndex++];
      return Response.json(body, { status });
    },
    now: () => new Date("2026-09-16T20:00:00Z"),
  });
  const activation = await service.activateReviewedWorker({
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    ...reviewed,
  });
  // Phase 7 ends unreachable: deployed at 100% with workers.dev and previews still disabled.
  assert.equal(requestIndex, 0);
  assert.equal(activation.reachable, false);
  assert.deepEqual(activation.subdomain, { enabled: false, previews_enabled: false });
  assert.deepEqual(deployed, { id: activatedVersionId, commit: reviewed.reviewedCommit });
  assert.equal(activation.deployment.baseReviewedVersionId, reviewed.versionId);
  assert.equal(activation.deployment.activatedVersionId, activatedVersionId);

  // Phase 8-10: one enablement POST, one read-back, then the five exact canary responses.
  const result = await service.enableSubdomainAndRunCanary({
    enableApproval: WRITE_APPROVALS.enableSubdomain,
    canaryApproval: WRITE_APPROVALS.runCanary,
    accessCredentialReceiptId: "managed-secret:" + CLOUDFLARE_ADMIN_V7.accessCredentialSecretName,
    serviceAuthReceiptId: "managed-secret:" + CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName,
    serviceTokenId: "12345678-1234-1234-1234-123456789abc",
    workerId: WORKER_ID,
    keyId: "canary-2026-09-16",
    activatedVersionId,
  });
  assert.equal(requestIndex, 5);
  assert.equal(result.evidence.length, 5);
  assert.equal(result.subdomainPosts, 1);
  assert.deepEqual(result.subdomain, { enabled: true, previews_enabled: false });
  const secret = JSON.parse(installed)["development-canary-v1"]["canary-2026-09-16"];
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(activation), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(result), /access-client|access-secret/);
});

test("canary stops after the first unexpected result and does not retry", async () => {
  const reviewed = { reviewedCommit: TARGET_COMMIT, configurationSha256: TARGET_CONFIG_SHA, versionId: "12345678-1234-1234-1234-123456789abc" };
  const activatedVersionId = "abcdefab-1234-1234-1234-abcdefabcdef";
  const baseResources = { bindings: [], script: { etag: "etag" }, script_runtime: { compatibility_date: "2026-09-16" } };
  let calls = 0;
  let activated = false;
  let deployedOnce = false;
  let subdomainEnabled = false;
  let subdomainPosts = 0;
  const tokenId = "12345678-1234-1234-1234-123456789abc";
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: reviewed,
    api: {
      ...workerIdentityMocks,
      async getWorkerSubdomain() { return { enabled: subdomainEnabled, previews_enabled: false }; },
      async setWorkerSubdomain() { subdomainPosts += 1; subdomainEnabled = true; return { enabled: true, previews_enabled: false }; },
      async listAccessServiceTokens() { return [{ id: tokenId, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName }]; },
      async listAccessApplications() { return [{ id: "app-id", name: CLOUDFLARE_ADMIN_V7.accessApplicationName, type: "self_hosted", destinations: [{ type: "worker", worker_id: WORKER_ID }] }]; },
      async listAccessApplicationPolicies() { return [{ id: "policy", decision: "non_identity", include: [{ service_token: { token_id: tokenId } }], exclude: [], require: [] }]; },
      async listWorkerDeployments() { return deployedOnce ? [{ id: "deployment-id", is_active: true, versions: [{ version_id: activatedVersionId, percentage: 100 }] }] : []; },
      async getWorkerVersion(id) {
        const prefix = id === reviewed.versionId ? "8978-reviewed" : "8978-activated";
        return {
          id,
          annotations: { "workers/message": `${prefix}:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` },
          resources: { ...baseResources, bindings: id === reviewed.versionId ? [] : [{ name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }] },
        };
      },
      async getLatestWorkerVersion() { return activated
        ? { id: activatedVersionId, annotations: { "workers/message": `8978-activated:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` } }
        : { id: reviewed.versionId, annotations: { "workers/message": `8978-reviewed:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` }, resources: baseResources }; },
      async listWorkerSecrets() { return []; },
      async createServiceAuthVersion() { activated = true; return { id: activatedVersionId }; },
      async createWorkerDeployment() { deployedOnce = true; return { id: "deployment-id", versions: [{ version_id: activatedVersionId, percentage: 100 }] }; },
    },
    custodian: {
      ...custodyMocks,
      async readAccessCredential() { return { clientId: "client", clientSecret: "secret" }; },
      async readServiceAuthPrincipal() { return { principalId: "development-canary-v1", keyId: "canary-2026-09-16", secret: "s".repeat(43) }; },
    },
    canaryFetch: async () => { calls += 1; return Response.json({ unexpected: true }, { status: 500 }); },
    now: () => new Date("2026-09-16T20:00:00Z"),
  });
  await service.activateReviewedWorker({
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    ...reviewed,
  });
  assert.equal(calls, 0, "activation alone must never reach the canary");
  await assert.rejects(() => service.enableSubdomainAndRunCanary({
    enableApproval: WRITE_APPROVALS.enableSubdomain,
    canaryApproval: WRITE_APPROVALS.runCanary,
    accessCredentialReceiptId: "managed-secret:" + CLOUDFLARE_ADMIN_V7.accessCredentialSecretName,
    serviceAuthReceiptId: "managed-secret:" + CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName,
    serviceTokenId: tokenId,
    workerId: WORKER_ID,
    keyId: "canary-2026-09-16",
    activatedVersionId,
  }), (error) => {
    // The failure keeps the canary detail and states the confirmed exposure state.
    assert.match(error.message, /^Canary failed after exactly one subdomain enablement POST: canary sequence 1 returned HTTP 500, expected 401; /u);
    assert.match(error.message, /read-back confirmed enabled=true previews_enabled=false, so the Worker is reachable and remains Access-protected; /u);
    assert.match(error.message, /no retry, cleanup, rollback, or restore was attempted$/u);
    assert.doesNotMatch(error.message, /client|secret|s{43}/u);
    return true;
  });
  // One canary request, one enablement POST, and no retry of either.
  assert.equal(calls, 1);
  assert.equal(subdomainPosts, 1);
});

test("canary refuses to overwrite existing service authentication before any request", async () => {
  const reviewed = { reviewedCommit: TARGET_COMMIT, configurationSha256: TARGET_CONFIG_SHA, versionId: "12345678-1234-1234-1234-123456789abc" };
  let calls = 0;
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: reviewed,
    api: {
      ...workerIdentityMocks,
      async listWorkerDeployments() { return []; },
      async getWorkerVersion() { return { id: reviewed.versionId, resources: { bindings: [], script: { etag: "etag" }, script_runtime: {} } }; },
      async getLatestWorkerVersion() { return { id: reviewed.versionId, annotations: { "workers/message": `8978-reviewed:${reviewed.reviewedCommit}:${reviewed.configurationSha256}` }, resources: { bindings: [] } }; },
      async listWorkerSecrets() { return [{ name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, type: "secret_text" }]; },
    },
    custodian: { ...custodyMocks, async readAccessCredential() { throw new Error("must not read"); } },
    canaryFetch: async () => { calls += 1; return Response.json({}); },
  });
  await assert.rejects(() => service.activateReviewedWorker({
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    ...reviewed,
  }), /retry or overwrite is prohibited/);
  assert.equal(calls, 0);
});

test("activation refuses caller-selected or no-longer-latest reviewed versions before mutation", async () => {
  const reviewed = { reviewedCommit: TARGET_COMMIT, configurationSha256: TARGET_CONFIG_SHA, versionId: "12345678-1234-1234-1234-123456789abc" };
  let mutations = 0;
  const api = {
    ...workerIdentityMocks,
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
    ...reviewed,
  };
  await assert.rejects(() => service.activateReviewedWorker({ ...approved, versionId: "abcdefab-1234-1234-1234-abcdefabcdef" }), /do not match/);
  await assert.rejects(() => service.activateReviewedWorker(approved), /not the unmodified latest version/);
  assert.equal(mutations, 0);
});

test("activation refuses a secret-derived version that changed reviewed code before deployment", async () => {
  const reviewed = { reviewedCommit: TARGET_COMMIT, configurationSha256: TARGET_CONFIG_SHA, versionId: "12345678-1234-1234-1234-123456789abc" };
  const activatedVersionId = "abcdefab-1234-1234-1234-abcdefabcdef";
  let activated = false;
  let deployments = 0;
  const baseResources = { bindings: [], script: { etag: "reviewed-etag" }, script_runtime: { compatibility_date: "2026-09-16" } };
  const service = new CloudflareAdminV7Service({
    reviewedDeployment: reviewed,
    api: {
      ...workerIdentityMocks,
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
    custodian: { ...custodyMocks, async readAccessCredential() { return { clientId: "client", clientSecret: "secret" }; } },
  });
  await assert.rejects(() => service.activateReviewedWorker({
    installApproval: WRITE_APPROVALS.installServiceAuth,
    deployApproval: WRITE_APPROVALS.deployReviewedWorker,
    ...reviewed,
  }), /changed reviewed code or configuration/);
  assert.equal(deployments, 0);
});
