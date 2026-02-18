# RedArm PDF Editor — Claude Code Instructions

## Auto-Commit & Push Policy

After every meaningful change (new file, bug fix, feature addition, config update):

1. Stage only the specific files that were changed (never use `git add -A` or `git add .`)
2. Create a NEW commit with a conventional commit message
3. Push to the remote immediately after committing

### Commit Message Format

```
<type>: <short description>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

**Types:** `feat`, `fix`, `chore`, `style`, `docs`, `refactor`, `test`, `perf`

## Auto-Commit Hook (Automated)

A `PostToolUse` hook at `.claude/hooks/auto-commit.sh` automatically commits and pushes
after every `Edit` or `Write` tool call. **You do NOT need to manually run git add/commit/push** —
it happens automatically via the hook. The hook:
- Stages only the changed file (never `git add -A`)
- Skips `.env`, `local.settings.json`, `.pem`, `.key` files
- Skips gitignored files
- Commits with `chore: update <filename>`
- Pushes to `origin HEAD` after each commit

### Rules

- NEVER amend previous commits
- NEVER force push
- NEVER skip pre-commit hooks
- NEVER commit secrets, `.env` files, `local.settings.json`, or `node_modules/`
- Always commit after completing a logical unit of work (not mid-change)
- If a commit fails due to hooks, fix the issue and create a NEW commit

## Project Structure

- `frontend/` — React + TypeScript + Vite + Tailwind CSS
- `backend/` — Azure Functions Node.js v4
- `infra/cli/` — Azure CLI deployment scripts (PowerShell)
- `docs/` — API specs and architecture docs
- `tests/` — Smoke test scripts

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite 5, Tailwind CSS v4, PDF.js, Lucide icons
- **Backend:** Azure Functions v4 (Node.js 20+), Azure Storage (Blob/Table/Queue)
- **Auth:** JWT bearer tokens, bcryptjs password hashing
- **OCR:** Azure Document Intelligence (optional, manual trigger)

## Development

```bash
# Frontend
cd frontend && npm install && npm run dev    # http://localhost:5173

# Backend (requires Azurite + Azure Functions Core Tools)
cd backend && npm install && func start      # http://localhost:7071

# Azurite (local Azure Storage emulator)
npx azurite --silent --location backend/.azurite
```

## Key Files

- `frontend/src/App.tsx` — Main app entry, auth routing
- `frontend/src/hooks/` — Custom hooks (useAuth, usePDF, useAnnotations, useJobs)
- `frontend/src/components/` — UI components organized by concern
- `frontend/src/lib/api.ts` — Backend API client
- `backend/src/index.js` — Azure Functions v4 entry point
- `backend/src/functions/` — All 8 function handlers
- `backend/src/lib/` — Shared utilities (auth, config, storage, tables)

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Email/password login → JWT |
| POST | `/api/docs/upload-url` | Get SAS URL for PDF upload |
| POST | `/api/docs/{docId}/save-annotation` | Save annotation operations |
| POST | `/api/docs/{docId}/export` | Queue PDF export job |
| POST | `/api/docs/{docId}/ocr` | Queue OCR job |
| GET | `/api/jobs/{jobId}` | Poll job status |

## Bootstrap Login

- Email: configured via `BOOTSTRAP_ADMIN_EMAIL` env var
- Password: configured via `BOOTSTRAP_ADMIN_PASSWORD` env var
