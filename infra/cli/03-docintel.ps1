. "$PSScriptRoot/_shared.ps1"

$state = Load-State
if (-not $state) {
  throw "State file not found. Run infra/cli/00-init.ps1 first."
}

if (-not $state.functionBaseUrl) {
  throw "Function app missing in state. Run infra/cli/02-functions.ps1 first."
}

Ensure-ResourceGroup -State $state

Write-Host "Creating Document Intelligence account $($state.docIntel) ..."
$null = az cognitiveservices account show -g $state.resourceGroup -n $state.docIntel -o none 2>$null
$created = ($LASTEXITCODE -eq 0)

if (-not $created) {
  az cognitiveservices account create `
    -g $state.resourceGroup `
    -n $state.docIntel `
    -l $state.location `
    --kind FormRecognizer `
    --sku F0 `
    --yes `
    --tags "app=redarm" "env=$($state.env)" "tier=cheap" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "F0 not available; falling back to S0"
    az cognitiveservices account create `
      -g $state.resourceGroup `
      -n $state.docIntel `
      -l $state.location `
      --kind FormRecognizer `
      --sku S0 `
      --yes `
      --tags "app=redarm" "env=$($state.env)" "tier=cheap" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create Document Intelligence account."
    }
  }
}

$endpoint = az cognitiveservices account show -g $state.resourceGroup -n $state.docIntel --query properties.endpoint -o tsv
if ($LASTEXITCODE -ne 0 -or -not $endpoint) {
  throw "Failed to read Document Intelligence endpoint."
}
$key = az cognitiveservices account keys list -g $state.resourceGroup -n $state.docIntel --query key1 -o tsv
if ($LASTEXITCODE -ne 0 -or -not $key) {
  throw "Failed to read Document Intelligence key."
}

az functionapp config appsettings set `
  -g $state.resourceGroup `
  -n $state.functionApp `
  --settings `
  "DOCINTEL_ENDPOINT=$endpoint" `
  "DOCINTEL_KEY=$key" `
  "DOCINTEL_MODEL_ID=prebuilt-read" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to set Function App Document Intelligence settings."
}

Set-StateValue -State $state -Name "docIntelEndpoint" -Value $endpoint
Save-State -State $state

Write-Host "Document Intelligence configured."
