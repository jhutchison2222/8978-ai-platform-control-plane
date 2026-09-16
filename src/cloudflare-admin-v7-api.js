import { CLOUDFLARE_ADMIN_V7 } from "./cloudflare-admin-v7-contracts.js";
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

  async #request(method, path, { body, contentType = "application/json", expected = [200] } = {}) {
    if (!new Set(["GET", "POST", "PUT", "PATCH"]).has(method)) throw new Error(`Cloudflare API method is prohibited: ${method}`);
    const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${this.apiToken}` });
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
    return parsed.result;
  }

  async verifyIdentity() {
    const token = await this.#request("GET", "/user/tokens/verify");
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

  async getLatestWorkerVersion() {
    return this.#request("GET", this.#accountPath(`/workers/workers/${CLOUDFLARE_ADMIN_V7.workerName}/versions/latest`));
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

  async listQueues() {
    return this.#request("GET", this.#accountPath(`/queues?name=${encodeURIComponent(CLOUDFLARE_ADMIN_V7.queueName)}`));
  }

  async listWorkflows() {
    return this.#request("GET", this.#accountPath("/workflows"));
  }

  async listAccessApplications() {
    const domain = new URL(CLOUDFLARE_ADMIN_V7.workerUrl).hostname;
    return this.#request("GET", this.#accountPath(`/access/apps?domain=${encodeURIComponent(domain)}`));
  }

  async listAccessServiceTokens() {
    return this.#request("GET", this.#accountPath("/access/service_tokens"));
  }

  async createAccessApplication() {
    return this.#request("POST", this.#accountPath("/access/apps"), {
      body: {
        name: CLOUDFLARE_ADMIN_V7.accessApplicationName,
        domain: new URL(CLOUDFLARE_ADMIN_V7.workerUrl).hostname,
        type: "self_hosted",
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

  async listAccessApplicationPolicies(applicationId) {
    if (!/^[0-9a-f-]{32,36}$/i.test(String(applicationId))) throw new Error("Access application ID is invalid");
    return this.#request("GET", this.#accountPath(`/access/apps/${applicationId}/policies`));
  }

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
