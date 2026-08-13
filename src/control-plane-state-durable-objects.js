import { DurableObject } from "cloudflare:workers";
import { canonicalize, digestCanonicalValue } from "./canonical-digest.js";

const ZERO_DIGEST = "sha256:" + "0".repeat(64);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMPONENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;

function requireDigest(name, value) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function requireComponent(name, value) {
  if (typeof value !== "string" || !COMPONENT_PATTERN.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

export class IdempotencyStateDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS lease_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          scope TEXT NOT NULL,
          action_digest TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('reserved', 'completed')),
          lease_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          result_digest TEXT,
          terminal_receipt_json TEXT
        )
      `);
    });
  }

  async reserve({ scope, actionDigest, leaseMs, nowMs }) {
    requireDigest("idempotency scope", scope); requireDigest("action digest", actionDigest);
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 86_400_000 || !Number.isFinite(nowMs)) {
      throw new Error("Invalid idempotency reservation");
    }
    return this.ctx.storage.transactionSync(() => {
      const current = this.ctx.storage.sql.exec(
        "SELECT scope, action_digest, state, lease_id, expires_at FROM lease_state WHERE id = 1",
      ).toArray()[0];
      if (current && current.scope !== scope) throw new Error("Idempotency shard scope mismatch");
      if (current && (current.state === "completed" || current.expires_at > nowMs)) return Object.freeze({ reserved: false });
      const leaseId = crypto.randomUUID();
      this.ctx.storage.sql.exec(`
        INSERT INTO lease_state (id, scope, action_digest, state, lease_id, expires_at, result_digest, terminal_receipt_json)
        VALUES (1, ?, ?, 'reserved', ?, ?, NULL, NULL)
        ON CONFLICT(id) DO UPDATE SET scope=excluded.scope, action_digest=excluded.action_digest,
          state='reserved', lease_id=excluded.lease_id, expires_at=excluded.expires_at,
          result_digest=NULL, terminal_receipt_json=NULL
      `, scope, actionDigest, leaseId, nowMs + leaseMs);
      return Object.freeze({ reserved: true, leaseId, recovered: Boolean(current) });
    });
  }

  async complete({ scope, leaseId, resultDigest, terminalReceipt }) {
    requireDigest("idempotency scope", scope); requireComponent("lease ID", leaseId); requireDigest("result digest", resultDigest);
    const receiptJson = canonicalize(terminalReceipt);
    return this.ctx.storage.transactionSync(() => {
      const update = this.ctx.storage.sql.exec(`
        UPDATE lease_state SET state='completed', result_digest=?, terminal_receipt_json=?
        WHERE id=1 AND scope=? AND state='reserved' AND lease_id=? AND expires_at>?
        RETURNING lease_id
      `, resultDigest, receiptJson, scope, leaseId, Date.now());
      return Object.freeze({ completed: update.next().done === false });
    });
  }

  async release({ scope, leaseId }) {
    requireDigest("idempotency scope", scope); requireComponent("lease ID", leaseId);
    return this.ctx.storage.transactionSync(() => {
      const deletion = this.ctx.storage.sql.exec(
        "DELETE FROM lease_state WHERE id=1 AND scope=? AND state='reserved' AND lease_id=? RETURNING lease_id",
        scope, leaseId,
      );
      return deletion.next().done === false;
    });
  }
}

export class OwnerDecisionStateDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS consumed_decision (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          decision_id TEXT NOT NULL UNIQUE,
          action_digest TEXT NOT NULL,
          consumed_at INTEGER NOT NULL
        )
      `);
    });
  }

  async consume({ decisionId, actionDigest, consumedAtMs }) {
    requireComponent("owner decision ID", decisionId); requireDigest("owner decision action digest", actionDigest);
    if (!Number.isFinite(consumedAtMs)) throw new Error("Invalid owner decision consumption time");
    if (this.ctx.id.name !== decisionId) throw new Error("Owner decision shard identity mismatch");
    const insertion = this.ctx.storage.sql.exec(`
      INSERT INTO consumed_decision (id, decision_id, action_digest, consumed_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
      RETURNING decision_id
    `, decisionId, actionDigest, consumedAtMs);
    return Object.freeze({ consumed: insertion.next().done === false });
  }
}

export class AuditStateDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS audit_head (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          scope TEXT,
          sequence INTEGER NOT NULL,
          digest TEXT NOT NULL
        );
        INSERT OR IGNORE INTO audit_head (id, scope, sequence, digest) VALUES (1, NULL, 0, '${ZERO_DIGEST}');
        CREATE TABLE IF NOT EXISTS audit_events (
          sequence INTEGER PRIMARY KEY,
          previous_digest TEXT NOT NULL,
          event_digest TEXT NOT NULL UNIQUE,
          event_json TEXT NOT NULL
        )
      `);
    });
  }

  async append({ scope, event }) {
    requireDigest("audit scope", scope);
    if (event?.idempotencyScope !== scope) throw new Error("Audit event scope mismatch");
    const eventJson = canonicalize(event);
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const head = this.ctx.storage.sql.exec("SELECT scope, sequence, digest FROM audit_head WHERE id=1").one();
      if (head.scope !== null && head.scope !== scope) throw new Error("Audit shard scope mismatch");
      const sequence = head.sequence + 1;
      const eventDigest = await digestCanonicalValue({ sequence, previousDigest: head.digest, event });
      const committed = this.ctx.storage.transactionSync(() => {
        const update = this.ctx.storage.sql.exec(`
          UPDATE audit_head SET scope=COALESCE(scope, ?), sequence=?, digest=?
          WHERE id=1 AND (scope IS NULL OR scope=?) AND sequence=? AND digest=?
          RETURNING sequence
        `, scope, sequence, eventDigest, scope, head.sequence, head.digest);
        if (update.next().done) return false;
        this.ctx.storage.sql.exec(
          "INSERT INTO audit_events (sequence, previous_digest, event_digest, event_json) VALUES (?, ?, ?, ?)",
          sequence, head.digest, eventDigest, eventJson,
        );
        return true;
      });
      if (committed) return Object.freeze({ sequence, previousDigest: head.digest, eventDigest, idempotencyScope: scope });
    }
    throw new Error("Audit append contention limit exceeded");
  }
}
