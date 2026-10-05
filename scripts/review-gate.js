import { pathToFileURL } from "node:url";
import {
  GitHubApi,
  reviewGateDecision,
} from "./autonomy-supervisor.js";

export async function runReviewGate({
  repository = process.env.GITHUB_REPOSITORY,
  githubToken = process.env.GITHUB_TOKEN,
  pullRequestNumber = process.env.PR_NUMBER,
  fetchImpl = fetch,
} = {}) {
  const api = new GitHubApi({ repository, token: githubToken, fetchImpl });
  const prNumber = Number(pullRequestNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error("PR_NUMBER is not configured");

  const pr = await api.get(`/pulls/${prNumber}`);
  const [reviews, reviewThreads] = await Promise.all([
    api.getAll(`/pulls/${prNumber}/reviews`),
    api.reviewThreads(prNumber),
  ]);

  const decision = reviewGateDecision({ reviews, headSha: pr.head.sha, reviewThreads });
  if (!decision.ok) {
    console.error(`review-gate: blocked — ${decision.reasons.join("; ")}`);
    process.exitCode = 1;
    return decision;
  }
  console.log("review-gate: clear");
  return decision;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runReviewGate();
}
