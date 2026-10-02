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
  for (const field of ["recordId", "version", "digest", "retrievedAt", "actionDigest", "scope"]) {
    if (typeof record[field] !== "string" || !record[field]) throw new Error(`Project Knowledge missing ${field}`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(record.digest) || !/^sha256:[a-f0-9]{64}$/.test(record.actionDigest)) {
    throw new Error("Project Knowledge digest binding is invalid");
  }
  if (!record.knowledge || typeof record.knowledge !== "object" || Array.isArray(record.knowledge)) {
    throw new Error("Project Knowledge content is unavailable");
  }
  const forbidden = new Set(["apikey", "authorization", "credential", "credentials", "privatekey", "proxyauthorization", "refreshtoken", "secret", "secrets", "token", "tokens", "accesstoken"]);
  const pending = [record];
  while (pending.length) {
    const current = pending.pop();
    for (const [key, value] of Object.entries(current)) {
      if (forbidden.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) throw new Error("Project Knowledge must not contain provider credentials");
      if (value && typeof value === "object") pending.push(value);
    }
  }
  return true;
}

export function assertOrchestratorEnvelope(envelope) {
  const fields = ["actionDigest", "correlationId", "idempotencyKey", "messageId", "projectKnowledgeRef", "queueName", "workflowName"];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
      JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(fields)) throw new Error("Invalid orchestrator envelope fields");
  const component = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
  for (const field of ["messageId", "correlationId", "idempotencyKey", "workflowName", "queueName"]) {
    if (typeof envelope[field] !== "string" || !component.test(envelope[field])) throw new Error(`Invalid orchestrator envelope: ${field}`);
  }
  if (envelope.messageId.length > 100) throw new Error("Invalid orchestrator envelope: messageId exceeds Workflow limit");
  if (!/^sha256:[a-f0-9]{64}$/.test(envelope.actionDigest)) throw new Error("Invalid orchestrator action digest");
  const reference = envelope.projectKnowledgeRef;
  const referenceFields = ["digest", "recordId", "status", "version"];
  if (!reference || typeof reference !== "object" || Array.isArray(reference) ||
      JSON.stringify(Object.keys(reference).sort()) !== JSON.stringify(referenceFields) ||
      !component.test(reference.recordId ?? "") || !component.test(reference.version ?? "") ||
      !new Set(["CURRENT", "FINAL"]).has(reference.status) || !/^sha256:[a-f0-9]{64}$/.test(reference.digest ?? "")) {
    throw new Error("Invalid orchestrator Project Knowledge reference");
  }
  return true;
}
