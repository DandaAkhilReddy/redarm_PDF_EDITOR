# RedArm PDF Editor - Cheapest Build

This repo now includes a full cheap-mode implementation using Azure CLI provisioning and serverless hosting.

## Stack

- Frontend: React + TypeScript + PDF.js (`frontend/`)
- Backend: Azure Functions Node.js (`backend/`)
- Data: Azure Storage blobs + tables + queues
- OCR: Azure Document Intelligence (manual trigger)

## Prerequisites

- Azure CLI logged in (`az login`)
- Node.js 20+ (installed)
- npm (installed)
- Azure Functions Core Tools (installed)

## Deploy order

Run from repo root:

```powershell
./infra/cli/00-init.ps1
./infra/cli/01-storage.ps1
./infra/cli/02-functions.ps1
./infra/cli/03-docintel.ps1
./infra/cli/04-policies.ps1
./infra/cli/05-budget.ps1 -MonthlyBudget 25
./infra/cli/06-deploy-ui.ps1
```

## Local backend run

```powershell
Copy-Item backend/local.settings.sample.json backend/local.settings.json
cd backend
npm install
npm run start
```

## Local frontend run

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Set `VITE_API_BASE_URL` in `frontend/.env` to your Function App URL.

## Bootstrap login

`infra/cli/02-functions.ps1` writes bootstrap login credentials into `infra/cli/.state.json`.

Use those credentials in the UI for first login.

## API spec and schemas

- `docs/api/bff-openapi.yaml`
- `docs/data/annotation-schema-v1.json`
- `docs/data/doc-metadata-v1.json`
- `docs/data/job-envelope-v1.json`

## Notes

- This is intentionally non-production and cost-first.
- Export currently copies source PDF to export container (annotation flattening is not yet implemented).
- OCR jobs require Document Intelligence to be provisioned via `03-docintel.ps1`.