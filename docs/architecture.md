# JelHR System architecture

## Deployment boundary

Cloudflare Pages in the Jelvan - Business - Operava account serves the static application from `frontend/`. Pages Functions in the repository-level `functions/` directory handle API routes. The production bindings are `DB` (D1), `FILES` (R2), `AI` (Workers AI), `VECTORIZE` (Vectorize) and `MAILER` (internal SES mailer Worker). The Wrangler file is the source of truth for resource bindings. Preview deployments remain disabled until separate preview resources are provisioned.

## Request flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant P as Cloudflare Pages
  participant F as Pages Function
  participant D as D1
  participant R as R2
  participant A as Workers AI / Vectorize
  participant M as SES mailer Worker
  B->>P: GET /index.html
  P-->>B: HTML / CSS / JavaScript
  B->>F: GET /api/health
  F->>D: SELECT 1 + schema probe
  D-->>F: Database result
  F-->>B: Health JSON
  F->>R: Store / retrieve files (when requested)
  F->>A: AI inference and optional semantic retrieval
  F->>M: Internal service binding for email
  M-->>F: SES delivery result
```

## Time and onboarding UI data flow

```mermaid
sequenceDiagram
  participant U as User
  participant B as Browser workflow page
  participant F as Tenant-scoped Pages Function
  participant D as D1 and audit log
  U->>B: Record time or update onboarding task
  B->>F: Authenticated same-origin JSON request
  F->>F: Check session, feature, role and ownership
  F->>D: Persist change and audit event
  D-->>F: Result
  F-->>B: JSON status
  B->>F: Reload current data
```

Time and onboarding are stored in JelHR; there is no live cross-tab subscription or external payroll/attendance synchronization.

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

## Authentication and release boundary

The v0.4 backend implements password authentication, session revocation, role checks, MFA/passkey endpoints, OIDC SSO, invitation APIs and platform administration APIs. Production session signing and encryption secrets are configured as encrypted Pages secrets. The platform super-admin email/password secrets are still missing, so platform administration is not yet initialized.

The browser UI remains v0.3. Do not enable MFA/passkey policy or onboard real employees until the corresponding v0.4 login, security and invitation screens are built and tested. Keep the deployment on synthetic data until the go-live checklist in [DEPLOYMENT.md](../DEPLOYMENT.md) is complete.

## Privacy

Use synthetic demo data only. Production rollout requires a privacy notice, retention schedule, employee data access policy, export/deletion workflows, least-privilege roles, audit retention, incident response and verified backups.
