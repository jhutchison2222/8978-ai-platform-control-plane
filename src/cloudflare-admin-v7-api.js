import { CLOUDFLARE_ADMIN_V7, collectPagedResults, requireImmutableWorkerId } from "./cloudflare-admin-v7-contracts.js";
import { redactSensitive } from "./cloudflare-admin-v7-redaction.js";

const API_ORIGIN = "https://api.cloudflare.com/client/v4";

export class CloudflareApiError extends Error {
  constructor(message, { status, method, path, response } = {}) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.response = redactSensitive(response);
  }
}

export class CloudflareAdminV7Api {
  constructor({ apiToken, fetchImpl = fetch, accountId = CLOUDFLARE_ADMIN_V7.accountId } = {}) {
    if (typeof apiToken !== "string" || apiToken.length < 20) throw new Error("Cloudflare API credential is unavailable");
    if (accountId !== CLOUDFLARE_ADMIN_V7.accountId) throw new Error("Cloudflare account does not match the pinned development account");
    if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is unavailable");
    this.apiToken = apiToken;
    this.fetchImpl = fetchImpl;
    this.accountId = accountId;
  }

  #accountPath(path) {
    if (typeof path !== "string" || (path !== "" && !path.startsWith("/")) || path.includes("..")) throw new TypeError("Invalid Cloudflare API path");
    return `/accounts/${this.accountId}${path}`;
  }

  async #request(method, path, { body, contentType = "application/json", expected = [200], headers: extraHeaders, envelope = false } = {}) {
    if (!new Set(["GET", "POST", "PUT", "PATCH"]).has(method)) throw new Error(`Cloudflare API method is prohibited: ${method}`);
    const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${this.apiToken}` });
    for (const [name, value] of Object.entries(extraHeaders ?? {})) headers.set(name, value);
    let payload;
    if (body !== undefined) {
      headers.set("Content-Type", contentType);
      payload = JSON.stringify(body);
    }
    const response = await this.fetchImpl(`${API_ORIGIN}${path}`, {
      method,
      headers,
      body: payload,
      redirect: "error",
    });
    const text = await response.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { nonJsonResponse: true };
    }
    if (!expected.includes(response.status) || parsed.success === false) {
      throw new CloudflareApiError("Cloudflare API request failed", {
        status: response.status,
        method,
        path,
        response: parsed,
      });
    }
    return envelope ? parsed : parsed.result;
  }

  async verifyIdentity() {
    // CLOUDFLARE_ADMIN_API_TOKEN is required to be an Account API Token (consistent with every
    // other credential this project uses), so credential status is verified at the account-owned
    // endpoint; no fallback to the user-token endpoint.
    const token = await this.#request("GET", this.#accountPath("/tokens/verify"));
    const account = await this.#request("GET", this.#accountPath(""));
    if (token?.status !== "active") throw new Error("Cloudflare API token is not active");
    if (account?.id !== this.accountId) throw new Error("Authenticated Cloudflare account identity mismatch");
    return { tokenStatus: token.status, account: { id: account.id, name: account.name ?? null } };
  }

  async listWorkerSecrets() {
    const result = await this.#request("GET", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.workerName}/secrets`));
    const bindings = Array.isArray(result) ? result : [];
    return bindings.map(({ name, type }) => ({ name, type }));
  }

  async getD1Database() {
    return this.#request("GET", this.#accountPath(`/d1/database/${CLOUDFLARE_ADMIN_V7.d1Id}`));
  }

  async getWorkerSettings() {
    return this.#request("GET", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.workerName}/settings`));
  }

  async listWorkerDeployments() {
    return this.#request("GET", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.workerName}/deployments`));
  }

  async getWorkerVersion(versionId) {
    if (!/^[0-9a-f-]{32,36}$/i.test(String(versionId))) throw new Error("Worker version ID is invalid");
    return this.#request("GET", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.workerName}/versions/${versionId}`));
  }

  // Cloudflare documents no "versions/latest" path; the list endpoint's own documentation states
  // "The first version in the list is the latest version", so that is how the latest ID is
  // obtained. The list response carries only summary fields (id, number, metadata) — never
  // resources (bindings, script, script_runtime) or annotations — so the latest ID is then passed
  // through the single-version GET to get the full detail every caller of this method relies on.
  async getLatestWorkerVersion() {
    const { items } = await this.#request("GET", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.workerName}/versions`));
    if (!Array.isArray(items) || items.length === 0) throw new Error(`${CLOUDFLARE_ADMIN_V7.workerName} has no versions`);
    return this.getWorkerVersion(items[0].id);
  }

  async createWorkerDeployment(versionId, reviewedCommit) {
    if (!/^[0-9a-f-]{32,36}$/i.test(String(versionId))) throw new Error("Worker version ID is invalid");
    return this.#request("POST", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.workerName}/deployments`), {
      body: {
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: versionId }],
        annotations: {
          "workers/message": `Reviewed development commit ${reviewedCommit}`,
          "workers/triggered_by": "8978-cloudflare-admin-v7",
        },
      },
    });
  }

  // Documented page/per_page pagination; result_info.total_pages bounds the listing. No cursor is used.
  async listWorkers() {
    return collectPagedResults(
      (page) => this.#request("GET", this.#accountPath(`/workers/workers?page=${page}&per_page=100`), { envelope: true }),
      "Worker listing",
    );
  }

  async getWorkerById(workerId) {
    requireImmutableWorkerId(workerId);
    return this.#request("GET", this.#accountPath(`/workers/workers/${workerId}`));
  }

  async listWorkerScripts() {
    return this.#request("GET", this.#accountPath("/workers/scripts"));
  }

  async getAccountWorkersSubdomain() {
    return this.#request("GET", this.#accountPath("/workers/subdomain"));
  }

  async getWorkerSubdomain() {
    return this.#request("GET", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.workerName}/subdomain`));
  }

  async setWorkerSubdomain({ enabled, previews_enabled: previewsEnabled } = {}) {
    if (enabled !== true || previewsEnabled !== false) {
      throw new Error("Only the reviewed subdomain transition enabled:true previews_enabled:false may be requested");
    }
    return this.#request("POST", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.workerName}/subdomain`), {
      body: { enabled: true, previews_enabled: false },
      headers: { "Cloudflare-Workers-Script-Api-Date": "2025-08-01" },
    });
  }

  // Documented service filter on a single-response listing; the complete envelope is returned for the shared rule.
  async listWorkerDomains() {
    const service = encodeURIComponent(CLOUDFLARE_ADMIN_V7.workerName);
    return this.#request("GET", this.#accountPath(`/workers/domains?service=${service}`), { envelope: true });
  }

  async listQueues() {
    return this.#request("GET", this.#accountPath(`/queues?name=${encodeURIComponent(CLOUDFLARE_ADMIN_V7.queueName)}`));
  }

  async listWorkflows() {
    return this.#request("GET", this.#accountPath("/workflows"));
  }

  // Every Access application in the account, unfiltered (no documented destination/worker_id filter
  // exists for this endpoint; `domain`/`name` only match hostname-based applications, never a
  // worker_id destination). per_page is Cloudflare's documented maximum, so the fail-closed
  // completeness ceiling (MAXIMUM_LISTING_PAGES * per_page) is as high as this endpoint allows.
  async listAccessApplications() {
    return collectPagedResults(
      (page) => this.#request("GET", this.#accountPath(`/access/apps?page=${page}&per_page=1000`), { envelope: true }),
      "Access application listing",
    );
  }

  // Every service token in the account, by documented page/per_page pagination with no search filter.
  // Cloudflare documents total_count as the total without search parameters, so only the unfiltered
  // population lets the strict collector prove completeness; callers filter by exact name locally.
  // per_page is Cloudflare's documented maximum for this endpoint.
  async listAccessServiceTokens() {
    return collectPagedResults(
      (page) => this.#request("GET", this.#accountPath(`/access/service_tokens?page=${page}&per_page=1000`), { envelope: true }),
      "Access service-token listing",
    );
  }

  // Documented exact read of one service token by its immutable ID; it carries expires_at, which the
  // creation response does not.
  async getAccessServiceToken(serviceTokenId) {
    if (!/^[0-9a-f-]{32,36}$/i.test(String(serviceTokenId))) throw new Error("Access service-token ID is invalid");
    return this.#request("GET", this.#accountPath(`/access/service_tokens/${serviceTokenId}`));
  }

  async createAccessApplication(workerId) {
    requireImmutableWorkerId(workerId);
    return this.#request("POST", this.#accountPath("/access/apps"), {
      body: {
        name: CLOUDFLARE_ADMIN_V7.accessApplicationName,
        type: "self_hosted",
        destinations: [{ type: "worker", worker_id: workerId }],
        session_duration: "24h",
        app_launcher_visible: false,
        auto_redirect_to_identity: false,
      },
    });
  }

  async createAccessServiceTokenPolicy(applicationId, serviceTokenId) {
    if (!/^[0-9a-f-]{32,36}$/i.test(String(applicationId))) throw new Error("Access application ID is invalid");
    if (!/^[0-9a-f-]{32,36}$/i.test(String(serviceTokenId))) throw new Error("Access service-token ID is invalid");
    return this.#request("POST", this.#accountPath(`/access/apps/${applicationId}/policies`), {
      body: {
        name: "8978 development canary service token only",
        decision: "non_identity",
        precedence: 1,
        include: [{ service_token: { token_id: serviceTokenId } }],
        require: [],
        exclude: [],
      },
    });
  }

  // per_page is Cloudflare's documented maximum for this endpoint.
  async listAccessApplicationPolicies(applicationId) {
    if (!/^[0-9a-f-]{32,36}$/i.test(String(applicationId))) throw new Error("Access application ID is invalid");
    return collectPagedResults(
      (page) => this.#request("GET", this.#accountPath(`/access/apps/${applicationId}/policies?page=${page}&per_page=1000`), { envelope: true }),
      "Access policy listing",
    );
  }

  // UNDOCUMENTED CLOUDFLARE ENDPOINT — tracked for re-verification in issue #87. Cloudflare's public API reference
  // (developers.cloudflare.com/api/) documents no PATCH on any /workers/.../versions resource, under
  // either /workers/scripts/ or /workers/workers/. This exact method/path/body is confirmed only by
  // reading Cloudflare's own first-party client, wrangler, directly:
  //   cloudflare/workers-sdk @ c82d96ba63a3b343b520e781a070889251868d9a (2026-07-20, PR #14448,
  //   "WC-5290 Use PATCH APIs for 'wrangler versions secret' commands"),
  //   packages/wrangler/src/versions/secrets/index.ts, patchLatestWorkerVersionWithSecrets().
  // That source confirms: PATCH /accounts/{id}/workers/workers/{scriptName}/versions/latest, where
  // scriptName is the Worker's human-readable NAME (typed `string`, passed from the CLI's --name /
  // wrangler.toml `name`) — NOT the 32-hex immutable ID that getWorkerById() below requires. The
  // /workers/workers/ collection is keyed by "ID or name" per Cloudflare's own docs for the
  // single-worker GET; getWorkerById()'s stricter requireImmutableWorkerId() check is this
  // codebase's own self-imposed constraint for that specific identity-confirmation call site, not a
  // universal requirement of the collection — wrangler's own use of the plain name on this exact
  // sub-resource is the only concrete evidence for what this particular PATCH endpoint accepts.
  // Rationale for depending on an undocumented endpoint at all: it is the only known mechanism that
  // creates a new, secret-bearing Worker version WITHOUT deploying it — the dedicated, fully
  // documented PUT .../workers/scripts/{name}/secrets endpoint deploys the secret to the currently
  // active version immediately, which would break this flow's deliberate separation between
  // "derive a secret-bearing version" and "deploy it" (createWorkerDeployment, called separately).
  // Substituting the documented PUT would change activation semantics, not just the request shape.
  // If Cloudflare changes or removes this path, the request fails closed: #request() throws on any
  // response status other than its expected list, so a 404/405/400 here surfaces as a thrown
  // CloudflareApiError, never a silent no-op.
  async createServiceAuthVersion(secretJson, reviewedCommit, configurationSha256) {
    return this.#request("PATCH", this.#accountPath(`/workers/workers/${CLOUDFLARE_ADMIN_V7.workerName}/versions/latest`), {
      contentType: "application/merge-patch+json",
      body: {
        env: {
          [CLOUDFLARE_ADMIN_V7.serviceAuthSecretName]: { type: "secret_text", text: secretJson },
        },
        annotations: {
          "workers/message": `8978-activated:${reviewedCommit}:${configurationSha256}`,
        },
      },
    });
  }

  async listConnectorSecrets() {
    return this.#request("GET", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.connectorWorkerName}/secrets`));
  }

  async installConnectorServiceAuthPrincipal(secretJson) {
    return this.#request("PUT", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.connectorWorkerName}/secrets`), {
      body: { name: CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName, text: secretJson, type: "secret_text" },
    });
  }

  async installConnectorAccessCredential(secretJson) {
    return this.#request("PUT", this.#accountPath(`/workers/scripts/${CLOUDFLARE_ADMIN_V7.connectorWorkerName}/secrets`), {
      body: { name: CLOUDFLARE_ADMIN_V7.accessCredentialSecretName, text: secretJson, type: "secret_text" },
    });
  }

  async createAccessServiceToken(durationHours) {
    if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > CLOUDFLARE_ADMIN_V7.maximumAccessTokenHours) {
      throw new Error("Access service token duration must be an integer from 1 through 24 hours");
    }
    return this.#request("POST", this.#accountPath("/access/service_tokens"), {
      body: { name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, duration: `${durationHours}h`, enabled: true },
    });
  }

}
