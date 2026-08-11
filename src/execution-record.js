import { digestCanonicalValue } from "./canonical-digest.js";

function scopeFor(action, authorization) {
  return digestCanonicalValue({ environment: authorization.resolvedTarget.environment,
    resource: authorization.resolvedTarget, operation: action.operation, idempotencyKey: action.idempotencyKey });
}

async function appendVerified(auditStore, event) {
  const receipt = await auditStore.append(event);
  if (!receipt || !await auditStore.verifyReceipt(receipt, event)) throw new Error("Durable audit append could not be verified");
  return receipt;
}

export async function executeAuthorizedAction({ action, authorization, gateway, runtime, execute, rollback, now = new Date(), leaseMs = 60_000 }) {
  if (!gateway || typeof gateway.assertExecutable !== "function") throw new Error("Trusted gateway required");
  if (runtime?.idempotencyStore?.atomic !== true || runtime?.idempotencyStore?.durability !== "durable") throw new Error("Durable atomic idempotency store required");
  if (runtime?.auditStore?.appendOnly !== true || runtime?.auditStore?.durability !== "durable") throw new Error("Durable append-only audit store required");
  if (typeof execute !== "function" || typeof rollback !== "function") throw new Error("Executable effect and rollback handlers required");
  const scope = await scopeFor(action, authorization);
  const reservation = await runtime.idempotencyStore.reserve({ scope, actionDigest: authorization.actionDigest, leaseMs, now });
  if (!reservation?.reserved || typeof reservation.leaseId !== "string") throw new Error("Execution denied: idempotency reservation unavailable or duplicate");
  let effectStarted = false;
  try {
    await gateway.assertExecutable(action, authorization, { now });
    const intent = { schemaVersion: "2.0.0", eventType: "execution_intent", actionDigest: authorization.actionDigest,
      correlationId: action.correlationId, idempotencyScope: scope, leaseId: reservation.leaseId,
      authorization: authorization.outcome, policy: authorization.authorizingPolicy ?? null,
      ownerDecisionId: authorization.ownerDecisionId ?? null, resolvedTarget: authorization.resolvedTarget,
      evidence: authorization.evidenceSnapshot, recordedAt: now.toISOString() };
    const intentReceipt = await appendVerified(runtime.auditStore, intent);
    effectStarted = true;
    const result = await execute({ action: structuredClone(action), resolvedTarget: authorization.resolvedTarget, intentReceipt });
    const resultDigest = await digestCanonicalValue(result);
    const terminal = { schemaVersion: "2.0.0", eventType: "execution_succeeded", actionDigest: authorization.actionDigest,
      correlationId: action.correlationId, idempotencyScope: scope, leaseId: reservation.leaseId,
      resultDigest, recordedAt: new Date().toISOString() };
    const terminalReceipt = await appendVerified(runtime.auditStore, terminal);
    const completed = await runtime.idempotencyStore.complete({ scope, leaseId: reservation.leaseId, resultDigest, terminalReceipt });
    if (!completed?.completed) throw new Error("Execution completed but idempotency finalization failed");
    return { result, intentReceipt, terminalReceipt, idempotencyScope: scope };
  } catch (error) {
    if (!effectStarted) await runtime.idempotencyStore.release({ scope, leaseId: reservation.leaseId });
    if (effectStarted) {
      let rollbackResult;
      try { rollbackResult = await rollback({ action, resolvedTarget: authorization.resolvedTarget, cause: error }); }
      catch (rollbackError) { rollbackResult = { status: "failed", error: rollbackError.message }; }
      try {
        await appendVerified(runtime.auditStore, { schemaVersion: "2.0.0", eventType: "execution_failed",
          actionDigest: authorization.actionDigest, correlationId: action.correlationId, idempotencyScope: scope,
          leaseId: reservation.leaseId, error: error.message, rollback: rollbackResult, recordedAt: new Date().toISOString() });
      } catch { /* Preserve the original execution error; the active lease contains the uncertain state. */ }
    }
    throw error;
  }
}
