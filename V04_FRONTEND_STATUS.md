# JelHR v0.4 frontend implementation status

This branch adds the first v0.4 browser interfaces while preserving the existing v0.3 pages.

## Implemented in this branch

- Shared v0.4 responsive UI styles and same-origin API helpers.
- Recruitment workspace: job creation/editing and publishing, applicant search/stage updates, applicant detail, advisory AI screening, hire-and-onboard action, interview scheduling, and careers URL sharing.
- Public branded careers listing and application form with privacy consent, honeypot, résumé upload, and optional Turnstile widget.
- AI assistant: organization-scoped chat, HR document drafting with review checklist/disclaimer, and knowledge-base listing/addition.
- Invitation acceptance: invitation lookup, email-code request, password setup, and optional username.
- Separate platform administrator login and overview, including platform metrics, organizations list and configuration status.
- User invitation, role/status updates, username, MFA reset and invitation resend.
- Workspace settings: branding/careers, auth policy/SSO settings, AI profile and read-only feature entitlements.
- Personal security: TOTP setup/confirmation and email verification enrollment.
- Login accepts a workspace identifier and displays the SSO entry point when the workspace public auth options enable SSO.
- Existing dashboard navigation includes v0.4 destinations for HR roles.

## Explicitly pending before production go-live

- Browser-level validation and accessibility pass for every new screen.
- Browser-level validation of passkey enrollment and passwordless sign-in; the WebAuthn browser ceremonies are now wired to the backend but still need real-device testing.
- TOTP QR rendering. The current authenticator setup shows the secret and requires manual entry; do not claim QR enrollment is available.
- Integrate the employee paperwork screen into the employee detail drawer and add contextual document explanation; the standalone paperwork route supports upload/download/delete.
- Improve platform organization editing UX and verify per-organization feature toggles and AI quota changes against a test tenant.
- Rich careers page content/details, public custom-domain verification and live Turnstile Siteverify smoke test.
- Full SSO provider round-trip with Entra ID, Google and Okta test tenants.
- End-to-end email tests for invitations, MFA codes, interviews and candidate confirmations.
- UI feature-tour and motion states (loader, empty-state illustrations, reduced-motion verification).
- Run the complete npm test and npm run test:ui suites in a Node 22.5+ checkout; this environment cannot run GitHub-hosted source locally.
- Review security headers/CSP against the actual Pages hostname and any configured custom careers domain.

## Release safety

- This branch is not production-ready and must not be deployed to production until all pending items are completed and the backend/frontend integration is verified.
- Keep organization MFA enforcement disabled until the updated login and enrollment screens are verified.
- Use synthetic records only until the production go-live checklist in DEPLOYMENT.md passes.
- AI screening is advisory only; human reviewers make all hiring decisions.
- The current backend password-login challenge issues email OTP; the login UI retains that supported flow. TOTP and passkey are enrolled/used only where the backend policy and corresponding screens support them.
