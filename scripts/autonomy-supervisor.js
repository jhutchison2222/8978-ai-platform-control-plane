import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const CLAUDE_LOGIN = "claude[bot]";
export const CLAUDE_USER_ID = 209825114;
export const MAX_CLAUDE_REQUESTS = 3;
export const SECOND_REQUEST_DELAY_MS = 10 * 60 * 1000;
export const LATER_ACTION_DELAY_MS = 15 * 60 * 1000;
export const EVENT_DISPATCH_FALLBACK_DELAY_MS = 10 * 60 * 1000;

const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const ACCEPTED_REVIEW = /\b(?:ACCEPTED|LGTM)\b|\blooks good\b/iu;
const REJECTED_REVIEW = /\b(?:REJECTED|REQUEST_CHANGES|BLOCKING)\b/iu;
const MARKER_PREFIX = "<!-- autonomy-supervisor:";

function required(name, value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is not configured`);
  return value;
}

export function checkState(checkRuns) {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) return "pending";
  if (checkRuns.some((run) => run.status !== "completed")) return "pending";
  return checkRuns.every((run) => SUCCESS_CONCLUSIONS.has(run.conclusion)) ? "passed" : "failed";
}

export function exactHeadClaudeVerdict(reviews, headSha) {
  const exact = reviews
    .filter((review) => review.user?.id === CLAUDE_USER_ID && review.user?.login === CLAUDE_LOGIN && review.commit_id === headSha)
    .sort((left, right) => Date.parse(left.submitted_at) - Date.parse(right.submitted_at));
  const latest = exact.at(-1);
  if (!latest) return "missing";
  const body = latest.body ?? "";
  if (latest.state === "CHANGES_REQUESTED" || REJECTED_REVIEW.test(body)) return "rejected";
  return ACCEPTED_REVIEW.test(body) ? "accepted" : "inconclusive";
}

export function claudeRequests(comments, headSha) {
  return comments
    .filter((comment) => typeof comment.body === "string" && comment.body.includes("@claude") && comment.body.includes(headSha))
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

export function nextPullRequestAction({ checkRuns, comments, headSha, nowMs, reviews }) {
  const checks = checkState(checkRuns);
  if (checks === "pending") return { kind: "wait", reason: "checks-pending" };
  if (checks === "failed") {
    const latestCompletion = Math.max(...checkRuns.map((run) => Date.parse(run.completed_at ?? 0)));
    return nowMs - latestCompletion >= EVENT_DISPATCH_FALLBACK_DELAY_MS
      ? { kind: "dispatch", reason: "checks-failed" }
      : { kind: "wait", reason: "event-dispatch-fallback-delay" };
  }

  const verdict = exactHeadClaudeVerdict(reviews, headSha);
  if (verdict === "accepted") {
    const latestAcceptance = Math.max(...reviews
      .filter((review) => review.user?.id === CLAUDE_USER_ID && review.user?.login === CLAUDE_LOGIN && review.commit_id === headSha)
      .map((review) => Date.parse(review.submitted_at)));
    return nowMs - latestAcceptance >= EVENT_DISPATCH_FALLBACK_DELAY_MS
      ? { kind: "dispatch", reason: "merge-ready" }
      : { kind: "wait", reason: "event-dispatch-fallback-delay" };
  }
  if (verdict === "rejected") return { kind: "dispatch", reason: "review-rejected" };

  const requests = claudeRequests(comments, headSha);
  if (requests.length === 0) return { kind: "request-review", attempt: 1 };

  const elapsed = nowMs - Date.parse(requests.at(-1).created_at);
  if (requests.length < MAX_CLAUDE_REQUESTS) {
    const delay = requests.length === 1 ? SECOND_REQUEST_DELAY_MS : LATER_ACTION_DELAY_MS;
    return elapsed >= delay
      ? { kind: "request-review", attempt: requests.length + 1 }
      : { kind: "wait", reason: "review-retry-delay" };
  }
  return elapsed >= LATER_ACTION_DELAY_MS
    ? { kind: "dispatch", reason: "review-stalled" }
    : { kind: "wait", reason: "review-stall-delay" };
}

export function marker(reason, headSha) {
  return `${MARKER_PREFIX}${reason}:${headSha} -->`;
}

export function hasMarker(comments, reason, headSha) {
  const expected = marker(reason, headSha);
  return comments.some((comment) => comment.body?.includes(expected));
}

class GitHubApi {
  constructor({ repository, token, fetchImpl = fetch }) {
    this.repository = required("GITHUB_REPOSITORY", repository);
    this.token = required("GITHUB_TOKEN", token);
    this.fetch = fetchImpl;
    this.base = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${this.repository}`;
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.base}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });
    if (!response.ok) throw new Error(`GitHub ${options.method ?? "GET"} ${path} returned ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  get(path) { return this.request(path); }
  post(path, body) {
    return this.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
}

const REQUIRED_LABELS = [
  { name: "autonomy-ready", color: "0E8A16", description: "Queued for autonomous implementation" },
  { name: "autonomy-dispatched", color: "1D76DB", description: "Autonomous agent dispatch completed" },
  { name: "autonomy-parallel", color: "5319E7", description: "May run while another pull request is open" },
  { name: "autonomy-blocked", color: "D93F0B", description: "Automation exhausted safe retries" },
  { name: "security-review", color: "B60205", description: "Owner security authorization required" },
  { name: "major-decision", color: "FBCA04", description: "Owner decision required" },
];

async function ensureLabels(api) {
  const labels = await api.get("/labels?per_page=100");
  const existing = new Set(labels.map((label) => label.name));
  for (const label of REQUIRED_LABELS) if (!existing.has(label.name)) await api.post("/labels", label);
}

export async function triggerWorkspaceAgent({ agentId, agentToken, conversationKey, input, idempotencyKey, fetchImpl = fetch }) {
  required("CHATGPT_WORKSPACE_AGENT_ID", agentId);
  required("CHATGPT_WORKSPACE_AGENT_TOKEN", agentToken);
  if (!/^agtch_[A-Za-z0-9_-]+$/u.test(agentId)) throw new Error("CHATGPT_WORKSPACE_AGENT_ID is invalid");
  const response = await fetchImpl(`https://api.chatgpt.com/v1/workspace_agents/${agentId}/trigger`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "workspace_agent_runs=v1",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ conversation_key: conversationKey, input: JSON.stringify(input) }),
  });
  if (response.status !== 202) throw new Error(`Workspace Agent trigger returned HTTP ${response.status}`);
  return response.json();
}

function idempotencyKey(repository, subject, headSha, reason) {
  return `autonomy-${createHash("sha256").update(`${repository}:${subject}:${headSha}:${reason}`).digest("hex")}`;
}

async function dispatchForPullRequest({ api, agent, comments, pr, reason }) {
  const headSha = pr.head.sha;
  if (hasMarker(comments, `dispatch-${reason}`, headSha)) return;
  await triggerWorkspaceAgent({
    ...agent,
    conversationKey: `github:${api.repository}:pr:${pr.number}`,
    idempotencyKey: idempotencyKey(api.repository, `pr:${pr.number}`, headSha, reason),
    input: {
      source: "github.autonomy_supervisor",
      repository: api.repository,
      pull_request: { number: pr.number, url: pr.html_url, head_sha: headSha, base_ref: pr.base.ref },
      reason,
      instruction: "Retrieve fresh GitHub evidence. Continue autonomously within the owner's standing code-only authorization. Merge only after green required checks and an explicit independent Claude acceptance bound to the exact head. Never perform Cloudflare deployment, production, customer, secret, destructive, or permission-expanding operations.",
    },
  });
  await api.post(`/issues/${pr.number}/comments`, {
    body: `${marker(`dispatch-${reason}`, headSha)}\nAutonomy supervisor dispatched the Workspace Agent for \`${reason}\` at exact head \`${headSha}\`.`,
  });
}

async function supervisePullRequest({ api, agent, nowMs, pr }) {
  if (pr.draft) return;
  const headSha = pr.head.sha;
  const [checkData, reviews, comments] = await Promise.all([
    api.get(`/commits/${headSha}/check-runs?per_page=100`),
    api.get(`/pulls/${pr.number}/reviews?per_page=100`),
    api.get(`/issues/${pr.number}/comments?per_page=100`),
  ]);
  const action = nextPullRequestAction({ checkRuns: checkData.check_runs, comments, headSha, nowMs, reviews });
  if (action.kind === "wait") return;
  if (action.kind === "request-review") {
    await api.post(`/issues/${pr.number}/comments`, {
      body: `${marker(`claude-request-${action.attempt}`, headSha)}\n@claude Review exact head \`${headSha}\`. Return one explicit final verdict: \`ACCEPTED — exact head ${headSha}\` with no surviving findings, or \`REJECTED — exact head ${headSha}\` with each blocking finding. This is automated attempt ${action.attempt} of ${MAX_CLAUDE_REQUESTS}.`,
    });
    return;
  }
  await dispatchForPullRequest({ api, agent, comments, pr, reason: action.reason });
  if (action.reason === "review-stalled") {
    await api.post(`/issues/${pr.number}/labels`, { labels: ["autonomy-blocked"] });
  }
}

async function superviseTaskQueue({ api, agent, openPullRequests }) {
  const issues = await api.get("/issues?state=open&labels=autonomy-ready&sort=created&direction=asc&per_page=100");
  const task = issues.find((issue) => !issue.pull_request && !issue.labels.some((label) => ["autonomy-dispatched", "security-review", "major-decision"].includes(label.name)));
  if (!task) return;
  const parallel = task.labels.some((label) => label.name === "autonomy-parallel");
  if (openPullRequests.length > 0 && !parallel) return;
  const reason = "task-ready";
  await triggerWorkspaceAgent({
    ...agent,
    conversationKey: `github:${api.repository}:issue:${task.number}`,
    idempotencyKey: idempotencyKey(api.repository, `issue:${task.number}`, "no-head", reason),
    input: {
      source: "github.autonomy_supervisor",
      repository: api.repository,
      issue: { number: task.number, url: task.html_url, title: task.title },
      reason,
      instruction: "Retrieve the issue and fresh repository evidence, then continue the task autonomously within the owner's standing code-only authorization. Use a branch and pull request. Escalate security issues or major decisions; do not perform Cloudflare deployment, production, customer, secret, destructive, or permission-expanding operations.",
    },
  });
  await api.post(`/issues/${task.number}/labels`, { labels: ["autonomy-dispatched"] });
  await api.post(`/issues/${task.number}/comments`, {
    body: `${marker("dispatch-task-ready", "no-head")}\nAutonomy supervisor dispatched the Workspace Agent for this queued task.`,
  });
}

export async function runSupervisor({
  repository = process.env.GITHUB_REPOSITORY,
  githubToken = process.env.GITHUB_TOKEN,
  agentId = process.env.AGENT_ID,
  agentToken = process.env.AGENT_TOKEN,
  fetchImpl = fetch,
  nowMs = Date.now(),
} = {}) {
  const api = new GitHubApi({ repository, token: githubToken, fetchImpl });
  const agent = { agentId, agentToken, fetchImpl };
  await ensureLabels(api);
  const pullRequests = await api.get("/pulls?state=open&per_page=100");
  for (const pr of pullRequests) await supervisePullRequest({ api, agent, nowMs, pr });
  await superviseTaskQueue({ api, agent, openPullRequests: pullRequests.filter((pr) => !pr.draft) });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSupervisor();
}
