import { DurableObject } from "cloudflare:workers";

const MAX_RETENTION_MS = 86_400_000;
const NONCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;

export class ServiceAuthReplayDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS consumed_nonces (
          nonce TEXT PRIMARY KEY,
          issued_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS consumed_nonces_expires_at
          ON consumed_nonces(expires_at);
      `);
    });
  }

  async consume({ nonce, issuedAt, expiresAt }) {
    const now = Date.now();
    const issuedAtMs = Date.parse(issuedAt);
    const expiresAtMs = Date.parse(expiresAt);
    if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce) ||
        !Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) ||
        expiresAtMs <= issuedAtMs || expiresAtMs <= now ||
        expiresAtMs - now > MAX_RETENTION_MS) {
      return Object.freeze({ consumed: false });
    }

    const consumed = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`
        DELETE FROM consumed_nonces
        WHERE nonce IN (
          SELECT nonce FROM consumed_nonces
          WHERE expires_at <= ?
          ORDER BY expires_at
          LIMIT 256
        )
      `, now);
      const insertion = this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO consumed_nonces (nonce, issued_at, expires_at, consumed_at) VALUES (?, ?, ?, ?)",
        nonce, issuedAtMs, expiresAtMs, now,
      );
      return insertion.rowsWritten === 1;
    });

    return Object.freeze({ consumed });
  }
}
