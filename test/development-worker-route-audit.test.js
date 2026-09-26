import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ROUTE_AUDIT_CONTRACT,
  RouteAuditStop,
  createReadOnlyRequester,
  enumerateZones,
  runRouteAudit,
} from "../scripts/audit-development-worker-routes.js";

const source = await readFile("scripts/audit-development-worker-routes.js", "utf8");

const ACCOUNT = "de5e0273347b0b4c5f8f4e554aa2288f";
const zone = (id, account = ACCOUNT) => ({ id, name: `${id}.example`, account: { id: account } });

// Documented envelope: total_count covers every zone visible to the credential.
function zonePage(page, totalPages, zones, { totalCount = zones.length, perPage = 50 } = {}) {
  return { success: true, result: zones, result_info: { page, per_page: perPage, count: zones.length, total_count: totalCount, total_pages: totalPages } };
}

// Serves an unfiltered dataset in documented pages and records every zone request.
function zoneDataset(all, { perPage = 2, routes = () => [], mutate = (body) => body } = {}) {
  const requested = [];
  const inspected = [];
  const requestGet = createReadOnlyRequester("x".repeat(40), fakeFetch((url) => {
    if (url.pathname === "/client/v4/zones") {
      requested.push(url.search);
      const page = Number(url.searchParams.get("page"));
      const items = all.slice((page - 1) * perPage, page * perPage);
      return { payload: mutate(zonePage(page, Math.ceil(all.length / perPage), items, { totalCount: all.length, perPage }), page) };
    }
    inspected.push(url.pathname.split("/")[4]);
    return { payload: { success: true, result: routes(url.pathname.split("/")[4]) } };
  }));
  return { requestGet, requested, inspected };
}

function fakeFetch(handler) {
  return async (url, init) => {
    const body = handler(new URL(url), init);
    return { ok: body.ok !== false, status: body.status ?? 200, json: async () => body.payload };
  };
}

test("route audit is GET-only and pins the authorized account, Worker, and read-only permissions", () => {
  assert.equal(ROUTE_AUDIT_CONTRACT.accountId, "de5e0273347b0b4c5f8f4e554aa2288f");
  assert.equal(ROUTE_AUDIT_CONTRACT.workerName, "8978-ai-control-plane-dev");
  assert.deepEqual([...ROUTE_AUDIT_CONTRACT.permittedMethods], ["GET"]);
  assert.deepEqual([...ROUTE_AUDIT_CONTRACT.requiredPermissions], ["Zone Read", "Workers Routes Read"]);
  assert.ok(ROUTE_AUDIT_CONTRACT.prohibitedPermissions.includes("Workers Routes Write"));
  assert.equal(ROUTE_AUDIT_CONTRACT.tokenVariable, "CLOUDFLARE_ROUTE_AUDIT_TOKEN");
  assert.equal(ROUTE_AUDIT_CONTRACT.writesRecord, false);
});

test("the requester issues no method other than GET and carries no body", async () => {
  let observed;
  const requestGet = createReadOnlyRequester("x".repeat(40), fakeFetch((url, init) => {
    observed = init;
    return { payload: { success: true, result: [] } };
  }));
  await requestGet("/zones?page=1");
  assert.equal(observed.method, "GET");
  assert.equal(observed.body, undefined);
  assert.equal(observed.redirect, "error");
  // The source contains no write verb and no route mutation endpoint.
  assert.ok(!/"(POST|PUT|PATCH|DELETE)"/u.test(source));
  assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/u.test(source));
});

test("audit stops when a zone cannot be enumerated", async () => {
  const requestGet = createReadOnlyRequester("x".repeat(40), fakeFetch(() => ({ ok: false, status: 403, payload: { success: false, errors: [] } })));
  await assert.rejects(() => runRouteAudit({ requestGet }), RouteAuditStop);
});

test("audit stops when pagination metadata is missing or the page index is unexpected", async () => {
  const missing = createReadOnlyRequester("x".repeat(40), fakeFetch(() => ({ payload: { success: true, result: [] } })));
  await assert.rejects(() => enumerateZones(missing), (error) => error instanceof RouteAuditStop && /pagination metadata/u.test(error.message));

  const wrongPage = createReadOnlyRequester("x".repeat(40), fakeFetch(() => ({ payload: zonePage(7, 9, []) })));
  await assert.rejects(() => enumerateZones(wrongPage), (error) => error instanceof RouteAuditStop && /returned page 7 when page 1 was requested/u.test(error.message));
});

test("audit paginates every zone page unfiltered and inspects every zone", async () => {
  const { requestGet, requested, inspected } = zoneDataset([zone("zone1"), zone("zone2"), zone("zone3")]);
  const summary = await runRouteAudit({ requestGet });
  assert.equal(requested.length, 2);
  for (const search of requested) assert.match(search, /^\?per_page=50&page=\d+$/u, "no account.id or other search filter is sent");
  assert.equal(summary.zonesEnumerated, 3);
  assert.equal(summary.zonesInspected, 3);
  assert.equal(summary.paginationComplete, true);
  assert.equal(summary.matchingRouteCount, 0);
  assert.equal(summary.tokenValueRecorded, false);
  assert.deepEqual(inspected, ["zone1", "zone2", "zone3"]);
});

test("audit accepts the documented account-wide total_count and audits only zones of the pinned account", async () => {
  const { requestGet, inspected } = zoneDataset([zone("zone1"), zone("other1", "f".repeat(32)), zone("zone2"), zone("other2", "f".repeat(32)), zone("zone3")]);
  const summary = await runRouteAudit({ requestGet });
  assert.equal(summary.zonesEnumerated, 3);
  assert.deepEqual(inspected, ["zone1", "zone2", "zone3"]);
});

test("a matching route in a zone on a later page stops the audit", async () => {
  const { requestGet } = zoneDataset([zone("zone1"), zone("zone2"), zone("zone3"), zone("zone4"), zone("zone5")], {
    routes: (zoneId) => zoneId === "zone5" ? [{ id: "r5", pattern: "five.example/*", script: "8978-ai-control-plane-dev" }] : [],
  });
  await assert.rejects(() => runRouteAudit({ requestGet }), /1 existing Workers route\(s\) target 8978-ai-control-plane-dev/u);
});

for (const [label, mutate, pattern] of [
  ["an under-reported total_pages", (body) => ({ ...body, result_info: { ...body.result_info, total_pages: 1 } }), /total_pages 1 conflicts with 3 derived/u],
  ["a truncated non-final page", (body, page) => page === 1 ? { ...body, result: body.result.slice(0, 1), result_info: { ...body.result_info, count: 1 } } : body, /page 1 is truncated before the final page/u],
  ["a zone repeated across pages", (body, page) => page === 2 ? { ...body, result: [zone("zone1"), zone("zone4")] } : body, /returned identifier zone1 more than once/u],
  ["a total_count that changes between pages", (body, page) => page === 2 ? { ...body, result_info: { ...body.result_info, total_count: 6 } } : body, /totals changed between pages/u],
  ["a short final page", (body, page) => page === 3 ? { ...body, result: [], result_info: { ...body.result_info, count: 0 } } : body, /collected 4 items but total_count is 5/u],
  ["a missing total_count", (body) => ({ ...body, result_info: { page: body.result_info.page, per_page: 2, total_pages: 3 } }), /invalid total_count/u],
  ["a zone without its account", (body, page) => page === 2 ? { ...body, result: [zone("zone3"), { id: "zone4", name: "four.example" }] } : body, /Zone zone4 does not report its account/u],
]) {
  test(`zone enumeration fails closed on ${label} and inspects no routes`, async () => {
    const { requestGet, inspected } = zoneDataset([zone("zone1"), zone("zone2"), zone("zone3"), zone("zone4"), zone("zone5")], { mutate });
    await assert.rejects(() => runRouteAudit({ requestGet }), (error) => error instanceof RouteAuditStop && pattern.test(error.message));
    assert.deepEqual(inspected, [], "no zone is audited from an unproven enumeration");
  });
}

test("audit stops when any route targets the pinned Worker and performs no mutation or cleanup", async () => {
  const requestGet = createReadOnlyRequester("x".repeat(40), fakeFetch((url) => {
    if (url.pathname === "/client/v4/zones") return { payload: zonePage(1, 1, [zone("zone1")]) };
    return { payload: { success: true, result: [{ id: "r1", pattern: "one.example/*", script: "8978-ai-control-plane-dev" }] } };
  }));
  await assert.rejects(() => runRouteAudit({ requestGet }), /would create a reachable Worker/u);
  assert.ok(!/delete|cleanup|remediat/iu.test(source.split("no cleanup or remediation was attempted")[1] ?? ""));
});

test("an unrelated route in the same zone does not fail the audit", async () => {
  const requestGet = createReadOnlyRequester("x".repeat(40), fakeFetch((url) => {
    if (url.pathname === "/client/v4/zones") return { payload: zonePage(1, 1, [zone("zone1")]) };
    return { payload: { success: true, result: [{ id: "r1", pattern: "one.example/*", script: "some-other-worker" }] } };
  }));
  const summary = await runRouteAudit({ requestGet });
  assert.equal(summary.matchingRouteCount, 0);
});

test("the audit never records or prints the temporary credential", async () => {
  const requestGet = createReadOnlyRequester("s3cret-token-value-that-is-long", fakeFetch((url) => {
    if (url.pathname === "/client/v4/zones") return { payload: zonePage(1, 1, []) };
    return { payload: { success: true, result: [] } };
  }));
  const summary = await runRouteAudit({ requestGet });
  assert.ok(!JSON.stringify(summary).includes("s3cret-token-value-that-is-long"));
  assert.equal(summary.credentialType, "temporary_read_only");
  assert.ok(!/console\.log\([^)]*token/iu.test(source));
});

test("an unavailable credential is refused before any request", () => {
  assert.throws(() => createReadOnlyRequester(""), RouteAuditStop);
  assert.throws(() => createReadOnlyRequester(undefined), RouteAuditStop);
});
