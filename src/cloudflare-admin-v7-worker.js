import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { CLOUDFLARE_ADMIN_V7 } from "./cloudflare-admin-v7-contracts.js";
import { handleCloudflareAdminV7Mcp, isPublicMcpDiscoveryRequest } from "./cloudflare-admin-v7-mcp.js";
import { oauthDefaultHandler } from "./cloudflare-admin-v7-oauth.js";

const apiHandler = { fetch: handleCloudflareAdminV7Mcp };
const oauth = new OAuthProvider({
  apiRoute: CLOUDFLARE_ADMIN_V7.mcpPath,
  apiHandler,
  defaultHandler: oauthDefaultHandler(),
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: [CLOUDFLARE_ADMIN_V7.oauthScopeRead, CLOUDFLARE_ADMIN_V7.oauthScopeWrite],
  allowImplicitFlow: false,
  allowPlainPKCE: false,
  disallowPublicClientRegistration: false,
  accessTokenTTL: 3600,
  refreshTokenTTL: 86400,
  clientRegistrationTTL: 2592000,
  clientIdMetadataDocumentEnabled: true,
  resourceMetadata: {
    resource: CLOUDFLARE_ADMIN_V7.connectorOrigin + CLOUDFLARE_ADMIN_V7.mcpPath,
    authorization_servers: [CLOUDFLARE_ADMIN_V7.connectorOrigin],
    scopes_supported: [CLOUDFLARE_ADMIN_V7.oauthScopeRead, CLOUDFLARE_ADMIN_V7.oauthScopeWrite],
    bearer_methods_supported: ["header"],
    resource_name: "8978 Cloudflare Admin v7",
  },
});

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === CLOUDFLARE_ADMIN_V7.mcpPath && !request.headers.has("authorization")) {
      let parsed;
      if (request.method === "POST") {
        try { parsed = await request.clone().json(); } catch { parsed = null; }
      }
      if (isPublicMcpDiscoveryRequest(request, parsed) || request.method === "POST") {
        return handleCloudflareAdminV7Mcp(request, env, ctx);
      }
    }
    return oauth.fetch(request, env, ctx);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(oauth.purgeExpiredData(env, { batchSize: 100 }));
  },
};

