CREATE TABLE authority_owner_keys (
  record_id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
  public_key_base64url TEXT NOT NULL,
  key_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CURRENT', 'FINAL')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  valid_from_ms INTEGER NOT NULL,
  valid_until_ms INTEGER,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK (valid_until_ms IS NULL OR valid_until_ms > valid_from_ms)
);

CREATE INDEX authority_owner_keys_active_key
  ON authority_owner_keys (key_id, enabled, status, valid_from_ms, valid_until_ms);

CREATE TABLE authority_standing_state (
  record_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('enabled', 'disabled')),
  kill_switch INTEGER NOT NULL CHECK (kill_switch IN (0, 1)),
  reason TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CURRENT', 'FINAL')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  valid_from_ms INTEGER NOT NULL,
  valid_until_ms INTEGER,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK (valid_until_ms IS NULL OR valid_until_ms > valid_from_ms)
);

CREATE INDEX authority_standing_state_active_policy
  ON authority_standing_state (policy_id, policy_version, enabled, status, valid_from_ms, valid_until_ms);
