CREATE TABLE authority_development_activation_evidence_bundles (
  record_id TEXT PRIMARY KEY,
  reviewed_commit TEXT NOT NULL,
  maker_validation_digest TEXT NOT NULL,
  checker_validation_digest TEXT NOT NULL,
  resource_activation_authorization_digest TEXT NOT NULL,
  worker_deployment_authorization_digest TEXT NOT NULL,
  rollback_evidence_digest TEXT NOT NULL,
  backup_digest TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  bundle_digest TEXT NOT NULL,
  record_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CURRENT', 'FINAL')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK (expires_at_ms > issued_at_ms)
);

CREATE INDEX authority_activation_evidence_active_commit
  ON authority_development_activation_evidence_bundles (
    reviewed_commit,
    maker_validation_digest,
    checker_validation_digest,
    resource_activation_authorization_digest,
    worker_deployment_authorization_digest,
    rollback_evidence_digest,
    backup_digest,
    enabled,
    status,
    issued_at_ms,
    expires_at_ms
  );
