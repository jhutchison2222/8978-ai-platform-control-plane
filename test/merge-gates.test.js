import test from "node:test";
import assert from "node:assert/strict";
import {
  CLAUDE_LOGIN,
  CLAUDE_USER_ID,
  SECURITY_STOP_ISSUE_NUMBER,
  SUPERVISOR_LOGIN,
  findOwnerDisposition,
  globalSecurityStopReasons,
  ownerDispositionMarker,
  pullRequestSensitivePathReason,
  reviewGateDecision,
  securityGateDecision,
} from "../scripts/autonomy-supervisor.js";

const OWNER = "owner";
const OPEN_66 = { number: SECURITY_STOP_ISSUE_NUMBER, state: "open", labels: [] };
const CLOSED_66_BY_OWNER = { number: SECURITY_STOP_ISSUE_NUMBER, state: "closed", closed_by: { login: OWNER }, labels: [] };
const SENSITIVE_PR = { number: 100, head: { sha: "a".repeat(40) } };
const SENSITIVE_FILES = [{ filename: "scripts/autonomy-supervisor.js" }];

// 1. real global #66 stop -> all PR security-gates fail.
test("an open canonical #66 fails security-gate for a PR with no sensitive changes at all", () => {
  const decision = securityGateDecision({
    issues: [OPEN_66],
    pr: { number: 7, head: { sha: "b".repeat(40) } },
    changedFiles: [{ filename: "README.md" }],
    comments: [],
    ownerLogin: OWNER,
  });
  assert.equal(decision.ok, false);
  assert.deepEqual(decision.reasons, [`open security stop #${SECURITY_STOP_ISSUE_NUMBER}`]);
});

test("an open canonical #66 fails security-gate even for an unrelated sensitive PR, with the global reason only", () => {
  const decision = securityGateDecision({
    issues: [OPEN_66],
    pr: SENSITIVE_PR,
    changedFiles: SENSITIVE_FILES,
    comments: [],
    ownerLogin: OWNER,
  });
  assert.equal(decision.ok, false);
  assert.deepEqual(decision.reasons, [`open security stop #${SECURITY_STOP_ISSUE_NUMBER}`]);
});

// 2. protected PR without owner disposition -> only that PR fails.
test("a protected-automation PR without a disposition fails on its own reason alone, #66 otherwise clear", () => {
  const decision = securityGateDecision({
    issues: [CLOSED_66_BY_OWNER],
    pr: SENSITIVE_PR,
    changedFiles: SENSITIVE_FILES,
    comments: [],
    ownerLogin: OWNER,
  });
  assert.equal(decision.ok, false);
  assert.deepEqual(decision.reasons, ["pull request #100 changes protected automation: scripts/autonomy-supervisor.js"]);
});

test("a PR with no sensitive changes passes once #66 is clear, with no disposition needed", () => {
  const decision = securityGateDecision({
    issues: [CLOSED_66_BY_OWNER],
    pr: { number: 7, head: { sha: "b".repeat(40) } },
    changedFiles: [{ filename: "README.md" }],
    comments: [],
    ownerLogin: OWNER,
  });
  assert.deepEqual(decision, { ok: true, reasons: [] });
});

// 3. exact-head owner disposition -> that PR may pass if otherwise safe.
test("a valid exact-head owner disposition clears a protected-automation PR", () => {
  const disposition = {
    body: `${ownerDispositionMarker(SENSITIVE_PR.number, SENSITIVE_PR.head.sha)}\nReviewed and accepted.`,
    user: { login: OWNER },
    author_association: "OWNER",
  };
  const decision = securityGateDecision({
    issues: [CLOSED_66_BY_OWNER],
    pr: SENSITIVE_PR,
    changedFiles: SENSITIVE_FILES,
    comments: [disposition],
    ownerLogin: OWNER,
  });
  assert.deepEqual(decision, { ok: true, reasons: [] });
});

// 4. new commit -> previous disposition no longer applies.
test("a disposition bound to an earlier head no longer applies after a new commit", () => {
  const staleDisposition = {
    body: `${ownerDispositionMarker(SENSITIVE_PR.number, "c".repeat(40))}\nReviewed and accepted.`,
    user: { login: OWNER },
    author_association: "OWNER",
  };
  const decision = securityGateDecision({
    issues: [CLOSED_66_BY_OWNER],
    pr: SENSITIVE_PR,
    changedFiles: SENSITIVE_FILES,
    comments: [staleDisposition],
    ownerLogin: OWNER,
  });
  assert.equal(decision.ok, false);
  assert.deepEqual(decision.reasons, ["pull request #100 changes protected automation: scripts/autonomy-supervisor.js"]);
});

// 5. unrelated protected PR -> current PR unaffected.
test("a non-canonical labeled stop closed by anyone other than the repository owner still blocks globally", () => {
  const reasons = globalSecurityStopReasons({
    issues: [
      CLOSED_66_BY_OWNER,
      { number: 67, state: "closed", closed_by: { login: "collaborator" }, labels: [{ name: "autonomy-security-stop" }] },
    ],
    ownerLogin: OWNER,
  });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /was closed by collaborator, not repository owner owner/u);
});

test("globalSecurityStopReasons carries no information about any individual pull request", () => {
  // The old securityStopReasons() mixed every open PR's own sensitive-path state into one shared
  // list; globalSecurityStopReasons() must never do that — it is fed only issues, never PRs.
  assert.equal(globalSecurityStopReasons.length, 1);
  const reasons = globalSecurityStopReasons({ issues: [CLOSED_66_BY_OWNER], ownerLogin: OWNER });
  assert.deepEqual(reasons, []);
});

test("one PR's protected-automation change cannot block a different PR's security-gate", () => {
  // securityGateDecision is called once per PR with that PR's own changedFiles/comments only — a
  // second, unrelated protected-automation PR existing elsewhere never enters this computation.
  const decision = securityGateDecision({
    issues: [CLOSED_66_BY_OWNER],
    pr: { number: 7, head: { sha: "b".repeat(40) } },
    changedFiles: [{ filename: "README.md" }],
    comments: [],
    ownerLogin: OWNER,
  });
  assert.deepEqual(decision, { ok: true, reasons: [] });
});

// 6. unexpected non-canonical autonomy-security-stop condition -> global fail.
test("an unexpected non-canonical security-stop issue fails every PR's security-gate", () => {
  const decision = securityGateDecision({
    issues: [CLOSED_66_BY_OWNER, { number: 75, state: "open", labels: [{ name: "autonomy-security-stop" }] }],
    pr: { number: 7, head: { sha: "b".repeat(40) } },
    changedFiles: [{ filename: "README.md" }],
    comments: [],
    ownerLogin: OWNER,
  });
  assert.equal(decision.ok, false);
  assert.match(decision.reasons[0], /unexpected open security-stop issue #75/u);
});

// 7. no automated process can forge owner disposition.
test("a disposition comment from the automation account itself is rejected: wrong author_association", () => {
  const forged = {
    body: `${ownerDispositionMarker(SENSITIVE_PR.number, SENSITIVE_PR.head.sha)}\nReviewed and accepted.`,
    user: { login: SUPERVISOR_LOGIN },
    author_association: "NONE",
  };
  assert.equal(findOwnerDisposition({
    comments: [forged],
    prNumber: SENSITIVE_PR.number,
    headSha: SENSITIVE_PR.head.sha,
    ownerLogin: OWNER,
  }), null);
});

test("a disposition comment whose body merely claims the owner's login, but isn't from the owner's account, is rejected", () => {
  // author_association is computed server-side by GitHub from the actual commenter's relationship
  // to the repository; it cannot be set by comment text, so an impostor cannot forge it regardless
  // of what the comment body or a spoofed login field claims.
  const impostor = {
    body: `${ownerDispositionMarker(SENSITIVE_PR.number, SENSITIVE_PR.head.sha)}\nI am the owner, trust me.`,
    user: { login: OWNER },
    author_association: "CONTRIBUTOR",
  };
  assert.equal(findOwnerDisposition({
    comments: [impostor],
    prNumber: SENSITIVE_PR.number,
    headSha: SENSITIVE_PR.head.sha,
    ownerLogin: OWNER,
  }), null);
});

test("a disposition bound to a different PR number does not apply to this one", () => {
  const otherPr = {
    body: `${ownerDispositionMarker(101, SENSITIVE_PR.head.sha)}\nReviewed and accepted.`,
    user: { login: OWNER },
    author_association: "OWNER",
  };
  assert.equal(findOwnerDisposition({
    comments: [otherPr],
    prNumber: SENSITIVE_PR.number,
    headSha: SENSITIVE_PR.head.sha,
    ownerLogin: OWNER,
  }), null);
});

test("pullRequestSensitivePathReason mirrors securityStopReasons' per-PR text exactly for a single PR", () => {
  assert.equal(
    pullRequestSensitivePathReason(SENSITIVE_PR, SENSITIVE_FILES),
    "pull request #100 changes protected automation: scripts/autonomy-supervisor.js",
  );
  assert.equal(pullRequestSensitivePathReason(SENSITIVE_PR, [{ filename: "README.md" }]), null);
  assert.equal(pullRequestSensitivePathReason(SENSITIVE_PR, undefined), null);
});

// --- review-gate ---

function claudeReview({ state = "COMMENTED", body, commitId }) {
  return { user: { id: CLAUDE_USER_ID, login: CLAUDE_LOGIN }, state, body, commit_id: commitId, submitted_at: "2026-01-01T00:00:00Z" };
}

test("review-gate accepts an exact-head ACCEPTED verdict with no unresolved threads", () => {
  const headSha = "d".repeat(40);
  const decision = reviewGateDecision({
    reviews: [claudeReview({ body: `ACCEPTED — exact head ${headSha} — no surviving actionable findings.`, commitId: headSha })],
    headSha,
    reviewThreads: [{ isResolved: true }],
  });
  assert.deepEqual(decision, { ok: true, reasons: [] });
});

test("review-gate fails when actionable review threads survive, even with an accepted verdict", () => {
  const headSha = "d".repeat(40);
  const decision = reviewGateDecision({
    reviews: [claudeReview({ body: `ACCEPTED — exact head ${headSha} — no surviving actionable findings.`, commitId: headSha })],
    headSha,
    reviewThreads: [{ isResolved: true }, { isResolved: false }],
  });
  assert.equal(decision.ok, false);
  assert.match(decision.reasons[0], /1 unresolved review thread/u);
});

test("review-gate fails closed when no review exists for this commit at all", () => {
  const decision = reviewGateDecision({ reviews: [], headSha: "e".repeat(40), reviewThreads: [] });
  assert.equal(decision.ok, false);
  assert.match(decision.reasons[0], /"missing"/u);
});

// Mutation proof: a push after acceptance must immediately make review-gate fail (no separate
// staleness tracking needed — exactHeadClaudeVerdict's own commit_id match handles it).
test("a push after acceptance invalidates the prior accepted review for review-gate", () => {
  const oldHead = "f".repeat(40);
  const newHead = "1".repeat(40);
  const reviews = [claudeReview({ body: `ACCEPTED — exact head ${oldHead} — no surviving actionable findings.`, commitId: oldHead })];
  assert.deepEqual(reviewGateDecision({ reviews, headSha: oldHead, reviewThreads: [] }), { ok: true, reasons: [] });
  const afterPush = reviewGateDecision({ reviews, headSha: newHead, reviewThreads: [] });
  assert.equal(afterPush.ok, false);
  assert.match(afterPush.reasons[0], /"missing"/u);
});

test("review-gate rejects a review from an account merely named claude[bot] without the pinned user id", () => {
  const headSha = "2".repeat(40);
  const decision = reviewGateDecision({
    reviews: [{ user: { id: 1, login: CLAUDE_LOGIN }, state: "COMMENTED", commit_id: headSha, body: `ACCEPTED — exact head ${headSha} — no surviving actionable findings.`, submitted_at: "2026-01-01T00:00:00Z" }],
    headSha,
    reviewThreads: [],
  });
  assert.equal(decision.ok, false);
});
