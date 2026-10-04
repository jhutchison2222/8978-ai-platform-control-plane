import { pathToFileURL } from "node:url";
import {
  GitHubApi,
  securityGateDecision,
} from "./autonomy-supervisor.js";

export async function runSecurityGate({
  repository = process.env.GITHUB_REPOSITORY,
  githubToken = process.env.GITHUB_TOKEN,
  pullRequestNumber = process.env.PR_NUMBER,
  fetchImpl = fetch,
} = {}) {
  const api = new GitHubApi({ repository, token: githubToken, fetchImpl });
  const prNumber = Number(pullRequestNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error("PR_NUMBER is not configured");

  const [pr, issues, changedFiles, comments] = await Promise.all([
    api.get(`/pulls/${prNumber}`),
    api.getAll("/issues?state=all"),
    api.getAll(`/pulls/${prNumber}/files`),
    api.getAll(`/issues/${prNumber}/comments`),
  ]);

  const ownerLogin = repository.split("/", 1)[0];
  const decision = securityGateDecision({ issues, pr, changedFiles, comments, ownerLogin });
  if (!decision.ok) {
    console.error(`security-gate: blocked — ${decision.reasons.join("; ")}`);
    process.exitCode = 1;
    return decision;
  }
  console.log("security-gate: clear");
  return decision;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSecurityGate();
}
