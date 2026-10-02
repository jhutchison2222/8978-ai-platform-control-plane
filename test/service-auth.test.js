import test from "node:test";
import assert from "node:assert/strict";
import { createServiceAuthHeaders, digestServiceBody, verifyServiceAuth, SERVICE_AUTH_HEADERS } from "../src/service-auth.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-08-12T19:00:00Z");
const URL = "https://internal.invalid/v1/actions?mode=validate";
const BODY = JSON.stringify({ action: "validate" });

class ReplayStore {
  atomic = true;
  durability = "durable";
  #seen = new Set();
  async consume({ principalId, keyId, nonce }) {
    const key = `${principalId}:${keyId}:${nonce}`;
    if (this.#seen.has(key)) return { consumed: false };
    this.#seen.add(key);
    return { consumed: true };
  }
}

async function signedRequest(overrides = {}) {
  const bodyDigest = await digestServiceBody(BODY);
  const headers = await createServiceAuthHeaders({
    secret: SECRET, principalId: "orchestrator-dev", keyId: "service-key-v1",
    method: "POST", url: URL, bodyDigest, now: NOW, nonce: "nonce-123", ...overrides,
  });
  headers.set("content-type", "application/json");
  return { request: new Request(URL, { method: "POST", headers, body: BODY }), bodyDigest };
}

const resolver = { async resolve({ principalId, keyId }) {
  if (principalId === "orchestrator-dev" && keyId === "service-key-v1") return SECRET;
  return null;
} };

test("service auth authenticates a digest-bound request without OAuth", async () => {
  const { request, bodyDigest } = await signedRequest();
  assert.equal(request.headers.has("authorization"), false);
  const identity = await verifyServiceAuth({ request, actualBodyDigest: bodyDigest, secretResolver: resolver, replayStore: new ReplayStore(), now: NOW });
  assert.deepEqual(identity, { authenticated: true, mechanism: "hmac-sha256", principalId: "orchestrator-dev", keyId: "service-key-v1",
    issuedAt: NOW.toISOString(), nonce: "nonce-123", bodyDigest });
});

test("service auth rejects body, target, signature, and timestamp tampering", async () => {
  const signed = await signedRequest();
  await assert.rejects(() => verifyServiceAuth({ request: signed.request, actualBodyDigest: "sha256:" + "0".repeat(64),
    secretResolver: resolver, replayStore: new ReplayStore(), now: NOW }), /body digest mismatch/);
  const targetTamper = new Request("https://internal.invalid/v1/other?mode=validate", signed.request);
  await assert.rejects(() => verifyServiceAuth({ request: targetTamper, actualBodyDigest: signed.bodyDigest,
    secretResolver: resolver, replayStore: new ReplayStore(), now: NOW }), /signature/);
  const signatureHeaders = new Headers(signed.request.headers);
  signatureHeaders.set(SERVICE_AUTH_HEADERS.signature, "invalid");
  const signatureTamper = new Request(URL, { method: "POST", headers: signatureHeaders, body: BODY });
  await assert.rejects(() => verifyServiceAuth({ request: signatureTamper, actualBodyDigest: signed.bodyDigest,
    secretResolver: resolver, replayStore: new ReplayStore(), now: NOW }), /signature/);
  await assert.rejects(() => verifyServiceAuth({ request: signed.request, actualBodyDigest: signed.bodyDigest,
    secretResolver: resolver, replayStore: new ReplayStore(), now: new Date(NOW.valueOf() + 300_001) }), /replay window/);
});

test("service auth consumes each nonce once in durable atomic replay storage", async () => {
  const signed = await signedRequest();
  const replayStore = new ReplayStore();
  await verifyServiceAuth({ request: signed.request, actualBodyDigest: signed.bodyDigest, secretResolver: resolver, replayStore, now: NOW });
  await assert.rejects(() => verifyServiceAuth({ request: signed.request, actualBodyDigest: signed.bodyDigest,
    secretResolver: resolver, replayStore, now: NOW }), /replay denied/);
});

test("service auth fails closed for short secrets, unknown keys, and non-durable replay storage", async () => {
  const digest = await digestServiceBody(BODY);
  await assert.rejects(() => createServiceAuthHeaders({ secret: "too-short", principalId: "p", keyId: "k", method: "POST",
    url: URL, bodyDigest: digest, now: NOW, nonce: "n" }), /at least 32 bytes/);
  const signed = await signedRequest();
  await assert.rejects(() => verifyServiceAuth({ request: signed.request, actualBodyDigest: signed.bodyDigest,
    secretResolver: { async resolve() { return null; } }, replayStore: new ReplayStore(), now: NOW }), /Unknown/);
  await assert.rejects(() => verifyServiceAuth({ request: signed.request, actualBodyDigest: signed.bodyDigest,
    secretResolver: resolver, replayStore: { atomic: false, durability: "memory", async consume() {} }, now: NOW }), /Durable atomic/);
});
