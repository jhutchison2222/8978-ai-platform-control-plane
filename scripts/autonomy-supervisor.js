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
export const SECURITY_STOP_LABEL = "autonomy-security-stop";
export const SECURITY_STOP_ISSUE_NUMBER = 66;

export const SENSITIVE_AUTOMATION_PATHS = [
  ".github/workflows/autonomy-supervisor.yml",
  ".github/workflows/autonomy-watchdog.yml",
  "scripts/autonomy-supervisor.js",
  "scripts/autonomy-watchdog.js",
];

const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const NON_CI_CHECK_NAMES = new Set(["Claude Code Review"]);
const TRUSTED_PR_AUTHOR_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const ACCEPTED_REVIEW = /^ACCEPTED\s*[—:-]\s*exact head\s+([0-9a-f]{40})\s*[—:-]\s*no surviving actionable findings[.]?$/iu;
const REJECTED_REVIEW = /^REJECTED\s*[—:-]\s*exact head\s+([0-9a-f]{40})[.]?$/iu;
const CLEAR_INITIAL_REVIEW = /^\s*(?:ACCEPTED|APPROVED|\*\*code review found no issues\*\*\s*no high-confidence issues detected in this change|no (?:high-confidence |actionable |blocking )?(?:issues|errors|bugs|findings) (?:were )?(?:detected|found)(?: in this change)?|i reviewed this pr and (?:did not|didn['’]t) find any (?:issues|errors|bugs))[.!]?\s*(?:<!--\s*bhrv:[0-9a-f]+\s*-->)?\s*$/iu;
const CLEAR_REREVIEW = /^\s*(?:\*\*code review completed\*\*\s*)?nothing new to post(?::\s*everything this review found is already covered by existing comments on this pull request or didn['’]t merit a separate one)?[.!]?\s*(?:<!--\s*bhrv:[0-9a-f]+\s*-->)?\s*$/iu;
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

function acceptedReview(review) {
  if (!review || review.state === "CHANGES_REQUESTED") return false;
  if (review.state === "APPROVED") return true;
  const commitId = review.commit_id?.toLowerCase();
  const verdicts = (review.body ?? "").split(/\r?\n/u).flatMap((line) => {
    const text = line.trim();
    const rejected = text.match(REJECTED_REVIEW);
    if (rejected && rejected[1].toLowerCase() === commitId) return ["rejected"];
    const accepted = text.match(ACCEPTED_REVIEW);
    if (accepted && accepted[1].toLowerCase() === commitId) return ["accepted"];
    return [];
  });
  if (verdicts.length > 0) return verdicts.at(-1) === "accepted";
  return CLEAR_INITIAL_REVIEW.test(review.body ?? "");
}

export function exactHeadClaudeVerdict(reviews, headSha) {
  const genuine = reviews
    .filter((review) => review.user?.id === CLAUDE_USER_ID && review.user?.login === CLAUDE_LOGIN &&
      review.state !== "DISMISSED")
    .sort((left, right) => Date.parse(left.submitted_at) - Date.parse(right.submitted_at));
  const exact = genuine.filter((review) => review.commit_id === headSha);
  const latest = exact.at(-1);
  if (!latest) return "missing";
  if (latest.state === "CHANGES_REQUESTED") return "rejected";
  if (latest.state === "APPROVED") return "accepted";
  const verdicts = (latest.body ?? "").split(/\r?\n/u).flatMap((line) => {
    const text = line.trim();
    const rejected = text.match(REJECTED_REVIEW);
    if (rejected && rejected[1].toLowerCase() === headSha.toLowerCase()) return ["rejected"];
    const accepted = text.match(ACCEPTED_REVIEW);
    if (accepted && accepted[1].toLowerCase() === headSha.toLowerCase()) return ["accepted"];
    return [];
  });
  if (verdicts.length > 0) return verdicts.at(-1);
  const body = latest.body ?? "";
  if (CLEAR_INITIAL_REVIEW.test(body)) return "accepted";
  const latestIndex = genuine.indexOf(latest);
  const previous = genuine.at(latestIndex - 1);
  if (latestIndex > 0 && acceptedReview(previous) && CLEAR_REREVIEW.test(body)) return "accepted";
  return "inconclusive";
}

export function hasLabel(subject, name) {
  const expected = name.toLowerCase();
  return subject.labels?.some((label) => label.name?.toLowerCase() === expected) ?? false;
}

export function isSensitiveAutomationPath(path) {
  return SENSITIVE_AUTOMATION_PATHS.includes(path);
}

export function securityStopReasons({ issues, pullRequests, changedFilesByPullRequest, ownerLogin }) {
  const reasons = [];
  const stops = issues
    .filter((issue) => !issue.pull_request && issue.number === SECURITY_STOP_ISSUE_NUMBER);
  const openStops = stops.filter((issue) => issue.state === "open");
  if (openStops.length > 0) {
    for (const issue of openStops) {
      reasons.push(`open security stop #${issue.number}`);
    }
  } else {
    const latest = stops.at(-1);
    if (latest && latest.closed_by?.login?.toLowerCase() !== ownerLogin.toLowerCase()) {
      reasons.push(`security stop #${latest.number} was not closed by repository owner ${ownerLogin}`);
    }
  }
  for (const pr of pullRequests) {
    const changedFiles = changedFilesByPullRequest.get(pr.number) ?? [];
    const sensitive = [...new Set(changedFiles.flatMap((file) =>
      [file.filename, file.previous_filename].filter((path) => isSensitiveAutomationPath(path))))];
    if (sensitive.length > 0) {
      reasons.push(`pull request #${pr.number} changes protected automation: ${sensitive.join(", ")}`);
    }
  }
  return reasons;
}

export async function fetchSecurityStop(api) {
  const issue = await api.get(`/issues/${SECURITY_STOP_ISSUE_NUMBER}`);
  if (issue.number !== SECURITY_STOP_ISSUE_NUMBER || issue.pull_request) {
    throw new Error(`Canonical security stop #${SECURITY_STOP_ISSUE_NUMBER} is unavailable`);
  }
  return issue;
}

export async function inspectPullRequestFiles(api, pullRequests) {
  const inspections = await Promise.all(pullRequests.map(async (pr) => {
    try {
      return { number: pr.number, files: await api.getAll(`/pulls/${pr.number}/files`) };
    } catch {
      return {
        number: pr.number,
        files: [],
        failure: `pull request #${pr.number} changed files could not be inspected; dispatch is deferred for this cycle`,
      };
    }
  }));
  return {
    changedFilesByPullRequest: new Map(inspections.map(({ number, files }) => [number, files])),
    failures: inspections.flatMap(({ failure }) => failure ? [failure] : []),
  };
}

export function blockedLabelAction(pr, action) {
  const existing = pr.labels?.find((label) => label.name?.toLowerCase() === "autonomy-blocked");
  if (action.reason === "review-stalled") return existing ? null : { kind: "add" };
  return existing ? { kind: "remove", name: existing.name } : null;
}

export function selectQueuedTasks(issues, hasOpenPullRequests) {
  return issues.filter((issue) => !issue.pull_request &&
    !["autonomy-blocked", "security-review", "major-decision"].some((name) => hasLabel(issue, name)) &&
    (!hasOpenPullRequests || hasLabel(issue, "autonomy-parallel")));
}

export function selectQueuedTask(issues, hasOpenPullRequests) {
  return selectQueuedTasks(issues, hasOpenPullRequests).at(0);
}

export function pullRequestForTask(pullRequests, taskNumber, repository) {
  const escaped = String(taskNumber).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const keyword = `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b\\s*:?\\s*`;
  const shortReference = new RegExp(`${keyword}#${escaped}\\b`, "iu");
  const repositoryReference = typeof repository === "string" && repository !== ""
    ? new RegExp(`${keyword}https?://github\\.com/${repository.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/issues/${escaped}\\b`, "iu")
    : null;
  const branchReference = new RegExp(`(?:^|[/-])(?:issue|task)[/-]?${escaped}(?:$|[/-])`, "iu");
  return pullRequests.find((pr) => TRUSTED_PR_AUTHOR_ASSOCIATIONS.has(pr.author_association?.toUpperCase()) &&
    (shortReference.test(pr.body ?? "") || repositoryReference?.test(pr.body ?? "") ||
      branchReference.test(pr.head?.ref ?? "")));
}

export function hasPullRequestForTask(pullRequests, taskNumber, repository) {
  return Boolean(pullRequestForTask(pullRequests, taskNumber, repository));
}

export function linkedPullRequestPausesTask(pullRequest, nowMs) {
  if (!pullRequest) return false;
  if (!pullRequest.draft) return true;
  const updatedAt = Date.parse(pullRequest.updated_at ?? pullRequest.created_at);
  return Number.isFinite(updatedAt) && nowMs - updatedAt < TASK_DISPATCH_RETRY_DELAY_MS;
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

export function nextPullRequestAction({ checkRuns, comments, headSha, nowMs, reviewThreads = [], reviews }) {
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
    if (reviewThreads.some((thread) => !thread.isResolved)) {
      return { kind: "dispatch", reason: "review-rejected" };
    }
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
    if (!response.ok) {
      const error = new Error(`GitHub ${options.method ?? "GET"} ${path} returned ${response.status}`);
      error.status = response.status;
      throw error;
    }
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

  async graphql(query, variables) {
    const response = await this.fetch(process.env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`GitHub GraphQL request returned ${response.status}`);
    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error("GitHub GraphQL request returned errors");
    }
    return payload.data;
  }

  async reviewThreads(pullRequestNumber) {
    const [owner, name, extra] = this.repository.split("/");
    if (!owner || !name || extra) throw new Error("GITHUB_REPOSITORY must use owner/name format");
    const threads = [];
    let cursor = null;
    do {
      const data = await this.graphql(`
        query ReviewThreads($owner: String!, $name: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $cursor) {
                nodes { id isResolved }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `, { owner, name, number: pullRequestNumber, cursor });
      const connection = data?.repository?.pullRequest?.reviewThreads;
      if (!connection || !Array.isArray(connection.nodes)) {
        throw new Error(`Pull request #${pullRequestNumber} review threads are unavailable`);
      }
      threads.push(...connection.nodes);
      cursor = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
      if (connection.pageInfo?.hasNextPage && !cursor) {
        throw new Error(`Pull request #${pullRequestNumber} review thread pagination is invalid`);
      }
    } while (cursor);
    return threads;
  }
}

const REQUIRED_LABELS = [
  { name: "autonomy-ready", color: "0E8A16", description: "Queued for autonomous implementation" },
  { name: "autonomy-dispatched", color: "1D76DB", description: "Autonomous agent dispatch accepted" },
  { name: "autonomy-parallel", color: "5319E7", description: "May run while another pull request is open" },
  { name: "autonomy-blocked", color: "D93F0B", description: "Automation exhausted safe retries" },
  { name: "security-review", color: "B60205", description: "Owner security authorization required" },
  { name: "major-decision", color: "FBCA04", description: "Owner decision required" },
  { name: SECURITY_STOP_LABEL, color: "B60205", description: "Global owner-controlled stop for autonomous dispatch" },
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

export async function ensureSecurityStop(api, reasons, knownStop) {
  if (reasons.length === 0) return null;
  const stop = knownStop ?? await fetchSecurityStop(api);
  const labels = [SECURITY_STOP_LABEL, "security-review"];
  if (stop.state === "open") {
    if (!labels.every((label) => hasLabel(stop, label))) {
      await api.post(`/issues/${SECURITY_STOP_ISSUE_NUMBER}/labels`, { labels });
    }
    return stop;
  }
  return api.patch(`/issues/${SECURITY_STOP_ISSUE_NUMBER}`, {
    state: "open",
    title: "Autonomous dispatch security stop",
    labels,
    body: [
      "The repository's fail-closed automation guard stopped all new Workspace Agent dispatches.",
      "",
      "Detected conditions:",
      ...reasons.map((reason) => `- ${reason}`),
      "",
      "Only the repository owner may reactivate autonomous dispatch, after reviewing and resolving every condition, by closing this issue. The supervisor and watchdog never close this issue automatically.",
    ].join("\n"),
  });
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
      instruction: "Retrieve fresh GitHub evidence. Continue autonomously within the owner's standing code-only authorization. A genuine exact-head initial Claude review may provide technical clearance through explicit acceptance/approval or unambiguous whole-review no-issues/no-errors wording. A genuine exact-head re-review may also clear with the canonical 'Nothing new to post' response when an earlier genuine Claude review exists. Require green exact-head checks and no unresolved review threads. Treat mixed or caveated wording, stale reviews, rejection, actionable findings, deferral, and owner security decisions as fail-closed. Never perform Cloudflare deployment, production, customer, secret, destructive, or permission-expanding operations.",
    },
  });
  await api.post(`/issues/${pr.number}/comments`, {
    body: `${marker(`dispatch-${reason}`, headSha)}\nAutonomy supervisor dispatched the Workspace Agent for \`${reason}\` at exact head \`${headSha}\`.`,
  });
}

async function supervisePullRequest({ api, agent, nowMs, pr }) {
  if (pr.draft) return;
  const headSha = pr.head.sha;
  const [checkData, reviews, comments, reviewThreads] = await Promise.all([
    api.getAll(`/commits/${headSha}/check-runs`, "check_runs"),
    api.getAll(`/pulls/${pr.number}/reviews`),
    api.getAll(`/issues/${pr.number}/comments`),
    api.reviewThreads(pr.number),
  ]);
  const action = nextPullRequestAction({ checkRuns: checkData, comments, headSha, nowMs, reviewThreads, reviews });
  const labelAction = blockedLabelAction(pr, action);
  if (labelAction?.kind === "add") {
    await api.post(`/issues/${pr.number}/labels`, { labels: ["autonomy-blocked"] });
  } else if (labelAction?.kind === "remove") {
    await api.delete(`/issues/${pr.number}/labels/${encodeURIComponent(labelAction.name)}`);
  }
  if (action.kind === "wait") return;
  if (action.kind === "request-review") {
    await api.post(`/issues/${pr.number}/comments`, {
      body: `${marker(`claude-request-${action.attempt}`, headSha)}\n@claude Review exact head \`${headSha}\`. Return exactly one explicit final verdict: \`ACCEPTED — exact head ${headSha} — no surviving actionable findings.\`, or \`REJECTED — exact head ${headSha}\` followed by every surviving actionable finding. This is automated attempt ${action.attempt} of ${MAX_CLAUDE_REQUESTS}.`,
    });
    return;
  }
  await dispatchForPullRequest({ api, agent, comments, pr, reason: action.reason });
}

export async function superviseTaskQueue({ api, agent, nowMs, pullRequests }) {
  const issues = await api.getAll("/issues?state=open&labels=autonomy-ready&sort=created&direction=asc");
  const candidates = selectQueuedTasks(issues, pullRequests.some((pr) => !pr.draft));
  const errors = [];
  let dispatched = false;
  for (const task of candidates) {
    try {
      const linkedPullRequest = pullRequestForTask(pullRequests, task.number, api.repository);
      if (linkedPullRequestPausesTask(linkedPullRequest, nowMs)) continue;
      const comments = await api.getAll(`/issues/${task.number}/comments`);
      const action = nextTaskDispatchAction({ comments, nowMs });
      if (action.kind === "wait") continue;
      if (action.kind === "block") {
        if (!hasMarker(comments, "task-dispatch-stalled", "no-head")) {
          await api.post(`/issues/${task.number}/comments`, {
            body: `${marker("task-dispatch-stalled", "no-head")}\nWorkspace Agent dispatch was accepted ${MAX_TASK_DISPATCHES} times without the issue closing. Owner-visible investigation is required; no further automatic dispatch will occur.`,
          });
        }
        await api.post(`/issues/${task.number}/labels`, { labels: ["autonomy-blocked"] });
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
      dispatched = true;
      await api.post(`/issues/${task.number}/comments`, {
        body: `${marker(`dispatch-task-ready${action.attempt === 1 ? "" : `-${action.attempt}`}`, "no-head")}\nAutonomy supervisor dispatch attempt ${action.attempt} of ${MAX_TASK_DISPATCHES} was accepted for this queued task.`,
      });
      await api.post(`/issues/${task.number}/labels`, { labels: ["autonomy-dispatched"] });
      break;
    } catch (error) {
      errors.push(error);
      console.error(`Task #${task.number} supervision failed:`, error);
      if (dispatched) break;
    }
  }
  if (errors.length > 0) throw new AggregateError(errors,
    `Task queue supervision failed${dispatched ? " after a later task was dispatched" : ""}`);
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
  const [securityStop, fileInspections] = await Promise.all([
    fetchSecurityStop(api),
    inspectPullRequestFiles(api, pullRequests),
  ]);
  const persistentReasons = securityStopReasons({
    issues: [securityStop],
    pullRequests,
    changedFilesByPullRequest: fileInspections.changedFilesByPullRequest,
    ownerLogin: repository.split("/", 1)[0],
  });
  const reasons = [...persistentReasons, ...fileInspections.failures];
  if (reasons.length > 0) {
    await ensureSecurityStop(api, persistentReasons, securityStop);
    console.error(`Autonomous dispatch stopped: ${reasons.join("; ")}`);
    return;
  }
  const errors = await runAllIsolated(pullRequests,
    (pr) => supervisePullRequest({ api, agent, nowMs, pr }),
    (error) => console.error("Pull request supervision failed:", error));
  try {
    await superviseTaskQueue({ api, agent, nowMs, pullRequests });
  } catch (error) {
    errors.push(error);
    console.error("Task queue supervision failed:", error);
  }
  if (errors.length > 0) throw new AggregateError(errors, "One or more supervisor items failed after independent processing");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSupervisor();
}
