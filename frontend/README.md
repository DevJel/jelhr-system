# JelHR System – Frontend

This folder contains the complete React dashboard artifact.

## `index.html`

Self-contained React 18 + Tailwind CSS application featuring:

- Welcome header with progress segments (Onboarding / Tasks / Work / Break)
- Employee card (Lora Piterson example) with compensation & benefits
- Time tracker with play/pause and weekly bar chart
- September calendar + scheduled meetings
- Onboarding task list with completion states
- Security status gauge + session history
- Active device sessions map

## How to use

- Open `index.html` directly in any modern browser, or
- Run `npm run dev` from the repo root to serve it locally.

## Next steps

1. Extract components into a proper Vite + React + TypeScript project.
2. Connect to a Cloudflare Worker backend (shared auth pattern with AI-API Store Hub).
3. Replace mock data with real API calls (employees, time entries, sessions).
