-- 0004: recruitment + careers site, employee paperwork, file storage, AI usage,
-- per-organization / per-user features, sign-in identifiers, MFA (passkey, TOTP, email OTP),
-- SSO, email-OTP invitations. Additive only.
PRAGMA foreign_keys = ON;

-- Organizations: features enabled by the platform, AI quota, branded careers domain.
ALTER TABLE organizations ADD COLUMN features_json TEXT;
ALTER TABLE organizations ADD COLUMN ai_daily_limit INTEGER NOT NULL DEFAULT 200;
ALTER TABLE organizations ADD COLUMN custom_domain TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_custom_domain ON organizations(custom_domain) WHERE custom_domain IS NOT NULL;

-- Users: username, per-user feature access, invitations.
ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE;
ALTER TABLE users ADD COLUMN features_json TEXT;
ALTER TABLE users ADD COLUMN invite_token_hash TEXT;
ALTER TABLE users ADD COLUMN invite_expires_at TEXT;
ALTER TABLE users ADD COLUMN invited_by TEXT REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_username ON users(organization_id, username) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_token ON users(invite_token_hash) WHERE invite_token_hash IS NOT NULL;

ALTER TABLE sessions ADD COLUMN auth_method TEXT;
ALTER TABLE sessions ADD COLUMN mfa_method TEXT;

-- Second factors. TOTP secrets are AES-GCM encrypted; passkeys store the public key only.
CREATE TABLE IF NOT EXISTS mfa_methods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('totp','passkey','email_otp')),
  label TEXT,
  secret_enc TEXT,
  credential_id TEXT,
  public_key_jwk TEXT,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  confirmed_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mfa_user ON mfa_methods(user_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_credential ON mfa_methods(credential_id) WHERE credential_id IS NOT NULL;

-- One-time email codes (MFA, invitation acceptance). Only hashes are stored.
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('login','invite','enroll')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_codes(user_id, purpose, created_at);

-- Short-lived challenges: pending MFA logins, WebAuthn ceremonies, SSO state.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('mfa','webauthn_register','webauthn_login','sso')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  challenge TEXT NOT NULL,
  data_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_challenges_expiry ON auth_challenges(expires_at);

-- Uploaded files. Content lives in R2 (FILES binding) when available, otherwise inline here.
CREATE TABLE IF NOT EXISTS stored_files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage TEXT NOT NULL CHECK(storage IN ('r2','d1')),
  data_b64 TEXT,
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_files_org ON stored_files(organization_id, created_at);

-- Employee paperwork (résumé, contract, ID copies, certificates…).
CREATE TABLE IF NOT EXISTS employee_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  file_id TEXT NOT NULL REFERENCES stored_files(id),
  category TEXT NOT NULL CHECK(category IN ('resume','contract','identity','certificate','tax','other')),
  title TEXT NOT NULL,
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_empdocs_employee ON employee_documents(organization_id, employee_id);

-- Job postings.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  department TEXT,
  location TEXT,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  work_mode TEXT NOT NULL DEFAULT 'onsite' CHECK(work_mode IN ('onsite','hybrid','remote')),
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT,
  show_salary INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  description TEXT NOT NULL,
  requirements TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed')),
  hiring_manager_id TEXT REFERENCES employees(id),
  closes_at TEXT,
  published_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jobs_org_status ON jobs(organization_id, status);

-- Applicants: link to job, application content, AI screening, hire.
ALTER TABLE applicants ADD COLUMN job_id TEXT REFERENCES jobs(id);
ALTER TABLE applicants ADD COLUMN cover_letter TEXT;
ALTER TABLE applicants ADD COLUMN resume_file_id TEXT REFERENCES stored_files(id);
ALTER TABLE applicants ADD COLUMN resume_text TEXT;
ALTER TABLE applicants ADD COLUMN profile_url TEXT;
ALTER TABLE applicants ADD COLUMN location TEXT;
ALTER TABLE applicants ADD COLUMN rating INTEGER;
ALTER TABLE applicants ADD COLUMN ai_summary TEXT;
ALTER TABLE applicants ADD COLUMN ai_generated_at TEXT;
ALTER TABLE applicants ADD COLUMN employee_id TEXT REFERENCES employees(id);
ALTER TABLE applicants ADD COLUMN privacy_accepted_at TEXT;
ALTER TABLE applicants ADD COLUMN ip_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_applicants_job ON applicants(organization_id, job_id, stage);

CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 45,
  mode TEXT NOT NULL DEFAULT 'video' CHECK(mode IN ('video','phone','onsite')),
  location TEXT,
  interviewer TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','no_show')),
  rating INTEGER,
  feedback TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_interviews_org ON interviews(organization_id, scheduled_at);

-- AI usage for quotas and transparency.
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT REFERENCES users(id),
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_org ON ai_usage(organization_id, created_at);

-- Organization AI knowledge base (handbook, policies, leave rules, labour-law notes).
-- Content is private to the organization; chunks are searched per organization only.
ALTER TABLE organizations ADD COLUMN country_code TEXT;
CREATE TABLE IF NOT EXISTS knowledge_docs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'policy' CHECK(category IN ('handbook','policy','leave','labour_law','procedure','template','other')),
  audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all','hr')),
  content TEXT NOT NULL,
  source_file_id TEXT REFERENCES stored_files(id),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_knowledge_org ON knowledge_docs(organization_id, category);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  doc_id TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  audience TEXT NOT NULL DEFAULT 'all',
  position INTEGER NOT NULL,
  heading TEXT,
  content TEXT NOT NULL,
  terms TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_org ON knowledge_chunks(organization_id, audience);

-- Private AI conversations: visible only to the user who owns them.
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'ask' CHECK(mode IN ('ask','draft')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id, updated_at);
CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  sources_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id, created_at);
