# JelHR System – Frontend

## Multi-page app

| Page | File | Description |
|------|------|-------------|
| Dashboard | `index.html` | Responsive overview and links to existing modules |
| Employees | `employees.html` | People directory table |
| Time Tracking | `time.html` | Timer + weekly chart |
| Onboarding | `onboarding.html` | Task checklist & progress |
| Security | `security.html` | Risk score, sessions, devices |
| Settings | `settings.html` | Prototype profile and company settings |
| Sign-in | `login.html` | Email/password authentication |
| Employee | `employee.html` | Authenticated employee landing page |
| Demo | `demo.html` | Synthetic, read-only auditor presentation |
| Offboarding | `offboarding.html` | D1-backed case UI with unfinished checklist controls |

Shared:
- `css/app.css` – design system (black / cream / yellow)
- `js/nav.js` – session check and navigation highlighting
- Existing pages use a sidebar/bottom navigation; the redesigned dashboard uses a top navigation and mobile page selector.
- `css/bolek.css` – screenshot-inspired sign-in/dashboard and embedded generated team image
- `js/login.js` and `js/dashboard.js` – sign-in and responsive dashboard interactions

## Run locally

```bash
npm run dev
# open the local address printed by Wrangler
```


For current API, security, demo limitations, setup and readiness details, see the [root README](../README.md). The static preview does not provide the Pages Functions backend.
