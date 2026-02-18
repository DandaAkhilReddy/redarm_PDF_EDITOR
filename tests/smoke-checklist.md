# Smoke Test Checklist

1. Open static website URL from `infra/cli/.state.json`.
2. Login using bootstrap admin credentials from state file.
3. Upload a small PDF (< 10 MB).
4. Confirm first page renders in canvas.
5. Add sample annotation and click save.
6. Trigger export job and wait for completed status.
7. Trigger OCR job and wait for completed status.
8. Open result links for export and OCR JSON.
9. Validate cost protections:
   - `az functionapp show` has low daily memory quota.
   - storage lifecycle policy exists.
   - budget exists for resource group.