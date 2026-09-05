import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  GitHubApi,
  SECURITY_STOP_LABEL,
  ensureLabels,
  ensureSecurityStop,
  securityStopReasons,
} from "./autonomy-supervisor.js";

const DISALLOWED_SUPERVISOR_PERMISSIONS = /\b(?:actions|checks|contents|deployments|id-token|packages|security-events|statuses):\s*write\b/iu;
const WORKSPACE_AGENT_CREDENTIAL = /CHATGPT_WORKSPACE_AGENT_(?:ID|TOKEN)|AGENT_(?:ID|TOKEN)/u;
const WORKSPACE_AGENT_TRIGGER = /api\.chatgpt\.com|triggerWorkspaceAgent/u;

export function localBoundaryViolations({ supervisorWorkflow, watchdogWorkflow }) {
  const violations = [];
  if (DISALLOWED_SUPERVISOR_PERMISSIONS.test(supervisorWorkflow)) {
    violations.push("the supervisor requests a prohibited write permission");
  }
  for (const required of ["actions: read", "checks: read", "contents: read", "issues: write", "pull-requests: write"]) {
    if (!supervisorWorkflow.includes(required)) violations.push(`the supervisor is missing required permission ${required}`);
  }
  if (WORKSPACE_AGENT_CREDENTIAL.test(watchdogWorkflow)) {
    violations.push("the watchdog workflow references a Workspace Agent credential");
  }
  if (WORKSPACE_AGENT_TRIGGER.test(watchdogWorkflow)) {
    violations.push("the watchdog workflow can reference Workspace Agent dispatch code or endpoints");
  }
  if (/pull-requests:\s*write|contents:\s*write|actions:\s*write/iu.test(watchdogWorkflow)) {
    violations.push("the watchdog requests a prohibited write permission");
  }
  return violations;
}

export async function runWatchdog({
  repository = process.env.GITHUB_REPOSITORY,
  githubToken = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
  readFileImpl = readFile,
} = {}) {
  const api = new GitHubApi({ repository, token: githubToken, fetchImpl });
  await ensureLabels(api);
  const [pullRequests, securityStops, supervisorWorkflow, watchdogWorkflow] = await Promise.all([
    api.getAll("/pulls?state=open"),
    api.getAll(`/issues?state=all&labels=${SECURITY_STOP_LABEL}`),
    readFileImpl(".github/workflows/autonomy-supervisor.yml", "utf8"),
    readFileImpl(".github/workflows/autonomy-watchdog.yml", "utf8"),
  ]);
  const changedFiles = await Promise.all(
    pullRequests.map(async (pr) => [pr.number, await api.getAll(`/pulls/${pr.number}/files`)]),
  );
  const reasons = [
    ...localBoundaryViolations({ supervisorWorkflow, watchdogWorkflow }),
    ...securityStopReasons({
      issues: securityStops,
      pullRequests,
      changedFilesByPullRequest: new Map(changedFiles),
      ownerLogin: repository.split("/", 1)[0],
    }),
  ];
  await ensureSecurityStop(api, reasons);
  if (reasons.length > 0) console.error(`Autonomous dispatch remains stopped: ${reasons.join("; ")}`);
  return reasons;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWatchdog();
}
