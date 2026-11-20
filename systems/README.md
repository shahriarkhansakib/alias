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

## Local ports (avoid clashes)

| Service | Port | Start command (from its folder) |
| --- | --- | --- |
| Platform web (`apps/web`) | 3000 | `pnpm dev` at repo root |
| Platform API (`apps/api`) | 4000 | `pnpm dev` at repo root |
| System 1 (Next.js) | 3005 | `npm install && npm run dev -- -p 3005` |
| System 2 API (FastAPI) | 8000 | `uvicorn app.main:app --reload --app-dir backend --port 8000` |
| System 2 web (Next.js) | 3001 | `cd frontend && npm install && npm run dev -- -p 3001` |
| System 3 API (Express) | 3002 | `cd Backend && npm install && npm run dev` (with `PORT=3002`) |
| System 3 web (Vite) | 5173 | `cd Frontend && npm install && npm run dev` |

## Environment files

Copy each example and fill in real values. Never commit the real files.

| Copy | To | Must fill |
| --- | --- | --- |
| `.env.example` (repo root) | `.env` | `BETTER_AUTH_SECRET` (32+ chars); Google OAuth keys only if used |
| `s1-client-intake/.env.example` | `s1-client-intake/.env.local` | `MONGODB_URI`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, `NEXTAUTH_SECRET`, `CRON_SECRET` |
| `s2-ad-creative/backend/.env.example` | `s2-ad-creative/backend/.env` | Delete `DATABASE_URL` to use local SQLite; set `CORS_ORIGINS=["http://localhost:3001"]`; `GEMINI_API_KEY` or `OPENAI_API_KEY` if vision QA is on; Facebook keys + `AUTH_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`) only if Facebook publishing is on |
| — | `s2-ad-creative/frontend/.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:8000` |
| `s3-publish/Backend/.env.example` | `s3-publish/Backend/.env` | `PORT=3002`, `DATABASE_URL`, `ZERNIO_API_KEY`, `JWT_SECRET`, `OWNER_SETUP_TOKEN`, `CLIENT_URL=http://localhost:5173`, `PUBLIC_TRACKING_BASE_URL=http://localhost:3002` |
| `s3-publish/Frontend/.env.example` | `s3-publish/Frontend/.env` | `VITE_API_BASE_URL=http://localhost:3002` |

## Handoff between systems (current state)

- System 1 → System 2: the confirmed Artifact-1 brief is entered into System 2's brief form.
- System 2 → System 3: the approved final ad is published from System 3.
- Planned: a shared campaign state machine and job queue so these handoffs run automatically.
