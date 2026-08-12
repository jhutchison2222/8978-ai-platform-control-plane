import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticateServiceRequest,
  createServiceAuthenticatedRequest,
  ServiceAuthFetcher,
} from "../src/service-auth-adapter.js";
import {
  CloudflareDurableReplayStore,
  replayStoreShardName,
} from "../src/cloudflare-replay-store.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-08-12T19:00:00Z");
const URL = "https://service.invalid/v1/actions?mode=validate";
const BODY = JSON.stringify({ action: "validate" });

class AtomicReplayStub {
  #seen = new Set();

  async consume({ nonce }) {
    if (this.#seen.has(nonce)) return { consumed: false };
    this.#seen.add(nonce);
    return { consumed: true };
  }
}

class ReplayNamespace {
  stubs = new Map();

  getByName(name) {
    if (!this.stubs.has(name)) this.stubs.set(name, new AtomicReplayStub());
    return this.stubs.get(name);
  }
}

const resolver = {
  async resolve({ principalId, keyId }) {
    return principalId === "orchestrator-dev" && keyId === "service-key-v1" ? SECRET : null;
  },
};

async function signedRequest(overrides = {}) {
  return createServiceAuthenticatedRequest({
    url: URL,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: BODY,
    secret: SECRET,
    principalId: "orchestrator-dev",
    keyId: "service-key-v1",
    now: NOW,
    nonce: "nonce-adapter-123",
    ...overrides,
  });
}

test("bounded adapter authenticates exact body bytes without OAuth", async () => {
  const request = await signedRequest();
  assert.equal(request.headers.has("authorization"), false);
  const replayStore = new CloudflareDurableReplayStore(new ReplayNamespace());
  const result = await authenticateServiceRequest({
    request,
    secretResolver: resolver,
    replayStore,
    now: NOW,
  });
  assert.equal(new TextDecoder().decode(result.bodyBytes), BODY);
  assert.deepEqual(result.identity, {
    authenticated: true,
    mechanism: "hmac-sha256",
    principalId: "orchestrator-dev",
    keyId: "service-key-v1",
    issuedAt: NOW.toISOString(),
    nonce: "nonce-adapter-123",
    bodyDigest: result.identity.bodyDigest,
  });
});

test("Durable Object replay adapter routes by unambiguous principal and key shard", async () => {
  const namespace = new ReplayNamespace();
  const replayStore = new CloudflareDurableReplayStore(namespace);
  const input = {
    principalId: "orchestrator-dev",
    keyId: "service-key-v1",
    nonce: "nonce-1",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.valueOf() + 300_000).toISOString(),
  };
  assert.deepEqual(await replayStore.consume(input), { consumed: true });
  assert.deepEqual(await replayStore.consume(input), { consumed: false });
  assert.notEqual(replayStoreShardName("ab", "c"), replayStoreShardName("a", "bc"));
  assert.equal(namespace.stubs.size, 1);
  assert.deepEqual(await replayStore.consume({ ...input, keyId: "service-key-v2" }), { consumed: true });
  assert.equal(namespace.stubs.size, 2);
});

test("concurrent verification consumes a signed nonce exactly once", async () => {
  const request = await signedRequest();
  const replayStore = new CloudflareDurableReplayStore(new ReplayNamespace());
  const results = await Promise.allSettled([
    authenticateServiceRequest({ request: request.clone(), secretResolver: resolver, replayStore, now: NOW }),
    authenticateServiceRequest({ request: request.clone(), secretResolver: resolver, replayStore, now: NOW }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.match(results.find(({ status }) => status === "rejected").reason.message, /replay denied/);
});

test("adapter rejects OAuth headers and oversized request bodies", async () => {
  await assert.rejects(() => signedRequest({ headers: { authorization: "Bearer forbidden" } }), /not allowed/);
  await assert.rejects(() => signedRequest({ body: "too large", maxBodyBytes: 3 }), /exceeds limit/);

  const declaredOversize = await signedRequest();
  const headers = new Headers(declaredOversize.headers);
  headers.set("content-length", "1000");
  const request = new Request(URL, { method: "POST", headers, body: BODY });
  await assert.rejects(() => authenticateServiceRequest({
    request,
    secretResolver: resolver,
    replayStore: new CloudflareDurableReplayStore(new ReplayNamespace()),
    now: NOW,
    maxBodyBytes: 100,
  }), /exceeds limit/);
});

test("ServiceAuthFetcher signs calls through an injected Service Binding-style fetcher", async () => {
  const replayStore = new CloudflareDurableReplayStore(new ReplayNamespace());
  const fetcher = {
    async fetch(request) {
      const authenticated = await authenticateServiceRequest({
        request,
        secretResolver: resolver,
        replayStore,
      });
      return Response.json({ principalId: authenticated.identity.principalId });
    },
  };
  const adapter = new ServiceAuthFetcher({
    fetcher,
    secret: SECRET,
    principalId: "orchestrator-dev",
    keyId: "service-key-v1",
  });
  const response = await adapter.fetch(URL, { method: "POST", body: BODY });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { principalId: "orchestrator-dev" });
});
