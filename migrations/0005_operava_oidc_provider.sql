-- 0005: first-party Operava OIDC authorization-code provider.
-- Additive only; codes are single-use, hashed at rest, and expire quickly.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS oidc_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  nonce TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_oidc_codes_expiry ON oidc_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oidc_codes_user ON oidc_authorization_codes(user_id, created_at);
