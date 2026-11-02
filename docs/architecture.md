# JelHR System – Architecture Notes

## Current State

- Frontend-only React dashboard (self-contained artifact)
- Mock data for employee profile, time tracking, onboarding tasks, security sessions

## Target Architecture (aligned with AI-API Store Hub)

```
Browser (React Dashboard)
        │
        ▼
Cloudflare Worker (Hono)
  ├── Auth (JWT / session)
  ├── Employees / Tenants (D1)
  ├── Time Entries
  ├── Onboarding Tasks
  ├── Device / Session tracking
  └── Optional: Workers for Platforms for multi-tenant isolation
```

## Suggested Tables (D1)

- `tenants` / `organizations`
- `employees` (profile, role, compensation, benefits)
- `time_entries`
- `onboarding_tasks`
- `devices` / `sessions`
- `documents` (policies, contracts)

## Shared Patterns

Reuse auth, API-key style tokens, and multi-tenant patterns from the sibling repo:
[ai-api-store-hub](https://github.com/DevJel/ai-api-store-hub)
