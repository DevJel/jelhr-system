# Work in progress — v0.4 (backend done, frontend pending)

Snapshot taken mid-build. The **backend is complete and tested** (`npm test` → 44 passing). The **frontend for the new v0.4 features is not built yet**; v0.3 pages all still work.

## Done (backend + migration + tests)

Migration `migrations/0004_recruitment_ai_auth.sql` (additive). Apply it **before** deploying this code.

| Area | API | Notes |
|---|---|---|
| Recruitment | `/api/jobs`, `/api/jobs/:id`, `/api/applicants[/:id]`, `/api/applicants/:id/hire`, `/api/interviews[/:id]`, `/api/recruitment/stats` | Pipeline: Submitted (applied) → Pending (screening/offer) → Interviewed → Rejected / Onboarded (hired). Hire creates the employee, copies the résumé to their paperwork, assigns the onboarding plan, optionally emails an invitation. |
| Public careers site | `/api/public/careers?org=slug`, `/api/public/jobs/:id`, `/api/public/jobs/:id/apply`, `/api/public/logo` | Works on a branded custom domain (Settings → `customDomain`, add it to the Pages project). Honeypot, 5/hour/IP rate limit, optional Turnstile (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`), résumé type/magic-byte checks, confirmation email. |
| Paperwork & files | `/api/employees/:id/documents`, `/api/files/:id` | R2 binding `FILES` (5 MB) or inline D1 fallback (1.5 MB). |
| AI | `/api/ai` (tasks: `ask`, `hr_draft`, `rewrite`, `job_description`, `screen_applicant`, `draft_message`, `explain_document`, `summarize_exit`), `/api/ai/conversations/:id` | Providers: Workers AI binding `AI` (default model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`), `AI_PROVIDER=openai` (+`AI_API_BASE`,`AI_API_KEY`,`AI_MODEL`), `AI_PROVIDER=anthropic` (+`ANTHROPIC_API_KEY`), `mock` (dev only). Daily per-org quota. Advisory only. |
| Org knowledge base | `/api/knowledge[/:id]` | Handbook, policies, leave, labour-law notes, templates; audience all / HR-only. Searched per organization only (keyword scoring in D1; Vectorize binding `VECTORIZE` with namespace = org id when bound). PDF/Word → text via Workers AI `toMarkdown`. |
| AI data boundaries | `_shared/aicontext.js` | Answers use only that org's knowledge + the asking user's own record (+ a subject employee for HR drafting). Conversations are private to their owner. Country/labour-law notes set in Settings (`countryCode`, `ai.labourLaw`). HR drafts (warning, show-cause, termination, probation, offer, policy, reference) come with a checklist + "review with counsel" disclaimer. |
| Sign-in identifiers | `/api/auth/login` `{identifier, workspace?, password}` | Email, username, or employee ID (+ workspace ID / branded domain). |
| MFA | `/api/auth/mfa`, `/api/auth/passkey`, `/api/mfa[/:id]` | Passkeys (WebAuthn ES256/RS256), authenticator app (TOTP), email OTP. Policy off / admins / all; allowed methods; bootstrap-then-enroll when required. |
| SSO | `/api/auth/sso/start`, `/api/auth/sso/callback`, `/api/auth/options` | OIDC + PKCE (Entra ID, Google, Okta…). Client secret AES-GCM encrypted (`JELHR_ENCRYPTION_KEY`). Allowed domains, enforce SSO (owner keeps password break-glass), "SSO satisfies MFA". |
| Invitations | `/api/users` `{invite:true,…}`, `/api/auth/invite` | Email link → 6-digit email code → set password (+username). Resend, reset MFA, per-user features in `PATCH /api/users/:id`. |
| Settings | `PATCH /api/settings` | `auth`, `branding` (colour, logo, tagline, careers intro, privacy URL), `customDomain`, `countryCode`, `ai` profile; `POST {action:"test_sso"}`. |
| Features | `_shared/features.js` | Super admin enables per org (`PATCH /api/platform/organizations/:id {features, aiDailyLimit}`); org admin narrows per user. Enforced on every module API. |
| Super admin | `/api/platform/overview` | Dashboard data (totals, per-org health, config status). Credentials from secrets or Secrets Store bindings; optional `JELHR_SUPERADMIN_TOTP_SECRET`. |

## Not finished (next steps)

1. **Frontend pages** (none built yet for v0.4):
   - `recruitment.html` — tabs Dashboard / Jobs / Applications / Interviews / Careers site; applicant drawer with AI screening, interviews, Hire & onboard.
   - `careers.html` — public branded job board + application form (résumé upload, privacy consent, honeypot, Turnstile). Needs a `_headers` rule for `/careers.html` if Turnstile is used (`! Content-Security-Policy` then a CSP allowing `challenges.cloudflare.com`).
   - `accept-invite.html` — token → send code → code + password (+username).
   - `assistant.html` — AI chat with sources, HR drafting (doc type, employee, details → draft + checklist → "Send for e-signature"), Knowledge tab for HR.
   - Login page: identifier + workspace field, MFA step UI (TOTP / email code / passkey), "Sign in with a passkey", "Sign in with SSO".
   - Security: Two-step verification tab (TOTP QR — needs a small QR encoder in `frontend/js/qr.js`, verify with OpenCV; passkey enroll via `navigator.credentials.create`; email codes).
   - Settings tabs: Authentication, Branding & careers, AI & knowledge profile, Features (read-only).
   - Users & access: invite by email, username, per-user feature checkboxes, reset MFA, resend invite.
   - Employee drawer: Documents (paperwork) tab with upload/download/delete.
   - Platform: dedicated `platform-login.html` (+TOTP field), Overview dashboard tab, per-org Features & AI quota editor.
   - Nav: add Recruitment + Assistant, hide items not in `me.user.features`.
   - Contextual AI buttons: job "Write with AI", communications "Draft with AI", sign page "Explain this document", exit interview "Summarise".
2. **Animations**: themed live loader (animated J mark), floating empty-state illustrations, sign-in progress, processing overlay, click ripple — all `prefers-reduced-motion` aware.
3. **Seed + UI check + feature tour** for v0.4 screens.
4. **Docs**: rewrite `DEPLOYMENT.md` as the single complete reference (all features, bindings `DB` / `AI` / `FILES` / `VECTORIZE`, every secret, migration order, processes), update README, SECURITY, API, RBAC, CHANGELOG.
5. **Production bindings are now enabled** in `wrangler.toml`: D1 `DB`, Workers AI `AI`, R2 `FILES`, Vectorize `VECTORIZE`, and the internal SES service binding `MAILER`. See [DEPLOYMENT.md](DEPLOYMENT.md) for resource names, IDs, secret handling and preview isolation.

Cloudflare Pages configuration lists encrypted secret entries for `JELHR_JWT_SECRET`, `JELHR_ENCRYPTION_KEY`, `JELHR_SUPERADMIN_EMAIL` and `JELHR_SUPERADMIN_PASSWORD` (minimum 16 characters). Values are write-only and are never stored in Git. The latest health endpoint still reports `platformAdmin: false`, so verify the bootstrap credentials and redeploy before considering platform administration initialized. Optional: `JELHR_SUPERADMIN_TOTP_SECRET`, `AI_API_BASE`, `AI_API_KEY`, `ANTHROPIC_API_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `JELHR_WEBAUTHN_RP_ID`, `JELHR_WEBAUTHN_ORIGINS`. Workers AI is configured by the `AI` binding and `AI_PROVIDER=workers-ai`.

## Production deployment status (2026-11-05)

- The v0.4 backend and migrations 0001–0004 are deployed to the Operava Business Cloudflare Pages project. Production bindings are documented in `DEPLOYMENT.md` and `wrangler.toml`: `DB`, `AI`, `FILES`, `VECTORIZE`, and `MAILER`.
- The original Projects - Works Pages project and D1 database remain intact. Its GitHub source connection was disconnected so the repository could be connected to Operava Business.
- The production health endpoint reports database connected, current schema, auth configured and email service binding configured. A real outbound SES message has not yet been sent as a smoke test.
- Cloudflare confirms the mailer Worker has all four SES SMTP secret references attached from the shared Secrets Store: host, port, username and password. The production Pages project also lists the encrypted super-admin secret entries, but the live health field remains `platformAdmin: false`; bootstrap is not yet confirmed.
- Preview deployments are disabled until isolated preview D1 and storage resources are provisioned.
- Do not enable MFA/passkey policy for users until the matching v0.4 login and security screens are built and tested. The current login UI is still v0.3 and does not handle the new `{mfaRequired}` flow.
- Do not enter real employee or applicant data until the frontend, platform bootstrap, email smoke test, privacy review and full go-live checklist are complete.
