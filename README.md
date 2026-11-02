# JelHR System

**Modern multi-tenant HR platform** with a polished employee dashboard.

> Built for the OPERAVA / Jelvan ecosystem.

## Features (UI)

- **Employee Profile** – photo, role, compensation, benefits, pension, assigned devices (MacBook etc.)
- **Time Tracker** – live timer, weekly work-time chart, daily breakdown
- **Onboarding** – progress bars, task list (Interview → Team Meeting → Project Update…)
- **Calendar / Schedule** – day selector + meetings (Weekly Team Sync, Onboarding Session)
- **Security Status** – risk score ring, session history with locations & devices
- **Active Sessions** – world-map style pins + last-sync info
- Clean black / cream / yellow accent design system

## Tech

- Self-contained **React** artifact (single HTML file with Tailwind + React 18)
- Mobile-first responsive layout
- Ready to be extracted into a Vite + React project or Cloudflare Pages

## Project Structure

```
.
├── frontend/
│   ├── index.html          # Full dashboard React artifact
│   └── README.md
├── docs/
│   └── architecture.md     # Planned backend (optional)
├── package.json
└── README.md
```

## Quick Start (Frontend)

1. Open `frontend/index.html` in a browser, **or**
2. Serve it:

```bash
npx serve frontend
```

## Planned Backend (Cloudflare)

- Workers + D1 for tenants / employees / time entries
- Auth via the same pattern as AI-API Store Hub
- Multi-tenant isolation with Workers for Platforms
- Integration with payroll / device inventory later

## Related Repos

- [ai-api-store-hub](https://github.com/DevJel/ai-api-store-hub) – Multi-tenant AI API gateway

## License

MIT
