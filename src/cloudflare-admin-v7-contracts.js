export const CLOUDFLARE_ADMIN_V7 = Object.freeze({
  version: "7.0.0",
  mcpPath: "/mcp-8978-admin-v7",
  connectorOrigin: "https://8978-cloudflare-admin-v7.jhutchison.workers.dev",
  connectorWorkerName: "8978-cloudflare-admin-v7",
  allowedGithubLogin: "jhutchison2222",
  oauthScopeRead: "cloudflare.activation.read",
  oauthScopeWrite: "cloudflare.activation.write",
  accountId: "de5e0273347b0b4c5f8f4e554aa2288f",
  workerName: "8978-ai-control-plane-dev",
  workerUrl: "https://8978-ai-control-plane-dev.jhutchison.workers.dev",
  d1Name: "8978-ai-authority-dev",
  d1Id: "741ade94-8539-4fc8-b6be-24884720dee8",
  queueName: "8978-ai-orchestrator-dev",
  workflowName: "8978-ai-orchestrator-dev",
  workflowClass: "OrchestratorWorkflow",
  serviceAuthSecretName: "SERVICE_AUTH_KEYS_JSON",
  accessApplicationName: "8978 AI Control Plane Development Worker",
  accessServiceTokenName: "8978-ai-control-plane-dev-canary",
  accessCredentialSecretName: "CANARY_ACCESS_CREDENTIAL_JSON",
  maximumAccessTokenHours: 24,
});

export const WRITE_APPROVALS = Object.freeze({
  ensureAccess:
    "APPROVE ACCESS PROTECTION FOR 8978-ai-control-plane-dev.jhutchison.workers.dev",
  createServiceToken:
    "APPROVE ONE ACCESS TOKEN UP TO 24 HOURS FOR 8978-ai-control-plane-dev",
  installServiceAuth:
    "APPROVE SERVICE_AUTH_KEYS_JSON FOR 8978-ai-control-plane-dev",
  deployReviewedWorker:
    "APPROVE EXACT REVIEWED COMMIT DEPLOYMENT TO 8978-ai-control-plane-dev",
  runCanary:
    "APPROVE ONE FIVE-REQUEST CANARY FOR 8978-ai-control-plane-dev",
});

export function requireExactApproval(operation, supplied) {
  const expected = WRITE_APPROVALS[operation];
  if (!expected) throw new Error("Unknown write operation");
  if (supplied !== expected) throw new Error(`Exact approval required: ${expected}`);
}

export function requireReviewedCommit(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new TypeError("reviewedCommit must be an exact 40-character lowercase Git commit SHA");
  }
  return value;
}

export function requireSha256(value, name = "sha256") {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${name} must be an exact lowercase SHA-256 digest`);
  }
  return value;
}

export function assertPinnedTarget(target = {}) {
  const allowedKeys = new Set(["accountId", "workerName", "workerUrl", "d1Id", "d1Name", "queueName", "workflowName"]);
  for (const key of Object.keys(target)) {
    if (!allowedKeys.has(key)) throw new Error(`Arbitrary target field is prohibited: ${key}`);
    if (target[key] !== CLOUDFLARE_ADMIN_V7[key]) throw new Error(`Pinned target mismatch: ${key}`);
  }
  return CLOUDFLARE_ADMIN_V7;
}
