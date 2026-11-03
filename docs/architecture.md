# JelHR System architecture

## Deployment boundary

Cloudflare Pages serves the static multi-page application from `frontend/`. Pages Functions in the repository-level `functions/` directory handle API routes. The D1 binding is named `DB`.

## Request flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant P as Cloudflare Pages
  participant F as Pages Function
  participant D as D1
  B->>P: GET /index.html
  P-->>B: HTML / CSS / JavaScript
  B->>F: GET /api/health
  F->>D: SELECT 1
  D-->>F: Database result
  F-->>B: Health JSON
```

## Tenant model

```mermaid
erDiagram
  ORGANIZATIONS ||--o{ USERS : contains
  ORGANIZATIONS ||--o{ EMPLOYEES : employs
  ORGANIZATIONS ||--o{ TIME_ENTRIES : records
  ORGANIZATIONS ||--o{ ONBOARDING_TASKS : assigns
  USERS ||--o{ SESSIONS : owns
  USERS ||--o{ AUDIT_LOGS : performs
  EMPLOYEES ||--o{ TIME_ENTRIES : logs
  EMPLOYEES ||--o{ ONBOARDING_TASKS : completes
```

Every future data query must derive `organization_id` from a verified session, never from an untrusted browser-supplied tenant header or request body. All write actions must create audit events in the same logical transaction/batch.

## Authentication and remaining work before real HR data

1. Invite-only organization owner bootstrap.
2. Password hashing using a modern password KDF and constant-time verification.
3. Opaque, random session tokens stored only as hashes; secure, HttpOnly, SameSite cookies.
4. Session rotation, expiry, logout and revocation.
5. Role-based access control with server-side permission checks.
6. MFA and recovery controls before production onboarding.
7. Rate limits and abuse monitoring for authentication routes.

Authentication endpoints for login, logout, current-user lookup and initial-owner bootstrap are present in the repository. Their presence does not establish that a particular deployment is configured or production-ready. The current implementation uses a signed JWT cookie and a D1 session record; see the root README for actual behavior, limitations and prerequisites. Items above remain review or future-work goals where not yet implemented.

## Privacy

Use synthetic demo data only. Production rollout requires a privacy notice, retention schedule, employee data access policy, export/deletion workflows, least-privilege roles, audit retention, incident response and verified backups.
