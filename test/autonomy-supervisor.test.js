import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLAUDE_LOGIN,
  CLAUDE_USER_ID,
  EVENT_DISPATCH_FALLBACK_DELAY_MS,
  LATER_ACTION_DELAY_MS,
  SECOND_REQUEST_DELAY_MS,
  checkState,
  exactHeadClaudeVerdict,
  hasMarker,
  marker,
  nextPullRequestAction,
} from "../scripts/autonomy-supervisor.js";

const HEAD = "a".repeat(40);
const NOW = Date.parse("2026-09-01T18:00:00Z");
const checks = [{ status: "completed", conclusion: "success", completed_at: "2026-09-01T17:30:00Z" }];
const review = (body, overrides = {}) => ({
  user: { id: CLAUDE_USER_ID, login: CLAUDE_LOGIN },
  commit_id: HEAD,
  state: "COMMENTED",
  submitted_at: "2026-09-01T17:50:00Z",
  body,
  ...overrides,
});
const request = (createdAt) => ({ body: `@claude exact ${HEAD}`, created_at: createdAt });

test("workflow is scheduled and least-privilege", async () => {
  const workflow = await readFile(".github/workflows/autonomy-supervisor.yml", "utf8");
  for (const required of [
    'cron: "*/5 * * * *"',
    "actions: read",
    "contents: read",
    "issues: write",
    "pull-requests: write",
    "node scripts/autonomy-supervisor.js",
  ]) assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(workflow, /contents:\s*write|deploy|wrangler|cloudflare/iu);
});

test("check state is fail-closed", () => {
  assert.equal(checkState([]), "pending");
  assert.equal(checkState([{ status: "in_progress", conclusion: null }]), "pending");
  assert.equal(checkState([{ status: "completed", conclusion: "failure" }]), "failed");
  assert.equal(checkState([{ status: "completed", conclusion: "neutral" }, ...checks]), "passed");
});

test("only an explicit exact-head Claude verdict is accepted", () => {
  assert.equal(exactHeadClaudeVerdict([review(`ACCEPTED — exact head ${HEAD}`)], HEAD), "accepted");
  assert.equal(exactHeadClaudeVerdict([review("No bugs found, but human review is still required")], HEAD), "inconclusive");
  assert.equal(exactHeadClaudeVerdict([review("LGTM", { commit_id: "b".repeat(40) })], HEAD), "missing");
  assert.equal(exactHeadClaudeVerdict([review(`REJECTED — exact head ${HEAD}`)], HEAD), "rejected");
  assert.equal(exactHeadClaudeVerdict([review("LGTM"), review("blocking", { state: "CHANGES_REQUESTED", submitted_at: "2026-09-01T17:55:00Z" })], HEAD), "rejected");
});

test("green PRs request Claude and retry on capped delays", () => {
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "request-review", attempt: 1 });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [request(new Date(NOW - SECOND_REQUEST_DELAY_MS).toISOString())], headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "request-review", attempt: 2 });
  const two = [request("2026-09-01T17:30:00Z"), request(new Date(NOW - LATER_ACTION_DELAY_MS).toISOString())];
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: two, headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "request-review", attempt: 3 });
  const three = [...two, request(new Date(NOW - LATER_ACTION_DELAY_MS).toISOString())];
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: three, headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "dispatch", reason: "review-stalled" });
});

test("checks and verdicts route to the Workspace Agent", () => {
  assert.deepEqual(nextPullRequestAction({ checkRuns: [{ status: "completed", conclusion: "failure", completed_at: new Date(NOW - EVENT_DISPATCH_FALLBACK_DELAY_MS).toISOString() }], comments: [], headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "dispatch", reason: "checks-failed" });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [review("LGTM")] }), { kind: "dispatch", reason: "merge-ready" });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [review("REJECTED")] }), { kind: "dispatch", reason: "review-rejected" });
});

test("event-triggered dispatch receives a ten-minute head start", () => {
  const recentFailure = [{ status: "completed", conclusion: "failure", completed_at: new Date(NOW - EVENT_DISPATCH_FALLBACK_DELAY_MS + 1).toISOString() }];
  assert.deepEqual(nextPullRequestAction({ checkRuns: recentFailure, comments: [], headSha: HEAD, nowMs: NOW, reviews: [] }), { kind: "wait", reason: "event-dispatch-fallback-delay" });
  const recentAcceptance = review("LGTM", { submitted_at: new Date(NOW - EVENT_DISPATCH_FALLBACK_DELAY_MS + 1).toISOString() });
  assert.deepEqual(nextPullRequestAction({ checkRuns: checks, comments: [], headSha: HEAD, nowMs: NOW, reviews: [recentAcceptance] }), { kind: "wait", reason: "event-dispatch-fallback-delay" });
});

test("dispatch markers are exact-head idempotency records", () => {
  const body = `${marker("dispatch-merge-ready", HEAD)}\nDispatched.`;
  assert.equal(hasMarker([{ body }], "dispatch-merge-ready", HEAD), true);
  assert.equal(hasMarker([{ body }], "dispatch-merge-ready", "b".repeat(40)), false);
});
