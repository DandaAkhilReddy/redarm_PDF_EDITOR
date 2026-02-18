param(
  [string]$AllowedOrigin = ""
)

. "$PSScriptRoot/_shared.ps1"

$state = Load-State
if (-not $state) {
  throw "State file not found. Run infra/cli/00-init.ps1 first."
}

Ensure-ResourceGroup -State $state

Write-Host "Creating storage account $($state.storageAccount) ..."
$exists = $false
az storage account show -g $state.resourceGroup -n $state.storageAccount -o none 2>$null
if ($LASTEXITCODE -eq 0) {
  $exists = $true
}

if (-not $exists) {
  az storage account create `
    -g $state.resourceGroup `
    -n $state.storageAccount `
    -l $state.location `
    --sku Standard_LRS `
    --kind StorageV2 `
    --access-tier Hot `
    --allow-blob-public-access false `
    --https-only true `
    --min-tls-version TLS1_2 `
    --tags "app=redarm" "env=$($state.env)" "tier=cheap" | Out-Null
}

az storage blob service-properties update --account-name $state.storageAccount --static-website true --index-document index.html --404-document index.html | Out-Null

$connection = Get-StorageConnectionString -State $state
if (-not $connection) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $token = az account get-access-token --query accessToken -o tsv
  $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
  $uri = "https://management.azure.com/subscriptions/$($state.subscriptionId)/resourceGroups/$($state.resourceGroup)/providers/Microsoft.Storage/storageAccounts/$($state.storageAccount)/listKeys?api-version=2023-01-01"
  $keys = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body "{}"
  $key0 = $keys.keys[0].value
  if (-not $key0) {
    throw "Failed to read storage account keys for $($state.storageAccount)."
  }
  $connection = "DefaultEndpointsProtocol=https;AccountName=$($state.storageAccount);AccountKey=$key0;EndpointSuffix=core.windows.net"
}
$storageKey = az storage account keys list -g $state.resourceGroup -n $state.storageAccount --query "[0].value" -o tsv
if (-not $storageKey) {
  $storageKey = ($connection -split ';' | Where-Object { $_ -like 'AccountKey=*' } | ForEach-Object { $_.Substring(11) })
}

foreach ($container in $state.containers) {
  az storage container create --name $container --connection-string $connection | Out-Null
}

foreach ($table in $state.tables) {
  az storage table create --name $table --connection-string $connection | Out-Null
}

foreach ($queue in $state.queues) {
  az storage queue create --name $queue --connection-string $connection | Out-Null
}

$webUrl = az storage account show -g $state.resourceGroup -n $state.storageAccount --query "primaryEndpoints.web" -o tsv
$origins = @("http://localhost:5173")
if ($AllowedOrigin) { $origins += $AllowedOrigin }
if ($webUrl) { $origins += ($webUrl.TrimEnd('/')) }

az storage cors clear --services b --connection-string $connection | Out-Null
az storage cors add `
  --services b `
  --methods GET PUT OPTIONS `
  --origins $origins `
  --allowed-headers "*" `
  --exposed-headers "*" `
  --max-age 3600 `
  --connection-string $connection | Out-Null

Set-StateValue -State $state -Name "storageConnectionString" -Value $connection
Set-StateValue -State $state -Name "storageAccountKey" -Value $storageKey
Set-StateValue -State $state -Name "staticWebUrl" -Value $webUrl
Save-State -State $state

Write-Host "Storage ready. Static site URL: $webUrl"
