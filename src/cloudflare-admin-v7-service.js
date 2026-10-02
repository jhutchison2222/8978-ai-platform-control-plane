import {
  CLOUDFLARE_ADMIN_V7,
  assertNoWorkerCustomDomains,
  assertPinnedTarget,
  declarationCoversHostname,
  parseStrictTimestamp,
  requireExactApproval,
  requireImmutableWorkerId,
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

function activeDeployment(deployments) {
  const list = asList(deployments);
  const explicit = list.filter((item) => item?.is_active === true || item?.active === true);
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) throw new Error("Active deployment state is ambiguous");
  return list.length > 0 ? list[0] : null;
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
  const baseEtag = base?.resources?.script?.etag;
  if (typeof baseEtag !== "string" || baseEtag.length === 0) {
    throw new Error("Reviewed Worker version does not expose a script etag; code continuity cannot be proven");
  }
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// The single workers/message annotation of a version. Two differing sources are ambiguous.
function exactVersionMessage(version, label) {
  const sources = [version?.annotations, version?.metadata?.annotations]
    .filter((annotations) => annotations && typeof annotations === "object" && annotations["workers/message"] !== undefined)
    .map((annotations) => annotations["workers/message"]);
  if (sources.length === 0) throw new Error(`${label} carries no workers/message annotation; provenance cannot be proven`);
  if (new Set(sources).size !== 1 || typeof sources[0] !== "string") throw new Error(`${label} annotation is ambiguous; provenance cannot be proven`);
  return sources[0];
}

// The one version receiving 100 percent of traffic in the active deployment, with its deployment ID.
function exactActiveAllocation(deployments, expectedVersionId, stage) {
  const active = activeDeployment(deployments);
  if (!active || typeof active.id !== "string" || active.id.length === 0 || !Array.isArray(active.versions) || active.versions.length !== 1 ||
      active.versions[0]?.percentage !== 100 || active.versions[0]?.version_id !== expectedVersionId) {
    throw new Error(`Active deployment at ${stage} does not allocate 100 percent to exactly the expected activated version`);
  }
  return { deploymentId: active.id, versionId: active.versions[0].version_id };
}

function assertSubdomainState(state, expected, stage) {
  if (!state || typeof state !== "object") throw new Error(`Worker subdomain state is unavailable at ${stage}`);
  if (state.enabled !== expected.enabled || state.previews_enabled !== expected.previews_enabled) {
    throw new Error(
      `Worker subdomain state at ${stage} is enabled=${String(state.enabled)} previews_enabled=${String(state.previews_enabled)}, ` +
      `expected enabled=${String(expected.enabled)} previews_enabled=${String(expected.previews_enabled)}`,
    );
  }
  return state;
}

function assertAccessApplicationShape(application, workerId) {
  if (application?.type !== "self_hosted") throw new Error("Access application type is not self_hosted");
  if (application?.name !== CLOUDFLARE_ADMIN_V7.accessApplicationName) throw new Error("Access application name does not match the pinned development contract");
  const destinations = Array.isArray(application?.destinations) ? application.destinations : [];
  if (destinations.length !== 1) throw new Error("Access application must declare exactly one destination");
  if (destinations[0]?.type !== "worker") throw new Error("Access application destination type must be worker");
  if (destinations[0]?.worker_id !== workerId) throw new Error("Access application destination does not pin the verified immutable Worker ID");
  // CORS preflight bypass would let OPTIONS requests reach the Worker without Access.
  const preflightBypass = application?.options_preflight_bypass;
  if (preflightBypass !== undefined && preflightBypass !== null && preflightBypass !== false) {
    throw new Error("Access application must not enable options_preflight_bypass");
  }
  return application;
}

function assertAccessPolicyShape(policies, serviceTokenId) {
  const list = asList(policies);
  if (list.length !== 1) throw new Error("Access application must carry exactly one Service Auth policy");
  const policy = list[0];
  if (policy?.decision !== "non_identity") throw new Error("Access policy decision must be the non_identity Service Auth action");
  const include = Array.isArray(policy?.include) ? policy.include : [];
  if (include.length !== 1 || include[0]?.service_token?.token_id !== serviceTokenId) {
    throw new Error("Access policy must include exactly the pinned development service token");
  }
  if ((Array.isArray(policy?.exclude) ? policy.exclude : []).length !== 0 ||
      (Array.isArray(policy?.require) ? policy.require : []).length !== 0) {
    throw new Error("Access policy must declare no additional exclude or require rules");
  }
  return policy;
}

const isWorkerDestinationFor = (destination, workerId) => destination?.type === "worker" && destination?.worker_id === workerId;

// Every hostname-like declaration an Access application can carry. Worker destinations are
// resolved separately by immutable Worker ID and are not hostname declarations.
function accessApplicationDeclarations(application) {
  const declarations = [];
  const undetermined = [];
  if (application?.domain !== undefined && application.domain !== null && application.domain !== "") declarations.push(application.domain);
  if (application?.self_hosted_domains !== undefined && application.self_hosted_domains !== null) {
    if (!Array.isArray(application.self_hosted_domains)) undetermined.push("self_hosted_domains is not a list");
    else declarations.push(...application.self_hosted_domains);
  }
  if (application?.destinations !== undefined && application.destinations !== null) {
    if (!Array.isArray(application.destinations)) undetermined.push("destinations is not a list");
    else {
      for (const destination of application.destinations) {
        if (destination?.type === "worker") {
          if (typeof destination.worker_id !== "string") undetermined.push("worker destination has no immutable Worker ID");
          continue;
        }
        const values = [destination?.uri, destination?.hostname].filter((value) => value !== undefined && value !== null);
        if (values.length === 0 && destination?.type !== "private") undetermined.push(`destination of type ${String(destination?.type)} has no determinable hostname`);
        declarations.push(...values);
      }
    }
  }
  if (application?.type === "self_hosted" && declarations.length === 0 &&
      !(Array.isArray(application?.destinations) && application.destinations.some((destination) => destination?.type === "worker"))) {
    undetermined.push("self_hosted application declares no determinable destination");
  }
  return { declarations, undetermined };
}

// Hostname and path Access applications are more specific than Worker-level Access and take
// precedence over it. Any other application that covers, or could cover, the target hostname
// is a conflict. Coverage that cannot be determined is also a conflict.
function assertNoOverlappingAccessApplications(applications, workerId, targetHostname) {
  const conflicts = [];
  for (const application of applications) {
    const destinations = Array.isArray(application?.destinations) ? application.destinations : [];
    if (destinations.some((destination) => isWorkerDestinationFor(destination, workerId))) continue;
    const { declarations, undetermined } = accessApplicationDeclarations(application);
    if (undetermined.length > 0) {
      conflicts.push(`${String(application?.id)} (coverage undetermined: ${undetermined.join("; ")})`);
      continue;
    }
    if (declarations.some((declaration) => declarationCoversHostname(declaration, targetHostname))) {
      conflicts.push(`${String(application?.id)} (hostname, path, or wildcard coverage)`);
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `${conflicts.length} other Access application(s) could cover ${targetHostname} with precedence over the Worker-level application: ` +
      `${conflicts.join(", ")}; subdomain enablement stops before any request`,
    );
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

  async #resolveImmutableWorkerId() {
    const matches = asList(await this.api.listWorkers()).filter((item) => item?.name === CLOUDFLARE_ADMIN_V7.workerName);
    if (matches.length > 1) throw new Error("Immutable Worker identity is ambiguous");
    if (matches.length === 0) return null;
    const workerId = matches[0]?.id;
    requireImmutableWorkerId(workerId, "immutable Worker ID");
    const confirmed = await this.api.getWorkerById(workerId);
    if (confirmed?.id !== workerId || confirmed?.name !== CLOUDFLARE_ADMIN_V7.workerName) {
      throw new Error("Immutable Worker ID confirmation did not return the pinned Worker identity");
    }
    const scripts = asList(await this.api.listWorkerScripts())
      .filter((item) => (item?.id ?? item?.name) === CLOUDFLARE_ADMIN_V7.workerName);
    if (scripts.length !== 1) throw new Error("Worker script identity is missing or ambiguous");
    if (scripts[0]?.tag !== workerId) {
      throw new Error("Immutable Worker ID does not match the stable Worker script tag");
    }
    return workerId;
  }

  async preflight({ target = {} } = {}) {
    assertPinnedTarget(target);
    const [identity, d1, queues, workflows, accessApplications] = await Promise.all([
      this.api.verifyIdentity(),
      this.api.getD1Database(),
      this.api.listQueues(),
      this.api.listWorkflows(),
      this.api.listAccessApplications(),
    ]);
    if (d1?.uuid !== CLOUDFLARE_ADMIN_V7.d1Id && d1?.id !== CLOUDFLARE_ADMIN_V7.d1Id) throw new Error("Pinned D1 UUID mismatch");
    if (d1?.name !== CLOUDFLARE_ADMIN_V7.d1Name) throw new Error("Pinned D1 name mismatch");
    const queue = exactOne(queues, (item) => item?.queue_name === CLOUDFLARE_ADMIN_V7.queueName || item?.name === CLOUDFLARE_ADMIN_V7.queueName, "Pinned Queue");
    const queueHasNoConsumers = queue.consumers_total_count === 0 || (Array.isArray(queue.consumers) && queue.consumers.length === 0);
    if (!queueHasNoConsumers) throw new Error("Pinned Queue consumer state is non-empty or unavailable");
    const workerId = await this.#resolveImmutableWorkerId();
    // Read scope sees only the Worker-level application for the verified immutable Worker ID. The
    // account-wide listing is used internally for overlap detection and is never returned.
    const access = workerId === null ? [] : asList(accessApplications)
      .filter((item) => Array.isArray(item?.destinations) && item.destinations.some((destination) => isWorkerDestinationFor(destination, workerId)))
      .map(({ id, name, type, destinations }) => ({ id, name, type, destinations }));

    if (workerId === null) {
      return {
        ok: true,
        mode: "development-read-only",
        phase: "pre_bootstrap",
        workerExists: false,
        identity,
        target: {
          accountId: CLOUDFLARE_ADMIN_V7.accountId,
          workerName: CLOUDFLARE_ADMIN_V7.workerName,
          workerUrl: CLOUDFLARE_ADMIN_V7.workerUrl,
          workerId: null,
          d1: { id: CLOUDFLARE_ADMIN_V7.d1Id, name: CLOUDFLARE_ADMIN_V7.d1Name },
          queue: { id: queue.id ?? queue.queue_id ?? null, name: CLOUDFLARE_ADMIN_V7.queueName },
          workflow: { id: null, name: CLOUDFLARE_ADMIN_V7.workflowName, exists: false },
        },
        worker: { bindings: [], deployments: [], secretMetadata: [], subdomain: null, customDomains: [] },
        access,
      };
    }

    const workflow = exactOne(workflows, (item) => item?.name === CLOUDFLARE_ADMIN_V7.workflowName, "Pinned Workflow");
    if (workflow.class_name !== CLOUDFLARE_ADMIN_V7.workflowClass || workflow.script_name !== CLOUDFLARE_ADMIN_V7.workerName) {
      throw new Error("Pinned Workflow class or Worker association mismatch");
    }
    const [workerSettings, deployments, secrets, subdomain, domains] = await Promise.all([
      this.api.getWorkerSettings(),
      this.api.listWorkerDeployments(),
      this.api.listWorkerSecrets(),
      this.api.getWorkerSubdomain(),
      this.api.listWorkerDomains(),
    ]);
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
    assertNoWorkerCustomDomains(domains, CLOUDFLARE_ADMIN_V7.workerName);
    return {
      ok: true,
      mode: "development-read-only",
      phase: "post_bootstrap",
      workerExists: true,
      identity,
      target: {
        accountId: CLOUDFLARE_ADMIN_V7.accountId,
        workerName: CLOUDFLARE_ADMIN_V7.workerName,
        workerUrl: CLOUDFLARE_ADMIN_V7.workerUrl,
        workerId,
        d1: { id: CLOUDFLARE_ADMIN_V7.d1Id, name: CLOUDFLARE_ADMIN_V7.d1Name },
        queue: { id: queue.id ?? queue.queue_id ?? null, name: CLOUDFLARE_ADMIN_V7.queueName },
        workflow: { id: workflow.id ?? null, name: CLOUDFLARE_ADMIN_V7.workflowName, exists: true },
      },
      worker: {
        bindings: bindings.filter(({ type }) => type !== "secret_text" && type !== "secret_key"),
        deployments: asList(deployments).map(({ id, created_on, author_email, source }) => ({ id, created_on, author_email, source })),
        secretMetadata: secretMetadataOnly(secrets),
        subdomain: { enabled: subdomain?.enabled ?? null, previews_enabled: subdomain?.previews_enabled ?? null },
        customDomains: [],
      },
      access,
    };
  }

  async createServiceToken({ approval, durationHours = 24, target = {} } = {}) {
    assertPinnedTarget(target);
    requireExactApproval("createServiceToken", approval);
    if (!this.custodian) throw new Error("Credential custodian is required before creating a service token");
    const existing = await this.#pinnedNameServiceTokens();
    if (existing.length > 0) throw new Error("Development Access service-token state already exists or is ambiguous; automatic retry is prohibited");
    // Exactly one creation POST. The client secret stays in this request-local value only. A thrown
    // or ambiguous POST may still have created a token, so it is reported as partial state; no error
    // detail or response body is carried into the message.
    let created;
    try {
      created = await this.api.createAccessServiceToken(durationHours);
    } catch {
      throw new Error(
        "Access service-token creation POST failed or was ambiguous and may have created a token; the credential was not stored; " +
        "stop without retry or cleanup; partial state requires owner review",
      );
    }
    // name is optional in the documented creation response: if present it must be the pinned name,
    // and the exact-ID read and complete listing below prove the pinned name before any custody.
    const isText = (value) => typeof value === "string" && value.length > 0;
    if (!isText(created?.id) || !isText(created?.client_id) || !isText(created?.client_secret) ||
        (created?.name !== undefined && created.name !== CLOUDFLARE_ADMIN_V7.accessServiceTokenName) ||
        (created?.enabled !== undefined && created.enabled !== true)) {
      throw new Error(
        "Cloudflare returned a partial or mismatched Access service-token creation result; the credential was not stored; " +
        "stop without retry or cleanup; partial state requires owner review",
      );
    }
    // The documented creation response carries no expires_at, so the created token is read back
    // before custody: the exact token by ID supplies the verified expiry, and the complete listing
    // proves it is the only pinned-name token.
    let verified;
    try {
      verified = await this.#verifiedCreatedServiceToken(created.id, created.client_id);
    } catch (error) {
      throw new Error(
        `Access service token was created but read-back did not verify it: ${error instanceof Error ? error.message : "unknown failure"}; ` +
        "the credential was not stored; stop without retry or cleanup; partial state requires owner review",
      );
    }
    let receipt;
    try {
      receipt = await this.custodian.store("access-service-token", {
        target: CLOUDFLARE_ADMIN_V7.workerUrl,
        tokenId: created.id,
        clientId: created.client_id,
        clientSecret: created.client_secret,
        expiresAt: verified.expiresAt,
      });
      // Like the service-auth principal, the stored slot must be confirmed by name before success.
      await this.custodian.confirmCustody("access-service-token");
    } catch {
      throw new Error("Access service token was created but credential custody was not confirmed; partial state requires owner review");
    }
    // Read-back after custody: the complete listing must still show exactly one pinned-name token, the one created.
    try {
      await this.#exactPinnedServiceToken(created.id);
    } catch (error) {
      throw new Error(
        `Access service token was created and its credential stored, but read-back did not confirm it: ${error instanceof Error ? error.message : "unknown failure"}; ` +
        "stop without retry or cleanup; partial state requires owner review",
      );
    }
    return {
      ok: true,
      created: true,
      token: { id: created.id, name: CLOUDFLARE_ADMIN_V7.accessServiceTokenName, duration: created.duration, expiresAt: verified.expiresAt },
      credential: receipt,
    };
  }

  // Read-only verification of a just-created token. The exact token must carry the created ID, the
  // pinned name, the created client ID, an enabled state if reported, and a strict future expires_at;
  // the complete pinned-name listing must contain exactly that one token. Messages carry no values.
  async #verifiedCreatedServiceToken(serviceTokenId, clientId) {
    const exact = await this.api.getAccessServiceToken(serviceTokenId);
    if (!exact || typeof exact !== "object" || Array.isArray(exact)) throw new Error("the exact token read returned no token");
    if (exact.id !== serviceTokenId) throw new Error("the exact token read does not carry the created immutable ID");
    if (exact.name !== CLOUDFLARE_ADMIN_V7.accessServiceTokenName) throw new Error("the exact token read does not carry the pinned name");
    if (exact.client_id !== clientId) throw new Error("the exact token read does not carry the created client ID");
    if (exact.enabled !== undefined && exact.enabled !== true) throw new Error("the exact token read reports the token is not enabled");
    const expiresAt = parseStrictTimestamp(exact.expires_at);
    if (Number.isNaN(expiresAt)) throw new Error("the exact token read does not carry a strict RFC 3339 expires_at");
    if (expiresAt <= this.now().getTime()) throw new Error("the exact token read reports an expires_at that is not later than the current time");
    const listed = await this.#exactPinnedServiceToken(serviceTokenId);
    if (listed.client_id !== undefined && listed.client_id !== clientId) {
      throw new Error("the pinned-name listing does not carry the created client ID");
    }
    return { expiresAt: exact.expires_at };
  }

  // Every token carrying the pinned name, filtered by exact equality from the complete, unfiltered,
  // strictly paginated account listing. Differently named tokens count toward completeness only.
  async #pinnedNameServiceTokens() {
    return asList(await this.api.listAccessServiceTokens()).filter((token) => token?.name === CLOUDFLARE_ADMIN_V7.accessServiceTokenName);
  }

  // Exactly one token carries the pinned name, and it has the expected immutable ID.
  async #exactPinnedServiceToken(serviceTokenId) {
    if (typeof serviceTokenId !== "string" || serviceTokenId.length === 0) throw new Error("Exact Access service-token ID is required");
    const tokens = await this.#pinnedNameServiceTokens();
    if (tokens.length !== 1) throw new Error(`Pinned development Access service token identity is ${tokens.length === 0 ? "missing" : "ambiguous"}`);
    if (tokens[0]?.id !== serviceTokenId) throw new Error("Pinned development Access service token does not carry the expected immutable ID");
    return tokens[0];
  }

  async #verifiedAccessProtection(serviceTokenId, workerId) {
    const application = exactOne(
      await this.api.listAccessApplications(),
      (item) => Array.isArray(item?.destinations) &&
        item.destinations.some((destination) => destination?.type === "worker" && destination?.worker_id === workerId),
      "Worker-level Access application",
    );
    assertAccessApplicationShape(application, workerId);
    const policy = assertAccessPolicyShape(await this.api.listAccessApplicationPolicies(application.id), serviceTokenId);
    return { application, policy };
  }

  // The target hostname is derived from verified account state, never from caller input.
  async #verifiedTargetHostname() {
    const account = await this.api.getAccountWorkersSubdomain();
    const subdomain = account?.subdomain;
    if (typeof subdomain !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(subdomain)) {
      throw new Error("Account workers.dev subdomain is missing or malformed; the target hostname cannot be determined");
    }
    const hostname = `${CLOUDFLARE_ADMIN_V7.workerName}.${subdomain}.workers.dev`;
    if (hostname !== new URL(CLOUDFLARE_ADMIN_V7.workerUrl).hostname) {
      throw new Error(`Verified workers.dev hostname ${hostname} does not equal the pinned development hostname`);
    }
    return hostname;
  }

  // Complete paginated Access state: exactly one Worker-level application for the immutable
  // Worker ID with its exact Service Auth policy, and no other application covering the hostname.
  async #verifiedAccessIsolation(serviceTokenId, workerId, targetHostname) {
    const applications = asList(await this.api.listAccessApplications());
    for (const application of applications) {
      if (typeof application?.id !== "string" || application.id.length === 0) throw new Error("An Access application has no identifier; Access state is ambiguous");
    }
    const application = exactOne(
      applications,
      (item) => Array.isArray(item?.destinations) && item.destinations.some((destination) => isWorkerDestinationFor(destination, workerId)),
      "Worker-level Access application",
    );
    assertAccessApplicationShape(application, workerId);
    assertNoOverlappingAccessApplications(applications, workerId, targetHostname);
    const policy = assertAccessPolicyShape(await this.api.listAccessApplicationPolicies(application.id), serviceTokenId);
    return { application, policy };
  }

  async ensureAccessProtection({ approval, serviceTokenId, workerId, target = {} } = {}) {
    assertPinnedTarget(target);
    requireExactApproval("ensureAccess", approval);
    requireImmutableWorkerId(workerId, "workerId");
    const resolved = await this.#resolveImmutableWorkerId();
    if (resolved !== workerId) throw new Error("Supplied Worker ID does not match the independently resolved immutable Worker ID");
    const token = await this.#exactPinnedServiceToken(serviceTokenId);
    const existing = asList(await this.api.listAccessApplications()).filter((item) =>
      Array.isArray(item?.destinations) &&
      item.destinations.some((destination) => destination?.type === "worker" && destination?.worker_id === workerId));
    if (existing.length > 1) throw new Error("Worker-level Access application state is ambiguous");
    if (existing.length === 1) {
      const verified = await this.#verifiedAccessProtection(token.id, workerId);
      return {
        ok: true,
        created: false,
        workerId,
        application: { id: verified.application.id, name: verified.application.name, destinations: verified.application.destinations },
        policy: { id: verified.policy.id ?? null, decision: "non_identity" },
      };
    }
    const application = await this.api.createAccessApplication(workerId);
    if (!application?.id) throw new Error("Cloudflare did not return an Access application ID; stop without retry");
    try {
      await this.api.createAccessServiceTokenPolicy(application.id, token.id);
    } catch {
      throw new Error("Access application was created but its service-token policy may be partially configured; stop without retry or cleanup");
    }
    const verified = await this.#verifiedAccessProtection(token.id, workerId);
    return {
      ok: true,
      created: true,
      workerId,
      application: { id: verified.application.id, name: verified.application.name, destinations: verified.application.destinations },
      policy: { id: verified.policy.id ?? null, decision: "non_identity" },
    };
  }

  async activateReviewedWorker({
    installApproval,
    deployApproval,
    reviewedCommit,
    configurationSha256,
    versionId,
    target = {},
  } = {}) {
    assertPinnedTarget(target);
    requireExactApproval("installServiceAuth", installApproval);
    requireExactApproval("deployReviewedWorker", deployApproval);
    requireReviewedCommit(reviewedCommit);
    requireSha256(configurationSha256, "configurationSha256");
    if (!this.custodian) throw new Error("Credential custodian is required before installing service authentication");
    const pinned = this.reviewedDeployment;
    if (!pinned || reviewedCommit !== pinned.reviewedCommit || configurationSha256 !== pinned.configurationSha256 || versionId !== pinned.versionId) {
      throw new Error("Activation inputs do not match the independently reviewed and pinned Worker version");
    }
    if (reviewedCommit !== CLOUDFLARE_ADMIN_V7.targetWorkerCommit || configurationSha256 !== CLOUDFLARE_ADMIN_V7.targetConfigurationSha256) {
      throw new Error("Activation inputs do not match the pinned target Worker provenance");
    }
    assertSubdomainState(await this.api.getWorkerSubdomain(), CLOUDFLARE_ADMIN_V7.subdomainBeforeEnablement, "activation start");
    const deployments = asList(await this.api.listWorkerDeployments());
    if (deployments.some(({ versions }) => Array.isArray(versions) && versions.some(({ version_id }) => version_id === versionId))) {
      throw new Error("Reviewed Worker version was already deployed; automatic activation is prohibited");
    }
    const [version, latest] = await Promise.all([
      this.api.getWorkerVersion(versionId),
      this.api.getLatestWorkerVersion(),
    ]);
    if (version?.id !== versionId) throw new Error("Cloudflare did not return the pinned reviewed Worker version");
    if (latest?.id !== versionId || versionAnnotations(latest)["workers/message"] !== `${CLOUDFLARE_ADMIN_V7.reviewedAnnotationPrefix}:${reviewedCommit}:${configurationSha256}`) {
      throw new Error("The pinned reviewed Worker version is not the unmodified latest version");
    }
    const existing = secretMetadataOnly(await this.api.listWorkerSecrets());
    const latestBindings = Array.isArray(latest?.resources?.bindings) ? latest.resources.bindings : [];
    if (existing.some(({ name }) => name === CLOUDFLARE_ADMIN_V7.serviceAuthSecretName) ||
        latestBindings.some(({ name }) => name === CLOUDFLARE_ADMIN_V7.serviceAuthSecretName)) {
      throw new Error("SERVICE_AUTH_KEYS_JSON already exists; canary retry or overwrite is prohibited");
    }
    const workerId = await this.#resolveImmutableWorkerId();
    if (workerId === null) throw new Error("Target Worker does not exist; authorized bootstrap creation must precede activation");
    const principalId = CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId;
    const keyId = `canary-${this.now().toISOString().slice(0, 10)}`;
    const secret = randomSecret();
    let custodyReceipt;
    try {
      custodyReceipt = await this.custodian.store("service-auth-principal", { principalId, keyId, secret, workerId });
      await this.custodian.confirmCustody("service-auth-principal");
    } catch (error) {
      throw new Error(
        `Service-auth principal custody was not confirmed: ${error instanceof Error ? error.message : "unknown failure"}; ` +
        "the secret-bearing version was not created and nothing was deployed; " +
        "no retry, cleanup, rollback, or restore was attempted",
      );
    }
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
          versionAnnotations(activatedLatest)["workers/message"] !== `${CLOUDFLARE_ADMIN_V7.activatedAnnotationPrefix}:${reviewedCommit}:${configurationSha256}`) {
        throw new Error("Cloudflare did not preserve the identity and annotation of the secret-bearing activation version");
      }
      assertOnlyServiceSecretChanged(version, activatedDetail);
      const deployed = await this.api.createWorkerDeployment(activationVersion.id, reviewedCommit);
      if (!deployed?.id || !Array.isArray(deployed.versions) || deployed.versions.length !== 1 ||
          deployed.versions[0]?.version_id !== activationVersion.id || deployed.versions[0]?.percentage !== 100) {
        throw new Error("Cloudflare returned an ambiguous or partial deployment result");
      }
      const subdomain = assertSubdomainState(
        await this.api.getWorkerSubdomain(),
        CLOUDFLARE_ADMIN_V7.subdomainBeforeEnablement,
        "post-deployment",
      );
      return {
        ok: true,
        attempts: 1,
        reachable: false,
        workerId,
        installedSecret: { name: CLOUDFLARE_ADMIN_V7.serviceAuthSecretName, principalId, keyId },
        serviceAuthCredential: custodyReceipt,
        deployment: {
          id: deployed.id,
          createdOn: deployed.created_on ?? null,
          baseReviewedVersionId: versionId,
          activatedVersionId: activationVersion.id,
          reviewedCommit,
          configurationSha256,
          percentage: 100,
        },
        subdomain: { enabled: subdomain.enabled, previews_enabled: subdomain.previews_enabled },
      };
    } catch (error) {
      const state = activationVersion?.id
        ? `secret-bearing Worker version ${activationVersion.id} was created`
        : "secret-bearing Worker version creation may have partially completed";
      throw new Error(`Activation stopped after ${state}: ${error instanceof Error ? error.message : "unknown failure"}; no retry, cleanup, rollback, or restore was attempted`);
    }
  }

  // Reviewed provenance comes only from the connector's pinned configuration, never from the caller.
  #pinnedReviewedProvenance(activatedVersionId) {
    const pinned = this.reviewedDeployment;
    if (!pinned || pinned.reviewedCommit !== CLOUDFLARE_ADMIN_V7.targetWorkerCommit ||
        pinned.configurationSha256 !== CLOUDFLARE_ADMIN_V7.targetConfigurationSha256 ||
        typeof pinned.versionId !== "string" || !UUID_PATTERN.test(pinned.versionId)) {
      throw new Error("Pinned reviewed Worker provenance is unavailable or does not match the target Worker provenance");
    }
    if (typeof activatedVersionId !== "string" || !UUID_PATTERN.test(activatedVersionId)) throw new Error("Activated Worker version ID is malformed");
    if (activatedVersionId === pinned.versionId) throw new Error("The activated version cannot be the reviewed base version");
    return {
      reviewedCommit: pinned.reviewedCommit,
      configurationSha256: pinned.configurationSha256,
      reviewedVersionId: pinned.versionId,
      reviewedMessage: `${CLOUDFLARE_ADMIN_V7.reviewedAnnotationPrefix}:${pinned.reviewedCommit}:${pinned.configurationSha256}`,
      activatedMessage: `${CLOUDFLARE_ADMIN_V7.activatedAnnotationPrefix}:${pinned.reviewedCommit}:${pinned.configurationSha256}`,
    };
  }

  // The version about to be exposed must be the exact authorized activation of the pinned reviewed
  // version: exact annotation, latest, and the same code-continuity rule enforced in phase 7.
  async #verifiedActivatedProvenance(provenance, activatedVersionId) {
    const [reviewedVersion, activatedVersion, latest] = await Promise.all([
      this.api.getWorkerVersion(provenance.reviewedVersionId),
      this.api.getWorkerVersion(activatedVersionId),
      this.api.getLatestWorkerVersion(),
    ]);
    if (reviewedVersion?.id !== provenance.reviewedVersionId) throw new Error("Cloudflare did not return the pinned reviewed Worker version");
    if (exactVersionMessage(reviewedVersion, "Reviewed Worker version") !== provenance.reviewedMessage) {
      throw new Error("Reviewed Worker version annotation does not bind the exact target commit and configuration digest");
    }
    if (activatedVersion?.id !== activatedVersionId) throw new Error("Cloudflare did not return the activated Worker version");
    if (exactVersionMessage(activatedVersion, "Activated Worker version") !== provenance.activatedMessage) {
      throw new Error("Activated Worker version annotation does not bind the exact target commit and configuration digest");
    }
    this.#assertLatestIsActivated(latest, activatedVersionId, provenance);
    assertOnlyServiceSecretChanged(reviewedVersion, activatedVersion);
  }

  #assertLatestIsActivated(latest, activatedVersionId, provenance) {
    if (latest?.id !== activatedVersionId) throw new Error("versions/latest does not identify exactly the activated Worker version");
    if (exactVersionMessage(latest, "Latest Worker version") !== provenance.activatedMessage) {
      throw new Error("Latest Worker version annotation does not bind the exact target commit and configuration digest");
    }
  }

  async #readBackSubdomain() {
    try {
      const state = await this.api.getWorkerSubdomain();
      if (!state || typeof state !== "object" || typeof state.enabled !== "boolean" || typeof state.previews_enabled !== "boolean") {
        throw new Error("subdomain read-back shape is ambiguous");
      }
      return state;
    } catch (error) {
      throw new Error(
        `Subdomain read-back failed or is ambiguous after exactly one enablement POST: ${error instanceof Error ? error.message : "unknown failure"}; ` +
        "reachability may exist, the canary was not run, and no retry, cleanup, rollback, or restore was attempted",
      );
    }
  }

  async enableSubdomainAndRunCanary({
    enableApproval,
    canaryApproval,
    accessCredentialReceiptId,
    serviceAuthReceiptId,
    serviceTokenId,
    workerId,
    keyId,
    activatedVersionId,
    target = {},
  } = {}) {
    assertPinnedTarget(target);
    requireExactApproval("enableSubdomain", enableApproval);
    requireExactApproval("runCanary", canaryApproval);
    requireImmutableWorkerId(workerId, "workerId");
    if (typeof keyId !== "string" || keyId.length === 0) throw new Error("Exact service-auth key ID is required before subdomain enablement");
    if (!this.custodian) throw new Error("Credential custodian is required for the bounded canary");
    const provenance = this.#pinnedReviewedProvenance(activatedVersionId);

    // 1. Identity, pre-enablement surface, deployment, provenance, hostname, and Access isolation.
    const resolvedWorkerId = await this.#resolveImmutableWorkerId();
    if (resolvedWorkerId !== workerId) throw new Error("Supplied Worker ID does not match the independently resolved immutable Worker ID");
    assertSubdomainState(await this.api.getWorkerSubdomain(), CLOUDFLARE_ADMIN_V7.subdomainBeforeEnablement, "pre-enablement");
    const initialAllocation = exactActiveAllocation(await this.api.listWorkerDeployments(), activatedVersionId, "pre-enablement");
    await this.#verifiedActivatedProvenance(provenance, activatedVersionId);
    const targetHostname = await this.#verifiedTargetHostname();
    await this.#verifiedAccessIsolation(serviceTokenId, workerId, targetHostname);
    await this.#exactPinnedServiceToken(serviceTokenId);

    // 2. Both custody values, retrieved and bound to the exact phase-8 inputs, before any exposure.
    let access;
    let principal;
    try {
      access = await this.custodian.readAccessCredential(accessCredentialReceiptId, { tokenId: serviceTokenId, now: this.now() });
      principal = await this.custodian.readServiceAuthPrincipal(serviceAuthReceiptId, { workerId, keyId });
    } catch (error) {
      throw new Error(
        `Canary custody was not confirmed before subdomain enablement: ${error instanceof Error ? error.message : "unknown failure"}; ` +
        "the subdomain was not changed and no canary request was made",
      );
    }
    if (typeof access?.clientId !== "string" || access.clientId.length === 0 || typeof access?.clientSecret !== "string" || access.clientSecret.length === 0) {
      throw new Error("Canary Access credential custody is malformed; the subdomain was not changed and no canary request was made");
    }
    if (principal?.principalId !== CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId || principal?.keyId !== keyId ||
        typeof principal?.secret !== "string" || principal.secret.length < 32) {
      throw new Error("Canary service-auth principal custody is not bound to the exact phase-8 inputs; the subdomain was not changed and no canary request was made");
    }

    // 3. The last observable state before enablement must still be the exact authorized version.
    const finalAllocation = exactActiveAllocation(await this.api.listWorkerDeployments(), activatedVersionId, "final pre-enablement check");
    if (finalAllocation.deploymentId !== initialAllocation.deploymentId) {
      throw new Error("Active deployment changed during pre-enablement verification; the subdomain was not changed");
    }
    this.#assertLatestIsActivated(await this.api.getLatestWorkerVersion(), activatedVersionId, provenance);

    // 4. Exactly one POST, then exactly one read-back on every outcome.
    let posted;
    try {
      posted = await this.api.setWorkerSubdomain({ enabled: true, previews_enabled: false });
    } catch (error) {
      const readBack = await this.#readBackSubdomain();
      throw new Error(
        `Subdomain enablement POST failed and was not repeated: ${error instanceof Error ? error.message : "unknown failure"}; ` +
        `read-back reports enabled=${String(readBack.enabled)} previews_enabled=${String(readBack.previews_enabled)}; ` +
        `${readBack.enabled === false ? "the Worker remains unreachable" : "the Worker may be reachable and remains Access-protected"}; ` +
        "no retry, cleanup, rollback, or restore was attempted",
      );
    }
    if (posted?.enabled !== true || posted?.previews_enabled !== false) {
      const readBack = await this.#readBackSubdomain();
      throw new Error(
        "Subdomain enablement POST returned an ambiguous result and was not repeated; " +
        `read-back reports enabled=${String(readBack.enabled)} previews_enabled=${String(readBack.previews_enabled)}; ` +
        "the canary was not run and no retry, cleanup, rollback, or restore was attempted",
      );
    }
    const readBack = await this.#readBackSubdomain();
    if (readBack.previews_enabled !== false) {
      throw new Error("Subdomain read-back reports an unexpected preview surface; security stop before any canary request");
    }
    if (readBack.enabled !== true) {
      throw new Error("Subdomain read-back does not confirm enablement; the canary was not run and the POST was not repeated");
    }

    // 5. The canary runs only after an unambiguous successful read-back, with the custody read in step 2.
    // A canary failure still reports the confirmed exposure state, like every earlier stop.
    let evidence;
    try {
      evidence = await this.#runCanary({
        access,
        principalId: principal.principalId,
        keyId: principal.keyId,
        secret: principal.secret,
      });
    } catch (error) {
      throw new Error(
        `Canary failed after exactly one subdomain enablement POST: ${error instanceof Error ? error.message : "unknown failure"}; ` +
        `read-back confirmed enabled=${String(readBack.enabled)} previews_enabled=${String(readBack.previews_enabled)}, ` +
        "so the Worker is reachable and remains Access-protected; the canary was not repeated and no retry, cleanup, rollback, or restore was attempted",
      );
    }
    return {
      ok: true,
      attempts: 1,
      workerId,
      subdomainPosts: 1,
      subdomain: { enabled: readBack.enabled, previews_enabled: readBack.previews_enabled },
      evidence,
    };
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
