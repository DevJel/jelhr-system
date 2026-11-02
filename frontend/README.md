# JelHR System – Frontend

## Multi-page app (new)

| Page | File | Description |
|------|------|-------------|
| Dashboard | `index.html` | Overview, stats, schedule, onboarding snapshot |
| Employees | `employees.html` | People directory table |
| Time Tracking | `time.html` | Timer + weekly chart |
| Onboarding | `onboarding.html` | Task checklist & progress |
| Security | `security.html` | Risk score, sessions, devices |
| Settings | `settings.html` | Profile & company |
| Full UI Artifact | `dashboard-full.html` | Original large React design (rename from previous index if needed) |

Shared:
- `css/app.css` – design system (black / cream / yellow)
- `js/nav.js` – active link highlighting
- Sidebar (desktop) + bottom nav (mobile)

## Run locally

```bash
npm run dev
# open http://localhost:3000
```

## Original React artifact

If you still have the large single-file React dashboard:

1. Rename it to `dashboard-full.html` (or keep as backup).
2. The sidebar link **Full UI Artifact** points to it.

```bash
# example if your big file is still named index.html from before:
# mv index.html dashboard-full.html   # then restore the new multi-page index.html from git if needed
```
