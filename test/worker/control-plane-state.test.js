import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  CloudflareDurableAuditStore,
  CloudflareDurableIdempotencyStore,
  CloudflareDurableOwnerDecisionStore,
} from "../../src/cloudflare-runtime-stores.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

describe("durable control-plane state", () => {
  it("allows one concurrent idempotency reservation and supports expiry recovery", async () => {
    const store = new CloudflareDurableIdempotencyStore(env.IDEMPOTENCY_STORE);
    const scope = digest("1");
    const now = new Date();
    const attempts = await Promise.all(Array.from({ length: 30 }, () => store.reserve({
      scope,
      actionDigest: digest("a"),
      leaseMs: 300_000,
      now,
    })));
    const winners = attempts.filter((attempt) => attempt.reserved);
    expect(winners).toHaveLength(1);
    expect(attempts.filter((attempt) => !attempt.reserved)).toHaveLength(29);

    const recoveryScope = digest("2");
    const first = await store.reserve({ scope: recoveryScope, actionDigest: digest("b"), leaseMs: 10, now });
    const recovered = await store.reserve({
      scope: recoveryScope,
      actionDigest: digest("b"),
      leaseMs: 300_000,
      now: new Date(now.valueOf() + 11),
    });
    expect(recovered.recovered).toBe(true);
    expect(await store.complete({
      scope: recoveryScope,
      leaseId: first.leaseId,
      resultDigest: digest("c"),
      terminalReceipt: { receipt: "stale" },
    })).toEqual({ completed: false });
    expect(await store.complete({
      scope: recoveryScope,
      leaseId: recovered.leaseId,
      resultDigest: digest("c"),
      terminalReceipt: { receipt: "winner" },
    })).toEqual({ completed: true });
    expect((await store.reserve({
      scope: recoveryScope,
      actionDigest: digest("b"),
      leaseMs: 300_000,
      now: new Date(now.valueOf() + 12),
    })).reserved).toBe(false);

    const releaseScope = digest("5");
    const releasable = await store.reserve({ scope: releaseScope, actionDigest: digest("f"), leaseMs: 300_000, now });
    expect(await store.release({ scope: releaseScope, leaseId: "wrong-lease" })).toBe(false);
    expect(await store.release({ scope: releaseScope, leaseId: releasable.leaseId })).toBe(true);
    expect((await store.reserve({ scope: releaseScope, actionDigest: digest("f"), leaseMs: 300_000, now })).reserved).toBe(true);
  });

  it("consumes an owner decision exactly once across concurrent callers", async () => {
    const store = new CloudflareDurableOwnerDecisionStore(env.OWNER_DECISION_STORE);
    const attempts = await Promise.all(Array.from({ length: 30 }, () => store.consume({
      decisionId: "owner-decision-concurrent",
      actionDigest: digest("d"),
    })));
    expect(attempts.filter((attempt) => attempt.consumed)).toHaveLength(1);
    expect(attempts.filter((attempt) => !attempt.consumed)).toHaveLength(29);
    expect(await store.consume({ decisionId: "owner-decision-concurrent", actionDigest: digest("e") })).toEqual({ consumed: false });
  });

  it("serializes concurrent audit appends into one verifiable SQLite hash chain", async () => {
    const store = new CloudflareDurableAuditStore(env.AUDIT_STORE);
    const scope = digest("3");
    const events = Array.from({ length: 30 }, (_, index) => ({
      idempotencyScope: scope,
      eventIndex: index,
      recordedAt: new Date().toISOString(),
    }));
    const receipts = await Promise.all(events.map((event) => store.append(event)));
    const ordered = [...receipts].sort((left, right) => left.sequence - right.sequence);
    expect(ordered.map((receipt) => receipt.sequence)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(ordered[0].previousDigest).toBe(digest("0"));
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index].previousDigest).toBe(ordered[index - 1].eventDigest);
    }
    for (let index = 0; index < receipts.length; index += 1) {
      expect(await store.verifyReceipt(receipts[index], events[index])).toBe(true);
    }
    expect(await store.verifyReceipt(receipts[0], { ...events[0], eventIndex: 999 })).toBe(false);
    expect(await store.verifyReceipt({ ...receipts[0], sequence: receipts[0].sequence + 100 }, events[0])).toBe(false);
    expect(await store.verifyReceipt({ ...receipts[0], previousDigest: digest("9") }, events[0])).toBe(false);
    expect(await store.verifyReceipt({ ...receipts[0], eventDigest: digest("8") }, events[0])).toBe(false);
    expect(await store.verifyReceipt({ ...receipts[0], idempotencyScope: digest("7") }, events[0])).toBe(false);

    const stub = env.AUDIT_STORE.getByName(scope);
    await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql.exec(
        "SELECT sequence, previous_digest, event_digest, event_json FROM audit_events ORDER BY sequence",
      ).toArray();
      expect(rows).toHaveLength(30);
      expect(rows[0].previous_digest).toBe(digest("0"));
      for (let index = 1; index < rows.length; index += 1) {
        expect(rows[index].previous_digest).toBe(rows[index - 1].event_digest);
      }
      expect(JSON.parse(rows[0].event_json).idempotencyScope).toBe(scope);
    });
  });

  it("isolates concurrent audit chains by execution scope", async () => {
    const store = new CloudflareDurableAuditStore(env.AUDIT_STORE);
    const scopes = [digest("6"), digest("7")];
    const chains = await Promise.all(scopes.map((scope) => Promise.all(
      Array.from({ length: 20 }, (_, index) => store.append({ idempotencyScope: scope, eventIndex: index })),
    )));
    for (const [index, receipts] of chains.entries()) {
      const ordered = [...receipts].sort((left, right) => left.sequence - right.sequence);
      expect(ordered.map((receipt) => receipt.sequence)).toEqual(Array.from({ length: 20 }, (_, position) => position + 1));
      expect(ordered.every((receipt) => receipt.idempotencyScope === scopes[index])).toBe(true);
    }
  });

  it("rejects malformed state keys before writing", async () => {
    const idempotency = new CloudflareDurableIdempotencyStore(env.IDEMPOTENCY_STORE);
    const decisions = new CloudflareDurableOwnerDecisionStore(env.OWNER_DECISION_STORE);
    const audit = new CloudflareDurableAuditStore(env.AUDIT_STORE);
    await expect(idempotency.reserve({ scope: "bad", actionDigest: digest("a"), leaseMs: 1, now: new Date() })).rejects.toThrow();
    await expect(idempotency.reserve({ scope: digest("8"), actionDigest: digest("a"), leaseMs: 0, now: new Date() })).rejects.toThrow();
    await expect(idempotency.reserve({ scope: digest("8"), actionDigest: digest("a"), leaseMs: 86_400_001, now: new Date() })).rejects.toThrow();
    await expect(decisions.consume({ decisionId: "bad id", actionDigest: digest("a") })).rejects.toThrow();
    await expect(audit.append({ idempotencyScope: digest("4"), value: undefined })).rejects.toThrow();
  });

  it("rejects direct attempts to cross a Durable Object shard boundary", async () => {
    const nowMs = Date.now();
    const idempotency = env.IDEMPOTENCY_STORE.getByName(digest("a"));
    await idempotency.reserve({ scope: digest("a"), actionDigest: digest("1"), leaseMs: 300_000, nowMs });
    await runInDurableObject(idempotency, async (instance) => {
      await expect(instance.reserve({ scope: digest("b"), actionDigest: digest("1"), leaseMs: 300_000, nowMs })).rejects.toThrow(/shard scope mismatch/);
    });

    const decisions = env.OWNER_DECISION_STORE.getByName("owner-shard-a");
    expect(await decisions.consume({ decisionId: "owner-shard-a", actionDigest: digest("2"), consumedAtMs: nowMs })).toEqual({ consumed: true });
    expect(await decisions.consume({ decisionId: "owner-shard-b", actionDigest: digest("2"), consumedAtMs: nowMs })).toEqual({ consumed: false });

    const audit = env.AUDIT_STORE.getByName(digest("c"));
    await audit.append({ scope: digest("c"), event: { idempotencyScope: digest("c"), eventIndex: 1 } });
    await runInDurableObject(audit, async (instance) => {
      await expect(instance.append({ scope: digest("d"), event: { idempotencyScope: digest("d"), eventIndex: 2 } })).rejects.toThrow(/shard scope mismatch/);
    });
  });
});
