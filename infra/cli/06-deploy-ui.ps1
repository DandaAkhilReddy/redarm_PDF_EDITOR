. "$PSScriptRoot/_shared.ps1"

$state = Load-State
if (-not $state) {
  throw "State file not found. Run infra/cli/00-init.ps1 first."
}

if (-not $state.functionBaseUrl) {
  throw "Function app URL missing. Run infra/cli/02-functions.ps1 first."
}

if (-not $state.storageConnectionString) {
  throw "Storage connection string missing. Run infra/cli/01-storage.ps1 first."
}

Write-Host "Building frontend with API base $($state.functionBaseUrl) ..."
Push-Location (Resolve-Path "$PSScriptRoot/../../frontend")
$env:VITE_API_BASE_URL = $state.functionBaseUrl
npm install
npm run build
Pop-Location

Write-Host "Uploading frontend assets to static website..."
az storage blob upload-batch `
  --destination '$web' `
  --source (Resolve-Path "$PSScriptRoot/../../frontend/dist") `
  --connection-string $state.storageConnectionString `
  --overwrite true | Out-Null

# Fix MIME type for .mjs files (Azure Blob Storage defaults them to text/plain)
Write-Host "Fixing MIME types for .mjs files..."
$mjsBlobs = az storage blob list `
  --container-name '$web' `
  --connection-string $state.storageConnectionString `
  --query "[?ends_with(name, '.mjs')].name" `
  -o tsv

foreach ($blob in $mjsBlobs) {
  az storage blob update `
    --container-name '$web' `
    --name $blob `
    --connection-string $state.storageConnectionString `
    --content-type "application/javascript" | Out-Null
  Write-Host "  Fixed: $blob"
}

Write-Host "Frontend deployed to: $($state.staticWebUrl)"
