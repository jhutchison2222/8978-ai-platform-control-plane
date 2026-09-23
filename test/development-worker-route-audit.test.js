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

function zonePage(page, totalPages, zones) {
  return { success: true, result: zones, result_info: { page, total_pages: totalPages, per_page: 50 } };
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
  await assert.rejects(() => enumerateZones(missing), /pagination metadata/u);

  const wrongPage = createReadOnlyRequester("x".repeat(40), fakeFetch(() => ({ payload: zonePage(7, 9, []) })));
  await assert.rejects(() => enumerateZones(wrongPage), /unexpected page index/u);
});

test("audit paginates every zone page and inspects every zone", async () => {
  const pages = {
    1: zonePage(1, 2, [{ id: "zone1", name: "one.example" }]),
    2: zonePage(2, 2, [{ id: "zone2", name: "two.example" }]),
  };
  const inspected = [];
  const requestGet = createReadOnlyRequester("x".repeat(40), fakeFetch((url) => {
    if (url.pathname === "/client/v4/zones") return { payload: pages[Number(url.searchParams.get("page"))] };
    inspected.push(url.pathname);
    return { payload: { success: true, result: [] } };
  }));
  const summary = await runRouteAudit({ requestGet });
  assert.equal(summary.zonesEnumerated, 2);
  assert.equal(summary.zonesInspected, 2);
  assert.equal(summary.paginationComplete, true);
  assert.equal(summary.matchingRouteCount, 0);
  assert.equal(summary.tokenValueRecorded, false);
  assert.equal(inspected.length, 2);
});

test("audit stops when any route targets the pinned Worker and performs no mutation or cleanup", async () => {
  const requestGet = createReadOnlyRequester("x".repeat(40), fakeFetch((url) => {
    if (url.pathname === "/client/v4/zones") return { payload: zonePage(1, 1, [{ id: "zone1", name: "one.example" }]) };
    return { payload: { success: true, result: [{ id: "r1", pattern: "one.example/*", script: "8978-ai-control-plane-dev" }] } };
  }));
  await assert.rejects(() => runRouteAudit({ requestGet }), /would create a reachable Worker/u);
  assert.ok(!/delete|cleanup|remediat/iu.test(source.split("no cleanup or remediation was attempted")[1] ?? ""));
});

test("an unrelated route in the same zone does not fail the audit", async () => {
  const requestGet = createReadOnlyRequester("x".repeat(40), fakeFetch((url) => {
    if (url.pathname === "/client/v4/zones") return { payload: zonePage(1, 1, [{ id: "zone1", name: "one.example" }]) };
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
