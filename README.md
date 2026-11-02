# JelHR System

**Modern multi-tenant HR platform** with a polished multi-page employee dashboard.

> Built for the OPERAVA / Jelvan ecosystem.

## Features

- **Multi-page navigation** – Dashboard, Employees, Time Tracking, Onboarding, Security, Settings
- Shared sidebar (desktop) + bottom nav (mobile)
- Employee directory, time tracker, onboarding checklist, security sessions
- Design system: black / cream (`#FFFBEB`) / yellow (`#FFE066`)
- Optional full React UI artifact (original design export)

## Quick Start

```bash
git clone https://github.com/DevJel/jelhr-system.git
cd jelhr-system
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
frontend/
├── index.html           # Dashboard (default)
├── employees.html
├── time.html
├── onboarding.html
├── security.html
├── settings.html
├── dashboard-full.html  # Original large React artifact (optional)
├── css/app.css
└── js/nav.js
docs/
└── architecture.md
```

## Related

- [ai-api-store-hub](https://github.com/DevJel/ai-api-store-hub) – Multi-tenant AI API gateway

## License

MIT
