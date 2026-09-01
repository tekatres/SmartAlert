# Quick test script
# Run: .\docs\test-alerts.ps1

$headers = @{
    "Content-Type" = "application/json"
    "X-API-Key"    = "dev-local-key"
}

$body = @{
    sensitivity = "medium"
    use_ai      = $true
} | ConvertTo-Json

try {
    $r = Invoke-RestMethod -Uri "http://localhost:8000/alerts/generate" -Method POST -Headers $headers -Body $body
    $r | ConvertTo-Json -Depth 6
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
