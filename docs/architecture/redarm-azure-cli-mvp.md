# RedArm Cheap MVP (Azure CLI-Only)

This repository contains a low-cost implementation of RedArm PDF Editor.

## What is implemented

- Backend: Azure Functions (Node.js, v4 model)
- Frontend: React + TypeScript + PDF.js
- Storage: Blob + Table + Queue in one StorageV2 account
- OCR: Azure Document Intelligence (manual trigger only)
- Auth: simple email/password using Table Storage + JWT
- Cost controls: lifecycle cleanup, soft delete/versioning, budget alerts

## Core endpoints

- `POST /api/auth/login`
- `POST /api/docs/upload-url`
- `POST /api/docs/{docId}/save-annotation`
- `POST /api/docs/{docId}/export`
- `POST /api/docs/{docId}/ocr`
- `GET /api/jobs/{jobId}`

## Cost-oriented decisions

- No AKS
- No Front Door / App Gateway
- No Cosmos DB / Service Bus / SignalR
- No always-on compute tiers
- OCR is manual only

## Files of interest

- `infra/cli/00-init.ps1` .. `infra/cli/06-deploy-ui.ps1`
- `backend/src/functions/*`
- `frontend/src/App.tsx`
- `docs/data/*.json`
- `docs/api/bff-openapi.yaml`