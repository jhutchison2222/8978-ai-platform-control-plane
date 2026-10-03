import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  GitHubApi,
  ensureLabels,
  ensureSecurityStop,
  fetchOtherSecurityStops,
  fetchSecurityStop,
  inspectPullRequestFiles,
  localBoundaryViolations,
  securityStopReasons,
  topLevelPermissions,
} from "./autonomy-supervisor.js";

export { localBoundaryViolations, topLevelPermissions };

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
  const [pullRequests, securityStop, otherStops, supervisorWorkflow, watchdogWorkflow] = await Promise.all([
    api.getAll("/pulls?state=open"),
    fetchSecurityStop(api),
    fetchOtherSecurityStops(api),
    readFileImpl(".github/workflows/autonomy-supervisor.yml", "utf8"),
    readFileImpl(".github/workflows/autonomy-watchdog.yml", "utf8"),
  ]);
  const fileInspections = await inspectPullRequestFiles(api, pullRequests);
  const persistentReasons = [
    ...localBoundaryViolations({ supervisorWorkflow, watchdogWorkflow }),
    ...securityStopReasons({
      issues: [securityStop, ...otherStops],
      pullRequests,
      changedFilesByPullRequest: fileInspections.changedFilesByPullRequest,
      ownerLogin: repository.split("/", 1)[0],
    }),
  ];
  const reasons = [...persistentReasons, ...fileInspections.failures];
  try {
    await ensureSecurityStop(api, persistentReasons, securityStop);
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
