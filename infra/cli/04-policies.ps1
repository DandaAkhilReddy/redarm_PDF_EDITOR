param(
  [int]$DeleteAfterDays = 14
)

. "$PSScriptRoot/_shared.ps1"

$state = Load-State
if (-not $state) {
  throw "State file not found. Run infra/cli/00-init.ps1 first."
}

if (-not $state.storageConnectionString) {
  throw "Storage connection string missing. Run infra/cli/01-storage.ps1 first."
}

Write-Host "Enabling blob versioning and soft delete..."
az storage account blob-service-properties update `
  -g $state.resourceGroup `
  -n $state.storageAccount `
  --enable-versioning true `
  --enable-delete-retention true `
  --delete-retention-days $DeleteAfterDays `
  --enable-container-delete-retention true `
  --container-delete-retention-days $DeleteAfterDays | Out-Null

$policyPath = Join-Path $PSScriptRoot "_lifecycle-policy.json"

$policy = @{
  rules = @(
    @{
      enabled = $true
      name = "cleanup-exports-and-ocr"
      type = "Lifecycle"
      definition = @{
        actions = @{
          baseBlob = @{
            delete = @{
              daysAfterModificationGreaterThan = $DeleteAfterDays
            }
          }
          version = @{
            delete = @{
              daysAfterCreationGreaterThan = $DeleteAfterDays
            }
          }
        }
        filters = @{
          blobTypes = @("blockBlob")
          prefixMatch = @("pdf-export/", "ocr-json/")
        }
      }
    }
  )
} | ConvertTo-Json -Depth 10

$policy | Set-Content -Path $policyPath
az storage account management-policy create -g $state.resourceGroup -n $state.storageAccount --policy "@$policyPath" | Out-Null
Remove-Item $policyPath -Force

if ($state.functionApp) {
  az functionapp update -g $state.resourceGroup -n $state.functionApp --set dailyMemoryTimeQuota=250 | Out-Null
}

Write-Host "Policies applied: versioning, soft delete, lifecycle cleanup, function daily quota."
