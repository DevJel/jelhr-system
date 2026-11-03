PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','closed')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL COLLATE NOCASE, display_name TEXT NOT NULL,
  password_hash TEXT, role TEXT NOT NULL CHECK(role IN ('owner','admin','hr_manager','manager','employee','auditor')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','suspended','disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,email)
);
CREATE INDEX IF NOT EXISTS idx_users_org_role ON users(organization_id,role,status);
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT REFERENCES users(id), employee_number TEXT NOT NULL,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE,
  job_title TEXT NOT NULL, department TEXT, employment_type TEXT NOT NULL DEFAULT 'full_time',
  employment_status TEXT NOT NULL DEFAULT 'active' CHECK(employment_status IN ('active','onboarding','on_leave','offboarding','terminated')),
  hire_date TEXT, manager_id TEXT REFERENCES employees(id), country_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,employee_number), UNIQUE(organization_id,email)
);
CREATE INDEX IF NOT EXISTS idx_employees_org_status ON employees(organization_id,employment_status);
CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  employee_id TEXT NOT NULL REFERENCES employees(id), started_at TEXT NOT NULL, ended_at TEXT,
  break_minutes INTEGER NOT NULL DEFAULT 0, note TEXT, approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(approval_status IN ('pending','approved','rejected')),
  approved_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_time_org_employee ON time_entries(organization_id,employee_id,started_at);
CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  employee_id TEXT NOT NULL REFERENCES employees(id), title TEXT NOT NULL, description TEXT,
  owner_user_id TEXT REFERENCES users(id), due_date TEXT, completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_onboarding_org_employee ON onboarding_tasks(organization_id,employee_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  revoked_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions(user_id,expires_at);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_user_id TEXT REFERENCES users(id), action TEXT NOT NULL, resource_type TEXT NOT NULL,
  resource_id TEXT, ip_hash TEXT, metadata_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(organization_id,created_at);
CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id), settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
