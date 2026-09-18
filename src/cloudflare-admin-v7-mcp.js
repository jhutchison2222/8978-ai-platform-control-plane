import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { CloudflareAdminV7Api } from "./cloudflare-admin-v7-api.js";
import { CLOUDFLARE_ADMIN_V7, WRITE_APPROVALS } from "./cloudflare-admin-v7-contracts.js";
import { ManagedSecretCredentialCustodian } from "./cloudflare-admin-v7-custodian.js";
import { redactSensitive } from "./cloudflare-admin-v7-redaction.js";
import { CloudflareAdminV7Service } from "./cloudflare-admin-v7-service.js";

function result(value) {
  const safe = redactSensitive(value);
  return { content: [{ type: "text", text: JSON.stringify(safe, null, 2) }], structuredContent: safe };
}

function challenge(requiredScope) {
  const resource = `${CLOUDFLARE_ADMIN_V7.connectorOrigin}/.well-known/oauth-protected-resource${CLOUDFLARE_ADMIN_V7.mcpPath}`;
  const message = "Sign in with the approved GitHub account and grant the required bounded Cloudflare Admin v7 scope.";
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    _meta: { "mcp/www_authenticate": [`Bearer resource_metadata="${resource}", scope="${requiredScope}", error="insufficient_scope"`] },
  };
}

function authorize(scope) {
  const props = getMcpAuthContext()?.props;
  const permissions = Array.isArray(props?.permissions) ? props.permissions : [];
  if (typeof props?.githubLogin !== "string" || props.githubLogin.toLowerCase() !== CLOUDFLARE_ADMIN_V7.allowedGithubLogin || !permissions.includes(scope)) return challenge(scope);
  return null;
}

function service(env) {
  const api = new CloudflareAdminV7Api({ apiToken: env.CLOUDFLARE_ADMIN_API_TOKEN });
  return new CloudflareAdminV7Service({
    api,
    custodian: new ManagedSecretCredentialCustodian(api, env),
    reviewedDeployment: {
      reviewedCommit: env.REVIEWED_COMMIT,
      configurationSha256: env.REVIEWED_CONFIGURATION_SHA256,
      versionId: env.REVIEWED_WORKER_VERSION_ID,
    },
  });
}

function annotations(title, readOnly) {
  return { title, readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: true };
}

export function createCloudflareAdminV7Server(env) {
  const server = new McpServer({ name: "8978 Cloudflare Admin v7", version: CLOUDFLARE_ADMIN_V7.version });
  server.registerTool("read_development_activation_preflight", {
    description: "Read sanitized identity, exact development resources, bindings, deployments, Access state, and secret names. Never returns secret values.",
    inputSchema: {},
    annotations: annotations("Read Development Activation Preflight", true),
  }, async () => {
    const denied = authorize(CLOUDFLARE_ADMIN_V7.oauthScopeRead);
    return denied ?? result(await service(env).preflight());
  });
  server.registerTool("create_development_access_service_token", {
    description: "Create exactly one Access service token for the pinned development Worker, with a maximum lifetime of 24 hours, and send its credential directly to the managed custodian.",
    inputSchema: { approval: z.literal(WRITE_APPROVALS.createServiceToken), durationHours: z.number().int().min(1).max(24).default(24) },
    annotations: annotations("Create Development Access Service Token", false),
  }, async (input) => {
    const denied = authorize(CLOUDFLARE_ADMIN_V7.oauthScopeWrite);
    return denied ?? result(await service(env).createServiceToken(input));
  });
  server.registerTool("ensure_development_access_protection", {
    description: "Create or confirm a self-hosted Access application and service-token-only policy for the one pinned workers.dev hostname.",
    inputSchema: { approval: z.literal(WRITE_APPROVALS.ensureAccess), serviceTokenId: z.string().uuid() },
    annotations: annotations("Ensure Development Access Protection", false),
  }, async (input) => {
    const denied = authorize(CLOUDFLARE_ADMIN_V7.oauthScopeWrite);
    return denied ?? result(await service(env).ensureAccessProtection(input));
  });
  server.registerTool("activate_exact_reviewed_development_worker", {
    description: "Derive a secret-bearing version from the exact latest reviewed Worker version, deploy it at 100%, and immediately run the exact five-request fail-closed canary once. Secret values are never returned or retained by this connector.",
    inputSchema: {
      installApproval: z.literal(WRITE_APPROVALS.installServiceAuth),
      deployApproval: z.literal(WRITE_APPROVALS.deployReviewedWorker),
      canaryApproval: z.literal(WRITE_APPROVALS.runCanary),
      accessCredentialReceiptId: z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/),
      reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/),
      configurationSha256: z.string().regex(/^[a-f0-9]{64}$/),
      versionId: z.string().uuid(),
    },
    annotations: annotations("Activate Exact Reviewed Development Worker", false),
  }, async (input) => {
    const denied = authorize(CLOUDFLARE_ADMIN_V7.oauthScopeWrite);
    return denied ?? result(await service(env).activateReviewedWorkerAndRunCanary(input));
  });
  return server;
}

export async function handleCloudflareAdminV7Mcp(request, env, ctx) {
  return createMcpHandler(() => createCloudflareAdminV7Server(env), {
    route: CLOUDFLARE_ADMIN_V7.mcpPath,
    allowedHostnames: [new URL(CLOUDFLARE_ADMIN_V7.connectorOrigin).hostname],
  })(request, env, ctx);
}

export function isPublicMcpDiscoveryRequest(request, parsedBody) {
  if (new URL(request.url).pathname !== CLOUDFLARE_ADMIN_V7.mcpPath) return false;
  if (request.method === "GET") return true;
  if (request.method !== "POST") return false;
  const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
  const publicMethods = new Set(["initialize", "notifications/initialized", "tools/list", "resources/list", "resources/templates/list", "prompts/list", "ping"]);
  return messages.length > 0 && messages.every((message) => message && typeof message === "object" && publicMethods.has(message.method));
}
