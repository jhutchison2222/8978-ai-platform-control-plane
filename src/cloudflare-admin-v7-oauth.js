import { CLOUDFLARE_ADMIN_V7 } from "./cloudflare-admin-v7-contracts.js";

const STATE_PREFIX = "cloudflare-admin-v7:oauth-state:";
const STATE_COOKIE = "cf_admin_v7_oauth_state";
const STATE_TTL_SECONDS = 600;
const SUPPORTED_SCOPES = new Set([
  CLOUDFLARE_ADMIN_V7.oauthScopeRead,
  CLOUDFLARE_ADMIN_V7.oauthScopeWrite,
]);

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}

function requireOAuthEnvironment(env) {
  for (const name of ["OAUTH_KV", "OAUTH_PROVIDER", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "ALLOWED_GITHUB_LOGIN"]) {
    if (!env?.[name]) throw new Error(`Missing ${name} OAuth configuration`);
  }
  if (String(env.ALLOWED_GITHUB_LOGIN).trim().toLowerCase() !== CLOUDFLARE_ADMIN_V7.allowedGithubLogin) {
    throw new Error("ALLOWED_GITHUB_LOGIN does not match the pinned repository owner");
  }
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function cookieValue(request, name) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

function sameValue(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}

function stateCookie(state) {
  return `${STATE_COOKIE}=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_SECONDS}`;
}

function clearStateCookie() {
  return `${STATE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

async function exchangeGitHubCode(code, redirectUri, env, fetchImpl) {
  const response = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "8978-cloudflare-admin-v7",
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== "string") throw new Error("GitHub token exchange failed");
  return body.access_token;
}

async function getGitHubUser(token, fetchImpl) {
  const response = await fetchImpl("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "8978-cloudflare-admin-v7",
      "x-github-api-version": "2022-11-28",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.login !== "string") throw new Error("GitHub user verification failed");
  return body;
}

export async function beginGitHubAuthorization(request, env) {
  requireOAuthEnvironment(env);
  let oauthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch {
    return json(400, { error: "invalid_request", error_description: "Invalid OAuth authorization request" });
  }
  if (!oauthRequest.clientId || oauthRequest.scope.length === 0 || oauthRequest.scope.some((scope) => !SUPPORTED_SCOPES.has(scope))) {
    return json(400, { error: "invalid_scope", error_description: "Unsupported or missing Cloudflare Admin v7 scope" });
  }
  const state = randomState();
  await env.OAUTH_KV.put(`${STATE_PREFIX}${state}`, JSON.stringify(oauthRequest), { expirationTtl: STATE_TTL_SECONDS });
  const callback = new URL("/callback", request.url).toString();
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("redirect_uri", callback);
  github.searchParams.set("scope", "read:user");
  github.searchParams.set("state", state);
  github.searchParams.set("allow_signup", "false");
  return new Response(null, {
    status: 302,
    headers: { location: github.toString(), "cache-control": "no-store", "set-cookie": stateCookie(state) },
  });
}

export async function completeGitHubAuthorization(request, env, { fetchImpl = fetch } = {}) {
  requireOAuthEnvironment(env);
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return json(403, { error: "access_denied", error_description: "GitHub authorization was denied" }, { "set-cookie": clearStateCookie() });
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const cookie = cookieValue(request, STATE_COOKIE);
  if (!code || !state || !cookie || !sameValue(state, cookie)) {
    return json(400, { error: "invalid_request", error_description: "OAuth callback state was missing or invalid" }, { "set-cookie": clearStateCookie() });
  }
  const key = `${STATE_PREFIX}${state}`;
  const stored = await env.OAUTH_KV.get(key);
  await env.OAUTH_KV.delete(key);
  if (!stored) return json(400, { error: "invalid_request", error_description: "OAuth request expired or was already used" }, { "set-cookie": clearStateCookie() });
  let oauthRequest;
  try {
    oauthRequest = JSON.parse(stored);
  } catch {
    return json(500, { error: "server_error", error_description: "Stored OAuth state was invalid" }, { "set-cookie": clearStateCookie() });
  }
  try {
    const callback = new URL("/callback", request.url).toString();
    const token = await exchangeGitHubCode(code, callback, env, fetchImpl);
    const user = await getGitHubUser(token, fetchImpl);
    if (user.login.toLowerCase() !== CLOUDFLARE_ADMIN_V7.allowedGithubLogin) {
      return json(403, { error: "access_denied", error_description: "This GitHub account is not authorized for Cloudflare Admin v7" }, { "set-cookie": clearStateCookie() });
    }
    const scopes = oauthRequest.scope.filter((scope) => SUPPORTED_SCOPES.has(scope));
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthRequest,
      userId: user.login.toLowerCase(),
      metadata: { label: `${user.login} — 8978 Cloudflare Admin v7` },
      scope: scopes,
      props: { githubLogin: user.login, permissions: scopes },
    });
    return new Response(null, { status: 302, headers: { location: redirectTo, "cache-control": "no-store", "set-cookie": clearStateCookie() } });
  } catch {
    return json(502, { error: "temporarily_unavailable", error_description: "Upstream identity verification failed" }, { "set-cookie": clearStateCookie() });
  }
}

export function oauthDefaultHandler() {
  return {
    async fetch(request, env) {
      const path = new URL(request.url).pathname;
      if (path === "/health" && request.method === "GET") return json(200, { ok: true, version: CLOUDFLARE_ADMIN_V7.version, mode: "development-bounded" });
      if (path === "/authorize" && request.method === "GET") return beginGitHubAuthorization(request, env);
      if (path === "/callback" && request.method === "GET") return completeGitHubAuthorization(request, env);
      return json(404, { error: "not_found" });
    },
  };
}
