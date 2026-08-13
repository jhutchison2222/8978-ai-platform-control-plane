CREATE TABLE authority_identity_keys (
  record_id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  allowed_roles_json TEXT NOT NULL,
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

CREATE INDEX authority_identity_keys_active_key
  ON authority_identity_keys (key_id, enabled, status, valid_from_ms, valid_until_ms);

CREATE TABLE authority_test_evidence (
  record_id TEXT PRIMARY KEY,
  action_digest TEXT NOT NULL,
  test_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('passed', 'failed')),
  source_principal_id TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CURRENT', 'FINAL')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK (expires_at_ms > issued_at_ms)
);

CREATE INDEX authority_test_evidence_active_action
  ON authority_test_evidence (action_digest, enabled, status, issued_at_ms, expires_at_ms, test_id);

CREATE TABLE authority_rollbacks (
  record_id TEXT PRIMARY KEY,
  rollback_ref TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK (valid IN (0, 1)),
  executable INTEGER NOT NULL CHECK (executable IN (0, 1)),
  executor_ref TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CURRENT', 'FINAL')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK (expires_at_ms > issued_at_ms)
);

CREATE INDEX authority_rollbacks_active_reference
  ON authority_rollbacks (rollback_ref, action_digest, enabled, status, issued_at_ms, expires_at_ms);
