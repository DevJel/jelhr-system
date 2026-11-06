# JelHR role and feature access

## Tenant roles

| Role | Intended scope |
|---|---|
| `owner` | Full organization control, including organization settings, users, people, recruitment, workflows and audit access. |
| `admin` | Organization administration, users, settings and enabled HR modules; cannot perform platform-level tenant administration. |
| `hr_manager` | HR operations, employee records, recruitment, onboarding/offboarding, paperwork and enabled AI features. |
| `manager` | Manager-scoped employee visibility and assigned team workflows. Access is constrained to direct reports and explicit manager permissions. |
| `employee` | Own employee profile, own paperwork and assigned employee tasks. No HR administration or other employees' private records. |
| `auditor` | Read-only organization access. Write requests are rejected by middleware as well as route-level authorization. |

Platform administration is a separate trust plane. Only the platform super-admin credentials stored in Cloudflare production secrets can create organizations and change platform entitlements. A tenant owner/admin is not a platform super-admin.

## Feature entitlements

The platform enables features per organization. The organization admin may narrow feature access for individual users but cannot enable a feature that the platform has not granted.

| Feature key | Module |
|---|---|
| `people` | Employee directory and profile management |
| `recruitment` | Jobs, applicants, interviews and careers site |
| `onboarding` | Onboarding plans and tasks |
| `offboarding` | Offboarding cases and exit workflow |
| `time` | Time clock and timesheets |
| `documents` | Employee documents and paperwork |
| `esign` | Electronic signature workflows |
| `communications` | HR communications and delivery |
| `ai` | AI assistant and AI-assisted HR tasks |
| `knowledge` | Organization knowledge base |

The effective feature set is computed server-side and returned to authenticated navigation. Hiding a link is only a usability measure: every API route must enforce the same feature entitlement and role boundary on the server.

## Sensitive workflow rules

- Employee profile access is tenant-scoped; managers are restricted to their own records and direct reports.
- Employee paperwork is private to HR readers and the employee who owns the record. File downloads re-check authorization.
- Applicant résumé access is limited to authorized recruitment/HR users in the applicant's organization.
- Conversations are private to their owner; AI context is constrained to the current organization and authorized employee context.
- AI applicant screening is advisory and cannot reject or hire candidates.
- Only owner/admin can manage tenant users and workspace-level authentication/branding configuration.
- Only platform super-admin can create/suspend/close organizations and set organization features/AI quotas.
- Offboarding finalization is restricted to owner/admin and requires all required tasks to be complete or explicitly not applicable. It revokes the employee's linked sessions and disables the account.
- Auditors are read-only regardless of UI state or direct API calls.
