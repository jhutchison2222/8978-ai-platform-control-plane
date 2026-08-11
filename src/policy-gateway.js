import { digestCanonicalValue, digestRequestedAction } from "./canonical-digest.js";
import { resourceKey, validateResolvedResource, assertCustomerIsolation } from "./resource-contract.js";
import { validateRuntimeReadiness, assertProjectKnowledgeRecord } from "./runtime-contracts.js";
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
const CONSTRUCTOR_TOKEN = Symbol("trusted-runtime-construction");

function invalidActionReasons(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return ["action_must_be_object"];
  const reasons = [];
  for (const field of ["actionId", "operation", "correlationId", "idempotencyKey", "rollbackRef"]) {
    if (typeof action[field] !== "string" || !action[field]) reasons.push(`invalid_${field}`);
  }
  if (!action.requestedTarget || typeof action.requestedTarget.locator !== "string" || !action.requestedTarget.locator) {
    reasons.push("invalid_requestedTarget");
  }
  for (const [field] of OWNER_EXCEPTION_FLAGS) if (typeof action[field] !== "boolean") reasons.push(`invalid_${field}`);
  return reasons;
}

function activeMatches(policySet, action, resolvedTarget, now) {
  const key = resourceKey(resolvedTarget);
  return policySet.policies.filter((policy) =>
    policy.status === "active" && policy.enabled === true &&
    new Date(policy.validFrom) <= now && (policy.validUntil === null || new Date(policy.validUntil) > now) &&
    policy.operations.includes(action.operation) && policy.resources.some((resource) => resourceKey(resource) === key));
}

export function selectUniquePolicyMatch(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return { selected: null, reason: "no_active_standing_policy" };
  if (matches.length !== 1) return { selected: null, reason: "ambiguous_standing_policy_match" };
  return { selected: matches[0], reason: null };
}

function exceptionReasons(action, resolvedTarget, thresholds) {
  const reasons = [];
  if (resolvedTarget.environment === "production") reasons.push("production_environment");
  for (const [field, reason] of OWNER_EXCEPTION_FLAGS) if (action[field]) reasons.push(reason);
  if (thresholds.costUsd > thresholds.ownerCostUsd) reasons.push("financial_threshold_exceeded");
  if (thresholds.recordCount > thresholds.ownerRecordCount) reasons.push("resource_threshold_exceeded");
  return reasons;
}

function limitReasons(policy, trustedLimits) {
  const reasons = [];
  if (RISK_ORDER[trustedLimits.risk] > RISK_ORDER[policy.maxRisk]) reasons.push("risk_limit_exceeded");
  if (trustedLimits.costUsd > policy.limits.costUsd) reasons.push("policy_cost_limit_exceeded");
  if (trustedLimits.recordCount > policy.limits.recordCount) reasons.push("policy_record_count_limit_exceeded");
  return reasons;
}

function approvalRequest(actionDigest, reasons, policy = null) {
  return { type: "owner_approval_request", requestedActionDigest: actionDigest, reasons: [...new Set(reasons)],
    candidatePolicy: policy ? { policyId: policy.id, policyVersion: policy.version } : null,
    requiredDecisionBinding: { canonicalization: "RFC8785", signatureRequired: true, singleUse: true, revalidateImmediatelyBeforeExecution: true } };
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export class PolicyGateway {
  #policySet; #runtime; #issued = new WeakMap();

  constructor(policySet, runtime, token) {
    if (token !== CONSTRUCTOR_TOKEN) throw new Error("PolicyGateway requires trusted runtime construction");
    this.#policySet = structuredClone(policySet); this.#runtime = runtime;
  }

  static async create(policySet, runtime = {}) {
    const readiness = validateRuntimeReadiness(runtime);
    if (!readiness.ready) throw new Error(`Runtime is not ready: missing=${readiness.missing.join(",")} invalid=${readiness.invalid.join(",")}`);
    const key = `${policySet?.policySetId}@${policySet?.policySetVersion}`;
    if (!TRUSTED_POLICY_SET_DIGESTS[key] || await digestCanonicalValue(policySet) !== TRUSTED_POLICY_SET_DIGESTS[key]) {
      throw new Error("Policy set digest is not owner-approved");
    }
    return new PolicyGateway(policySet, runtime, CONSTRUCTOR_TOKEN);
  }

  async #resolve(action) {
    let resolved;
    try { resolved = await this.#runtime.resourceResolver.resolve(structuredClone(action.requestedTarget)); }
    catch { return { error: "authoritative_resolution_unavailable" }; }
    const errors = validateResolvedResource(resolved);
    if (errors.length) return { error: "invalid_authoritative_resolution", details: errors };
    const isolationErrors = assertCustomerIsolation(resolved, resolved.bindings);
    if (isolationErrors.length) return { error: "customer_isolation_failed", details: isolationErrors };
    return { resolved: freeze(structuredClone(resolved)) };
  }

  async #trustedLimits(action, resolved, actionDigest) {
    try {
      const limits = await this.#runtime.limitProvider.resolve(action, resolved, { actionDigest });
      if (!limits || !Object.hasOwn(RISK_ORDER, limits.risk) || !Number.isFinite(limits.costUsd) || limits.costUsd < 0 ||
          !Number.isInteger(limits.recordCount) || limits.recordCount < 0 || typeof limits.evidenceDigest !== "string" || limits.actionDigest !== actionDigest) return null;
      return freeze(structuredClone(limits));
    } catch { return null; }
  }

  async #trustedGates(action, actionDigest, policy, now) {
    const unmet = []; let maker; let checker; let tests; let rollback;
    try {
      maker = await this.#runtime.identityVerifier.verify(action.evidence?.makerAttestation, { role: "maker", actionDigest });
      checker = await this.#runtime.identityVerifier.verify(action.evidence?.checkerAttestation, { role: "checker", actionDigest });
    } catch { unmet.push({ gate: "identity", reason: "authenticated_maker_checker_required" }); }
    if (!maker?.principalId || !checker?.principalId || maker.actionDigest !== actionDigest || checker.actionDigest !== actionDigest || maker.principalId === checker.principalId) {
      unmet.push({ gate: "identity", reason: "independent_authenticated_principals_required" });
    }
    try { tests = await this.#runtime.evidenceProvider.getTestEvidence(actionDigest, policy.requiredTests); }
    catch { tests = null; }
    if (!Array.isArray(tests) || policy.requiredTests.some((testId) =>
      !tests.some((e) => e.testId === testId && e.result === "passed" && e.actionDigest === actionDigest &&
        new Date(e.issuedAt) <= now && now < new Date(e.expiresAt) && /^sha256:[a-f0-9]{64}$/.test(e.evidenceDigest)))) {
      unmet.push({ gate: "tests", reason: "trusted_digest_bound_test_evidence_required" });
    }
    try { rollback = await this.#runtime.rollbackVerifier.verify(action.rollbackRef, { actionDigest }); }
    catch { rollback = null; }
    if (!rollback?.valid || !rollback.executable || rollback.actionDigest !== actionDigest ||
        !(new Date(rollback.issuedAt) <= now && now < new Date(rollback.expiresAt)) || !/^sha256:[a-f0-9]{64}$/.test(rollback.evidenceDigest ?? "")) {
      unmet.push({ gate: "rollback", reason: "executable_digest_bound_rollback_required" });
    }
    return { unmet, maker, checker, tests, rollback };
  }

  async #prepare(action, now) {
    const invalid = invalidActionReasons(action); if (invalid.length) return { denial: { outcome: "denied", reason: "invalid_requested_action", details: invalid } };
    const resolution = await this.#resolve(action); if (!resolution.resolved) return { denial: { outcome: "denied", reason: resolution.error, details: resolution.details } };
    const actionDigest = await digestRequestedAction(action, resolution.resolved);
    const matches = activeMatches(this.#policySet, action, resolution.resolved, now);
    // Ambiguity is rejected before any policy's limits can influence selection.
    const selection = selectUniquePolicyMatch(matches);
    if (selection.reason === "ambiguous_standing_policy_match") return { denial: { outcome: "denied", reason: selection.reason, actionDigest } };
    const trustedLimits = await this.#trustedLimits(action, resolution.resolved, actionDigest);
    if (!trustedLimits) return { denial: { outcome: "denied", reason: "trusted_limits_unavailable", actionDigest } };
    const thresholds = { ...trustedLimits, ownerCostUsd: this.#policySet.ownerApprovalThresholds.costUsd,
      ownerRecordCount: this.#policySet.ownerApprovalThresholds.recordCount };
    const mandatory = exceptionReasons(action, resolution.resolved, thresholds);
    return { actionDigest, resolved: resolution.resolved, matches, trustedLimits, mandatory };
  }

  async evaluate(action, now = new Date()) {
    const prepared = await this.#prepare(action, now); if (prepared.denial) return prepared.denial;
    const { actionDigest, resolved, matches, trustedLimits, mandatory } = prepared;
    if (mandatory.length) return { outcome: "owner_approval_required", actionDigest, ownerApprovalRequest: approvalRequest(actionDigest, mandatory) };
    if (matches.length === 0) return { outcome: "owner_approval_required", actionDigest,
      ownerApprovalRequest: approvalRequest(actionDigest, ["no_active_standing_policy"]) };
    const policy = matches[0]; const exceeded = limitReasons(policy, trustedLimits);
    if (exceeded.length) return { outcome: "owner_approval_required", actionDigest,
      ownerApprovalRequest: approvalRequest(actionDigest, exceeded, policy) };
    const gates = await this.#trustedGates(action, actionDigest, policy, now);
    if (gates.unmet.length) return { outcome: "validation_required", actionDigest,
      authorizingPolicy: { policyId: policy.id, policyVersion: policy.version }, unmetGates: gates.unmet };
    let knowledge;
    try { knowledge = await this.#runtime.projectKnowledge.readGoverningKnowledge({ statuses: ["FINAL", "CURRENT"], actionDigest }); }
    catch { return { outcome: "denied", reason: "governing_project_knowledge_unavailable", actionDigest }; }
    try { assertProjectKnowledgeRecord(knowledge); } catch { return { outcome: "denied", reason: "governing_project_knowledge_unavailable", actionDigest }; }
    const authorization = freeze({ outcome: "authorized_by_standing_policy", actionDigest,
      authorizingPolicy: { policyId: policy.id, policyVersion: policy.version }, resolvedTarget: resolved,
      evidenceSnapshot: { maker: gates.maker, checker: gates.checker, testEvidence: gates.tests,
        rollback: gates.rollback, trustedLimits, projectKnowledge: knowledge } });
    this.#issued.set(authorization, { mechanism: "standing_policy" }); return authorization;
  }

  async authorizeOwnerException(action, decision, { now = new Date() } = {}) {
    const prepared = await this.#prepare(action, now); if (prepared.denial) return prepared.denial;
    if (prepared.matches.length === 1 && prepared.mandatory.length === 0 && limitReasons(prepared.matches[0], prepared.trustedLimits).length === 0) {
      return { outcome: "denied", reason: "owner_exception_not_required" };
    }
    if (!decision || decision.requestedActionDigest !== prepared.actionDigest || decision.decision !== "approved" ||
        ["decisionId","decidedBy","decidedAt","expiresAt","issuerKeyId","signatureAlgorithm","signature"].some((field) => typeof decision[field] !== "string" || !decision[field])) {
      return { outcome: "denied", reason: "invalid_owner_decision" };
    }
    const decidedAt = new Date(decision.decidedAt); const expiresAt = new Date(decision.expiresAt);
    if (!(decidedAt <= now && now < expiresAt)) return { outcome: "denied", reason: "owner_decision_not_current" };
    if (!await this.#runtime.ownerVerifier.verify(decision, { actionDigest: prepared.actionDigest })) return { outcome: "denied", reason: "invalid_owner_signature" };
    const authorization = freeze({ outcome: "authorized_by_owner_exception", actionDigest: prepared.actionDigest,
      ownerDecisionId: decision.decisionId, resolvedTarget: prepared.resolved, evidenceSnapshot: { trustedLimits: prepared.trustedLimits } });
    this.#issued.set(authorization, { mechanism: "owner_exception", decision: structuredClone(decision) }); return authorization;
  }

  async assertExecutable(action, authorization, { now = new Date() } = {}) {
    const context = authorization && this.#issued.get(authorization); if (!context) throw new Error("Execution denied: unissued authorization");
    const resolution = await this.#resolve(action); if (!resolution.resolved) throw new Error("Execution denied: authoritative resolution unavailable");
    if (await digestRequestedAction(action, resolution.resolved) !== authorization.actionDigest) throw new Error("Execution denied: action or resolution changed");
    if (context.mechanism === "standing_policy") {
      const fresh = await this.evaluate(action, now);
      if (fresh.outcome !== "authorized_by_standing_policy" || fresh.actionDigest !== authorization.actionDigest) throw new Error("Execution denied: standing authorization stale");
      if (!await this.#runtime.revalidateStandingState(action, authorization)) throw new Error("Execution denied: kill switch or state revalidation failed");
    } else {
      if (!await this.#runtime.ownerVerifier.verify(context.decision, { actionDigest: authorization.actionDigest })) throw new Error("Execution denied: owner signature invalid");
      const use = await this.#runtime.ownerDecisionStore.consume({ decisionId: authorization.ownerDecisionId, actionDigest: authorization.actionDigest, now });
      if (!use?.consumed) throw new Error("Execution denied: owner decision replay");
    }
    return true;
  }
}
