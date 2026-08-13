import { canonicalize, digestCanonicalValue } from "./canonical-digest.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMPONENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;

function namespace(name, value) {
  if (!value || typeof value.getByName !== "function") throw new Error(`${name} Durable Object namespace required`);
  return value;
}

function digest(name, value) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function component(name, value) {
  if (typeof value !== "string" || !COMPONENT_PATTERN.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function instant(value) {
  const time = value instanceof Date ? value.valueOf() : Date.parse(value);
  if (!Number.isFinite(time)) throw new Error("Invalid runtime store time");
  return time;
}

export class CloudflareDurableIdempotencyStore {
  atomic = true;
  durability = "durable";
  #namespace;

  constructor(binding) { this.#namespace = namespace("idempotency", binding); }

  async reserve({ scope, actionDigest, leaseMs, now }) {
    digest("idempotency scope", scope); digest("action digest", actionDigest);
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 86_400_000) throw new Error("Invalid idempotency lease");
    return this.#namespace.getByName(scope).reserve({ scope, actionDigest, leaseMs, nowMs: instant(now) });
  }

  async complete({ scope, leaseId, resultDigest, terminalReceipt }) {
    digest("idempotency scope", scope); component("lease ID", leaseId); digest("result digest", resultDigest);
    return this.#namespace.getByName(scope).complete({ scope, leaseId, resultDigest, terminalReceipt });
  }

  async release({ scope, leaseId }) {
    digest("idempotency scope", scope); component("lease ID", leaseId);
    return this.#namespace.getByName(scope).release({ scope, leaseId });
  }
}

export class CloudflareDurableOwnerDecisionStore {
  atomic = true;
  durability = "durable";
  #namespace;

  constructor(binding) { this.#namespace = namespace("owner decision", binding); }

  async consume({ decisionId, actionDigest, now = new Date() }) {
    component("owner decision ID", decisionId); digest("owner decision action digest", actionDigest);
    return this.#namespace.getByName(decisionId).consume({ decisionId, actionDigest, consumedAtMs: instant(now) });
  }
}

export class CloudflareDurableAuditStore {
  durability = "durable";
  appendOnly = true;
  #namespace;

  constructor(binding) { this.#namespace = namespace("audit", binding); }

  async append(event) {
    const scope = digest("audit idempotency scope", event?.idempotencyScope);
    canonicalize(event);
    return this.#namespace.getByName(scope).append({ scope, event });
  }

  async verifyReceipt(receipt, event) {
    if (!receipt || !Number.isInteger(receipt.sequence) || receipt.sequence < 1 ||
        !DIGEST_PATTERN.test(receipt.previousDigest ?? "") || !DIGEST_PATTERN.test(receipt.eventDigest ?? "") ||
        receipt.idempotencyScope !== event?.idempotencyScope) return false;
    return receipt.eventDigest === await digestCanonicalValue({
      sequence: receipt.sequence,
      previousDigest: receipt.previousDigest,
      event,
    });
  }
}
