import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  GitHubApi,
  SECURITY_STOP_LABEL,
  ensureLabels,
  ensureSecurityStop,
  hydrateSecurityStops,
  securityStopReasons,
} from "./autonomy-supervisor.js";

const WORKSPACE_AGENT_CREDENTIAL = /CHATGPT_WORKSPACE_AGENT_(?:ID|TOKEN)|AGENT_(?:ID|TOKEN)/u;
const WORKSPACE_AGENT_TRIGGER = /api\.chatgpt\.com|triggerWorkspaceAgent/u;

const EXPECTED_SUPERVISOR_PERMISSIONS = new Map([
  ["actions", "read"],
  ["checks", "read"],
  ["contents", "read"],
  ["issues", "write"],
  ["pull-requests", "write"],
]);
const EXPECTED_WATCHDOG_PERMISSIONS = new Map([
  ["contents", "read"],
  ["issues", "write"],
  ["pull-requests", "read"],
]);

export function topLevelPermissions(workflow) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === "permissions:");
  if (start < 0) return null;
  const permissions = new Map();
  for (const line of lines.slice(start + 1)) {
    if (line !== "" && !line.startsWith(" ")) break;
    const match = line.match(/^  ([a-z-]+): (read|write|none)$/u);
    if (match) permissions.set(match[1], match[2]);
  }
  return permissions;
}

function permissionMismatch(name, actual, expected) {
  if (!actual || actual.size !== expected.size) return `${name} permissions do not exactly match the reviewed allowlist`;
  for (const [scope, access] of expected) {
    if (actual.get(scope) !== access) return `${name} permissions do not exactly match the reviewed allowlist`;
  }
  return null;
}

export function localBoundaryViolations({ supervisorWorkflow, watchdogWorkflow }) {
  const violations = [];
  const supervisorMismatch = permissionMismatch(
    "the supervisor",
    topLevelPermissions(supervisorWorkflow),
    EXPECTED_SUPERVISOR_PERMISSIONS,
  );
  if (supervisorMismatch) violations.push(supervisorMismatch);
  const watchdogMismatch = permissionMismatch(
    "the watchdog",
    topLevelPermissions(watchdogWorkflow),
    EXPECTED_WATCHDOG_PERMISSIONS,
  );
  if (watchdogMismatch) violations.push(watchdogMismatch);
  if (WORKSPACE_AGENT_CREDENTIAL.test(watchdogWorkflow)) {
    violations.push("the watchdog workflow references a Workspace Agent credential");
  }
  if (WORKSPACE_AGENT_TRIGGER.test(watchdogWorkflow)) {
    violations.push("the watchdog workflow can reference Workspace Agent dispatch code or endpoints");
  }
  return violations;
}

export function isRestrictedForkPullRequest({ eventName, headRepository, repository }) {
  return eventName === "pull_request" &&
    typeof headRepository === "string" && headRepository !== "" &&
    headRepository.toLowerCase() !== repository.toLowerCase();
}

export function isRestrictedForkSecurityStopFailure({ error, ...context }) {
  return error?.status === 403 && isRestrictedForkPullRequest(context);
}

export async function runWatchdog({
  repository = process.env.GITHUB_REPOSITORY,
  githubToken = process.env.GITHUB_TOKEN,
  eventName = process.env.GITHUB_EVENT_NAME,
  headRepository = process.env.GITHUB_PR_HEAD_REPOSITORY,
  fetchImpl = fetch,
  readFileImpl = readFile,
} = {}) {
  const api = new GitHubApi({ repository, token: githubToken, fetchImpl });
  const restrictedForkPullRequest = isRestrictedForkPullRequest({ eventName, headRepository, repository });
  if (!restrictedForkPullRequest) await ensureLabels(api);
  const [pullRequests, securityStops, supervisorWorkflow, watchdogWorkflow] = await Promise.all([
    api.getAll("/pulls?state=open"),
    api.getAll(`/issues?state=all&labels=${SECURITY_STOP_LABEL}`),
    readFileImpl(".github/workflows/autonomy-supervisor.yml", "utf8"),
    readFileImpl(".github/workflows/autonomy-watchdog.yml", "utf8"),
  ]);
  const detailedSecurityStops = await hydrateSecurityStops(api, securityStops);
  const changedFiles = await Promise.all(
    pullRequests.map(async (pr) => [pr.number, await api.getAll(`/pulls/${pr.number}/files`)]),
  );
  const reasons = [
    ...localBoundaryViolations({ supervisorWorkflow, watchdogWorkflow }),
    ...securityStopReasons({
      issues: detailedSecurityStops,
      pullRequests,
      changedFilesByPullRequest: new Map(changedFiles),
      ownerLogin: repository.split("/", 1)[0],
    }),
  ];
  try {
    await ensureSecurityStop(api, reasons);
  } catch (error) {
    if (!isRestrictedForkSecurityStopFailure({ error, eventName, headRepository, repository })) throw error;
    console.error("Fork pull-request token is read-only; the scheduled watchdog remains the security-stop creation backstop.");
  }
  if (reasons.length > 0) console.error(`Autonomous dispatch remains stopped: ${reasons.join("; ")}`);
  return reasons;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWatchdog();
}
