CREATE TABLE authority_resources (
  record_id TEXT PRIMARY KEY,
  locator TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CURRENT', 'FINAL')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  valid_from_ms INTEGER NOT NULL,
  valid_until_ms INTEGER,
  resource_key TEXT NOT NULL,
  resource_json TEXT NOT NULL,
  resource_digest TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK (valid_until_ms IS NULL OR valid_until_ms > valid_from_ms)
);

CREATE INDEX authority_resources_active_locator
  ON authority_resources (locator, enabled, status, valid_from_ms, valid_until_ms);

CREATE TABLE authority_limits (
  record_id TEXT PRIMARY KEY,
  resource_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CURRENT', 'FINAL')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  valid_from_ms INTEGER NOT NULL,
  valid_until_ms INTEGER,
  risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high', 'critical')),
  cost_usd REAL NOT NULL CHECK (cost_usd >= 0),
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  evidence_digest TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK (valid_until_ms IS NULL OR valid_until_ms > valid_from_ms)
);

CREATE INDEX authority_limits_active_resource_operation
  ON authority_limits (resource_key, operation, enabled, status, valid_from_ms, valid_until_ms);
