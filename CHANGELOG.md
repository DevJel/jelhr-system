# Changelog

## Unreleased — sign-in backend and agent handoff
- Expanded public workspace sign-in options to expose the configured MFA level and allowed factor types without exposing secrets or user records.
- Removed development OTP values from the MFA email-send API response.
- Blocked password sign-in when the user's organization is suspended or unavailable.
- Added mandatory agent handoff, authentication contract/test matrix, and production architecture/go-live documentation with Mermaid diagrams.
- Updated README and API reference to require documentation updates alongside every code change.

# Changelog

## 0.4.0 — Frontend implementation in review

- Added recruitment workspace, applicant pipeline, interviews and hire/onboard UI.
- Added public careers and candidate application experience.
- Added AI assistant, HR drafting and organization knowledge interface.
- Added invitation acceptance, workspace user management and settings.
- Added MFA enrollment and policy-driven email/TOTP/passkey login flows.
- Added separate platform-admin entry point and organization overview/editor.
- Added employee directory drawer with paperwork management.
- Added feature-aware navigation and route guards.
- Corrected password login to use the organization's configured MFA policy after first-factor verification.
- Added test-only local Turnstile fixture handling without changing production verification behavior.
- Updated static UI checks, deployment guidance, API and RBAC documentation.

This release remains in draft PR #7. Production continues to serve the existing v0.3 frontend until all browser, email, Turnstile, privacy and platform-bootstrap release gates pass.

## 0.3.x

See the Git history for earlier dashboard, employee lifecycle, offboarding, communications, time, document and e-signature changes.
