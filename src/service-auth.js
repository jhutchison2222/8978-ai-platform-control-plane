const ENCODER = new TextEncoder();
const HEADER = Object.freeze({
  version: "x-8978-auth-version",
  principal: "x-8978-service-principal",
  keyId: "x-8978-key-id",
  timestamp: "x-8978-timestamp",
  nonce: "x-8978-nonce",
  bodyDigest: "x-8978-content-sha256",
  signature: "x-8978-signature",
});
const VERSION = "1";

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return ENCODER.encode(value);
  throw new TypeError("Service-auth input must be a string, Uint8Array, or ArrayBuffer");
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid service signature encoding");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonicalTarget(input) {
  const url = input instanceof URL ? input : new URL(input);
  return url.pathname + url.search;
}

function canonicalMessage({ principalId, keyId, timestamp, nonce, method, target, bodyDigest }) {
  for (const [name, value] of Object.entries({ principalId, keyId, timestamp, nonce, method, target, bodyDigest })) {
    if (typeof value !== "string" || !value || value.includes("\n") || value.includes("\r")) throw new Error(`Invalid service-auth ${name}`);
  }
  return [VERSION, principalId, keyId, timestamp, nonce, method.toUpperCase(), target, bodyDigest].join("\n");
}

async function importHmacKey(secret, usages) {
  const bytes = asBytes(secret);
  if (bytes.byteLength < 32) throw new Error("Service-auth secret must contain at least 32 bytes");
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function digestServiceBody(body = new Uint8Array()) {
  return "sha256:" + Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", asBytes(body))),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createServiceAuthHeaders({
  secret, principalId, keyId, method, url, bodyDigest, now = new Date(), nonce = crypto.randomUUID(),
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new Error("Invalid service-auth time");
  if (!/^sha256:[a-f0-9]{64}$/u.test(bodyDigest)) throw new Error("Invalid service-auth body digest");
  const timestamp = now.toISOString();
  const target = canonicalTarget(url);
  const message = canonicalMessage({ principalId, keyId, timestamp, nonce, method, target, bodyDigest });
  const key = await importHmacKey(secret, ["sign"]);
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, ENCODER.encode(message))));
  return new Headers({
    [HEADER.version]: VERSION,
    [HEADER.principal]: principalId,
    [HEADER.keyId]: keyId,
    [HEADER.timestamp]: timestamp,
    [HEADER.nonce]: nonce,
    [HEADER.bodyDigest]: bodyDigest,
    [HEADER.signature]: signature,
  });
}

export async function verifyServiceAuth({
  request, actualBodyDigest, secretResolver, replayStore, now = new Date(), allowedClockSkewMs = 300_000,
}) {
  if (!(request instanceof Request)) throw new TypeError("Service-auth verification requires a Request");
  if (typeof secretResolver?.resolve !== "function") throw new Error("Trusted service secret resolver required");
  if (replayStore?.atomic !== true || replayStore?.durability !== "durable" || typeof replayStore.consume !== "function") {
    throw new Error("Durable atomic replay store required");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf()) || !Number.isInteger(allowedClockSkewMs) || allowedClockSkewMs < 1) {
    throw new Error("Invalid service-auth verification time");
  }
  const read = (name) => request.headers.get(name);
  const version = read(HEADER.version);
  const principalId = read(HEADER.principal);
  const keyId = read(HEADER.keyId);
  const timestamp = read(HEADER.timestamp);
  const nonce = read(HEADER.nonce);
  const bodyDigest = read(HEADER.bodyDigest);
  const encodedSignature = read(HEADER.signature);
  if (version !== VERSION || !principalId || !keyId || !timestamp || !nonce || !encodedSignature ||
      !/^sha256:[a-f0-9]{64}$/u.test(bodyDigest ?? "") || !/^sha256:[a-f0-9]{64}$/u.test(actualBodyDigest ?? "")) throw new Error("Service authentication required");\n  if (bodyDigest !== actualBodyDigest) throw new Error("Service-auth body digest mismatch");
  const issuedAt = new Date(timestamp);
  if (!Number.isFinite(issuedAt.valueOf()) || Math.abs(now.valueOf() - issuedAt.valueOf()) > allowedClockSkewMs) {
    throw new Error("Service-auth timestamp outside replay window");
  }
  const target = canonicalTarget(request.url);
  const message = canonicalMessage({ principalId, keyId, timestamp, nonce, method: request.method, target, bodyDigest });
  const secret = await secretResolver.resolve({ principalId, keyId });
  if (!secret) throw new Error("Unknown service principal or key");
  const key = await importHmacKey(secret, ["verify"]);
  let signature;
  try { signature = fromBase64Url(encodedSignature); } catch { throw new Error("Invalid service signature"); }
  if (!await crypto.subtle.verify("HMAC", key, signature, ENCODER.encode(message))) throw new Error("Invalid service signature");
  const replay = await replayStore.consume({ principalId, keyId, nonce, issuedAt: timestamp, expiresAt: new Date(issuedAt.valueOf() + allowedClockSkewMs).toISOString() });
  if (!replay?.consumed) throw new Error("Service-auth replay denied");
  return Object.freeze({ authenticated: true, mechanism: "hmac-sha256", principalId, keyId, issuedAt: timestamp, nonce, bodyDigest });
}

export const SERVICE_AUTH_HEADERS = HEADER;
