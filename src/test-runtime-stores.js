import { digestCanonicalValue } from "./canonical-digest.js";

export class DurableLeaseStore {
  atomic = true; durability = "durable"; #entries = new Map(); #next = 1;
  async reserve({ scope, actionDigest, leaseMs, now }) {
    const current = this.#entries.get(scope); const timestamp = now.valueOf();
    if (current?.state === "completed" || (current?.state === "reserved" && current.expiresAt > timestamp)) return { reserved: false };
    const leaseId = `lease-${this.#next++}`; this.#entries.set(scope, { state: "reserved", leaseId, actionDigest, expiresAt: timestamp + leaseMs });
    return { reserved: true, leaseId, recovered: Boolean(current) };
  }
  async complete({ scope, leaseId, resultDigest, terminalReceipt }) {
    const current = this.#entries.get(scope); if (current?.state !== "reserved" || current.leaseId !== leaseId) return { completed: false };
    this.#entries.set(scope, { ...current, state: "completed", resultDigest, terminalReceipt }); return { completed: true };
  }
  async release({ scope, leaseId }) { const current = this.#entries.get(scope); if (current?.state === "reserved" && current.leaseId === leaseId) { this.#entries.delete(scope); return true; } return false; }
}

export class DurableOwnerDecisionStore {
  atomic = true; durability = "durable"; #used = new Set();
  async consume({ decisionId, actionDigest }) { const key = `${decisionId}\u0000${actionDigest}`; if (this.#used.has(key)) return { consumed: false }; this.#used.add(key); return { consumed: true }; }
}

export class DurableAppendOnlyAuditStore {
  durability = "durable"; appendOnly = true; #events = []; #head = "sha256:" + "0".repeat(64); #tail = Promise.resolve(); failNext = false;
  async append(event) {
    const previous = this.#tail; let release; this.#tail = new Promise((resolve) => { release = resolve; }); await previous;
    try {
      if (this.failNext) { this.failNext = false; throw new Error("audit unavailable"); }
      const immutable = structuredClone(event); const sequence = this.#events.length + 1; const previousDigest = this.#head;
      const eventDigest = await digestCanonicalValue({ sequence, previousDigest, event: immutable });
      const receipt = Object.freeze({ sequence, previousDigest, eventDigest }); this.#events.push({ event: immutable, receipt }); this.#head = eventDigest; return receipt;
    } finally { release(); }
  }
  async verifyReceipt(receipt, event) { return receipt.eventDigest === await digestCanonicalValue({ sequence: receipt.sequence, previousDigest: receipt.previousDigest, event }); }
  events() { return structuredClone(this.#events); }
}
