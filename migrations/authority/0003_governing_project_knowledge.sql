CREATE TABLE authority_project_knowledge (
  record_id TEXT PRIMARY KEY,
  knowledge_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CURRENT', 'FINAL')),
  governing INTEGER NOT NULL CHECK (governing = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  knowledge_json TEXT NOT NULL,
  knowledge_digest TEXT NOT NULL,
  valid_from_ms INTEGER NOT NULL,
  valid_until_ms INTEGER,
  version TEXT NOT NULL CHECK (length(version) > 0),
  CHECK (valid_until_ms IS NULL OR valid_until_ms > valid_from_ms)
);

CREATE INDEX authority_project_knowledge_active_scope
  ON authority_project_knowledge (knowledge_scope, enabled, governing, status, valid_from_ms, valid_until_ms);
