const COMPONENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;

function requireComponent(name, value, pattern = COMPONENT_PATTERN) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid replay-store ${name}`);
  return value;
}

function replayShardName(principalId, keyId) {
  const principal = requireComponent("principalId", principalId);
  const key = requireComponent("keyId", keyId);
  return `v1:${principal.length}:${principal}:${key.length}:${key}`;
}

export class CloudflareDurableReplayStore {
  atomic = true;
  durability = "durable";
  #namespace;

  constructor(namespace) {
    if (!namespace || typeof namespace.getByName !== "function") {
      throw new Error("Durable Object namespace binding required");
    }
    this.#namespace = namespace;
  }

  async consume({ principalId, keyId, nonce, issuedAt, expiresAt }) {
    const shard = replayShardName(principalId, keyId);
    requireComponent("nonce", nonce, NONCE_PATTERN);
    const issuedAtMs = Date.parse(issuedAt);
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) {
      throw new Error("Invalid replay-store time window");
    }

    const stub = this.#namespace.getByName(shard);
    if (!stub || typeof stub.consume !== "function") throw new Error("Replay Durable Object RPC unavailable");
    const result = await stub.consume({ nonce, issuedAt, expiresAt });
    return Object.freeze({ consumed: result?.consumed === true });
  }
}

export const replayStoreShardName = replayShardName;
