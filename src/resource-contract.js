const ENVIRONMENTS = new Set(["development", "test", "staging", "production"]);

function requiredString(value, field, errors) {
  if (typeof value !== "string" || value.length === 0) errors.push(`invalid_${field}`);
}

export function resourceKey(resource) {
  switch (resource.kind) {
    case "github_repository": return `github:${resource.repository}`;
    case "cloudflare_worker": return `cloudflare:${resource.accountId}:worker:${resource.workerName}`;
    case "cloudflare_d1": return `cloudflare:${resource.accountId}:d1:${resource.databaseId}`;
    case "cloudflare_r2": return `cloudflare:${resource.accountId}:r2:${resource.bucketName}`;
    case "cloudflare_queue": return `cloudflare:${resource.accountId}:queue:${resource.queueId}`;
    case "cloudflare_workflow": return `cloudflare:${resource.accountId}:workflow:${resource.workflowId}`;
    case "ghl_location": return `ghl:${resource.accountId}:location:${resource.locationId}`;
    case "autocalls_environment": return `ai-employees.net:${resource.accountId}:environment:${resource.environmentId}`;
    default: return "unsupported";
  }
}

export function validateResolvedResource(resource) {
  const errors = [];
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) return ["invalid_resolved_resource"];
  requiredString(resource.kind, "resource_kind", errors);
  if (!ENVIRONMENTS.has(resource.environment)) errors.push("invalid_resolved_environment");
  if (!resource.isolation || !["internal_8978", "dedicated_customer"].includes(resource.isolation.mode)) {
    errors.push("invalid_isolation_mode");
  }
  if (resource.isolation?.mode === "dedicated_customer") requiredString(resource.isolation.customerId, "customerId", errors);
  const expectedProvider = {
    github_repository: "github", cloudflare_worker: "cloudflare", cloudflare_d1: "cloudflare",
    cloudflare_r2: "cloudflare", cloudflare_queue: "cloudflare", cloudflare_workflow: "cloudflare",
    ghl_location: "ghl", autocalls_environment: "ai-employees.net",
  }[resource.kind];
  if (!expectedProvider || resource.provider !== expectedProvider) errors.push("provider_kind_mismatch");
  if (resource.kind === "github_repository") requiredString(resource.repository, "repository", errors);
  if (expectedProvider === "cloudflare") requiredString(resource.accountId, "cloudflare_accountId", errors);
  if (resource.kind === "cloudflare_worker") requiredString(resource.workerName, "workerName", errors);
  if (resource.kind === "cloudflare_d1") {
    requiredString(resource.databaseId, "databaseId", errors);
    requiredString(resource.databaseName, "databaseName", errors);
  }
  if (resource.kind === "cloudflare_r2") requiredString(resource.bucketName, "bucketName", errors);
  if (resource.kind === "cloudflare_queue") {
    requiredString(resource.queueId, "queueId", errors); requiredString(resource.queueName, "queueName", errors);
  }
  if (resource.kind === "cloudflare_workflow") {
    requiredString(resource.workflowId, "workflowId", errors); requiredString(resource.workflowName, "workflowName", errors);
  }
  if (resource.kind === "ghl_location") {
    requiredString(resource.accountId, "ghl_accountId", errors); requiredString(resource.locationId, "locationId", errors);
  }
  if (resource.kind === "autocalls_environment") {
    requiredString(resource.accountId, "autocalls_accountId", errors); requiredString(resource.environmentId, "environmentId", errors);
  }
  if (resource.environment === "production" && resource.isolation?.mode !== "dedicated_customer") {
    errors.push("production_customer_must_be_dedicated");
  }
  return errors;
}

export function assertCustomerIsolation(resource, bindings) {
  const errors = validateResolvedResource(resource);
  if (resource?.environment === "production") {
    if (!bindings || bindings.customerId !== resource.isolation?.customerId) errors.push("customer_binding_mismatch");
    if (!bindings?.dedicatedWorkerName || !bindings?.dedicatedD1DatabaseId) errors.push("dedicated_worker_and_d1_required");
    if (bindings?.sharedProductionD1 === true) errors.push("shared_production_d1_prohibited");
  }
  return errors;
}
