#!/usr/bin/env node
// Phase 0: read-only all-zone Workers route audit for 8978-ai-control-plane-dev.
//
// Runs immediately before the authorized bootstrap deploy, using a SEPARATE temporary
// read-only credential (CLOUDFLARE_ROUTE_AUDIT_TOKEN) scoped to:
//   Zone -> Zone -> Read                 (all zones in the authorized account)
//   Zone -> Workers Routes -> Read       (all zones in the authorized account)
// Never Workers Routes Write. This token is not the Admin v7 runtime token and is never
// given to the connector.
//
// GET-only. Paginates every applicable response. Stops if any zone cannot be enumerated,
// any response is missing/rejected/truncated/ambiguous, or a matching route exists.
// Never prints or persists the token. Writes no verification record.

const ACCOUNT_ID = "de5e0273347b0b4c5f8f4e554aa2288f";
const WORKER_NAME = "8978-ai-control-plane-dev";
const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const MAX_PAGES = 200;

export const ROUTE_AUDIT_CONTRACT = Object.freeze({
  accountId: ACCOUNT_ID,
  workerName: WORKER_NAME,
  tokenVariable: "CLOUDFLARE_ROUTE_AUDIT_TOKEN",
  requiredPermissions: Object.freeze(["Zone Read", "Workers Routes Read"]),
  prohibitedPermissions: Object.freeze(["Workers Routes Write", "Workers Routes Edit"]),
  permittedMethods: Object.freeze(["GET"]),
  permittedEndpoints: Object.freeze([
    "/zones",
    "/zones/{zone_id}/workers/routes",
  ]),
  writesRecord: false,
});

export class RouteAuditStop extends Error {
  constructor(message) {
    super(message);
    this.name = "RouteAuditStop";
  }
}

// Single choke point: hard-codes GET and refuses to carry a body.
export function createReadOnlyRequester(token, fetchImpl = fetch) {
  if (typeof token !== "string" || token.length < 20) throw new RouteAuditStop("Temporary route-audit credential is unavailable");
  return async function requestGet(pathAndQuery) {
    if (typeof pathAndQuery !== "string" || !pathAndQuery.startsWith("/") || pathAndQuery.includes("..")) {
      throw new RouteAuditStop("Invalid route-audit path");
    }
    const response = await fetchImpl(`${API_ORIGIN}${pathAndQuery}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      redirect: "error",
    });
    let parsed;
    try {
      parsed = await response.json();
    } catch {
      throw new RouteAuditStop(`Route-audit response for ${pathAndQuery} was not valid JSON; state is ambiguous`);
    }
    if (!response.ok || parsed?.success !== true) {
      throw new RouteAuditStop(`Route-audit request for ${pathAndQuery} was rejected with HTTP ${response.status}; state is ambiguous`);
    }
    if (!Array.isArray(parsed.result)) {
      throw new RouteAuditStop(`Route-audit response for ${pathAndQuery} did not return a result list; state is ambiguous`);
    }
    return parsed;
  };
}

export async function enumerateZones(requestGet) {
  const zones = [];
  let page = 1;
  let totalPages = null;
  for (; page <= MAX_PAGES; page += 1) {
    const body = await requestGet(`/zones?account.id=${ACCOUNT_ID}&per_page=50&page=${page}`);
    const info = body.result_info;
    if (!info || typeof info.total_pages !== "number" || typeof info.page !== "number") {
      throw new RouteAuditStop("Zone enumeration did not return pagination metadata; completeness cannot be proven");
    }
    if (info.page !== page) throw new RouteAuditStop("Zone enumeration returned an unexpected page index; state is ambiguous");
    totalPages = info.total_pages;
    zones.push(...body.result);
    if (page >= totalPages) break;
  }
  if (totalPages === null) throw new RouteAuditStop("Zone enumeration produced no pagination metadata");
  if (page > MAX_PAGES) throw new RouteAuditStop("Zone enumeration did not terminate; completeness cannot be proven");
  for (const zone of zones) {
    if (typeof zone?.id !== "string" || zone.id.length === 0) throw new RouteAuditStop("A zone record is missing its identifier; state is ambiguous");
  }
  return zones;
}

export async function auditZoneRoutes(requestGet, zoneId) {
  const body = await requestGet(`/zones/${zoneId}/workers/routes`);
  return body.result.map((route) => ({ id: route?.id ?? null, pattern: route?.pattern ?? null, script: route?.script ?? null }));
}

export async function runRouteAudit({ requestGet }) {
  const zones = await enumerateZones(requestGet);
  const matches = [];
  let inspected = 0;
  for (const zone of zones) {
    const routes = await auditZoneRoutes(requestGet, zone.id);
    inspected += 1;
    for (const route of routes) {
      if (route.script === WORKER_NAME) matches.push({ zoneId: zone.id, zoneName: zone.name ?? null, pattern: route.pattern, routeId: route.id });
    }
  }
  if (inspected !== zones.length) throw new RouteAuditStop("Not every enumerated zone was inspected; completeness cannot be proven");
  if (matches.length !== 0) {
    throw new RouteAuditStop(
      `${matches.length} existing Workers route(s) target ${WORKER_NAME}; the bootstrap deploy would create a reachable Worker. ` +
      "Stop. No route was created, modified, or deleted, and no cleanup or remediation was attempted.",
    );
  }
  return {
    accountId: ACCOUNT_ID,
    workerName: WORKER_NAME,
    zonesEnumerated: zones.length,
    zonesInspected: inspected,
    paginationComplete: true,
    matchingRouteCount: 0,
    credentialType: "temporary_read_only",
    tokenValueRecorded: false,
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].split("\\").join("/")}`).href;
if (invokedDirectly) {
  const token = process.env[ROUTE_AUDIT_CONTRACT.tokenVariable];
  if (!token) {
    console.error(`${ROUTE_AUDIT_CONTRACT.tokenVariable} is not set. Provide the temporary read-only route-audit credential in the process environment.`);
    console.error("Required scope: Zone Read and Workers Routes Read, all zones in the authorized account. Never Workers Routes Write.");
    process.exit(2);
  }
  try {
    const summary = await runRouteAudit({ requestGet: createReadOnlyRequester(token) });
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Route audit passed: no Workers route targets ${WORKER_NAME} in any zone of account ${ACCOUNT_ID}.`);
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : "unknown route-audit failure"}`);
    process.exit(1);
  }
}
