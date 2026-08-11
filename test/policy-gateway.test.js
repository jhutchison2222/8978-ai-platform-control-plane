import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { digestRequestedAction } from "../src/canonical-digest.js";
import {
  authorizeByOwnerException,
  evaluateAction,
  PolicyGateway,
  validateOwnerExceptionDecision,
} from "../src/policy-gateway.js";
import { createExecutionRecord, InMemoryIdempotencyRegistry } from "../src/execution-record.js";

const policySet = JSON.parse(
  await readFile(new URL("../policies/development-standing-policies.json", import.meta.url)),
);
const gateway = await PolicyGateway.create(policySet, {
  revalidateStandingState: async () => true,
});

function action(overrides = {}) {
  return {
    actionId: "action-1",
    operation: "commit",
    resource: { kind: "github_repository", id: "jhutchison2222/8978-ai-platform-control-plane" },
    environment: "development",
    risk: "medium",
    costUsd: 0,
    recordCount: 1,
    productionSensitive: false,
    destructiveProductionOrCustomerData: false,
    credentialScopeExpansion: false,
    newProductionExternalWriteIntegration: false,
    finalOwnerDecisionChange: false,
    legalPrivacyComplianceContractualDecision: false,
    proposingAgent: "maker-agent",
    review: null,
    testEvidence: [],
    rollbackPlan: { strategy: "revert_commit" },
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    payload: { files: ["README.md"] },
    ...overrides,
  };
}

async function boundAction(overrides = {}) {
  const requested = action(overrides);
  const requestedActionDigest = await digestRequestedAction(requested);
  requested.review = {
    reviewer: "checker-agent",
    verdict: "approved",
    requestedActionDigest,
  };
  requested.testEvidence = [
    { testId: "unit", result: "passed", requestedActionDigest },
    { testId: "artifact-validation", result: "passed", requestedActionDigest },
  ];
  return requested;
}

test("standing policy authorizes an in-scope development action", async () => {
  const result = await gateway.evaluate(await boundAction());
  assert.equal(result.outcome, "authorized_by_standing_policy");
  assert.deepEqual(result.authorizingPolicy, {
    policyId: "dev-github-control-plane",
    policyVersion: "1.0.0",
  });
});

test("malformed action input is denied without an owner approval request", async () => {
  const result = await evaluateAction(action({ risk: "unknown" }), policySet);
  assert.equal(result.outcome, "denied");
  assert.equal(result.reason, "invalid_requested_action");
  assert.equal(result.ownerApprovalRequest, undefined);
});

test("normal validation gaps block without creating owner approval", async () => {
  const result = await evaluateAction(action(), policySet);
  assert.equal(result.outcome, "validation_required");
  assert.equal(result.ownerApprovalRequest, undefined);
});

test("no active policy fails closed and creates a digest-bound exception request", async () => {
  const requested = action({ resource: { kind: "cloudflare_d1", id: "unapproved-d1" } });
  const result = await evaluateAction(requested, policySet);
  assert.equal(result.outcome, "owner_approval_required");
  assert.deepEqual(result.ownerApprovalRequest.reasons, ["no_active_standing_policy"]);
  assert.equal(result.ownerApprovalRequest.requestedActionDigest, await digestRequestedAction(requested));
  await assert.rejects(() => gateway.assertExecutable(requested, result), /Execution denied/);
});

test("disabled placeholders cannot authorize execution", async () => {
  const result = await evaluateAction(
    action({
      operation: "write_test_data",
      resource: { kind: "cloudflare_d1", id: "__OWNER_APPROVED_DEVELOPMENT_D1_ID__" },
    }),
    policySet,
  );
  assert.equal(result.outcome, "owner_approval_required");
});

test("production and sensitive flags always use the owner exception path", async () => {
  const production = await evaluateAction(action({ environment: "production" }), policySet);
  assert.equal(production.outcome, "owner_approval_required");
  assert.ok(production.ownerApprovalRequest.reasons.includes("production_environment"));

  const credential = await evaluateAction(action({ credentialScopeExpansion: true }), policySet);
  assert.ok(credential.ownerApprovalRequest.reasons.includes("credential_scope_expansion"));
});

test("policy limit overruns create an owner exception request", async () => {
  const result = await evaluateAction(action({ recordCount: 101 }), policySet);
  assert.equal(result.outcome, "owner_approval_required");
  assert.ok(result.ownerApprovalRequest.reasons.includes("resource_threshold_exceeded"));
});

test("policy boundaries are inclusive and operation, environment, risk, and cost are enforced", async () => {
  const boundary = await evaluateAction(await boundAction({ recordCount: 100 }), policySet);
  assert.equal(boundary.outcome, "authorized_by_standing_policy");

  for (const requested of [
    action({ operation: "delete_repository" }),
    action({ environment: "staging" }),
    action({ risk: "high" }),
    action({ costUsd: 0.01 }),
  ]) {
    const result = await evaluateAction(requested, policySet);
    assert.equal(result.outcome, "owner_approval_required");
  }
});

test("every exceptional owner boundary precedes standing authorization", async () => {
  const flags = [
    "productionSensitive",
    "destructiveProductionOrCustomerData",
    "credentialScopeExpansion",
    "newProductionExternalWriteIntegration",
    "finalOwnerDecisionChange",
    "legalPrivacyComplianceContractualDecision",
  ];
  for (const flag of flags) {
    const result = await evaluateAction(action({ [flag]: true }), policySet);
    assert.equal(result.outcome, "owner_approval_required", flag);
  }
});

test("missing, self-authored, or digest-mismatched review and missing rollback block execution", async () => {
  const requested = await boundAction();
  const cases = [
    { ...requested, review: null },
    { ...requested, review: { ...requested.review, reviewer: "maker-agent" } },
    { ...requested, review: { ...requested.review, requestedActionDigest: "sha256:" + "0".repeat(64) } },
    { ...requested, rollbackPlan: null },
  ];
  for (const candidate of cases) {
    const result = await evaluateAction(candidate, policySet);
    assert.equal(result.outcome, "validation_required");
    assert.equal(result.ownerApprovalRequest, undefined);
  }
});

test("expired and duplicate matching policies fail closed", async () => {
  const requested = await boundAction();
  const expired = structuredClone(policySet);
  expired.policies[0].validUntil = "2026-08-10T00:00:00Z";
  const noMatch = await evaluateAction(requested, expired, new Date("2026-08-11T00:00:00Z"));
  assert.equal(noMatch.outcome, "owner_approval_required");

  const duplicate = structuredClone(policySet);
  duplicate.policies.push({ ...structuredClone(duplicate.policies[0]), id: "duplicate-policy" });
  const ambiguous = await evaluateAction(requested, duplicate);
  assert.deepEqual(ambiguous.ownerApprovalRequest.reasons, ["ambiguous_standing_policy_match"]);
});

test("owner exception validation rejects payload substitution", async () => {
  const original = action({ resource: { kind: "cloudflare_d1", id: "unapproved-d1" } });
  const changed = action({ resource: { kind: "cloudflare_d1", id: "different-d1" } });
  const decision = {
    decisionId: "decision-1",
    requestedActionDigest: await digestRequestedAction(original),
    decision: "approved",
    decidedBy: "owner",
    decidedAt: "2026-08-11T18:00:00Z",
    expiresAt: "2026-08-12T18:00:00Z",
    signatureAlgorithm: "test",
    signature: "signed",
  };
  const result = await validateOwnerExceptionDecision(
    changed,
    decision,
    async () => true,
    { now: new Date("2026-08-11T19:00:00Z"), revalidateCurrentState: async () => true },
  );
  assert.deepEqual(result, { valid: false, reason: "digest_mismatch" });
});

test("owner exception cannot authorize a malformed requested action", async () => {
  const malformed = { foo: "bar" };
  const decision = {
    decisionId: "decision-malformed",
    requestedActionDigest: await digestRequestedAction(malformed),
    decision: "approved",
    expiresAt: "2026-08-12T18:00:00Z",
  };
  const result = await authorizeByOwnerException(malformed, decision, async () => true, {
    now: new Date("2026-08-11T19:00:00Z"),
    revalidateCurrentState: async () => true,
  });
  assert.deepEqual(result, { outcome: "denied", reason: "invalid_requested_action" });
});

test("gateway rejects injected, changed, and directly constructed policy sets", async () => {
  const injected = structuredClone(policySet);
  injected.policies[0].resources[0].id = "attacker/repository";
  await assert.rejects(() => PolicyGateway.create(injected), /digest is not owner-approved/);
  assert.throws(() => new PolicyGateway(policySet), /approved trust anchor/);
});

test("owner exception requires signature, expiry, and immediate state revalidation", async () => {
  const requested = action({ resource: { kind: "cloudflare_d1", id: "unapproved-d1" } });
  const decision = {
    decisionId: "decision-2",
    requestedActionDigest: await digestRequestedAction(requested),
    decision: "approved",
    decidedBy: "owner",
    decidedAt: "2026-08-11T18:00:00Z",
    expiresAt: "2026-08-12T18:00:00Z",
    signatureAlgorithm: "test",
    signature: "signed",
  };
  const missingRevalidation = await authorizeByOwnerException(
    requested,
    decision,
    async () => true,
    { now: new Date("2026-08-11T19:00:00Z") },
  );
  assert.deepEqual(missingRevalidation, {
    outcome: "denied",
    reason: "pre_execution_revalidation_required",
  });

  const authorized = await authorizeByOwnerException(
    requested,
    decision,
    async () => true,
    {
      now: new Date("2026-08-11T19:00:00Z"),
      revalidateCurrentState: async () => true,
    },
  );
  assert.equal(authorized.outcome, "authorized_by_owner_exception");
});

test("owner exception is revalidated again at the execution boundary", async () => {
  const requested = action({ resource: { kind: "cloudflare_d1", id: "unapproved-d1" } });
  let stateIsCurrent = true;
  const decision = {
    decisionId: "decision-short-lived",
    requestedActionDigest: await digestRequestedAction(requested),
    decision: "approved",
    decidedBy: "owner",
    decidedAt: "2026-08-11T18:59:00Z",
    expiresAt: "2026-08-11T19:00:01Z",
    signatureAlgorithm: "test",
    signature: "signed",
  };
  const authorization = await gateway.authorizeOwnerException(
    requested,
    decision,
    async () => true,
    {
      now: new Date("2026-08-11T19:00:00Z"),
      revalidateCurrentState: async () => stateIsCurrent,
    },
  );
  assert.equal(authorization.outcome, "authorized_by_owner_exception");

  stateIsCurrent = false;
  await assert.rejects(
    () => gateway.assertExecutable(requested, authorization, { now: new Date("2026-08-11T19:00:02Z") }),
    /owner exception decision_expired/,
  );
});

test("owner decision must be structurally signed and temporally sane", async () => {
  const requested = action({ resource: { kind: "cloudflare_d1", id: "unapproved-d1" } });
  const result = await validateOwnerExceptionDecision(
    requested,
    {
      decisionId: "decision-unsigned",
      requestedActionDigest: await digestRequestedAction(requested),
      decision: "approved",
      decidedBy: "owner",
      decidedAt: "2026-08-12T18:00:00Z",
      expiresAt: "2026-08-11T18:00:00Z",
      signatureAlgorithm: "",
      signature: "",
    },
    async () => true,
    { now: new Date("2026-08-11T19:00:00Z"), revalidateCurrentState: async () => true },
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_decision");
});

test("execution record persists required standing-policy evidence", async () => {
  const requested = await boundAction();
  const authorization = await gateway.evaluate(requested);
  const idempotencyRegistry = new InMemoryIdempotencyRegistry();
  const record = await createExecutionRecord({
    action: requested,
    authorization,
    beforeState: { sha: "before" },
    result: { status: "succeeded" },
    afterState: { sha: "after" },
    rollback: { strategy: "revert_commit", status: "available" },
    idempotencyRegistry,
    gateway,
  });
  assert.equal(record.authorization.policyId, "dev-github-control-plane");
  assert.equal(record.requestedActionDigest, authorization.actionDigest);
  assert.equal(record.independentReviewer, "checker-agent");
  assert.equal(record.correlationId, "corr-1");
  assert.equal(record.idempotencyKey, "idem-1");
  await assert.rejects(
    () =>
      createExecutionRecord({
        action: requested,
        authorization,
        beforeState: {},
        result: {},
        afterState: {},
        rollback: {},
        idempotencyRegistry,
        gateway,
      }),
    /Duplicate execution/,
  );
});

test("execution boundary rejects forged authorization and action mutation", async () => {
  const requested = await boundAction();
  const authorization = await gateway.evaluate(requested);
  const registry = new InMemoryIdempotencyRegistry();
  const evidence = {
    action: requested,
    beforeState: {},
    result: {},
    afterState: {},
    rollback: {},
    idempotencyRegistry: registry,
    gateway,
  };

  await assert.rejects(
    () => createExecutionRecord({ ...evidence, authorization: { ...authorization } }),
    /not issued by this gateway/,
  );
  await assert.rejects(
    () =>
      createExecutionRecord({
        ...evidence,
        action: { ...requested, payload: { files: ["different-file"] } },
        authorization,
      }),
    /changed after authorization/,
  );

  await assert.rejects(
    () =>
      createExecutionRecord({
        action: requested,
        authorization,
        result: {},
        afterState: {},
        rollback: {},
        idempotencyRegistry: new InMemoryIdempotencyRegistry(),
        gateway,
      }),
    /missing beforeState/,
  );
});
