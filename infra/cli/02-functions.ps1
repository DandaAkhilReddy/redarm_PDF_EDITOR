param(
  [switch]$SkipDeploy
)

. "$PSScriptRoot/_shared.ps1"

$state = Load-State
if (-not $state) {
  throw "State file not found. Run infra/cli/00-init.ps1 first."
}

if (-not $state.storageConnectionString) {
  throw "Storage connection string missing in state. Run infra/cli/01-storage.ps1 first."
}

Ensure-ResourceGroup -State $state

Write-Host "Creating Function App $($state.functionApp) ..."
try {
  az functionapp show -g $state.resourceGroup -n $state.functionApp -o none
  Write-Host "Function app already exists. Skipping create."
}
catch {
  az functionapp create `
    -g $state.resourceGroup `
    -n $state.functionApp `
    -s $state.storageAccount `
    --consumption-plan-location $state.location `
    --functions-version 4 `
    --runtime node `
    --runtime-version 20 `
    --os-type Linux `
    --disable-app-insights true `
    --https-only true `
    --tags "app=redarm" "env=$($state.env)" "tier=cheap" | Out-Null
}

$jwtSecret = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
$bootstrapPass = [Convert]::ToBase64String((1..18 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))

az functionapp config appsettings set `
  -g $state.resourceGroup `
  -n $state.functionApp `
  --settings `
  "AzureWebJobsStorage=$($state.storageConnectionString)" `
  "STORAGE_CONNECTION_STRING=$($state.storageConnectionString)" `
  "STORAGE_ACCOUNT_NAME=$($state.storageAccount)" `
  "STORAGE_ACCOUNT_KEY=$($state.storageAccountKey)" `
  "FUNCTIONS_WORKER_RUNTIME=node" `
  "JWT_SECRET=$jwtSecret" `
  "JWT_EXPIRES_IN=8h" `
  "BCRYPT_ROUNDS=10" `
  "LOCKOUT_THRESHOLD=5" `
  "LOCKOUT_MINUTES=15" `
  "MAX_UPLOAD_BYTES=10485760" `
  "BOOTSTRAP_ADMIN_EMAIL=admin@local.redarm" `
  "BOOTSTRAP_ADMIN_PASSWORD=$bootstrapPass" `
  "BLOB_SOURCE_CONTAINER=pdf-source" `
  "BLOB_EXPORT_CONTAINER=pdf-export" `
  "BLOB_OCR_CONTAINER=ocr-json" `
  "TABLE_USERS=users" `
  "TABLE_DOCUMENTS=documents" `
  "TABLE_SESSIONS=sessions" `
  "TABLE_JOBS=jobs" `
  "QUEUE_OCR=q-ocr" `
  "QUEUE_EXPORT=q-export" `
  "WEBSITE_RUN_FROM_PACKAGE=1" | Out-Null

$originList = @("http://localhost:5173")
if ($state.staticWebUrl) {
  $originList += $state.staticWebUrl.TrimEnd('/')
}
az functionapp cors add -g $state.resourceGroup -n $state.functionApp --allowed-origins $originList | Out-Null

if (-not $SkipDeploy) {
  Write-Host "Installing backend dependencies and creating deployment zip ..."
  Push-Location (Resolve-Path "$PSScriptRoot/../../backend")
  npm install --omit=dev
  if (Test-Path "publish.zip") { Remove-Item "publish.zip" -Force }
  Compress-Archive -Path * -DestinationPath publish.zip -Force
  Pop-Location

  az functionapp deployment source config-zip `
    -g $state.resourceGroup `
    -n $state.functionApp `
    --src (Resolve-Path "$PSScriptRoot/../../backend/publish.zip") | Out-Null
}

$funcUrl = "https://$($state.functionApp).azurewebsites.net"
Set-StateValue -State $state -Name "functionBaseUrl" -Value $funcUrl
Set-StateValue -State $state -Name "bootstrapAdminEmail" -Value "admin@local.redarm"
Set-StateValue -State $state -Name "bootstrapAdminPassword" -Value $bootstrapPass
Save-State -State $state

Write-Host "Function App ready: $funcUrl"
Write-Host "Bootstrap login email: $($state.bootstrapAdminEmail)"
Write-Host "Bootstrap login password: $($state.bootstrapAdminPassword)"
