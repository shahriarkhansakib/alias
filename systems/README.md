# Alias systems

The three Alias systems were built by separate teams and merged here with their full Git history
(`git subtree add`, no squash). Each still runs on its own; integration into `apps/` is the next
milestone.

| Folder | System | Built by | Stack | Original repo |
| --- | --- | --- | --- | --- |
| `s1-client-intake/` | 1 — Client support, intake chat, operator console, Artifact-1 brief, research | Afridi | Next.js, MongoDB, Gemini, Tavily | afridi19999/ALIAS-SYSTEM-1. |
| `s2-ad-creative/` | 2 — Ad creative pipeline: brief gate, strategy, creative + copy, compositing, QA | Aninda | FastAPI, Next.js, SQLAlchemy | Anninda24/alias-img-gen |
| `s3-publish/` | 3 — Publishing through Zernio, ID mapping, analytics dashboard, link tracking | Linkon | Express, Vite/React, PostgreSQL | linkon-biswas/M.I.R.A |

The platform (`apps/web`, `apps/api`) provides authentication, 2FA, roles, admin and audit logs.

## Run everything on one address

```bash
pnpm setup:systems   # once: installs all systems, creates missing .env files, runs their migrations
pnpm dev:all         # starts the platform and all systems; open http://localhost:3000 only
```

The platform forwards `/intake` (System 1), `/studio` (System 2), `/publish` (System 3) and
`/svc/creative`, `/svc/publishing` (their APIs) after checking the login and role. Details:
`docs/integration/agent.md`. Internal ports (never opened directly): 3005, 3001, 8000, 3002, 5173.

## Environment files

Every real file sits next to its `.env.example`; `pnpm setup:systems` copies any that are missing.
Git ignores the real files.

| Real file | Example | You must fill |
| --- | --- | --- |
| `.env` | `.env.example` | already set up |
| `s1-client-intake/.env.local` | `s1-client-intake/.env.example` | `MONGODB_URI`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, `NEXTAUTH_SECRET`, `CRON_SECRET` |
| `s2-ad-creative/backend/.env` | `s2-ad-creative/backend/.env.example` | nothing for the demo (SQLite); optional `GEMINI_API_KEY` |
| `s2-ad-creative/frontend/.env.local` | `s2-ad-creative/frontend/.env.example` | nothing |
| `s3-publish/Backend/.env` | `s3-publish/Backend/.env.example` | `ZERNIO_API_KEY`, `JWT_SECRET`, `OWNER_SETUP_TOKEN` (and create `social_db`, see the file) |
| `s3-publish/Frontend/.env` | `s3-publish/Frontend/.env.example` | nothing |

## Handoff between systems (current state)

- System 1 → System 2: the confirmed Artifact-1 brief is entered into System 2's brief form.
- System 2 → System 3: the approved final ad is published from System 3.
- Planned: a shared campaign state machine and job queue so these handoffs run automatically.
