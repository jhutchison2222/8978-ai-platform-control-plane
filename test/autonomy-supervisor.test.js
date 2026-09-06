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
  SECURITY_STOP_LABEL,
  SECURITY_STOP_ISSUE_NUMBER,
  GitHubApi,
  blockedLabelAction,
  checkState,
  claudeRequests,
  ensureLabels,
  ensureSecurityStop,
  exactHeadClaudeVerdict,
  fetchSecurityStop,
  hasLabel,
  hasMarker,
  hasPullRequestForTask,
  inspectPullRequestFiles,
  linkedPullRequestPausesTask,
  marker,
  nextPullRequestAction,
  nextTaskDispatchAction,
  pullRequestForTask,
  runAllIsolated,
  securityStopReasons,
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
    'cron: "2-59/5 * * * *"',
    'workflows: ["validate"]',
    "pull_request_review:",
    "types: [submitted]",
    "issues:",
    "types: [labeled, reopened]",
    "actions: read",
    "checks: read",
    "contents: read",
    "issues: write",
    "pull-requests: write",
    "group: autonomy-control",
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

test("exact-head Claude verdicts accept bounded initial and re-review clearance", () => {
  assert.equal(exactHeadClaudeVerdict([review(`ACCEPTED — exact head ${HEAD} — no surviving actionable findings.`)], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review(`No blocking issues found.\nACCEPTED — exact head ${HEAD} — no surviving actionable findings.`)], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("ACCEPTED")], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("APPROVED")], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("", { state: "APPROVED" })], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("LGTM")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("looks good")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("**Code review found no issues**\n\nNo high-confidence issues detected in this change.\n\n<!-- bhrv:abc123 -->")], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("I reviewed this PR and didn't find any bugs.")], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("No blocking issues found.")], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("Nothing new to post")], HEAD), "inconclusive");
  const priorReview = review("File A needs repair", { commit_id: "b".repeat(40), submitted_at: "2026-09-01T17:40:00Z" });
  assert.equal(exactHeadClaudeVerdict([priorReview, review("**Code review completed**\n\nNothing new to post: everything this review found is already covered by existing comments on this pull request or didn't merit a separate one.\n\n<!-- bhrv:abc123 -->")], HEAD), "accepted");
  const untrustedPrior = review("File A needs repair", { user: { id: 7, login: "attacker" }, commit_id: "b".repeat(40), submitted_at: "2026-09-01T17:40:00Z" });
  assert.equal(exactHeadClaudeVerdict([untrustedPrior, review("Nothing new to post")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("prior", { commit_id: "b".repeat(40), state: "DISMISSED", submitted_at: "2026-09-01T17:40:00Z" }), review("Nothing new to post")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("Nothing new to post, but token handling carries a moderate risk that should be addressed before merge.")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("No bugs found, but a blocking finding remains and must be fixed")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("No bugs found, but there is a moderate risk in token handling that should be addressed before merge")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("I reviewed this PR and didn't find any bugs — human authorization is still required")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("LGTM", { commit_id: "b".repeat(40) })], HEAD), "missing");
  assert.equal(exactHeadClaudeVerdict([review(`ACCEPTED — exact head ${"b".repeat(40)} — no surviving actionable findings.`)], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review(`REJECTED — exact head ${HEAD}`)], HEAD), "rejected");
  assert.equal(exactHeadClaudeVerdict([review("REJECTED")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("File A looks good, but File B has SQL injection; do not merge")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review(`ACCEPTED — exact head ${HEAD} — no surviving actionable findings.\nREQUEST_CHANGES was the prior status`)], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("LGTM"), review("blocking", { state: "CHANGES_REQUESTED", submitted_at: "2026-09-01T17:55:00Z" })], HEAD), "rejected");
  assert.equal(exactHeadClaudeVerdict([review("approved, but token handling should be fixed")], HEAD), "inconclusive");
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

test("GitHub review-thread requests paginate and preserve resolved state", async () => {
  const cursors = [];
  const fetchImpl = async (_url, options) => {
    const { variables } = JSON.parse(options.body);
    cursors.push(variables.cursor);
    const first = variables.cursor === null;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { repository: { pullRequest: { reviewThreads: {
        nodes: [{ id: first ? "first" : "second", isResolved: !first }],
        pageInfo: { hasNextPage: first, endCursor: first ? "cursor-1" : null },
      } } } } }),
    };
  };
  const api = new GitHubApi({ repository: "owner/repo", token: "fixture", fetchImpl });
  assert.deepEqual(await api.reviewThreads(62), [
    { id: "first", isResolved: false },
    { id: "second", isResolved: true },
  ]);
  assert.deepEqual(cursors, [null, "cursor-1"]);
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
  assert.equal(created.length, 5);
  assert.deepEqual(updated, [{ path:"/labels/Autonomy-Dispatched", description:"Autonomous agent dispatch accepted" }]);
  assert.equal(hasLabel({ labels: [{ name: "AUTONOMY-BLOCKED" }] }, "autonomy-blocked"), true);
});

test("global security stops fail closed and only the repository owner can clear them", () => {
  const inputs = {
    pullRequests: [],
    changedFilesByPullRequest: new Map(),
    ownerLogin: "owner",
  };
  assert.deepEqual(securityStopReasons({
    ...inputs,
    issues: [{ number: SECURITY_STOP_ISSUE_NUMBER, state: "open", labels: [] }],
  }), [`open security stop #${SECURITY_STOP_ISSUE_NUMBER}`]);
  assert.deepEqual(securityStopReasons({
    ...inputs,
    issues: [{ number: SECURITY_STOP_ISSUE_NUMBER, state: "closed", closed_by: { login: "collaborator" }, labels: [] }],
  }), [`security stop #${SECURITY_STOP_ISSUE_NUMBER} was not closed by repository owner owner`]);
  assert.deepEqual(securityStopReasons({
    ...inputs,
    issues: [{ number: SECURITY_STOP_ISSUE_NUMBER, state: "closed", closed_by: { login: "OWNER" }, labels: [] }],
  }), []);
  assert.deepEqual(securityStopReasons({
    ...inputs,
    issues: [{ number: 7, state: "open", labels: [{ name: SECURITY_STOP_LABEL }] }],
  }), []);
});

test("open changes to the dispatch boundary stop all autonomous dispatch", () => {
  const pullRequests = [{ number: 62 }];
  assert.deepEqual(securityStopReasons({
    issues: [],
    pullRequests,
    changedFilesByPullRequest: new Map([[62, [
      { filename: "README.md" },
      { filename: "scripts/autonomy-supervisor.js" },
    ]]]),
    ownerLogin: "owner",
  }), ["pull request #62 changes protected automation: scripts/autonomy-supervisor.js"]);
});

test("canonical security stop is idempotent, label-independent, and only reopens", async () => {
  const posts = [];
  const patches = [];
  const existing = {
    number: SECURITY_STOP_ISSUE_NUMBER,
    state: "open",
    labels: [{ name: SECURITY_STOP_LABEL }, { name: "security-review" }],
  };
  const api = {
    post: async (path, body) => posts.push({ path, body }),
    patch: async (path, body) => patches.push({ path, body }),
  };
  assert.equal(await ensureSecurityStop(api, ["fixture violation"], existing), existing);
  assert.deepEqual(posts, []);
  assert.deepEqual(patches, []);

  await ensureSecurityStop(api, ["fixture violation"], { ...existing, labels: [] });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, `/issues/${SECURITY_STOP_ISSUE_NUMBER}/labels`);
  assert.deepEqual(posts[0].body.labels, [SECURITY_STOP_LABEL, "security-review"]);

  await ensureSecurityStop(api, ["fixture violation"], { ...existing, state: "closed" });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].path, `/issues/${SECURITY_STOP_ISSUE_NUMBER}`);
  assert.equal(patches[0].body.state, "open");
  assert.match(patches[0].body.body, /never close this issue automatically/iu);
  assert.equal(await ensureSecurityStop(api, []), null);
  assert.equal(patches.length, 1);
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

test("only trusted linked implementation pull requests pause task redispatch", () => {
  const trusted = (overrides) => ({ author_association: "OWNER", ...overrides });
  assert.equal(hasPullRequestForTask([trusted({ body: "Closes #61", head: { ref: "agent/live-test" } })], 61, "owner/repo"), true);
  assert.equal(hasPullRequestForTask([trusted({ body: "Resolves https://github.com/owner/repo/issues/61", head: { ref: "agent/live-test" } })], 61, "owner/repo"), true);
  assert.equal(hasPullRequestForTask([trusted({ body: "Closes https://github.com/other/repo/issues/61", head: { ref: "agent/live-test" } })], 61, "owner/repo"), false);
  assert.equal(hasPullRequestForTask([trusted({ body: "discloses #61", head: { ref: "agent/live-test" } })], 61, "owner/repo"), false);
  assert.equal(hasPullRequestForTask([trusted({ body: "No issue reference", head: { ref: "agent/issue-61-live-test" } })], 61, "owner/repo"), true);
  assert.equal(hasPullRequestForTask([trusted({ body: "Related: #61", head: { ref: "agent/live-test" } })], 61, "owner/repo"), false);
  assert.equal(hasPullRequestForTask([trusted({ body: "Blocked by https://github.com/owner/repo/issues/61", head: { ref: "agent/live-test" } })], 61, "owner/repo"), false);
  assert.equal(hasPullRequestForTask([trusted({ body: "Closes #610", head: { ref: "agent/live-test" } })], 61, "owner/repo"), false);
  assert.equal(hasPullRequestForTask([trusted({ body: null, head: { ref: "agent/live-test" } })], 61, "owner/repo"), false);
  assert.equal(hasPullRequestForTask([{ author_association: "NONE", body: "Closes #61", head: { ref: "attacker/issue-61" } }], 61, "owner/repo"), false);
  assert.equal(hasPullRequestForTask([{ author_association: "CONTRIBUTOR", body: "Closes #61", head: { ref: "attacker/issue-61" } }], 61, "owner/repo"), false);
  assert.equal(hasPullRequestForTask([{ body: "Closes #61", head: { ref: "attacker/issue-61" } }], 61, "owner/repo"), false);
  assert.equal(hasPullRequestForTask([{ author_association: "collaborator", body: "Closes #61", head: { ref: "agent/issue-61" } }], 61, "owner/repo"), true);
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
    pullRequests: [{
      author_association: "OWNER",
      draft: true,
      updated_at: new Date(NOW - TASK_DISPATCH_RETRY_DELAY_MS + 1).toISOString(),
      body: "Closes #61",
      head: { ref: "agent/issue-61" },
    }],
  });
  assert.equal(commentsFetched, false);
});

test("an inactive linked draft returns to the bounded task retry path", () => {
  const draft = {
    author_association: "OWNER",
    draft: true,
    updated_at: new Date(NOW - TASK_DISPATCH_RETRY_DELAY_MS).toISOString(),
    body: "Closes #61",
    head: { ref: "agent/issue-61" },
  };
  const linked = pullRequestForTask([draft], 61, "owner/repo");
  assert.equal(linked, draft);
  assert.equal(linkedPullRequestPausesTask(linked, NOW), false);
  assert.equal(linkedPullRequestPausesTask({ ...draft, draft: false }, NOW), true);
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
  assert.deepEqual(posts.map(({ path }) => path), ["/issues/2/comments", "/issues/2/labels"]);
});

test("an accepted trigger stops the run even when GitHub recording fails", async () => {
  let triggers = 0;
  let secondCommentsFetched = false;
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
      if (path === "/issues/2/comments") secondCommentsFetched = true;
      return [];
    },
    post: async (path) => {
      if (path === "/issues/1/comments") throw new Error("fixture recording failure");
    },
  };
  const agent = {
    agentId: "agtch_fixture",
    agentToken: "fixture",
    fetchImpl: async () => {
      triggers += 1;
      return { status: 202, json: async () => ({ accepted: true }) };
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      superviseTaskQueue({ api, agent, nowMs: NOW, pullRequests: [] }),
      (error) => error instanceof AggregateError && error.errors[0].message === "fixture recording failure",
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(triggers, 1);
  assert.equal(secondCommentsFetched, false);
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
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [review(`ACCEPTED — exact head ${HEAD} — no surviving actionable findings.`)] }), { kind: "dispatch", reason: "merge-ready" });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [review(`REJECTED — exact head ${HEAD}`)] }), { kind: "dispatch", reason: "review-rejected" });
  assert.deepEqual(nextPullRequestAction({
    checkRuns: checks,
    comments: [],
    headSha: HEAD,
    nowMs: NOW,
    reviewThreads: [{ id: "unresolved", isResolved: false }],
    reviews: [review(`ACCEPTED — exact head ${HEAD} — no surviving actionable findings.`)],
  }), { kind: "dispatch", reason: "review-rejected" });
});

test("event-triggered dispatch receives a ten-minute head start", () => {
  const recentFailure = [{ name: "test", status: "completed", conclusion: "failure", completed_at: new Date(NOW - EVENT_DISPATCH_FALLBACK_DELAY_MS + 1).toISOString() }];
  assert.deepEqual(nextPullRequestAction({ checkRuns: recentFailure, comments: [], headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "wait", reason: "event-dispatch-fallback-delay" });
  const recentAcceptance = review(`ACCEPTED — exact head ${HEAD} — no surviving actionable findings.`, { submitted_at: new Date(NOW - EVENT_DISPATCH_FALLBACK_DELAY_MS + 1).toISOString() });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [recentAcceptance] }), { kind: "wait", reason: "event-dispatch-fallback-delay" });
});

test("dispatch markers are exact-head idempotency records", () => {
  const body = `${marker("dispatch-merge-ready", HEAD)}\nDispatched.`;
  assert.equal(hasMarker([{ body }], "dispatch-merge-ready", HEAD), true);
  assert.equal(hasMarker([{ body }], "dispatch-merge-ready", "b".repeat(40)), false);
});


test("the canonical security stop is fetched directly and cannot vanish with its label", async () => {
  const detailed = { number: SECURITY_STOP_ISSUE_NUMBER, state: "closed", closed_by: { login: "owner" }, labels: [] };
  const requested = [];
  const stop = await fetchSecurityStop({
    get: async (path) => {
      requested.push(path);
      return detailed;
    },
  });
  assert.deepEqual(requested, [`/issues/${SECURITY_STOP_ISSUE_NUMBER}`]);
  assert.equal(stop, detailed);
  assert.deepEqual(securityStopReasons({
    issues: [stop],
    pullRequests: [],
    changedFilesByPullRequest: new Map(),
    ownerLogin: "owner",
  }), []);
});

test("changed-file inspection isolates failures and preserves other PR results", async () => {
  const inspected = await inspectPullRequestFiles({
    getAll: async (path) => {
      if (path === "/pulls/1/files") throw new Error("transient fixture failure");
      return [{ filename: "scripts/autonomy-watchdog.js" }];
    },
  }, [{ number: 1 }, { number: 2 }]);
  assert.deepEqual(inspected.changedFilesByPullRequest.get(1), []);
  assert.deepEqual(inspected.changedFilesByPullRequest.get(2), [{ filename: "scripts/autonomy-watchdog.js" }]);
  assert.deepEqual(inspected.failures, [
    "pull request #1 changed files could not be inspected; dispatch is deferred for this cycle",
  ]);
  assert.deepEqual(securityStopReasons({
    issues: [],
    pullRequests: [{ number: 1 }, { number: 2 }],
    changedFilesByPullRequest: inspected.changedFilesByPullRequest,
    ownerLogin: "owner",
  }), ["pull request #2 changes protected automation: scripts/autonomy-watchdog.js"]);
});

test("protected automation renames trigger the security stop using the previous path", () => {
  assert.deepEqual(securityStopReasons({
    issues: [],
    pullRequests: [{ number: 62 }],
    changedFilesByPullRequest: new Map([[62, [{
      filename: "archive/old-watchdog.js",
      previous_filename: "scripts/autonomy-watchdog.js",
      status: "renamed",
    }]]]),
    ownerLogin: "owner",
  }), ["pull request #62 changes protected automation: scripts/autonomy-watchdog.js"]);
});
