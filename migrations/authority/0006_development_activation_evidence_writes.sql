CREATE TABLE authority_development_activation_evidence_writes (
  write_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL UNIQUE,
  record_digest TEXT NOT NULL,
  request_body_digest TEXT NOT NULL UNIQUE,
  service_principal_id TEXT NOT NULL,
  service_key_id TEXT NOT NULL,
  service_nonce TEXT NOT NULL,
  authenticated_at_ms INTEGER NOT NULL,
  inserted_at_ms INTEGER NOT NULL,
  write_digest TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL CHECK (version > 0),
  FOREIGN KEY (record_id)
    REFERENCES authority_development_activation_evidence_bundles(record_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (inserted_at_ms >= authenticated_at_ms)
);

CREATE UNIQUE INDEX authority_activation_evidence_write_nonce
  ON authority_development_activation_evidence_writes (
    service_principal_id,
    service_key_id,
    service_nonce
  );
