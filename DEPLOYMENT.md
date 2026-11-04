# JelHR production deployment — Operava Business

Last verified: 2026-11-05

## Production target

| Setting | Value |
|---|---|
| GitHub repository | `DevJel/jelhr-system` |
| Production branch | `main` |
| Cloudflare account | Jelvan - Business - Operava |
| Pages project | `jelhr-system` |
| Pages hostname | `https://jelhr-system-213.pages.dev` |
| Build command | None (static Pages output) |
| Output directory | `frontend` |
| Functions directory | `functions/` |
| Wrangler source of truth | `wrangler.toml` |

Production commits to `main` trigger Pages deployments. Preview deployments are disabled. Do not re-enable previews until a separate preview D1 database and preview storage resources are provisioned; the production database must never be shared with preview deployments.

## Cloudflare resources and bindings

The following bindings are configured for the production Pages Functions environment:

| Binding | Resource | Purpose |
|---|---|---|
| `DB` | D1 `jelhr-system-db` (`65b599fb-e45d-4f92-8588-d353df0e1cb8`) | Tenant, employee, recruitment, auth, audit and workflow records |
| `FILES` | R2 `jelhr-files` (APAC) | Résumés, employee documents and uploaded files |
| `AI` | Workers AI | HR assistant, screening and document conversion |
| `VECTORIZE` | Vectorize `jelhr-knowledge` (768 dimensions, cosine) | Optional semantic retrieval, organization namespace isolation |
| `MAILER` | Worker service `jelhr-mailer` | Internal SES SMTP delivery |

The production AI variables are:

- `AI_PROVIDER=workers-ai`
- `AI_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast`

The sender address is `noreply@operavaglobal.com`.

## Email and Secrets Store

Pages Functions cannot consume Cloudflare Secrets Store bindings directly. JelHR therefore uses an internal Worker service binding:

1. Pages Functions call `env.MAILER.fetch()`.
2. The `jelhr-mailer` Worker accepts only its internal `POST /send` contract and is not intended to have a public route.
3. The Worker reads the shared Operava Secrets Store entries `SES_SMTP_HOST`, `SES_SMTP_PORT`, `SES_SMTP_USERNAME`, and `SES_SMTP_PASSWORD`.
4. The Worker sends through the existing AWS SES SMTP endpoint in `ap-southeast-2`.

The SMTP values are write-only Secrets Store values. They are not copied into GitHub, Wrangler, or Pages variables. The mailer Worker binds to the existing secret names in the Operava account's default Secrets Store.

The Pages project has encrypted secrets:

- `JELHR_JWT_SECRET` — session signing and OTP HMAC key material.
- `JELHR_ENCRYPTION_KEY` — AES-GCM key material for encrypted SSO/TOTP values.

Their values are intentionally not documented or returned by Cloudflare.

### Platform super-admin credentials still required

The platform administration plane is not initialized yet. Before using `/platform.html`, set these as encrypted Pages production secrets:

- `JELHR_SUPERADMIN_EMAIL`
- `JELHR_SUPERADMIN_PASSWORD` (minimum 16 characters)

Optional: `JELHR_SUPERADMIN_TOTP_SECRET`.

Do not reuse credentials from another Operava application. After setting these secrets, trigger a production redeployment and verify `platformAdmin: true` from the health endpoint.

## Database migration and preservation

Migrations `0001_init.sql` through `0004_recruitment_ai_auth.sql` have been applied to the Operava Business D1 database. The target `d1_migrations` table records all four migrations.

The previous `jelhr-system` Pages project and original D1 database in Projects - Works were left intact. The old Pages project's GitHub source connection was disconnected so the same repository could be connected to Operava Business. Its existing D1 database was not deleted or modified.

A read-only data audit of the original application tables found zero organization, user, employee, applicant and operational records. The new production database therefore has the complete v0.4 schema and no application rows to copy. The original database remains available as a preservation copy.

Do not delete the legacy project or its D1 database until the new production environment has been accepted.

## Health check

Public readiness endpoint:

`GET /api/health`

Expected fields after the latest production deployment:

- `status: "ok"`
- `database: "connected"`
- `schema: "current"`
- `auth: true`
- `email: true`
- `platformAdmin: false` until the two platform admin secrets are configured

The health endpoint confirms binding/configuration presence. It does not send a test email or prove an SMTP delivery. Perform a controlled email smoke test to an approved mailbox before enabling invitations or OTP flows for real users.

## Release status and go-live checklist

The v0.4 backend APIs and migration are deployed. The existing frontend is still the v0.3 UI; the v0.4 recruitment, careers, invite acceptance, MFA/passkey, SSO, AI assistant and knowledge-management screens remain unfinished as documented in `UNFINISHED.md`.

Before real employee or applicant data is entered:

- [ ] Set `JELHR_SUPERADMIN_EMAIL` and `JELHR_SUPERADMIN_PASSWORD` as encrypted Pages secrets.
- [ ] Redeploy and confirm `platformAdmin: true`.
- [ ] Complete the v0.4 frontend and update the login UI before enabling MFA or passkey policies.
- [ ] Send and receive a controlled SES test email.
- [ ] Test R2 upload/download and verify the 5 MB limit.
- [ ] Test Workers AI inference and organization-scoped knowledge retrieval.
- [ ] Review privacy notice, retention, employee access/export/deletion and audit policies.
- [ ] Run the repository test suite and complete the production smoke test.
- [ ] Confirm backups and rollback procedure.

## Operational rules

- Keep all production resource IDs in `wrangler.toml`; never commit credentials.
- Use encrypted Pages secrets for Pages-only secrets.
- Keep AWS SES credentials in the shared Cloudflare Secrets Store and consume them only through the internal mailer Worker.
- Keep preview deployments disabled until isolated preview resources exist.
- Apply additive D1 migrations before deploying code that depends on them.
- Do not bind the old Projects - Works database to the Operava Business project.
