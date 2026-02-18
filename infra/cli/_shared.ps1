Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$StatePath = Join-Path $ScriptRoot ".state.json"

function Assert-AzCli {
  $null = az --version | Out-Null
}

function Assert-AzLogin {
  try {
    $account = az account show --output json | ConvertFrom-Json
    if (-not $account.id) {
      throw "No active subscription"
    }
    return $account
  }
  catch {
    throw "Azure CLI is not logged in. Run: az login"
  }
}

function Ensure-ProviderRegistered {
  param(
    [Parameter(Mandatory = $true)][string]$Namespace
  )

  $state = az provider show -n $Namespace --query registrationState -o tsv
  if ($state -eq "Registered") {
    return
  }

  Write-Host "Registering provider $Namespace ..."
  az provider register -n $Namespace | Out-Null

  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 5
    $current = az provider show -n $Namespace --query registrationState -o tsv
    if ($current -eq "Registered") {
      Write-Host "$Namespace registered."
      return
    }
  }

  throw "Provider registration timeout for $Namespace"
}

function New-NameSuffix {
  $chars = (97..122 + 48..57) | ForEach-Object { [char]$_ }
  -join (1..6 | ForEach-Object { $chars[(Get-Random -Minimum 0 -Maximum $chars.Length)] })
}

function To-AlphaNumLower {
  param([string]$Value)
  if ($null -eq $Value) {
    $raw = ""
  } else {
    $raw = $Value.ToLower()
  }
  return [Regex]::Replace($raw, "[^a-z0-9]", "")
}

function Load-State {
  if (Test-Path $StatePath) {
    return Get-Content $StatePath -Raw | ConvertFrom-Json
  }
  return $null
}

function Save-State {
  param(
    [Parameter(Mandatory = $true)]$State
  )

  $State | ConvertTo-Json -Depth 20 | Set-Content -Path $StatePath
}

function Set-StateValue {
  param(
    [Parameter(Mandatory = $true)]$State,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter()][AllowNull()]$Value
  )

  if ($State.PSObject.Properties.Name -contains $Name) {
    $State.$Name = $Value
  } else {
    $State | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
  }
}

function Get-OrCreate-State {
  param(
    [string]$Prefix = "redarm",
    [string]$Env = "devcheap",
    [string]$Location = "eastus2",
    [string]$SubscriptionId = ""
  )

  $existing = Load-State
  if ($existing) {
    return $existing
  }

  $suffix = New-NameSuffix
  $rg = "rg-$Prefix-$Env"
  $storagePrefix = To-AlphaNumLower -Value $Prefix
  $storageEnv = To-AlphaNumLower -Value $Env
  if (-not $storagePrefix) { $storagePrefix = "redarm" }
  if (-not $storageEnv) { $storageEnv = "devcheap" }
  $storageBase = "st{0}{1}{2}" -f $storagePrefix, $storageEnv, $suffix

  $state = [ordered]@{
    prefix = $Prefix
    env = $Env
    location = $Location
    subscriptionId = $SubscriptionId
    suffix = $suffix
    resourceGroup = $rg
    storageAccount = $storageBase.Substring(0, [Math]::Min(24, $storageBase.Length))
    functionApp = ("func-$Prefix-$Env-$suffix").ToLower()
    docIntel = ("di-$Prefix-$Env-$suffix").ToLower()
    budgetName = "budget-$Prefix-$Env"
    containers = @("pdf-source", "pdf-export", "ocr-json")
    tables = @("users", "documents", "sessions", "jobs")
    queues = @("q-ocr", "q-export")
    storageConnectionString = ""
    storageAccountKey = ""
    staticWebUrl = ""
    functionBaseUrl = ""
    bootstrapAdminEmail = ""
    bootstrapAdminPassword = ""
    docIntelEndpoint = ""
    tenantId = ""
    accountName = ""
  }

  Save-State -State $state
  return $state
}

function Ensure-ResourceGroup {
  param([Parameter(Mandatory = $true)]$State)

  az group create -n $State.resourceGroup -l $State.location --tags "app=redarm" "env=$($State.env)" "tier=cheap" | Out-Null
}

function Get-StorageConnectionString {
  param([Parameter(Mandatory = $true)]$State)

  return az storage account show-connection-string -g $State.resourceGroup -n $State.storageAccount --query connectionString -o tsv
}
