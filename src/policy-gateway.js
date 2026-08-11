import { digestCanonicalValue, digestRequestedAction } from "./canonical-digest.js";
import { TRUSTED_POLICY_SET_DIGESTS } from "./trusted-policy-sets.js";

const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
const OWNER_EXCEPTION_FLAGS = Object.freeze([
  ["productionSensitive", "production_sensitive"],
  ["destructiveProductionOrCustomerData", "destructive_production_or_customer_data"],
  ["credentialScopeExpansion", "credential_scope_expansion"],
  ["newProductionExternalWriteIntegration", "new_production_external_write_integration"],
  ["finalOwnerDecisionChange", "final_owner_decision_change"],
  ["legalPrivacyComplianceContractualDecision", "legal_privacy_compliance_contractual_decision"],
]);
const ENVIRONMENTS = new Set(["development", "test", "staging", "production"]);
const GATEWAY_CONSTRUCTOR_TOKEN = Symbol("trusted-policy-gateway");

export function invalidActionReasons(action) {
  const reasons = [];
  if (!action || typeof action !== "object" || Array.isArray(action)) return ["action_must_be_object"];
  for (const field of ["actionId", "operation", "proposingAgent", "correlationId", "idempotencyKey"]) {
    if (typeof action[field] !== "string" || action[field].length === 0) reasons.push(`invalid_${field}`);
  }
  if (
    !action.resource ||
    typeof action.resource.kind !== "string" ||
    action.resource.kind.length === 0 ||
    typeof action.resource.id !== "string" ||
    action.resource.id.length === 0
  ) reasons.push("invalid_resource");
  if (!ENVIRONMENTS.has(action.environment)) reasons.push("invalid_environment");
  if (!Object.hasOwn(RISK_ORDER, action.risk)) reasons.push("invalid_risk");
  if (typeof action.costUsd !== "number" || !Number.isFinite(action.costUsd) || action.costUsd < 0) {
    reasons.push("invalid_costUsd");
  }
  if (!Number.isInteger(action.recordCount) || action.recordCount < 0) reasons.push("invalid_recordCount");
  if (!Array.isArray(action.testEvidence)) reasons.push("invalid_testEvidence");
  for (const [field] of OWNER_EXCEPTION_FLAGS) {
    if (typeof action[field] !== "boolean") reasons.push(`invalid_${field}`);
  }
  return reasons;
}

function isPlaceholder(resourceId) {
  return resourceId.startsWith("__OWNER_APPROVED_") && resourceId.endsWith("__");
}

function resourceMatches(policyResource, requestedResource) {
  return (
    policyResource.kind === requestedResource.kind &&
    policyResource.id === requestedResource.id &&
    !isPlaceholder(policyResource.id)
  );
}

function missingTests(policy, action, actionDigest) {
  const supplied = new Set(
    action.testEvidence
      .filter(
        (evidence) =>
          evidence.result === "passed" && evidence.requestedActionDigest === actionDigest,
      )
      .map((evidence) => evidence.testId),
  );
  return policy.requiredTests.filter((testId) => !supplied.has(testId));
}

function exceptionReasons(action, policySet) {
  const reasons = [];
  if (action.environment === "production") reasons.push("production_environment");
  for (const [field, reason] of OWNER_EXCEPTION_FLAGS) {
    if (action[field]) reasons.push(reason);
  }
  if (action.costUsd > policySet.ownerApprovalThresholds.costUsd) {
    reasons.push("financial_threshold_exceeded");
  }
  if (action.recordCount > policySet.ownerApprovalThresholds.recordCount) {
    reasons.push("resource_threshold_exceeded");
  }
  return reasons;
}

function matchingPolicies(action, policySet, now) {
  return policySet.policies.filter(
    (policy) =>
      policy.status === "active" &&
      policy.enabled === true &&
      new Date(policy.validFrom) <= now &&
      (policy.validUntil === null || new Date(policy.validUntil) > now) &&
      policy.environments.includes(action.environment) &&
      policy.operations.includes(action.operation) &&
      policy.resources.some((resource) => resourceMatches(resource, action.resource)),
  );
}

function policyLimitReasons(policy, action) {
  const reasons = [];
  if (RISK_ORDER[action.risk] > RISK_ORDER[policy.maxRisk]) reasons.push("risk_limit_exceeded");
  if (action.costUsd > policy.limits.costUsd) reasons.push("policy_cost_limit_exceeded");
  if (action.recordCount > policy.limits.recordCount) reasons.push("policy_record_count_limit_exceeded");
  return reasons;
}

function ownerApprovalRequest(action, actionDigest, reasons, candidatePolicy) {
  return {
    type: "owner_approval_request",
    requestedActionDigest: actionDigest,
    requestedAction: action,
    reasons: [...new Set(reasons)],
    candidatePolicy: candidatePolicy
      ? { policyId: candidatePolicy.id, policyVersion: candidatePolicy.version }
      : null,
    requiredDecisionBinding: {
      digestAlgorithm: "sha256",
      signatureRequired: true,
      revalidateImmediatelyBeforeExecution: true,
    },
  };
}

export async function evaluateAction(action, policySet, now = new Date()) {
  const invalidReasons = invalidActionReasons(action);
  if (invalidReasons.length > 0) {
    return { outcome: "denied", reason: "invalid_requested_action", details: invalidReasons };
  }
  const actionDigest = await digestRequestedAction(action);
  const mandatoryExceptions = exceptionReasons(action, policySet);
  if (mandatoryExceptions.length > 0) {
    return {
      outcome: "owner_approval_required",
      actionDigest,
      ownerApprovalRequest: ownerApprovalRequest(action, actionDigest, mandatoryExceptions, null),
    };
  }

  const matches = matchingPolicies(action, policySet, now);
  if (matches.length === 0) {
    return {
      outcome: "owner_approval_required",
      actionDigest,
      ownerApprovalRequest: ownerApprovalRequest(
        action,
        actionDigest,
        ["no_active_standing_policy"],
        null,
      ),
    };
  }

  const evaluated = matches.map((policy) => ({ policy, reasons: policyLimitReasons(policy, action) }));
  const withinLimits = evaluated.filter(({ reasons }) => reasons.length === 0);
  if (withinLimits.length === 0) {
    const closest = evaluated[0];
    return {
      outcome: "owner_approval_required",
      actionDigest,
      ownerApprovalRequest: ownerApprovalRequest(
        action,
        actionDigest,
        closest.reasons,
        closest.policy,
      ),
    };
  }

  if (withinLimits.length > 1) {
    return {
      outcome: "owner_approval_required",
      actionDigest,
      ownerApprovalRequest: ownerApprovalRequest(
        action,
        actionDigest,
        ["ambiguous_standing_policy_match"],
        null,
      ),
    };
  }

  const { policy } = withinLimits[0];
  const unmetGates = [];
  const tests = missingTests(policy, action, actionDigest);
  if (tests.length > 0) unmetGates.push({ gate: "tests", missing: tests });
  if (policy.reviewer.required && !action.review) {
    unmetGates.push({ gate: "reviewer", reason: "independent_reviewer_required" });
  } else if (
    policy.reviewer.required &&
    policy.reviewer.independent &&
    action.review.reviewer === action.proposingAgent
  ) {
    unmetGates.push({ gate: "reviewer", reason: "reviewer_must_be_independent" });
  } else if (
    policy.reviewer.required &&
    (action.review.verdict !== "approved" || action.review.requestedActionDigest !== actionDigest)
  ) {
    unmetGates.push({ gate: "reviewer", reason: "review_must_approve_exact_action_digest" });
  }
  if (policy.rollbackRequired && !action.rollbackPlan) {
    unmetGates.push({ gate: "rollback", reason: "rollback_plan_required" });
  }

  if (unmetGates.length > 0) {
    return {
      outcome: "validation_required",
      actionDigest,
      authorizingPolicy: { policyId: policy.id, policyVersion: policy.version },
      unmetGates,
    };
  }

  return {
    outcome: "authorized_by_standing_policy",
    actionDigest,
    authorizingPolicy: { policyId: policy.id, policyVersion: policy.version },
  };
}

export async function validateOwnerExceptionDecision(
  action,
  decision,
  verifySignature,
  { now = new Date(), revalidateCurrentState } = {},
) {
  const invalidReasons = invalidActionReasons(action);
  if (invalidReasons.length > 0) {
    return { valid: false, reason: "invalid_requested_action", details: invalidReasons };
  }
  const actionDigest = await digestRequestedAction(action);
  if (!decision || typeof decision !== "object") return { valid: false, reason: "invalid_decision" };
  for (const field of ["decisionId", "decidedBy", "decidedAt", "expiresAt", "signatureAlgorithm", "signature"]) {
    if (typeof decision[field] !== "string" || decision[field].length === 0) {
      return { valid: false, reason: "invalid_decision", details: [`invalid_${field}`] };
    }
  }
  if (decision.requestedActionDigest !== actionDigest) return { valid: false, reason: "digest_mismatch" };
  if (decision.decision !== "approved") return { valid: false, reason: "not_approved" };
  const decidedAt = new Date(decision.decidedAt);
  const expiresAt = new Date(decision.expiresAt);
  if (Number.isNaN(decidedAt.valueOf()) || Number.isNaN(expiresAt.valueOf()) || decidedAt >= expiresAt) {
    return { valid: false, reason: "invalid_decision_dates" };
  }
  if (decidedAt > now) return { valid: false, reason: "decision_not_yet_valid" };
  if (expiresAt <= now) return { valid: false, reason: "decision_expired" };
  if (typeof verifySignature !== "function") return { valid: false, reason: "signature_verifier_required" };
  if (!(await verifySignature(decision))) return { valid: false, reason: "invalid_signature" };
  if (!revalidateCurrentState) return { valid: false, reason: "pre_execution_revalidation_required" };
  if (!(await revalidateCurrentState(action, decision))) {
    return { valid: false, reason: "current_state_revalidation_failed" };
  }
  return { valid: true, actionDigest };
}

export async function authorizeByOwnerException(action, decision, verifySignature, options) {
  const validation = await validateOwnerExceptionDecision(action, decision, verifySignature, options);
  if (!validation.valid) return { outcome: "denied", reason: validation.reason };
  return {
    outcome: "authorized_by_owner_exception",
    actionDigest: validation.actionDigest,
    ownerDecisionId: decision.decisionId,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export class PolicyGateway {
  #policySet;
  #issued = new WeakMap();
  #revalidateStandingState;

  constructor(policySet, revalidateStandingState, token) {
    if (token !== GATEWAY_CONSTRUCTOR_TOKEN) {
      throw new Error("PolicyGateway must be created from an approved trust anchor");
    }
    this.#policySet = structuredClone(policySet);
    this.#revalidateStandingState = revalidateStandingState;
  }

  static async create(policySet, { revalidateStandingState } = {}) {
    if (!policySet || typeof policySet !== "object") throw new Error("Invalid policy set");
    const key = `${policySet.policySetId}@${policySet.policySetVersion}`;
    const trustedDigest = TRUSTED_POLICY_SET_DIGESTS[key];
    if (!trustedDigest) throw new Error("Policy set is not an approved trust anchor");
    const actualDigest = await digestCanonicalValue(policySet);
    if (actualDigest !== trustedDigest) throw new Error("Policy set digest is not owner-approved");
    if (typeof revalidateStandingState !== "function") {
      throw new Error("A standing-policy state and kill-switch revalidator is required");
    }
    return new PolicyGateway(policySet, revalidateStandingState, GATEWAY_CONSTRUCTOR_TOKEN);
  }

  #issue(result, action, context) {
    const issued = deepFreeze({
      ...structuredClone(result),
      evidenceSnapshot: {
        proposingAgent: action.proposingAgent,
        independentReviewer: action.review?.reviewer ?? null,
        resource: structuredClone(action.resource),
        environment: action.environment,
        testEvidence: structuredClone(action.testEvidence),
        rollbackPlan: structuredClone(action.rollbackPlan ?? null),
      },
    });
    this.#issued.set(issued, context);
    return issued;
  }

  async evaluate(action, now = new Date()) {
    const result = await evaluateAction(action, this.#policySet, now);
    return result.outcome === "authorized_by_standing_policy"
      ? this.#issue(result, action, { mechanism: "standing_policy" })
      : result;
  }

  async authorizeOwnerException(action, decision, verifySignature, options) {
    const result = await authorizeByOwnerException(action, decision, verifySignature, options);
    return result.outcome === "authorized_by_owner_exception"
      ? this.#issue(result, action, {
          mechanism: "owner_exception",
          decision: structuredClone(decision),
          verifySignature,
          revalidateCurrentState: options?.revalidateCurrentState,
        })
      : result;
  }

  async assertExecutable(action, authorization, { now = new Date() } = {}) {
    const context = authorization && this.#issued.get(authorization);
    if (!context) {
      throw new Error("Execution denied: authorization was not issued by this gateway");
    }
    const currentDigest = await digestRequestedAction(action);
    if (authorization.actionDigest !== currentDigest) {
      throw new Error("Execution denied: requested action changed after authorization");
    }
    if (
      authorization.outcome === "authorized_by_standing_policy" &&
      (!authorization.authorizingPolicy?.policyId || !authorization.authorizingPolicy?.policyVersion)
    ) throw new Error("Execution denied: incomplete standing-policy authorization");
    if (
      authorization.outcome === "authorized_by_owner_exception" &&
      !authorization.ownerDecisionId
    ) throw new Error("Execution denied: incomplete owner-exception authorization");

    if (context.mechanism === "standing_policy") {
      const fresh = await evaluateAction(action, this.#policySet, now);
      if (
        fresh.outcome !== "authorized_by_standing_policy" ||
        fresh.actionDigest !== authorization.actionDigest ||
        fresh.authorizingPolicy.policyId !== authorization.authorizingPolicy.policyId ||
        fresh.authorizingPolicy.policyVersion !== authorization.authorizingPolicy.policyVersion
      ) throw new Error("Execution denied: standing-policy authorization is no longer current");
      if (!(await this.#revalidateStandingState(action, authorization))) {
        throw new Error("Execution denied: standing-policy state or kill switch blocked execution");
      }
    } else {
      const fresh = await validateOwnerExceptionDecision(
        action,
        context.decision,
        context.verifySignature,
        {
          now,
          revalidateCurrentState: context.revalidateCurrentState,
        },
      );
      if (!fresh.valid) throw new Error(`Execution denied: owner exception ${fresh.reason}`);
    }
    return true;
  }
}
