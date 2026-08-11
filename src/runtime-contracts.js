export const REQUIRED_RUNTIME_DEPENDENCIES = Object.freeze([
  "resourceResolver", "identityVerifier", "evidenceProvider", "rollbackVerifier", "limitProvider",
  "ownerVerifier", "ownerDecisionStore", "idempotencyStore", "auditStore", "revalidateStandingState",
  "projectKnowledge", "workflowDispatcher", "queuePublisher",
]);

export function validateRuntimeReadiness(runtime) {
  const missing = REQUIRED_RUNTIME_DEPENDENCIES.filter((name) => !runtime?.[name]);
  const invalid = [];
  if (runtime?.auditStore?.durability !== "durable" || runtime?.auditStore?.appendOnly !== true) invalid.push("auditStore");
  if (runtime?.idempotencyStore?.atomic !== true || runtime?.idempotencyStore?.durability !== "durable") invalid.push("idempotencyStore");
  if (runtime?.ownerDecisionStore?.atomic !== true || runtime?.ownerDecisionStore?.durability !== "durable") invalid.push("ownerDecisionStore");
  for (const [name, methods] of [["auditStore",["append","verifyReceipt"]],["idempotencyStore",["reserve","complete","release"]],["ownerDecisionStore",["consume"]]]) {
    if (runtime?.[name] && methods.some((method) => typeof runtime[name][method] !== "function")) invalid.push(name);
  }
  for (const [name, method] of [
    ["resourceResolver", "resolve"], ["identityVerifier", "verify"], ["evidenceProvider", "getTestEvidence"],
    ["rollbackVerifier", "verify"], ["limitProvider", "resolve"], ["ownerVerifier", "verify"],
    ["projectKnowledge", "readGoverningKnowledge"], ["workflowDispatcher", "dispatch"], ["queuePublisher", "publish"],
  ]) if (runtime?.[name] && typeof runtime[name][method] !== "function") invalid.push(name);
  return { ready: missing.length === 0 && invalid.length === 0, missing, invalid: [...new Set(invalid)] };
}

export function assertProjectKnowledgeRecord(record) {
  if (!record || !["FINAL", "CURRENT"].includes(record.status)) throw new Error("Governing Project Knowledge unavailable");
  for (const field of ["recordId", "version", "digest", "retrievedAt"]) {
    if (typeof record[field] !== "string" || !record[field]) throw new Error(`Project Knowledge missing ${field}`);
  }
  if (record.credentials !== undefined || record.secrets !== undefined) throw new Error("Project Knowledge must not contain provider credentials");
  return true;
}

export function assertOrchestratorEnvelope(envelope) {
  for (const field of ["messageId", "actionDigest", "correlationId", "idempotencyKey", "workflowName", "queueName"]) {
    if (typeof envelope?.[field] !== "string" || !envelope[field]) throw new Error(`Invalid orchestrator envelope: ${field}`);
  }
  if (!envelope.actionDigest.startsWith("sha256:")) throw new Error("Invalid orchestrator action digest");
  return true;
}
