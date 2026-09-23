#!/usr/bin/env node
// Phase 2-3: owner-run, local, read-only bootstrap verifier for 8978-ai-control-plane-dev.
// This is NOT Admin v7. It is GET-only, redacts credentials, never prints response headers,
// and writes no verification record. The owner authors the record from this output.
//
// Usage:
//   node scripts/verify-development-worker-bootstrap.js --remediation-commit <AUTHORIZED_SHA>
//
// The remediation commit SHA is supplied externally in the owner authorization after
// independent review. It is never stored in a tracked reviewed file.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  TARGET_MIGRATIONS,
  TARGET_PROTECTED_FILES,
  TARGET_RUNTIME_INPUTS,
  TARGET_WORKER_COMMIT,
} from "../src/target-runtime-manifest.js";
import { CLOUDFLARE_ADMIN_V7 } from "../src/cloudflare-admin-v7-contracts.js";

const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = CLOUDFLARE_ADMIN_V7.accountId;
const WORKER_NAME = CLOUDFLARE_ADMIN_V7.workerName;

export const BOOTSTRAP_VERIFIER_CONTRACT = Object.freeze({
  accountId: ACCOUNT_ID,
  workerName: WORKER_NAME,
  tokenVariable: "CLOUDFLARE_API_TOKEN",
  permittedMethods: Object.freeze(["GET"]),
  writesRecord: false,
  permittedEndpoints: Object.freeze([
    "/accounts/{account_id}/workers/workers",
    "/accounts/{account_id}/workers/workers/{worker_id}",
    "/accounts/{account_id}/workers/scripts",
    "/accounts/{account_id}/workers/services/{script_name}",
    "/accounts/{account_id}/workers/scripts/{script_name}/deployments",
    "/accounts/{account_id}/workers/scripts/{script_name}/versions/latest",
    "/accounts/{account_id}/workers/scripts/{script_name}/subdomain",
    "/accounts/{account_id}/workers/scripts/{script_name}/secrets",
    "/accounts/{account_id}/workers/domains",
    "/accounts/{account_id}/workflows/{workflow_name}",
    "/accounts/{account_id}/queues",
    "/accounts/{account_id}/d1/database/{database_id}",
  ]),
  prohibitedEndpoints: Object.freeze([
    "/accounts/{account_id}/workers/scripts/{script_name}/routes",
  ]),
});

export class BootstrapVerificationStop extends Error {
  constructor(message) {
    super(message);
    this.name = "BootstrapVerificationStop";
  }
}

export function createReadOnlyRequester(token, fetchImpl = fetch) {
  if (typeof token !== "string" || token.length < 20) throw new BootstrapVerificationStop("Cloudflare credential is unavailable");
  return async function requestGet(pathAndQuery) {
    if (typeof pathAndQuery !== "string" || !pathAndQuery.startsWith("/") || pathAndQuery.includes("..")) {
      throw new BootstrapVerificationStop("Invalid bootstrap-verifier path");
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
      throw new BootstrapVerificationStop(`Response for ${pathAndQuery} was not valid JSON; state is ambiguous`);
    }
    if (!response.ok || parsed?.success === false) {
      throw new BootstrapVerificationStop(`Request for ${pathAndQuery} was rejected with HTTP ${response.status}; state is ambiguous`);
    }
    return parsed.result;
  };
}

const asList = (value) => (Array.isArray(value) ? value : Array.isArray(value?.result) ? value.result : []);

// Selects the current active deployment. Historical deployment records never cause failure.
export function selectActiveDeployment(deployments) {
  const list = asList(deployments);
  const explicit = list.filter((item) => item?.is_active === true || item?.active === true);
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) throw new BootstrapVerificationStop("Active deployment state is ambiguous");
  if (list.length === 0) throw new BootstrapVerificationStop("No deployment exists for the bootstrapped Worker");
  return list[0];
}

export function assertActiveBootstrapDeployment(deployment, expectedVersionId) {
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  if (versions.length !== 1) throw new BootstrapVerificationStop("Active deployment does not contain exactly one version");
  if (versions[0]?.percentage !== 100) throw new BootstrapVerificationStop("Active deployment does not allocate 100 percent to one version");
  if (expectedVersionId !== undefined && versions[0]?.version_id !== expectedVersionId) {
    throw new BootstrapVerificationStop("Active deployment does not identify the expected bootstrap version");
  }
  return versions[0];
}

export function assertBootstrapAnnotation(version, { targetCommit, bootstrapConfigurationSha256 }) {
  const annotations = version?.annotations ?? version?.metadata?.annotations ?? {};
  const expected = `${CLOUDFLARE_ADMIN_V7.bootstrapAnnotationPrefix}:${targetCommit}:${bootstrapConfigurationSha256}`;
  if (annotations["workers/message"] !== expected) {
    throw new BootstrapVerificationStop("Bootstrap version annotation does not bind the exact target commit and bootstrap configuration digest");
  }
  return expected;
}

export function assertExpectedBindings(bindings) {
  const list = Array.isArray(bindings) ? bindings : [];
  const named = (name, predicate) => {
    const matches = list.filter((binding) => binding?.name === name && predicate(binding));
    if (matches.length !== 1) throw new BootstrapVerificationStop(`${name} binding is missing or ambiguous`);
  };
  named("AUTHORITY_DB", (b) => b.type === "d1" && (b.id ?? b.database_id) === CLOUDFLARE_ADMIN_V7.d1Id);
  named("ORCHESTRATOR_QUEUE", (b) => b.type === "queue" && b.queue_name === CLOUDFLARE_ADMIN_V7.queueName);
  named("ORCHESTRATOR_WORKFLOW", (b) => b.type === "workflow" && b.workflow_name === CLOUDFLARE_ADMIN_V7.workflowName && b.class_name === CLOUDFLARE_ADMIN_V7.workflowClass);
  for (const durable of ["SERVICE_AUTH_REPLAY", "IDEMPOTENCY_STORE", "OWNER_DECISION_STORE", "AUDIT_STORE"]) {
    named(durable, (b) => b.type === "durable_object_namespace" || b.type === "durable_object");
  }
  return list.length;
}

export function assertSubdomainDisabled(subdomain) {
  if (subdomain?.enabled !== false || subdomain?.previews_enabled !== false) {
    throw new BootstrapVerificationStop(
      `Bootstrapped Worker subdomain is enabled=${String(subdomain?.enabled)} previews_enabled=${String(subdomain?.previews_enabled)}; expected false/false`,
    );
  }
  return { enabled: false, previews_enabled: false };
}

export function assertServiceAuthSecretAbsent(secrets) {
  const names = asList(secrets).map((item) => (typeof item === "string" ? item : item?.name)).filter((n) => typeof n === "string");
  if (names.includes(CLOUDFLARE_ADMIN_V7.serviceAuthSecretName)) {
    throw new BootstrapVerificationStop(`${CLOUDFLARE_ADMIN_V7.serviceAuthSecretName} is already installed; bootstrap verification stops`);
  }
  return names;
}

export function assertNoCustomDomains(domains) {
  const matching = asList(domains).filter((record) => record?.service === WORKER_NAME);
  if (matching.length !== 0) throw new BootstrapVerificationStop("A Custom Domain is attached to the bootstrapped Worker");
  return 0;
}

export function assertMigrationTag(service) {
  const tag = service?.default_environment?.script?.migration_tag;
  if (tag !== CLOUDFLARE_ADMIN_V7.expectedMigrationTag) {
    throw new BootstrapVerificationStop(`Worker migration tag is ${String(tag)}; expected exactly ${CLOUDFLARE_ADMIN_V7.expectedMigrationTag}`);
  }
  return tag;
}

export function resolveImmutableWorkerId(workers, scripts) {
  const matches = asList(workers).filter((item) => item?.name === WORKER_NAME);
  if (matches.length !== 1) throw new BootstrapVerificationStop("Immutable Worker identity is missing or ambiguous");
  const workerId = matches[0]?.id;
  if (typeof workerId !== "string" || !/^[a-f0-9]{32}$/.test(workerId)) {
    throw new BootstrapVerificationStop("Immutable Worker ID is not an exact 32-character lowercase hexadecimal identifier");
  }
  const scriptMatches = asList(scripts).filter((item) => (item?.id ?? item?.name) === WORKER_NAME);
  if (scriptMatches.length !== 1) throw new BootstrapVerificationStop("Worker script identity is missing or ambiguous");
  if (scriptMatches[0]?.tag !== workerId) {
    throw new BootstrapVerificationStop("Immutable Worker ID does not match the stable Worker script tag");
  }
  return workerId;
}

function gitBlobDigest(commit, file) {
  return createHash("sha256")
    .update(execFileSync("git", ["cat-file", "blob", `${commit}:${file}`], { maxBuffer: 64 * 1024 * 1024 }))
    .digest("hex");
}

export function verifyLocalProvenance(remediationCommit) {
  if (typeof remediationCommit !== "string" || !/^[a-f0-9]{40}$/.test(remediationCommit)) {
    throw new BootstrapVerificationStop("--remediation-commit must be an exact 40-character lowercase Git commit SHA supplied by the owner authorization");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== remediationCommit) {
    throw new BootstrapVerificationStop(`HEAD ${head} does not equal the externally authorized remediation commit ${remediationCommit}`);
  }
  for (const [file, expected] of Object.entries({ ...TARGET_RUNTIME_INPUTS, ...TARGET_MIGRATIONS, ...TARGET_PROTECTED_FILES })) {
    const actual = gitBlobDigest("HEAD", file);
    if (actual !== expected) throw new BootstrapVerificationStop(`${file} digest ${actual} does not equal reviewed ${expected}`);
  }
  const bootstrapDigest = gitBlobDigest("HEAD", CLOUDFLARE_ADMIN_V7.bootstrapConfigurationPath);
  if (bootstrapDigest !== CLOUDFLARE_ADMIN_V7.bootstrapConfigurationSha256) {
    throw new BootstrapVerificationStop("Bootstrap configuration digest does not equal the reviewed pinned digest");
  }
  return { head, targetWorkerCommit: TARGET_WORKER_COMMIT, bootstrapConfigurationSha256: bootstrapDigest };
}

export async function runBootstrapVerification({ requestGet, remediationCommit, expectedBootstrapVersionId }) {
  const provenance = verifyLocalProvenance(remediationCommit);
  const identity = await requestGet("/user/tokens/verify");
  const workers = await requestGet(`/accounts/${ACCOUNT_ID}/workers/workers?per_page=100`);
  const scripts = await requestGet(`/accounts/${ACCOUNT_ID}/workers/scripts`);
  const workerId = resolveImmutableWorkerId(workers, scripts);
  const confirmed = await requestGet(`/accounts/${ACCOUNT_ID}/workers/workers/${workerId}`);
  if (confirmed?.id !== workerId || confirmed?.name !== WORKER_NAME) {
    throw new BootstrapVerificationStop("Immutable Worker ID confirmation did not return the pinned Worker identity");
  }
  const service = await requestGet(`/accounts/${ACCOUNT_ID}/workers/services/${WORKER_NAME}`);
  const migrationTag = assertMigrationTag(service);
  const deployments = await requestGet(`/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/deployments`);
  const active = selectActiveDeployment(deployments);
  const activeVersion = assertActiveBootstrapDeployment(active, expectedBootstrapVersionId);
  const latest = await requestGet(`/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/versions/latest`);
  const annotation = assertBootstrapAnnotation(latest, {
    targetCommit: TARGET_WORKER_COMMIT,
    bootstrapConfigurationSha256: provenance.bootstrapConfigurationSha256,
  });
  assertExpectedBindings(latest?.resources?.bindings);
  const subdomain = assertSubdomainDisabled(await requestGet(`/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/subdomain`));
  const secretNames = assertServiceAuthSecretAbsent(await requestGet(`/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets`));
  assertNoCustomDomains(await requestGet(`/accounts/${ACCOUNT_ID}/workers/domains`));
  const workflow = await requestGet(`/accounts/${ACCOUNT_ID}/workflows/${CLOUDFLARE_ADMIN_V7.workflowName}`);
  if (workflow?.class_name !== CLOUDFLARE_ADMIN_V7.workflowClass || workflow?.script_name !== WORKER_NAME) {
    throw new BootstrapVerificationStop("Workflow class or Worker association does not match the pinned contract");
  }
  const queues = asList(await requestGet(`/accounts/${ACCOUNT_ID}/queues`))
    .filter((item) => (item?.queue_name ?? item?.name) === CLOUDFLARE_ADMIN_V7.queueName);
  if (queues.length !== 1) throw new BootstrapVerificationStop("Pinned Queue identity is missing or ambiguous");
  const consumers = queues[0]?.consumers_total_count ?? (Array.isArray(queues[0]?.consumers) ? queues[0].consumers.length : null);
  if (consumers !== 0) throw new BootstrapVerificationStop("Pinned Queue reports consumers or an unavailable consumer count");
  const d1 = await requestGet(`/accounts/${ACCOUNT_ID}/d1/database/${CLOUDFLARE_ADMIN_V7.d1Id}`);
  if (d1?.name !== CLOUDFLARE_ADMIN_V7.d1Name || (d1?.uuid ?? d1?.id) !== CLOUDFLARE_ADMIN_V7.d1Id) {
    throw new BootstrapVerificationStop("Pinned D1 identity does not match");
  }
  if (identity?.status && identity.status !== "active") throw new BootstrapVerificationStop("Credential is not active");
  return {
    accountId: ACCOUNT_ID,
    workerName: WORKER_NAME,
    workerId,
    workerIdSource: "workers_beta_list",
    workerIdCorroboratingSource: "workers_scripts_tag",
    sourcesAgree: true,
    remediationCommit: provenance.head,
    targetWorkerCommit: provenance.targetWorkerCommit,
    bootstrapConfigurationSha256: provenance.bootstrapConfigurationSha256,
    annotation,
    activeDeployment: { id: active?.id ?? null, versionId: activeVersion.version_id, percentage: 100, versionCount: 1 },
    bootstrapEtag: latest?.resources?.script?.etag ?? null,
    migrationTag,
    subdomain,
    serviceAuthSecretPresent: false,
    secretNames,
    customDomainMatches: 0,
    recordWritten: false,
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].split("\\").join("/")}`).href;
if (invokedDirectly) {
  const index = process.argv.indexOf("--remediation-commit");
  const remediationCommit = index === -1 ? undefined : process.argv[index + 1];
  const token = process.env[BOOTSTRAP_VERIFIER_CONTRACT.tokenVariable];
  if (!token) {
    console.error(`${BOOTSTRAP_VERIFIER_CONTRACT.tokenVariable} is not set in the process environment.`);
    process.exit(2);
  }
  try {
    const summary = await runBootstrapVerification({
      requestGet: createReadOnlyRequester(token),
      remediationCommit,
      expectedBootstrapVersionId: process.argv[process.argv.indexOf("--bootstrap-version-id") + 1],
    });
    console.log(JSON.stringify(summary, null, 2));
    console.log("Bootstrap verification passed. No record was written; author it from this sanitized output.");
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : "unknown bootstrap verification failure"}`);
    process.exit(1);
  }
}
