param(
  [string]$Prefix = "redarm",
  [string]$Env = "devcheap",
  [string]$Location = "eastus2",
  [string]$SubscriptionId = ""
)

. "$PSScriptRoot/_shared.ps1"

Assert-AzCli
$account = Assert-AzLogin

if ($SubscriptionId) {
  az account set --subscription $SubscriptionId
}

$current = az account show --output json | ConvertFrom-Json
$state = Get-OrCreate-State -Prefix $Prefix -Env $Env -Location $Location -SubscriptionId $current.id
Set-StateValue -State $state -Name "subscriptionId" -Value $current.id
Set-StateValue -State $state -Name "tenantId" -Value $current.tenantId
Set-StateValue -State $state -Name "accountName" -Value $current.user.name
Save-State -State $state

$providers = @(
  "Microsoft.Storage",
  "Microsoft.Web",
  "Microsoft.CognitiveServices",
  "Microsoft.Insights"
)
foreach ($provider in $providers) {
  Ensure-ProviderRegistered -Namespace $provider
}

Write-Host "Initialized state at $PSScriptRoot/.state.json"
Write-Host "Resource group: $($state.resourceGroup)"
Write-Host "Storage account: $($state.storageAccount)"
Write-Host "Function app: $($state.functionApp)"
Write-Host "Document Intelligence account: $($state.docIntel)"
