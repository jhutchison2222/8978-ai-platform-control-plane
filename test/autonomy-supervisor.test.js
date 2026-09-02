import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLAUDE_LOGIN,
  CLAUDE_USER_ID,
  EVENT_DISPATCH_FALLBACK_DELAY_MS,
  LATER_ACTION_DELAY_MS,
  MAX_TASK_DISPATCHES,
  SECOND_REQUEST_DELAY_MS,
  SUPERVISOR_LOGIN,
  TASK_DISPATCH_RETRY_DELAY_MS,
  GitHubApi,
  blockedLabelAction,
  checkState,
  claudeRequests,
  ensureLabels,
  exactHeadClaudeVerdict,
  hasLabel,
  hasMarker,
  hasPullRequestForTask,
  marker,
  nextPullRequestAction,
  nextTaskDispatchAction,
  runAllIsolated,
  selectQueuedTask,
  selectQueuedTasks,
  superviseTaskQueue,
  taskDispatches,
} from "../scripts/autonomy-supervisor.js";

const HEAD = "a".repeat(40);
const NOW = Date.parse("2026-09-01T18:00:00Z");
const checks = [{ name: "test", status: "completed", conclusion: "success", completed_at: "2026-09-01T17:30:00Z" }];
const review = (body, overrides = {}) => ({
  user: { id: CLAUDE_USER_ID, login: CLAUDE_LOGIN },
  commit_id: HEAD,
  state: "COMMENTED",
  submitted_at: "2026-09-01T17:50:00Z",
  body,
  ...overrides,
});
const request = (createdAt, attempt = 1, overrides = {}) => ({
  user: { login: SUPERVISOR_LOGIN },
  body: `${marker(`claude-request-${attempt}`, HEAD)}\n@claude exact ${HEAD}`,
  created_at: createdAt,
  ...overrides,
});

test("workflow is scheduled and least-privilege", async () => {
  const workflow = await readFile(".github/workflows/autonomy-supervisor.yml", "utf8");
  for (const required of [
    'cron: "*/5 * * * *"',
    "actions: read",
    "checks: read",
    "contents: read",
    "issues: write",
    "pull-requests: write",
    "node scripts/autonomy-supervisor.js",
  ]) assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(workflow, /contents:\s*write|deploy|wrangler|cloudflare/iu);
});

test("check state is fail-closed", () => {
  assert.equal(checkState([]), "pending");
  assert.equal(checkState([{ name: "test", status: "in_progress", conclusion: null }]), "pending");
  assert.equal(checkState([{ name: "test", status: "completed", conclusion: "failure" }]), "failed");
  assert.equal(checkState([{ name: "lint", status: "completed", conclusion: "neutral" }, ...checks]), "passed");
});

test("a stalled Claude check cannot hold green CI", () => {
  const stalledClaude = { name: "Claude Code Review", status: "in_progress", conclusion: null };
  assert.equal(checkState([stalledClaude]), "pending");
  assert.equal(checkState([...checks, stalledClaude]), "passed");
});

test("only an explicit exact-head Claude verdict is accepted", () => {
  assert.equal(exactHeadClaudeVerdict([review(`ACCEPTED — exact head ${HEAD}`)], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review(`No blocking issues found.\nACCEPTED — exact head ${HEAD}`)], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("No bugs found, but human review is still required")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("LGTM", { commit_id: "b".repeat(40) })], HEAD), "missing");
  assert.equal(exactHeadClaudeVerdict([review(`ACCEPTED — exact head ${"b".repeat(40)}`)], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review(`REJECTED — exact head ${HEAD}`)], HEAD), "rejected");
  assert.equal(exactHeadClaudeVerdict([review("File A looks good, but File B has SQL injection; do not merge")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review(`ACCEPTED — exact head ${HEAD}\nREQUEST_CHANGES was the prior status`)], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("LGTM"), review("blocking", { state: "CHANGES_REQUESTED", submitted_at: "2026-09-01T17:55:00Z" })], HEAD), "rejected");
  assert.equal(exactHeadClaudeVerdict([review("LGTM", { state: "DISMISSED" })], HEAD), "missing");
});

test("only supervisor-authored exact-head markers consume retry attempts", () => {
  const valid = request("2026-09-01T17:30:00Z");
  const arbitrary = { user: { login: "attacker" }, body: `@claude exact ${HEAD}`, created_at: "2026-09-01T17:31:00Z" };
  const forgedMarker = { ...valid, user: { login: "attacker" } };
  assert.deepEqual(claudeRequests([arbitrary, forgedMarker, valid], HEAD), [valid]);
});

test("one failed item cannot prevent later supervision", async () => {
  const visited = [];
  const reported = [];
  const errors = await runAllIsolated([1, 2, 3], async (item) => {
    visited.push(item);
    if (item === 2) throw new Error("fixture failure");
  }, (error) => reported.push(error.message));
  assert.deepEqual(visited, [1, 2, 3]);
  assert.equal(errors.length, 1);
  assert.deepEqual(reported, ["fixture failure"]);
});

test("GitHub list requests paginate until a short page", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    const data = page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }];
    return { ok: true, status: 200, json: async () => data };
  };
  const api = new GitHubApi({ repository: "owner/repo", token: "fixture", fetchImpl });
  const items = await api.getAll("/issues?state=open");
  assert.equal(items.length, 101);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /state=open&per_page=100&page=1$/u);
  assert.match(calls[1], /state=open&per_page=100&page=2$/u);
});

test("required labels recognize GitHub case-insensitive matches", async () => {
  const created = [];
  const updated = [];
  const api = {
    getAll: async () => [
      { name: "Security-Review", description: "custom" },
      { name: "Autonomy-Dispatched", description: "Autonomous agent dispatch completed" },
    ],
    post: async (_path, label) => created.push(label.name),
    patch: async (path, label) => updated.push({ path, ...label }),
  };
  await ensureLabels(api);
  assert.equal(created.includes("security-review"), false);
  assert.equal(created.includes("autonomy-dispatched"), false);
  assert.equal(created.length, 4);
  assert.deepEqual(updated, [{ path:"/labels/Autonomy-Dispatched", description:"Autonomous agent dispatch accepted" }]);
  assert.equal(hasLabel({ labels: [{ name: "AUTONOMY-BLOCKED" }] }, "autonomy-blocked"), true);
});

test("the blocked label is idempotent and clears after recovery", () => {
  const blocked = { labels: [{ name: "Autonomy-Blocked" }] };
  assert.equal(blockedLabelAction(blocked, { reason: "review-stalled" }), null);
  assert.deepEqual(blockedLabelAction({ labels: [] }, { reason: "review-stalled" }), { kind: "add" });
  assert.deepEqual(blockedLabelAction(blocked, { reason: "checks-pending" }), { kind: "remove", name: "Autonomy-Blocked" });
  assert.equal(blockedLabelAction({ labels: [] }, { reason: "merge-ready" }), null);
});

test("a parallel task can bypass an older sequential task while PRs are open", () => {
  const sequential = { number: 1, labels: [{ name: "autonomy-ready" }] };
  const parallel = { number: 2, labels: [{ name: "Autonomy-Parallel" }] };
  assert.equal(selectQueuedTask([sequential, parallel], true), parallel);
  assert.equal(selectQueuedTask([sequential, parallel], false), sequential);
  assert.equal(selectQueuedTask([{ ...parallel, labels: [{ name: "SECURITY-REVIEW" }, { name: "autonomy-parallel" }] }], true), undefined);
  assert.equal(selectQueuedTask([{ ...parallel, labels: [{ name: "autonomy-dispatched" }, { name: "autonomy-parallel" }] }], true)?.number, 2);
  assert.equal(selectQueuedTask([{ ...parallel, labels: [{ name: "autonomy-blocked" }, { name: "autonomy-parallel" }] }], true), undefined);
  assert.deepEqual(selectQueuedTasks([sequential, parallel], true), [parallel]);
});

test("accepted task dispatches retry with fresh attempts and then block", () => {
  const dispatch = (attempt, createdAt, overrides = {}) => ({
    user: { login: SUPERVISOR_LOGIN },
    body: `${marker(`dispatch-task-ready${attempt === 1 ? "" : `-${attempt}`}`, "no-head")}\nAccepted.`,
    created_at: createdAt,
    ...overrides,
  });
  const first = dispatch(1, new Date(NOW - TASK_DISPATCH_RETRY_DELAY_MS).toISOString());
  assert.deepEqual(taskDispatches([{ ...first, user: { login: "attacker" } }, first]), [first]);
  assert.deepEqual(nextTaskDispatchAction({ comments: [], nowMs: NOW }), { kind: "dispatch", attempt: 1 });
  assert.deepEqual(nextTaskDispatchAction({ comments: [dispatch(1, new Date(NOW - TASK_DISPATCH_RETRY_DELAY_MS + 1).toISOString())], nowMs: NOW }), { kind: "wait" });
  assert.deepEqual(nextTaskDispatchAction({ comments: [first], nowMs: NOW }), { kind: "dispatch", attempt: 2 });
  const two = [first, dispatch(2, new Date(NOW - TASK_DISPATCH_RETRY_DELAY_MS).toISOString())];
  assert.deepEqual(nextTaskDispatchAction({ comments: two, nowMs: NOW }), { kind: "dispatch", attempt: 3 });
  const three = [...two, dispatch(MAX_TASK_DISPATCHES, new Date(NOW - TASK_DISPATCH_RETRY_DELAY_MS).toISOString())];
  assert.deepEqual(nextTaskDispatchAction({ comments: three, nowMs: NOW }), { kind: "block" });
  assert.deepEqual(nextTaskDispatchAction({ comments: [{ ...first, created_at: null }], nowMs: NOW }), { kind: "wait" });
});

test("a linked implementation pull request pauses task redispatch", () => {
  assert.equal(hasPullRequestForTask([{ body: "Closes #61", head: { ref: "agent/live-test" } }], 61), true);
  assert.equal(hasPullRequestForTask([{ body: "Resolves https://github.com/owner/repo/issues/61", head: { ref: "agent/live-test" } }], 61), true);
  assert.equal(hasPullRequestForTask([{ body: "No issue reference", head: { ref: "agent/issue-61-live-test" } }], 61), true);
  assert.equal(hasPullRequestForTask([{ body: "Related: #61", head: { ref: "agent/live-test" } }], 61), false);
  assert.equal(hasPullRequestForTask([{ body: "Blocked by https://github.com/owner/repo/issues/61", head: { ref: "agent/live-test" } }], 61), false);
  assert.equal(hasPullRequestForTask([{ body: "Closes #610", head: { ref: "agent/live-test" } }], 61), false);
  assert.equal(hasPullRequestForTask([{ body: null, head: { ref: "agent/live-test" } }], 61), false);
});

test("a linked draft pull request pauses task redispatch", async () => {
  let commentsFetched = false;
  const api = {
    repository: "owner/repo",
    getAll: async (path) => {
      if (path.startsWith("/issues?")) {
        return [{ number: 61, labels: [{ name: "autonomy-ready" }], html_url: "https://example.test/61", title: "Task" }];
      }
      commentsFetched = true;
      return [];
    },
    post: async () => assert.fail("linked draft task must not be mutated"),
  };
  await superviseTaskQueue({
    api,
    agent: {},
    nowMs: NOW,
    pullRequests: [{ draft: true, body: "Closes #61", head: { ref: "agent/issue-61" } }],
  });
  assert.equal(commentsFetched, false);
});

test("one task failure cannot starve a later dispatchable task", async () => {
  const posts = [];
  const api = {
    repository: "owner/repo",
    getAll: async (path) => {
      if (path.startsWith("/issues?")) {
        return [1, 2].map((number) => ({
          number,
          labels: [{ name: "autonomy-ready" }],
          html_url: `https://example.test/${number}`,
          title: `Task ${number}`,
        }));
      }
      if (path === "/issues/1/comments") throw new Error("fixture comments failure");
      return [];
    },
    post: async (path, body) => posts.push({ path, body }),
  };
  const agent = {
    agentId: "agtch_fixture",
    agentToken: "fixture",
    fetchImpl: async () => ({ status: 202, json: async () => ({ accepted: true }) }),
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      superviseTaskQueue({ api, agent, nowMs: NOW, pullRequests: [] }),
      (error) => error instanceof AggregateError && error.errors[0].message === "fixture comments failure",
    );
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(posts.map(({ path }) => path), ["/issues/2/labels", "/issues/2/comments"]);
});

test("stall reporting is owner-visible and retryable before blocking", async () => {
  const oldDispatches = Array.from({ length: MAX_TASK_DISPATCHES }, (_, index) => ({
    user: { login: SUPERVISOR_LOGIN },
    body: `${marker(`dispatch-task-ready${index === 0 ? "" : `-${index + 1}`}`, "no-head")}\nAccepted.`,
    created_at: new Date(NOW - TASK_DISPATCH_RETRY_DELAY_MS).toISOString(),
  }));
  const posts = [];
  const api = {
    repository: "owner/repo",
    getAll: async (path) => path.startsWith("/issues?")
      ? [{ number: 61, labels: [{ name: "autonomy-ready" }] }]
      : oldDispatches,
    post: async (path, body) => posts.push({ path, body }),
  };
  await superviseTaskQueue({ api, agent: {}, nowMs: NOW, pullRequests: [] });
  assert.deepEqual(posts.map(({ path }) => path), ["/issues/61/comments", "/issues/61/labels"]);

  posts.length = 0;
  const stalled = { user: { login: SUPERVISOR_LOGIN }, body: marker("task-dispatch-stalled", "no-head") };
  api.getAll = async (path) => path.startsWith("/issues?")
    ? [{ number: 61, labels: [{ name: "autonomy-ready" }] }]
    : [...oldDispatches, stalled];
  await superviseTaskQueue({ api, agent: {}, nowMs: NOW, pullRequests: [] });
  assert.deepEqual(posts.map(({ path }) => path), ["/issues/61/labels"]);
});

test("green PRs request Claude and retry on capped delays", () => {
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "request-review", attempt: 1 });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [request(new Date(NOW - SECOND_REQUEST_DELAY_MS).toISOString())], headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "request-review", attempt: 2 });
  const two = [request("2026-09-01T17:30:00Z"), request(new Date(NOW - LATER_ACTION_DELAY_MS).toISOString(), 2)];
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: two, headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "request-review", attempt: 3 });
  const three = [...two, request(new Date(NOW - LATER_ACTION_DELAY_MS).toISOString(), 3)];
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: three, headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "dispatch", reason: "review-stalled" });
});

test("checks and verdicts route to the Workspace Agent", () => {
  assert.deepEqual(nextPullRequestAction({ checkRuns: [{ name: "test", status: "completed", conclusion: "failure", completed_at: new Date(NOW - EVENT_DISPATCH_FALLBACK_DELAY_MS).toISOString() }], comments: [], headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "dispatch", reason: "checks-failed" });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [review("LGTM")] }), { kind: "dispatch", reason: "merge-ready" });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [review("REJECTED")] }), { kind: "dispatch", reason: "review-rejected" });
});

test("event-triggered dispatch receives a ten-minute head start", () => {
  const recentFailure = [{ name: "test", status: "completed", conclusion: "failure", completed_at: new Date(NOW - EVENT_DISPATCH_FALLBACK_DELAY_MS + 1).toISOString() }];
  assert.deepEqual(nextPullRequestAction({ checkRuns: recentFailure, comments: [], headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "wait", reason: "event-dispatch-fallback-delay" });
  const recentAcceptance = review("LGTM", { submitted_at: new Date(NOW - EVENT_DISPATCH_FALLBACK_DELAY_MS + 1).toISOString() });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [recentAcceptance] }), { kind: "wait", reason: "event-dispatch-fallback-delay" });
});

test("dispatch markers are exact-head idempotency records", () => {
  const body = `${marker("dispatch-merge-ready", HEAD)}\nDispatched.`;
  assert.equal(hasMarker([{ body }], "dispatch-merge-ready", HEAD), true);
  assert.equal(hasMarker([{ body }], "dispatch-merge-ready", "b".repeat(40)), false);
});
