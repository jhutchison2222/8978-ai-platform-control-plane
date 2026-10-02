import { createServiceAuthHeaders, digestServiceBody, verifyServiceAuth } from "./service-auth.js";

const DEFAULT_MAX_BODY_BYTES = 1_048_576;

function requireMaxBodyBytes(value) {
  if (!Number.isInteger(value) || value < 0 || value > 16_777_216) throw new Error("Invalid service-auth body limit");
  return value;
}

function bodyBytes(body) {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError("Service-auth body must be a string, ArrayBuffer, or ArrayBufferView");
}

async function readBoundedBody(request, maxBodyBytes) {
  const maximum = requireMaxBodyBytes(maxBodyBytes);
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^(0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > maximum)) {
    throw new Error("Service-auth request body exceeds limit");
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maximum) {
        await reader.cancel("Service-auth request body exceeds limit");
        throw new Error("Service-auth request body exceeds limit");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export async function createServiceAuthenticatedRequest({
  url,
  method = "GET",
  headers: inputHeaders,
  body,
  secret,
  principalId,
  keyId,
  now = new Date(),
  nonce = crypto.randomUUID(),
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
}) {
  const bytes = bodyBytes(body);
  if (bytes.byteLength > requireMaxBodyBytes(maxBodyBytes)) throw new Error("Service-auth request body exceeds limit");
  const headers = new Headers(inputHeaders);
  if (headers.has("authorization") || headers.has("proxy-authorization")) {
    throw new Error("OAuth and bearer authorization headers are not allowed in service-auth requests");
  }

  const bodyDigest = await digestServiceBody(bytes);
  const authHeaders = await createServiceAuthHeaders({
    secret, principalId, keyId, method, url, bodyDigest, now, nonce,
  });
  for (const [name, value] of authHeaders) headers.set(name, value);

  return new Request(url, {
    method,
    headers,
    body: bytes.byteLength === 0 ? undefined : bytes,
  });
}

export async function authenticateServiceRequest({
  request,
  secretResolver,
  replayStore,
  now = new Date(),
  allowedClockSkewMs = 300_000,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
}) {
  if (!(request instanceof Request)) throw new TypeError("Service-auth adapter requires a Request");
  const bytes = await readBoundedBody(request.clone(), maxBodyBytes);
  const actualBodyDigest = await digestServiceBody(bytes);
  const identity = await verifyServiceAuth({
    request,
    actualBodyDigest,
    secretResolver,
    replayStore,
    now,
    allowedClockSkewMs,
  });
  return Object.freeze({ identity, bodyBytes: bytes });
}

export class ServiceAuthFetcher {
  #fetcher;
  #configuration;

  constructor({ fetcher, secret, principalId, keyId, maxBodyBytes = DEFAULT_MAX_BODY_BYTES }) {
    if (!fetcher || typeof fetcher.fetch !== "function") throw new Error("Service binding or fetcher required");
    this.#fetcher = fetcher;
    this.#configuration = Object.freeze({ secret, principalId, keyId, maxBodyBytes: requireMaxBodyBytes(maxBodyBytes) });
  }

  async fetch(url, init = {}) {
    const request = await createServiceAuthenticatedRequest({
      url,
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      ...this.#configuration,
    });
    return this.#fetcher.fetch(request);
  }
}

export const SERVICE_AUTH_DEFAULT_MAX_BODY_BYTES = DEFAULT_MAX_BODY_BYTES;
