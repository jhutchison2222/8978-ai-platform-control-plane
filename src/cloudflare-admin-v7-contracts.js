export const CLOUDFLARE_ADMIN_V7 = Object.freeze({
  version: "7.0.0",
  mcpPath: "/mcp-8978-admin-v7",
  connectorOrigin: "https://8978-cloudflare-admin-v7.jhutchison.workers.dev",
  connectorWorkerName: "8978-cloudflare-admin-v7",
  allowedGithubLogin: "jhutchison2222",
  oauthScopeRead: "cloudflare.activation.read",
  oauthScopeWrite: "cloudflare.activation.write",
  accountId: "de5e0273347b0b4c5f8f4e554aa2288f",
  workerName: "8978-ai-control-plane-dev",
  workerUrl: "https://8978-ai-control-plane-dev.jhutchison.workers.dev",
  d1Name: "8978-ai-authority-dev",
  d1Id: "741ade94-8539-4fc8-b6be-24884720dee8",
  queueName: "8978-ai-orchestrator-dev",
  workflowName: "8978-ai-orchestrator-dev",
  workflowClass: "OrchestratorWorkflow",
  serviceAuthSecretName: "SERVICE_AUTH_KEYS_JSON",
  accessApplicationName: "8978 AI Control Plane Development Worker",
  accessServiceTokenName: "8978-ai-control-plane-dev-canary",
  accessCredentialSecretName: "CANARY_ACCESS_CREDENTIAL_JSON",
  serviceAuthPrincipalSecretName: "CANARY_SERVICE_AUTH_PRINCIPAL_JSON",
  serviceAuthPrincipalId: "development-canary-v1",
  maximumAccessTokenHours: 24,
  targetWorkerCommit: "371b02d797528f175e9e6075aef6fc92757dfd52",
  targetConfigurationSha256: "f011600fb1835dcdf9f6491f4b27613004e58e37a1cd5ef9b2b5697859ab40a6",
  bootstrapConfigurationSha256: "9f9cd5ee1a388d0a50959f9fc68a2c2efecdb6e05ed7bdac1bfae9559d434e8d",
  bootstrapConfigurationPath: "wrangler.bootstrap.jsonc",
  bootstrapAnnotationPrefix: "8978-bootstrap",
  reviewedAnnotationPrefix: "8978-reviewed",
  activatedAnnotationPrefix: "8978-activated",
  expectedMigrationTag: "v2",
  subdomainBeforeEnablement: Object.freeze({ enabled: false, previews_enabled: false }),
  subdomainAfterEnablement: Object.freeze({ enabled: true, previews_enabled: false }),
  workerIdPattern: "^[a-f0-9]{32}$",
});

export const WRITE_APPROVALS = Object.freeze({
  ensureAccess:
    "APPROVE WORKER-LEVEL ACCESS PROTECTION FOR 8978-ai-control-plane-dev",
  createServiceToken:
    "APPROVE ONE ACCESS TOKEN UP TO 24 HOURS FOR 8978-ai-control-plane-dev",
  installServiceAuth:
    "APPROVE SERVICE_AUTH_KEYS_JSON FOR 8978-ai-control-plane-dev",
  deployReviewedWorker:
    "APPROVE EXACT REVIEWED COMMIT DEPLOYMENT TO 8978-ai-control-plane-dev",
  enableSubdomain:
    "APPROVE WORKERS.DEV SUBDOMAIN ENABLEMENT FOR 8978-ai-control-plane-dev",
  runCanary:
    "APPROVE ONE FIVE-REQUEST CANARY FOR 8978-ai-control-plane-dev",
});

export function requireExactApproval(operation, supplied) {
  const expected = WRITE_APPROVALS[operation];
  if (!expected) throw new Error("Unknown write operation");
  if (supplied !== expected) throw new Error(`Exact approval required: ${expected}`);
}

export function requireReviewedCommit(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new TypeError("reviewedCommit must be an exact 40-character lowercase Git commit SHA");
  }
  return value;
}

export function requireSha256(value, name = "sha256") {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${name} must be an exact lowercase SHA-256 digest`);
  }
  return value;
}

export function requireImmutableWorkerId(value, name = "workerId") {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) {
    throw new TypeError(`${name} must be an exact 32-character lowercase immutable Cloudflare Worker ID`);
  }
  return value;
}

// Collects a complete page/per_page listing and fails closed on any missing, inconsistent,
// repeated, truncated, or non-terminating pagination. fetchPage(page) must return the full
// response envelope { result, result_info }, never only the result list.
//
// Two Cloudflare V4 page-pagination forms are accepted. Both require page, per_page, and
// total_count; the page count is always derived as ceil(total_count / per_page):
//   - result_info.total_pages supplied: it must equal the derived page count;
//   - result_info.total_pages omitted: the derived page count is used.
// An empty listing (total_count 0) is one empty page 1 and may report total_pages 0 or 1.
// There is no single-page fallback: a response without valid metadata always stops.
export const MAXIMUM_LISTING_PAGES = 100;

const isPositiveInteger = (value) => Number.isInteger(value) && value >= 1;
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

function derivedPageCount(label, page, info) {
  if (!isPositiveInteger(info.per_page)) throw new Error(`${label} page ${page} reported an invalid per_page; state is ambiguous`);
  if (!isNonNegativeInteger(info.total_count)) throw new Error(`${label} page ${page} reported an invalid total_count; completeness cannot be proven`);
  const derived = Math.ceil(info.total_count / info.per_page);
  if (info.total_pages !== undefined) {
    if (!isNonNegativeInteger(info.total_pages)) throw new Error(`${label} page ${page} reported an invalid total_pages; completeness cannot be proven`);
    const consistent = info.total_pages === derived || (info.total_count === 0 && info.total_pages === 1);
    if (!consistent) {
      throw new Error(
        `${label} page ${page} total_pages ${info.total_pages} conflicts with ${derived} derived from total_count ${info.total_count} ` +
        `and per_page ${info.per_page}; completeness cannot be proven`,
      );
    }
  }
  return derived;
}

export async function collectPagedResults(fetchPage, label, { maximumPages = MAXIMUM_LISTING_PAGES } = {}) {
  const collected = [];
  const seen = new Set();
  let first = null;
  let totalPages = null;
  for (let page = 1; page <= maximumPages; page += 1) {
    const envelope = await fetchPage(page);
    const items = envelope?.result;
    const info = envelope?.result_info;
    if (!Array.isArray(items)) throw new Error(`${label} page ${page} did not return a result list; state is ambiguous`);
    if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error(`${label} page ${page} did not return pagination metadata; completeness cannot be proven`);
    if (info.page !== page) throw new Error(`${label} returned page ${String(info.page)} when page ${page} was requested; state is ambiguous`);
    if (first === null) {
      totalPages = derivedPageCount(label, page, info);
      first = { per_page: info.per_page, total_count: info.total_count, total_pages: info.total_pages };
      if (totalPages > maximumPages) throw new Error(`${label} pagination did not terminate within ${maximumPages} pages; completeness cannot be proven`);
    } else if (info.per_page !== first.per_page || info.total_count !== first.total_count || info.total_pages !== first.total_pages) {
      throw new Error(`${label} pagination totals changed between pages; state is ambiguous`);
    }
    if (info.count !== undefined && info.count !== items.length) throw new Error(`${label} page ${page} count does not equal the returned items; state is ambiguous`);
    if (items.length > info.per_page) throw new Error(`${label} page ${page} returned more items than per_page; state is ambiguous`);
    if (first.total_count === 0) {
      if (page !== 1 || items.length !== 0) throw new Error(`${label} reported zero pages inconsistently; state is ambiguous`);
      return collected;
    }
    if (page > totalPages) throw new Error(`${label} returned a page beyond total_pages; state is ambiguous`);
    if (page < totalPages && items.length !== info.per_page) throw new Error(`${label} page ${page} is truncated before the final page; completeness cannot be proven`);
    for (const item of items) {
      const id = item?.id;
      if (typeof id !== "string" || id.length === 0) throw new Error(`${label} page ${page} returned an item without an identifier; state is ambiguous`);
      if (seen.has(id)) throw new Error(`${label} returned identifier ${id} more than once; pagination is repeated or ambiguous`);
      seen.add(id);
      collected.push(item);
    }
    if (page === totalPages) {
      if (collected.length !== first.total_count) throw new Error(`${label} collected ${collected.length} items but total_count is ${first.total_count}; completeness cannot be proven`);
      return collected;
    }
  }
  throw new Error(`${label} pagination did not terminate within ${maximumPages} pages; completeness cannot be proven`);
}

// Conservative Access coverage test. Any hostname-like declaration whose host part equals the
// target, or whose wildcard pattern could match it, is treated as covering the target at any
// path. Declarations that cannot be parsed unambiguously are also treated as covering.
// A single trailing dot (fully qualified form) is removed before comparison; any remaining
// empty label, such as a doubled trailing dot or "..", makes the declaration uninterpretable.
function normalizeHost(host) {
  const withoutRoot = host.endsWith(".") ? host.slice(0, -1) : host;
  if (withoutRoot.length === 0 || withoutRoot.split(".").some((labelPart) => labelPart.length === 0)) return null;
  return withoutRoot;
}

function hostPartOf(declaration) {
  if (typeof declaration !== "string") return null;
  let value = declaration.trim().toLowerCase();
  if (value.length === 0) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//u, "");
  const host = value.split("/")[0].replace(/:\d+$/u, "");
  if (host.length === 0 || /\s/u.test(host) || !/^[a-z0-9.*-]+$/u.test(host)) return null;
  return normalizeHost(host);
}

export function declarationCoversHostname(declaration, targetHostname) {
  const target = typeof targetHostname === "string" ? normalizeHost(targetHostname.toLowerCase()) : null;
  if (target === null) throw new Error("Target hostname for Access overlap detection is missing or malformed");
  const host = hostPartOf(declaration);
  if (host === null) return true;
  if (host === target) return true;
  if (!host.includes("*")) return false;
  // host contains only [a-z0-9.*-]; "." is the only regular-expression metacharacter to escape.
  const pattern = new RegExp(`^${host.split("*").map((part) => part.replace(/\./gu, "\\.")).join(".*")}$`, "u");
  return pattern.test(target);
}

export function assertPinnedTarget(target = {}) {
  const allowedKeys = new Set(["accountId", "workerName", "workerUrl", "d1Id", "d1Name", "queueName", "workflowName"]);
  for (const key of Object.keys(target)) {
    if (!allowedKeys.has(key)) throw new Error(`Arbitrary target field is prohibited: ${key}`);
    if (target[key] !== CLOUDFLARE_ADMIN_V7[key]) throw new Error(`Pinned target mismatch: ${key}`);
  }
  return CLOUDFLARE_ADMIN_V7;
}
