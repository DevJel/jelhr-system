PRAGMA foreign_keys = ON;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
CREATE TABLE IF NOT EXISTS offboarding_cases (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 employee_id TEXT NOT NULL REFERENCES employees(id), initiated_by TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL, last_working_day TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','pending_approval','completed','cancelled')),
 exit_interview_status TEXT NOT NULL DEFAULT 'pending' CHECK(exit_interview_status IN ('pending','scheduled','completed','declined')),
 final_pay_status TEXT NOT NULL DEFAULT 'pending' CHECK(final_pay_status IN ('pending','processing','completed','not_applicable')),
 notes TEXT, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offboarding_open_employee ON offboarding_cases(employee_id) WHERE status IN ('in_progress','pending_approval');
CREATE INDEX IF NOT EXISTS idx_offboarding_org_status ON offboarding_cases(organization_id,status,created_at);
CREATE TABLE IF NOT EXISTS offboarding_tasks (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES offboarding_cases(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('knowledge_transfer','it_access','assets','finance','people','compliance')),
 title TEXT NOT NULL, description TEXT, owner_role TEXT NOT NULL DEFAULT 'hr',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','blocked','not_applicable')),
 due_date TEXT, completed_by TEXT REFERENCES users(id), completed_at TEXT, evidence_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_case ON offboarding_tasks(case_id,status);
CREATE TABLE IF NOT EXISTS employee_assets (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 employee_id TEXT NOT NULL REFERENCES employees(id), asset_type TEXT NOT NULL, asset_tag TEXT,
 description TEXT, returned_at TEXT, condition_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL,
 locked_until INTEGER
);
CREATE TABLE IF NOT EXISTS auth_events (
 id TEXT PRIMARY KEY, user_id TEXT, email TEXT NOT NULL, event TEXT NOT NULL,
 ip_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_events_email ON auth_events(email,created_at);
