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
5. `wrangler.toml` additions to make when ready (shown below; commented so current deploys don't break):

```toml
# [ai]
# binding = "AI"
# [[r2_buckets]]
# binding = "FILES"
# bucket_name = "jelhr-files"
# [[vectorize]]
# binding = "VECTORIZE"
# index_name = "jelhr-knowledge"   # create with: npx wrangler vectorize create jelhr-knowledge --dimensions=768 --metric=cosine
```

New secrets (all optional): `JELHR_ENCRYPTION_KEY`, `JELHR_SUPERADMIN_TOTP_SECRET`, `AI_PROVIDER`, `AI_API_BASE`, `AI_API_KEY`, `AI_MODEL`, `ANTHROPIC_API_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `JELHR_WEBAUTHN_RP_ID`, `JELHR_WEBAUTHN_ORIGINS`.

## Caution before deploying this snapshot

- Don't merge to `main` until the frontend exists: the login API now returns `{mfaRequired}` steps that the current login page doesn't handle. MFA policy defaults to **off**, so password sign-in keeps working, but new features have no UI yet.
- Apply migration 0004 first.
