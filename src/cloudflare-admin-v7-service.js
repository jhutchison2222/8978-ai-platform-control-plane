import {
  CLOUDFLARE_ADMIN_V7,
  assertPinnedTarget,
  requireExactApproval,
  requireReviewedCommit,
  requireSha256,
} from "./cloudflare-admin-v7-contracts.js";
import { secretMetadataOnly } from "./cloudflare-admin-v7-redaction.js";
import { createServiceAuthHeaders, digestServiceBody } from "./service-auth.js";

function asList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.result)) return result.result;
  if (Array.isArray(result?.deployments)) return result.deployments;
  return [];
}

function exactOne(items, predicate, label, { allowNone = false } = {}) {
  const matches = asList(items).filter(predicate);
  if (matches.length === 0 && allowNone) return null;
  if (matches.length !== 1) throw new Error(`${label} identity is ${matches.length === 0 ? "missing" : "ambiguous"}`);
  return matches[0];
}

function randomSecret(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function versionAnnotations(version) {
  return version?.annotations ?? version?.metadata?.annotations ?? {};
}

function versionBindings(version) {
  if (Array.isArray(version?.resources?.bindings)) return version.resources.bindings;
  if (Array.isArray(version?.bindings)) return version.bindings;
  return [];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertOnlyServiceSecretChanged(base, activated) {
  const baseBindings = versionBindings(base).map(stableJson).sort();
  const activatedBindings = versionBindings(activated);
  const secretBindings = activatedBindings.filter(({ name }) => name === CLOUDFLARE_ADMIN_V7.serviceAuthSecretName);
  const retainedBindings = activatedBindings.filter(({ name }) => name !== CLOUDFLARE_ADMIN_V7.serviceAuthSecretName).map(stableJson).sort();
  if (secretBindings.length !== 1 || !["secret_text", "secret_key"].includes(secretBindings[0]?.type)) {
    throw new Error("Activation version does not contain exactly one SERVICE_AUTH_KEYS_JSON secret binding");
  }
  if (stableJson(baseBindings) !== stableJson(retainedBindings) ||
      base?.resources?.script?.etag !== activated?.resources?.script?.etag ||
      stableJson(base?.resources?.script_runtime) !== stableJson(activated?.resources?.script_runtime)) {
    throw new Error("Activation version changed reviewed code or configuration beyond SERVICE_AUTH_KEYS_JSON");
  }
}

async function jsonBody(response) {
  try {
    return await response.json();
  } catch {
    return { outcome: "invalid_non_json_response" };
  }
}

export class CloudflareAdminV7Service {
  constructor({ api, custodian, reviewedDeployment, canaryFetch = fetch, now = () => new Date() } = {}) {
    if (!api) throw new Error("Cloudflare API adapter is unavailable");
    this.api = api;
    this.custodian = custodian;
    this.reviewedDeployment = reviewedDeployment;
    this.canaryFetch = canaryFetch;
    this.now = now;
  }

  async preflight({ target = {} } = {}) {
    assertPinnedTarget(target);
    const [identity, d1, workerSettings, deployments, queues, workflows, accessApplications, secrets] = await Promise.all([
      this.api.verifyIdentity(),
      this.api.getD1Database(),
      this.api.getWorkerSettings(),
      this.api.listWorkerDeployments(),
      this.api.listQueues(),
      this.api.listWorkflows(),
      this.api.listAccessApplications(),
      this.api.listWorkerSecrets(),
    ]);
    if (d1?.uuid !== CLOUDFLARE_ADMIN_V7.d1Id && d1?.id !== CLOUDFLARE_ADMIN_V7.d1Id) throw new Error("Pinned D1 UUID mismatch");
    if (d1?.name !== CLOUDFLARE_ADMIN_V7.d1Name) throw new Error("Pinned D1 name mismatch");
    const queue = exactOne(queues, (item) => item?.queue_name === CLOUDFLARE_ADMIN_V7.queueName || item?.name === CLOUDFLARE_ADMIN_V7.queueName, "Pinned Queue");
    const workflow = exactOne(workflows, (item) => item?.name === CLOUDFLARE_ADMIN_V7.workflowName, "Pinned Workflow");
    const queueHasNoConsumers = queue.consumers_total_count === 0 || (Array.isArray(queue.consumers) && queue.consumers.length === 0);
    if (!queueHasNoConsumers) throw new Error("Pinned Queue consumer state is non-empty or unavailable");
    if (workflow.class_name !== CLOUDFLARE_ADMIN_V7.workflowClass || workflow.script_name !== CLOUDFLARE_ADMIN_V7.workerName) {
      throw new Error("Pinned Workflow class or Worker association mismatch");
    }
    const bindings = Array.isArray(workerSettings?.bindings) ? workerSettings.bindings : [];
    exactOne(bindings, (binding) =>
      binding?.name === "AUTHORITY_DB" &&
      binding?.type === "d1" &&
      (binding?.id ?? binding?.database_id) === CLOUDFLARE_ADMIN_V7.d1Id,
    "AUTHORITY_DB binding");
    exactOne(bindings, (binding) =>
      binding?.name === "ORCHESTRATOR_QUEUE" &&
      binding?.type === "queue" &&
      binding?.queue_name === CLOUDFLARE_ADMIN_V7.queueName,
    "ORCHESTRATOR_QUEUE binding");
    exactOne(bindings, (binding) =>
      binding?.name === "ORCHESTRATOR_WORKFLOW" &&
      binding?.type === "workflow" &&
      binding?.workflow_name === CLOUDFLARE_ADMIN_V7.workflowName &&
      binding?.class_name === CLOUDFLARE_ADMIN_V7.workflowClass &&
      binding?.script_name === CLOUDFLARE_ADMIN_V7.workerName,
    "ORCHESTRATOR_WORKFLOW binding");
    return {
      ok: true,
      mode: "development-read-only",
      identity,
      target: {
        accountId: CLOUDFLARE_ADMIN_V7.accountId,
        workerName: CLOUDFLARE_ADMIN_V7.workerName,
        workerUrl: CLOUDFLARE_ADMIN_V7.workerUrl,
        d1: { id: CLOUDFLARE_ADMIN_V7.d1Id, name: CLOUDFLARE_ADMIN_V7.d1Name },
        queue: { id: queue.id ?? queue.queue_id ?? null, name: CLOUDFLARE_ADMIN_V7.queueName },
        workflow: { id: workflow.id ?? null, name: CLOUDFLARE_ADMIN_V7.workflowName },
      },
      worker: {
        bindings: bindings.filter(({ type }) => type !== "secret_text" && type !== "secret_key"),
        deployments: asList(deployments).map(({ id, created_on, author_email, source }) => ({ id, created_on, author_email, source })),
        secretMetadata: secretMetadataOnly(secrets),
      },
      access: asList(accessApplications).map(({ id, name, domain, type }) => ({ id, name, domain, type })),
    };
  }

  async createServiceToken({ approval, durationHours = 24, target = {} } = {}) {
    assertPinnedTarget(target);
    requireExactApproval("createServiceToken", approval);
    if (!this.custodian) throw new Error("Credential custodian is required before creating a service token");
    const existing = asList(await this.api.listAccessServiceTokens())
      .filter(({ name }) => name === CLOUDFLARE_ADMIN_V7.accessServiceTokenName);
    if (existing.length > 0) throw new Error("Development Access service-token state already exists or is ambiguous; automatic retry is prohibited");
    const created = await this.api.createAccessServiceToken(durationHours);
    if (!created?.id || !created?.client_id || !created?.client_secret) {
      throw new Error("Cloudflare returned a partial Access service-token result; stop without retry or cleanup");
    }
    let receipt;
    try {
      receipt = await this.custodian.store("access-service-token", {
        target: CLOUDFLARE_ADMIN_V7.workerUrl,
        tokenId: created.id,
        clientId: created.client_id,
        clientSecret: created.client_secret,
        expiresAt: created.expires_at ?? null,
      });
    } catch {
      throw new Error("Access service token was created but credential custody was not confirmed; partial state requires owner review");
    }
    return {
      ok: true,
      created: true,
      token: { id: created.id, name: created.name, duration: created.duration, expiresAt: created.expires_at ?? null },
      credential: receipt,
    };
  }

  async ensureAccessProtection({ approval, serviceTokenId, target = {} } = {}) {
    assertPinnedTarget(target);
    requireExactApproval("ensureAccess", approval);
    const token = exactOne(
      await this.api.listAccessServiceTokens(),
      ({ id, name }) => id === serviceTokenId && name === CLOUDFLARE_ADMIN_V7.accessServiceTokenName,
      "Pinned development Access service token",
    );
    const applications = asList(await this.api.listAccessApplications());
    const hostname = new URL(CLOUDFLARE_ADMIN_V7.workerUrl).hostname;
    let application = exactOne(applications, ({ domain }) => domain === hostname, "Development Access application", { allowNone: true });
    if (application && (application.name !== CLOUDFLARE_ADMIN_V7.accessApplicationName || application.type !== "self_hosted")) {
      throw new Error("Existing Access application does not match the pinned development contract");
    }
    const createdApplication = !application;
    if (!application) application = await this.api.createAccessApplication();
    if (!application?.id) throw new Error("Cloudflare did not return an Access application ID; stop without retry");
    if (!createdApplication) {
      const policies = asList(await this.api.listAccessApplicationPolicies(application.id));
      const matches = policies.filter((policy) => policy?.decision === "non_identity" && Array.isArray(policy?.include) &&
        policy.include.some((rule) => rule?.service_token?.token_id === token.id));
      if (matches.length === 1 && policies.length === 1) {
        return { ok: true, created: false, application: { id: application.id, name: application.name, domain: application.domain }, policy: { id: matches[0].id ?? null, decision: "non_identity" } };
      }
      if (policies.length > 0) throw new Error("Existing Access policy state is ambiguous or broader than the pinned service-token-only contract");
    }
    try {
      const policy = await this.api.createAccessServiceTokenPolicy(application.id, token.id);
      return { ok: true, created: true, application: { id: application.id, name: application.name, domain: application.domain }, policy: { id: policy?.id ?? null, decision: policy?.decision ?? "non_identity" } };
    } catch {
      throw new Error(`${createdApplication ? "Access application" : "Access protection"} may be partially configured; stop without retry or cleanup`);
    }
  }

  async activateReviewedWorkerAndRunCanary({
    installApproval,
    deployApproval,
    canaryApproval,
    accessCredentialReceiptId,
    reviewedCommit,
    configurationSha256,
    versionId,
    target = {},
  } = {}) {
    assertPinnedTarget(target);
    requireExactApproval("installServiceAuth", installApproval);
    requireExactApproval("deployReviewedWorker", deployApproval);
    requireExactApproval("runCanary", canaryApproval);
    requireReviewedCommit(reviewedCommit);
    requireSha256(configurationSha256, "configurationSha256");
    if (!this.custodian) throw new Error("Credential custodian is required for the bounded canary");
    const pinned = this.reviewedDeployment;
    if (!pinned || reviewedCommit !== pinned.reviewedCommit || configurationSha256 !== pinned.configurationSha256 || versionId !== pinned.versionId) {
      throw new Error("Activation inputs do not match the independently reviewed and pinned Worker version");
    }
    const deployments = asList(await this.api.listWorkerDeployments());
    if (deployments.some(({ versions }) => Array.isArray(versions) && versions.some(({ version_id }) => version_id === versionId))) {
      throw new Error("Reviewed Worker version was already deployed; automatic activation is prohibited");
    }
    const [version, latest] = await Promise.all([
      this.api.getWorkerVersion(versionId),
      this.api.getLatestWorkerVersion(),
    ]);
    if (version?.id !== versionId) throw new Error("Cloudflare did not return the pinned reviewed Worker version");
    if (latest?.id !== versionId || versionAnnotations(latest)["workers/message"] !== `8978-reviewed:${reviewedCommit}:${configurationSha256}`) {
      throw new Error("The pinned reviewed Worker version is not the unmodified latest version");
    }
    const existing = secretMetadataOnly(await this.api.listWorkerSecrets());
    const latestBindings = Array.isArray(latest?.resources?.bindings) ? latest.resources.bindings : [];
    if (existing.some(({ name }) => name === CLOUDFLARE_ADMIN_V7.serviceAuthSecretName) ||
        latestBindings.some(({ name }) => name === CLOUDFLARE_ADMIN_V7.serviceAuthSecretName)) {
      throw new Error("SERVICE_AUTH_KEYS_JSON already exists; canary retry or overwrite is prohibited");
    }
    const access = await this.custodian.readAccessCredential(accessCredentialReceiptId);
    const principalId = "development-canary-v1";
    const keyId = `canary-${this.now().toISOString().slice(0, 10)}`;
    const secret = randomSecret();
    let activationVersion;
    try {
      activationVersion = await this.api.createServiceAuthVersion(
        JSON.stringify({ [principalId]: { [keyId]: secret } }),
        reviewedCommit,
        configurationSha256,
      );
      if (!activationVersion?.id || activationVersion.id === versionId) {
        throw new Error("Cloudflare returned an ambiguous secret-bearing activation version");
      }
      const [activatedDetail, activatedLatest] = await Promise.all([
        this.api.getWorkerVersion(activationVersion.id),
        this.api.getLatestWorkerVersion(),
      ]);
      if (activatedDetail?.id !== activationVersion.id || activatedLatest?.id !== activationVersion.id ||
          versionAnnotations(activatedLatest)["workers/message"] !== `8978-activated:${reviewedCommit}:${configurationSha256}`) {
        throw new Error("Cloudflare did not preserve the identity and annotation of the secret-bearing activation version");
      }
      assertOnlyServiceSecretChanged(version, activatedDetail);
      const deployed = await this.api.createWorkerDeployment(activationVersion.id, reviewedCommit);
      if (!deployed?.id || !Array.isArray(deployed.versions) || deployed.versions.length !== 1 ||
          deployed.versions[0]?.version_id !== activationVersion.id || deployed.versions[0]?.percentage !== 100) {
        throw new Error("Cloudflare returned an ambiguous or partial deployment result");
      }
      const evidence = await this.#runCanary({ access, principalId, keyId, secret });
      return {
        ok: true,
        attempts: 1,
        installedSecret: { name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, principalId, keyId },
        deployment: {
          id: deployed.id,
          createdOn: deployed.created_on ?? null,
          baseReviewedVersionId: versionId,
          activatedVersionId: activationVersion.id,
          reviewedCommit,
          configurationSha256,
          percentage: 100,
        },
        evidence,
      };
    } catch (error) {
      const state = activationVersion?.id
        ? `secret-bearing Worker version ${activationVersion.id} was created`
        : "secret-bearing Worker version creation may have partially completed";
      throw new Error(`Activation stopped after ${state}: ${error instanceof Error ? error.message : "unknown failure"}; no retry, cleanup, rollback, or restore was attempted`);
    }
  }

  async #runCanary({ access, principalId, keyId, secret }) {
    const accessHeaders = new Headers({
      "CF-Access-Client-Id": access.clientId,
      "CF-Access-Client-Secret": access.clientSecret,
    });
    const makeSigned = async (path, { method = "GET", body = "", nonce = crypto.randomUUID() } = {}) => {
      const url = CLOUDFLARE_ADMIN_V7.workerUrl + path;
      const headers = new Headers(accessHeaders);
      if (body) headers.set("content-type", "application/json");
      const auth = await createServiceAuthHeaders({
        secret,
        principalId,
        keyId,
        method,
        url,
        bodyDigest: await digestServiceBody(body),
        now: this.now(),
        nonce,
      });
      for (const [name, value] of auth) headers.set(name, value);
      return new Request(url, { method, headers, body: method === "GET" ? undefined : body });
    };
    const unsigned = new Request(CLOUDFLARE_ADMIN_V7.workerUrl + "/v1/runtime/readiness", { headers: accessHeaders });
    const replayNonce = crypto.randomUUID();
    const signedReadiness = await makeSigned("/v1/runtime/readiness", { nonce: replayNonce });
    const action = JSON.stringify({
      actionId: "development-live-canary-action-1",
      operation: "read",
      requestedTarget: { locator: "live-canary://missing-resource" },
      correlationId: "development-live-canary-correlation-1",
      idempotencyKey: "development-live-canary-idempotency-1",
      rollbackRef: "not-applicable-no-external-write",
      evidence: { makerAttestation: "synthetic-live-canary-maker", checkerAttestation: "synthetic-live-canary-checker" },
      productionSensitive: false,
      destructiveProductionOrCustomerData: false,
      credentialScopeExpansion: false,
      newProductionExternalWriteIntegration: false,
      finalOwnerDecisionChange: false,
      legalPrivacyComplianceContractualDecision: false,
    });
    const requests = [
      unsigned,
      signedReadiness,
      signedReadiness.clone(),
      await makeSigned("/v1/actions/evaluate", { method: "POST", body: action }),
      await makeSigned("/v1/actions/execute", { method: "POST", body: "{}" }),
    ];
    const expectedStatuses = [401, 200, 401, 200, 503];
    const evidence = [];
    for (let index = 0; index < requests.length; index += 1) {
      const startedAt = this.now().toISOString();
      const response = await this.canaryFetch(requests[index]);
      const body = await jsonBody(response);
      evidence.push({ sequence: index + 1, method: requests[index].method, path: new URL(requests[index].url).pathname, status: response.status, body, startedAt });
      if (response.status !== expectedStatuses[index]) throw new Error(`canary sequence ${index + 1} returned HTTP ${response.status}, expected ${expectedStatuses[index]}`);
    }
    if (evidence[0].body?.reason !== "service_authentication_failed" || evidence[2].body?.reason !== "service_authentication_failed" ||
        evidence[3].body?.reason !== "authoritative_resolution_unavailable" || evidence[4].body?.reason !== "execution_disabled" ||
        evidence[1].body?.ready !== false || evidence[1].body?.mode !== "development" || evidence[1].body?.externalWritesEnabled !== false ||
        !Array.isArray(evidence[1].body?.missingAuthoritativeDependencies) || evidence[1].body.missingAuthoritativeDependencies.length !== 0) {
      throw new Error("canary response body did not match the fail-closed development contract");
    }
    return evidence;
  }
}
