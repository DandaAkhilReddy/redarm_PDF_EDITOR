. "$PSScriptRoot/../infra/cli/_shared.ps1"

$state = Load-State
if (-not $state) {
  throw "Missing state file. Deploy first."
}

$base = $state.functionBaseUrl
$email = $state.bootstrapAdminEmail
$pass = $state.bootstrapAdminPassword

if (-not $base -or -not $email -or -not $pass) {
  throw "State file is missing function URL or bootstrap credentials."
}

Write-Host "Logging in..."
$loginBody = @{ email = $email; password = $pass } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType "application/json" -Body $loginBody
$token = $login.accessToken

Write-Host "Smoke auth passed for $email"
Write-Host "Token prefix: $($token.Substring(0, 20))..."