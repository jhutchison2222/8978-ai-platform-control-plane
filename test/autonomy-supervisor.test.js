import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLAUDE_LOGIN,
  CLAUDE_USER_ID,
  EVENT_DISPATCH_FALLBACK_DELAY_MS,
  LATER_ACTION_DELAY_MS,
  SECOND_REQUEST_DELAY_MS,
  SUPERVISOR_LOGIN,
  checkState,
  claudeRequests,
  exactHeadClaudeVerdict,
  hasMarker,
  marker,
  nextPullRequestAction,
  runAllIsolated,
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
  assert.equal(exactHeadClaudeVerdict([review(`REJECTED — exact head ${HEAD}`)], HEAD), "rejected");
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
