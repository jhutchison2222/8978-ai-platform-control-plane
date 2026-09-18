import test from "node:test";
import assert from "node:assert/strict";
import { CLOUDFLARE_ADMIN_V7 } from "../src/cloudflare-admin-v7-contracts.js";
import { beginGitHubAuthorization, completeGitHubAuthorization } from "../src/cloudflare-admin-v7-oauth.js";
import { handleCloudflareAdminV7Mcp, isPublicMcpDiscoveryRequest } from "../src/cloudflare-admin-v7-mcp.js";

class MemoryKv {
  values = new Map();
  async put(key, value) { this.values.set(key, value); }
  async get(key) { return this.values.get(key) ?? null; }
  async delete(key) { this.values.delete(key); }
}

function environment(scopes = [CLOUDFLARE_ADMIN_V7.oauthScopeRead]) {
  const completed = [];
  return {
    OAUTH_KV: new MemoryKv(),
    GITHUB_CLIENT_ID: "github-client-id",
    GITHUB_CLIENT_SECRET: "github-" + "fixture",
    ALLOWED_GITHUB_LOGIN: "jhutchison2222",
    OAUTH_PROVIDER: {
      async parseAuthRequest() { return { clientId: "chatgpt-client", redirectUri: "https://chatgpt.com/callback", responseType: "code", scope: scopes, state: "client-state", codeChallenge: "challenge", codeChallengeMethod: "S256" }; },
      async completeAuthorization(input) { completed.push(input); return { redirectTo: "https://chatgpt.com/callback?code=oauth-code" }; },
    },
    completed,
  };
}

async function begin(env) {
  const response = await beginGitHubAuthorization(new Request(`${CLOUDFLARE_ADMIN_V7.connectorOrigin}/authorize?client_id=x`), env);
  const github = new URL(response.headers.get("location"));
  return { response, state: github.searchParams.get("state"), cookie: response.headers.get("set-cookie") };
}

test("OAuth authorization preserves PKCE request state and redirects only to GitHub", async () => {
  const env = environment();
  const { response, state, cookie } = await begin(env);
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).origin, "https://github.com");
  assert.match(cookie, /Secure; HttpOnly; SameSite=Lax/);
  assert.ok(await env.OAUTH_KV.get(`cloudflare-admin-v7:oauth-state:${state}`));
});

test("OAuth rejects unsupported scopes before GitHub authorization", async () => {
  const env = environment(["cloudflare.everything.write"]);
  const response = await beginGitHubAuthorization(new Request(`${CLOUDFLARE_ADMIN_V7.connectorOrigin}/authorize`), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_scope");
});

test("OAuth callback allows only the configured GitHub owner and grants only requested scope", async () => {
  const env = environment([CLOUDFLARE_ADMIN_V7.oauthScopeRead]);
  const { state, cookie } = await begin(env);
  const request = new Request(`${CLOUDFLARE_ADMIN_V7.connectorOrigin}/callback?code=github-code&state=${state}`, { headers: { cookie } });
  const fetchImpl = async (url) => url.includes("access_token")
    ? Response.json({ access_token: "upstream-" + "fixture" })
    : Response.json({ login: "jhutchison2222", name: "Owner" });
  const response = await completeGitHubAuthorization(request, env, { fetchImpl });
  assert.equal(response.status, 302);
  assert.equal(env.completed.length, 1);
  assert.deepEqual(env.completed[0].scope, [CLOUDFLARE_ADMIN_V7.oauthScopeRead]);
  assert.deepEqual(env.completed[0].props, { githubLogin: "jhutchison2222", permissions: [CLOUDFLARE_ADMIN_V7.oauthScopeRead] });
});

test("OAuth callback rejects state mismatch and a different GitHub login", async () => {
  const env = environment();
  const started = await begin(env);
  const mismatch = await completeGitHubAuthorization(new Request(`${CLOUDFLARE_ADMIN_V7.connectorOrigin}/callback?code=x&state=${started.state}`, { headers: { cookie: "cf_admin_v7_oauth_state=wrong" } }), env);
  assert.equal(mismatch.status, 400);

  const second = await begin(env);
  const request = new Request(`${CLOUDFLARE_ADMIN_V7.connectorOrigin}/callback?code=x&state=${second.state}`, { headers: { cookie: second.cookie } });
  const rejected = await completeGitHubAuthorization(request, env, { fetchImpl: async (url) => url.includes("access_token") ? Response.json({ access_token: "token" }) : Response.json({ login: "another-user" }) });
  assert.equal(rejected.status, 403);
  assert.equal(env.completed.length, 0);
});

test("MCP discovery is public but tool execution is not classified as discovery", () => {
  const url = CLOUDFLARE_ADMIN_V7.connectorOrigin + CLOUDFLARE_ADMIN_V7.mcpPath;
  assert.equal(isPublicMcpDiscoveryRequest(new Request(url, { method: "POST" }), { jsonrpc: "2.0", method: "tools/list", id: 1 }), true);
  assert.equal(isPublicMcpDiscoveryRequest(new Request(url, { method: "POST" }), { jsonrpc: "2.0", method: "tools/call", id: 2 }), false);
  assert.equal(isPublicMcpDiscoveryRequest(new Request(url + "/other", { method: "GET" }), null), false);
});

function mcpRequest(body) {
  return new Request(CLOUDFLARE_ADMIN_V7.connectorOrigin + CLOUDFLARE_ADMIN_V7.mcpPath, {
    method: "POST",
    headers: {
      host: new URL(CLOUDFLARE_ADMIN_V7.connectorOrigin).hostname,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function sseJson(response) {
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  return JSON.parse(data);
}

test("public MCP inventory is exact and unauthenticated execution returns an MCP OAuth challenge", async () => {
  const listed = await sseJson(await handleCloudflareAdminV7Mcp(mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), {}, {}));
  assert.deepEqual(listed.result.tools.map(({ name }) => name), [
    "read_development_activation_preflight",
    "create_development_access_service_token",
    "ensure_development_access_protection",
    "activate_exact_reviewed_development_worker",
  ]);
  assert.equal(listed.result.tools.every(({ annotations }) => annotations.destructiveHint === false), true);
  const called = await sseJson(await handleCloudflareAdminV7Mcp(mcpRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "read_development_activation_preflight", arguments: {} },
  }), {}, {}));
  assert.equal(called.result.isError, true);
  assert.match(called.result._meta["mcp/www_authenticate"][0], /oauth-protected-resource\/mcp-8978-admin-v7/);
  assert.doesNotMatch(JSON.stringify(listed), /delete|cleanup|rollback|restore|production|customer/i);
});
