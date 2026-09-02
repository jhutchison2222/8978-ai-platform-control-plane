import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const CLAUDE_LOGIN = "claude[bot]";
export const CLAUDE_USER_ID = 209825114;
export const SUPERVISOR_LOGIN = "github-actions[bot]";
export const MAX_CLAUDE_REQUESTS = 3;
export const MAX_TASK_DISPATCHES = 3;
export const SECOND_REQUEST_DELAY_MS = 10 * 60 * 1000;
export const LATER_ACTION_DELAY_MS = 15 * 60 * 1000;
export const EVENT_DISPATCH_FALLBACK_DELAY_MS = 10 * 60 * 1000;
export const TASK_DISPATCH_RETRY_DELAY_MS = 15 * 60 * 1000;

const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const NON_CI_CHECK_NAMES = new Set(["Claude Code Review"]);
const ACCEPTED_REVIEW = /^(?:ACCEPTED(?:\s*[—:-]\s*exact head\s+([0-9a-f]{40}))?|LGTM|looks good)[.!]?$/iu;
const REJECTED_REVIEW = /^(?:REJECTED(?:\s*[—:-]\s*exact head\s+([0-9a-f]{40}))?|REQUEST_CHANGES)[.!]?$/iu;
const MARKER_PREFIX = "<!-- autonomy-supervisor:";

function required(name, value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is not configured`);
  return value;
}

export function checkState(checkRuns) {
  const ciRuns = Array.isArray(checkRuns) ? checkRuns.filter((run) => !NON_CI_CHECK_NAMES.has(run.name)) : [];
  if (ciRuns.length === 0) return "pending";
  if (ciRuns.some((run) => run.status !== "completed")) return "pending";
  return ciRuns.every((run) => SUCCESS_CONCLUSIONS.has(run.conclusion)) ? "passed" : "failed";
}

export function exactHeadClaudeVerdict(reviews, headSha) {
  const exact = reviews
    .filter((review) => review.user?.id === CLAUDE_USER_ID && review.user?.login === CLAUDE_LOGIN &&
      review.commit_id === headSha && review.state !== "DISMISSED")
    .sort((left, right) => Date.parse(left.submitted_at) - Date.parse(right.submitted_at));
  const latest = exact.at(-1);
  if (!latest) return "missing";
  if (latest.state === "CHANGES_REQUESTED") return "rejected";
  const verdicts = (latest.body ?? "").split(/\r?\n/u).flatMap((line) => {
    const text = line.trim();
    const rejected = text.match(REJECTED_REVIEW);
    if (rejected && (!rejected[1] || rejected[1].toLowerCase() === headSha.toLowerCase())) return ["rejected"];
    const accepted = text.match(ACCEPTED_REVIEW);
    if (accepted && (!accepted[1] || accepted[1].toLowerCase() === headSha.toLowerCase())) return ["accepted"];
    return [];
  });
  return verdicts.at(-1) ?? "inconclusive";
}

export function hasLabel(subject, name) {
  const expected = name.toLowerCase();
  return subject.labels?.some((label) => label.name?.toLowerCase() === expected) ?? false;
}

export function blockedLabelAction(pr, action) {
  const existing = pr.labels?.find((label) => label.name?.toLowerCase() === "autonomy-blocked");
  if (action.reason === "review-stalled") return existing ? null : { kind: "add" };
  return existing ? { kind: "remove", name: existing.name } : null;
}

export function selectQueuedTask(issues, hasOpenPullRequests) {
  return issues.find((issue) => !issue.pull_request &&
    !["autonomy-blocked", "security-review", "major-decision"].some((name) => hasLabel(issue, name)) &&
    (!hasOpenPullRequests || hasLabel(issue, "autonomy-parallel")));
}

export function hasPullRequestForTask(pullRequests, taskNumber) {
  const escaped = String(taskNumber).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const bodyReference = new RegExp(`(?:#|/issues/)${escaped}\\b`, "iu");
  const branchReference = new RegExp(`(?:^|[/-])(?:issue|task)[/-]?${escaped}(?:$|[/-])`, "iu");
  return pullRequests.some((pr) => bodyReference.test(pr.body ?? "") || branchReference.test(pr.head?.ref ?? ""));
}

export function taskDispatches(comments) {
  return comments
    .filter((comment) => comment.user?.login === SUPERVISOR_LOGIN && typeof comment.body === "string" &&
      /<!-- autonomy-supervisor:dispatch-task-ready(?:-\d+)?:no-head -->/u.test(comment.body))
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

export function nextTaskDispatchAction({ comments, nowMs }) {
  const dispatches = taskDispatches(comments);
  if (dispatches.length === 0) return { kind: "dispatch", attempt: 1 };
  const elapsed = nowMs - Date.parse(dispatches.at(-1).created_at);
  if (!Number.isFinite(elapsed) || elapsed < TASK_DISPATCH_RETRY_DELAY_MS) return { kind: "wait" };
  if (dispatches.length < MAX_TASK_DISPATCHES) return { kind: "dispatch", attempt: dispatches.length + 1 };
  return { kind: "block" };
}

export function claudeRequests(comments, headSha) {
  const expectedPrefix = `${MARKER_PREFIX}claude-request-`;
  return comments
    .filter((comment) => comment.user?.login === SUPERVISOR_LOGIN && typeof comment.body === "string" &&
      comment.body.includes(expectedPrefix) && comment.body.includes(`:${headSha} -->`) && comment.body.includes("@claude"))
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

export async function runAllIsolated(items, handler, onError = console.error) {
  const errors = [];
  for (const item of items) {
    try {
      await handler(item);
    } catch (error) {
      errors.push(error);
      onError(error);
    }
  }
  return errors;
}

export function nextPullRequestAction({ checkRuns, comments, headSha, nowMs, reviews }) {
  const checks = checkState(checkRuns);
  if (checks === "pending") return { kind: "wait", reason: "checks-pending" };
  if (checks === "failed") {
    const latestCompletion = Math.max(...checkRuns
      .filter((run) => !NON_CI_CHECK_NAMES.has(run.name))
      .map((run) => Date.parse(run.completed_at ?? 0)));
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

export class GitHubApi {
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
  async getAll(path, field) {
    const items = [];
    for (let page = 1; ; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const data = await this.get(`${path}${separator}per_page=100&page=${page}`);
      const pageItems = field ? data[field] : data;
      if (!Array.isArray(pageItems)) throw new Error(`GitHub GET ${path} did not return a list`);
      items.push(...pageItems);
      if (pageItems.length < 100) return items;
    }
  }
  post(path, body) {
    return this.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  patch(path, body) {
    return this.request(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  delete(path) { return this.request(path, { method: "DELETE" }); }
}

const REQUIRED_LABELS = [
  { name: "autonomy-ready", color: "0E8A16", description: "Queued for autonomous implementation" },
  { name: "autonomy-dispatched", color: "1D76DB", description: "Autonomous agent dispatch accepted" },
  { name: "autonomy-parallel", color: "5319E7", description: "May run while another pull request is open" },
  { name: "autonomy-blocked", color: "D93F0B", description: "Automation exhausted safe retries" },
  { name: "security-review", color: "B60205", description: "Owner security authorization required" },
  { name: "major-decision", color: "FBCA04", description: "Owner decision required" },
];

export async function ensureLabels(api) {
  const labels = await api.getAll("/labels");
  const existing = new Map(labels.map((label) => [label.name.toLowerCase(), label]));
  for (const label of REQUIRED_LABELS) {
    const current = existing.get(label.name.toLowerCase());
    if (!current) {
      await api.post("/labels", label);
    } else if (label.name === "autonomy-dispatched" && current.description === "Autonomous agent dispatch completed") {
      await api.patch(`/labels/${encodeURIComponent(current.name)}`, { description: label.description });
    }
  }
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
    api.getAll(`/commits/${headSha}/check-runs`, "check_runs"),
    api.getAll(`/pulls/${pr.number}/reviews`),
    api.getAll(`/issues/${pr.number}/comments`),
  ]);
  const action = nextPullRequestAction({ checkRuns: checkData, comments, headSha, nowMs, reviews });
  const labelAction = blockedLabelAction(pr, action);
  if (labelAction?.kind === "add") {
    await api.post(`/issues/${pr.number}/labels`, { labels: ["autonomy-blocked"] });
  } else if (labelAction?.kind === "remove") {
    await api.delete(`/issues/${pr.number}/labels/${encodeURIComponent(labelAction.name)}`);
  }
  if (action.kind === "wait") return;
  if (action.kind === "request-review") {
    await api.post(`/issues/${pr.number}/comments`, {
      body: `${marker(`claude-request-${action.attempt}`, headSha)}\n@claude Review exact head \`${headSha}\`. Return one explicit final verdict: \`ACCEPTED — exact head ${headSha}\` with no surviving findings, or \`REJECTED — exact head ${headSha}\` with each blocking finding. This is automated attempt ${action.attempt} of ${MAX_CLAUDE_REQUESTS}.`,
    });
    return;
  }
  await dispatchForPullRequest({ api, agent, comments, pr, reason: action.reason });
}

async function superviseTaskQueue({ api, agent, nowMs, openPullRequests }) {
  const issues = await api.getAll("/issues?state=open&labels=autonomy-ready&sort=created&direction=asc");
  const candidates = issues.filter((issue) => !issue.pull_request &&
    !["autonomy-blocked", "security-review", "major-decision"].some((name) => hasLabel(issue, name)) &&
    (openPullRequests.length === 0 || hasLabel(issue, "autonomy-parallel")));
  for (const task of candidates) {
    if (hasPullRequestForTask(openPullRequests, task.number)) continue;
    const comments = await api.getAll(`/issues/${task.number}/comments`);
    const action = nextTaskDispatchAction({ comments, nowMs });
    if (action.kind === "wait") continue;
    if (action.kind === "block") {
      await api.post(`/issues/${task.number}/labels`, { labels: ["autonomy-blocked"] });
      await api.post(`/issues/${task.number}/comments`, {
        body: `${marker("task-dispatch-stalled", "no-head")}\nWorkspace Agent dispatch was accepted ${MAX_TASK_DISPATCHES} times without the issue closing. Owner-visible investigation is required; no further automatic dispatch will occur.`,
      });
      continue;
    }
    const reason = action.attempt === 1 ? "task-ready" : `task-ready-retry-${action.attempt}`;
    await triggerWorkspaceAgent({
      ...agent,
      conversationKey: `github:${api.repository}:issue:${task.number}`,
      idempotencyKey: idempotencyKey(api.repository, `issue:${task.number}`, "no-head", reason),
      input: {
        source: "github.autonomy_supervisor",
        repository: api.repository,
        issue: { number: task.number, url: task.html_url, title: task.title },
        reason,
        attempt: action.attempt,
        instruction: `Retrieve the issue and fresh repository evidence, then continue the task autonomously within the owner's standing code-only authorization. Use a branch and pull request whose body includes \"Closes #${task.number}\" so the supervisor can detect active implementation. If an earlier run stalled, resume or repair it. Escalate security issues or major decisions; do not perform Cloudflare deployment, production, customer, secret, destructive, or permission-expanding operations.`,
      },
    });
    await api.post(`/issues/${task.number}/labels`, { labels: ["autonomy-dispatched"] });
    await api.post(`/issues/${task.number}/comments`, {
      body: `${marker(`dispatch-task-ready${action.attempt === 1 ? "" : `-${action.attempt}`}`, "no-head")}\nAutonomy supervisor dispatch attempt ${action.attempt} of ${MAX_TASK_DISPATCHES} was accepted for this queued task.`,
    });
    return;
  }
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
  const pullRequests = await api.getAll("/pulls?state=open");
  const errors = await runAllIsolated(pullRequests,
    (pr) => supervisePullRequest({ api, agent, nowMs, pr }),
    (error) => console.error("Pull request supervision failed:", error));
  try {
    await superviseTaskQueue({ api, agent, nowMs, openPullRequests: pullRequests.filter((pr) => !pr.draft) });
  } catch (error) {
    errors.push(error);
    console.error("Task queue supervision failed:", error);
  }
  if (errors.length > 0) throw new AggregateError(errors, "One or more supervisor items failed after independent processing");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSupervisor();
}
