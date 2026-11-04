-- 0003: account hardening, offboarding completion, onboarding/time workflow, e-signature.
-- Additive only: no existing column or row is removed.
PRAGMA foreign_keys = ON;

-- Sign-in looks users up by email alone, so an email must identify exactly one account.
-- If this statement fails, two organizations share an email: resolve the duplicate first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_global ON users(email);

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN ip_hash TEXT;

ALTER TABLE employees ADD COLUMN phone TEXT;
ALTER TABLE employees ADD COLUMN location TEXT;
CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(organization_id, manager_id);

-- Offboarding
ALTER TABLE offboarding_tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE offboarding_cases ADD COLUMN exit_interview_at TEXT;
ALTER TABLE offboarding_cases ADD COLUMN exit_interview_notes TEXT;
ALTER TABLE offboarding_cases ADD COLUMN rehire_eligible TEXT;
ALTER TABLE offboarding_cases ADD COLUMN cancelled_reason TEXT;
ALTER TABLE offboarding_cases ADD COLUMN submitted_at TEXT;
ALTER TABLE offboarding_cases ADD COLUMN approved_by TEXT REFERENCES users(id);

ALTER TABLE employee_assets ADD COLUMN case_id TEXT REFERENCES offboarding_cases(id);
ALTER TABLE employee_assets ADD COLUMN status TEXT NOT NULL DEFAULT 'assigned';
ALTER TABLE employee_assets ADD COLUMN recorded_by TEXT REFERENCES users(id);
ALTER TABLE employee_assets ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_org_employee ON employee_assets(organization_id, employee_id);

-- Onboarding
ALTER TABLE onboarding_tasks ADD COLUMN completed_by TEXT REFERENCES users(id);
ALTER TABLE onboarding_tasks ADD COLUMN owner_label TEXT;
ALTER TABLE onboarding_tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Time
ALTER TABLE time_entries ADD COLUMN approved_at TEXT;
CREATE INDEX IF NOT EXISTS idx_time_open ON time_entries(employee_id, ended_at);

-- Electronic signature requests.
-- body + title + signer identity are hashed into document_hash when the request is created;
-- the hash is shown to the signer and must be echoed back on signing.
CREATE TABLE IF NOT EXISTS signature_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  offboarding_case_id TEXT REFERENCES offboarding_cases(id),
  template_id TEXT NOT NULL DEFAULT 'custom',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  message TEXT,
  document_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','signed','declined','voided')),
  due_date TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  viewed_at TEXT,
  signed_at TEXT,
  signer_user_id TEXT REFERENCES users(id),
  signer_name TEXT,
  signer_email TEXT,
  signature_type TEXT CHECK(signature_type IN ('drawn','typed')),
  signature_image TEXT,
  typed_name TEXT,
  consent_text TEXT,
  signer_ip_hash TEXT,
  signer_user_agent TEXT,
  signature_hash TEXT,
  declined_reason TEXT,
  voided_reason TEXT,
  voided_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sig_org_status ON signature_requests(organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_sig_employee ON signature_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_sig_case ON signature_requests(offboarding_case_id);

CREATE TABLE IF NOT EXISTS signature_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  event TEXT NOT NULL CHECK(event IN ('created','viewed','signed','declined','voided','reminded')),
  actor_user_id TEXT REFERENCES users(id),
  ip_hash TEXT,
  user_agent TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sig_events_request ON signature_events(request_id, created_at);

-- Former-employee contact details (work email is disabled after offboarding).
ALTER TABLE employees ADD COLUMN personal_email TEXT COLLATE NOCASE;
ALTER TABLE employees ADD COLUMN contact_opt_out INTEGER NOT NULL DEFAULT 0;

-- Applicants (lightweight recruitment records used for communications).
CREATE TABLE IF NOT EXISTS applicants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT,
  position TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'applied' CHECK(stage IN ('applied','screening','interview','offer','hired','rejected','withdrawn')),
  source TEXT,
  notes TEXT,
  consent_to_contact INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, email, position)
);
CREATE INDEX IF NOT EXISTS idx_applicants_org_stage ON applicants(organization_id, stage);

-- Outbound communications (email). Recipients are resolved and frozen when the message is created.
CREATE TABLE IF NOT EXISTS communications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL CHECK(audience IN ('employees','department','applicants','former','individuals')),
  audience_filter TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','partial','cancelled')),
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comms_org_created ON communications(organization_id, created_at);

CREATE TABLE IF NOT EXISTS communication_recipients (
  id TEXT PRIMARY KEY,
  communication_id TEXT NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  recipient_type TEXT NOT NULL CHECK(recipient_type IN ('employee','applicant','former')),
  recipient_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed','skipped')),
  error TEXT,
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comm_recipients ON communication_recipients(communication_id, status);

-- Platform (super admin) sessions. The super admin identity lives only in Cloudflare secrets.
CREATE TABLE IF NOT EXISTS platform_sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS platform_audit (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  organization_id TEXT,
  resource_id TEXT,
  metadata_json TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit(created_at);
