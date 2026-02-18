param(
  [double]$MonthlyBudget = 25.0
)

. "$PSScriptRoot/_shared.ps1"

$state = Load-State
if (-not $state) {
  throw "State file not found. Run infra/cli/00-init.ps1 first."
}

if (-not $state.subscriptionId) {
  $account = Assert-AzLogin
  $state.subscriptionId = $account.id
}

$today = Get-Date
$startDate = Get-Date -Year $today.Year -Month $today.Month -Day 1
$endDate = $startDate.AddYears(1).AddDays(-1)
$scope = "/subscriptions/$($state.subscriptionId)/resourceGroups/$($state.resourceGroup)"
$contact = if ($state.accountName) { $state.accountName } else { (Assert-AzLogin).user.name }

$payload = @{
  properties = @{
    category = "Cost"
    amount = $MonthlyBudget
    timeGrain = "Monthly"
    timePeriod = @{
      startDate = $startDate.ToString("yyyy-MM-dd")
      endDate = $endDate.ToString("yyyy-MM-dd")
    }
    notifications = @{
      actual50 = @{
        enabled = $true
        operator = "GreaterThan"
        threshold = 50
        contactEmails = @($contact)
      }
      forecast80 = @{
        enabled = $true
        operator = "GreaterThan"
        threshold = 80
        thresholdType = "Forecasted"
        contactEmails = @($contact)
      }
      actual100 = @{
        enabled = $true
        operator = "GreaterThan"
        threshold = 100
        contactEmails = @($contact)
      }
    }
  }
} | ConvertTo-Json -Depth 10

$uri = "https://management.azure.com$scope/providers/Microsoft.Consumption/budgets/$($state.budgetName)?api-version=2023-11-01"

az rest --method put --uri $uri --body $payload | Out-Null

Write-Host "Budget created/updated: $($state.budgetName)"
Write-Host "Scope: $scope"
Write-Host "Amount: $$MonthlyBudget / month"