export class InMemoryIdempotencyRegistry {
  #claims = new Set();

  claim(scope) {
    if (this.#claims.has(scope)) return false;
    this.#claims.add(scope);
    return true;
  }
}

export async function createExecutionRecord(input) {
  const { action, authorization, beforeState, result, afterState, rollback, idempotencyRegistry, gateway, executionNow } = input;
  if (!gateway || typeof gateway.assertExecutable !== "function") {
    throw new Error("A trusted policy gateway is required");
  }
  await gateway.assertExecutable(action, authorization, { now: executionNow ?? new Date() });
  for (const field of ["beforeState", "result", "afterState", "rollback"]) {
    if (!Object.hasOwn(input, field) || input[field] === undefined) {
      throw new Error(`Execution evidence is missing ${field}`);
    }
  }
  if (!action.correlationId || !action.idempotencyKey) {
    throw new Error("Execution evidence requires correlation and idempotency identifiers");
  }
  if (!idempotencyRegistry) throw new Error("A durable idempotency registry is required");
  const idempotencyScope = [
    action.environment,
    action.resource.kind,
    action.resource.id,
    action.operation,
    action.idempotencyKey,
  ].join(":");
  if (!idempotencyRegistry.claim(idempotencyScope)) {
    throw new Error("Duplicate execution blocked by idempotency key");
  }
  const evidence = authorization.evidenceSnapshot;
  if (!evidence || !Array.isArray(evidence.testEvidence)) {
    throw new Error("Gateway authorization is missing its evidence snapshot");
  }
  return {
    schemaVersion: "1.0.0",
    authorization: {
      mechanism:
        authorization.outcome === "authorized_by_standing_policy"
          ? "standing_policy"
          : "owner_exception",
      policyId: authorization.authorizingPolicy?.policyId ?? null,
      policyVersion: authorization.authorizingPolicy?.policyVersion ?? null,
      ownerDecisionId: authorization.ownerDecisionId ?? null,
    },
    requestedActionDigest: authorization.actionDigest,
    proposingAgent: evidence.proposingAgent,
    independentReviewer: evidence.independentReviewer,
    resource: evidence.resource,
    environment: evidence.environment,
    beforeState,
    testEvidence: evidence.testEvidence,
    executionResult: result,
    afterState,
    rollback,
    correlationId: action.correlationId,
    idempotencyKey: action.idempotencyKey,
    idempotencyScope,
  };
}
