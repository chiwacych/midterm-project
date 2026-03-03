#!/usr/bin/env pwsh
# Quick Access to Hospital Systems
# This script finds current IPs and opens the React frontends

Write-Host "=== Hospital System Quick Access ===" -ForegroundColor Cyan
Write-Host ""

# Get current IPs
Write-Host "Detecting current VM IPs..." -ForegroundColor Yellow
$hospitalAInfo = multipass info hospital-a | Out-String
$hospitalBInfo = multipass info hospital-b | Out-String
$hospitalAIP = if ($hospitalAInfo -match 'IPv4:\s+([\d\.]+)') { $matches[1] } else { "N/A" }
$hospitalBIP = if ($hospitalBInfo -match 'IPv4:\s+([\d\.]+)') { $matches[1] } else { "N/A" }

Write-Host ""
Write-Host "Hospital A:" -ForegroundColor Green
Write-Host "  IP: $hospitalAIP" -ForegroundColor Gray
Write-Host "  React UI: http://${hospitalAIP}:8000" -ForegroundColor Cyan
Write-Host "  API Docs: http://${hospitalAIP}:8000/docs" -ForegroundColor Gray
Write-Host "  MinIO: http://${hospitalAIP}:9001" -ForegroundColor Gray
Write-Host "  Grafana: http://${hospitalAIP}:3001" -ForegroundColor Gray

Write-Host ""
Write-Host "Hospital B:" -ForegroundColor Green
Write-Host "  IP: $hospitalBIP" -ForegroundColor Gray
Write-Host "  React UI: http://${hospitalBIP}:8000" -ForegroundColor Cyan
Write-Host "  API Docs: http://${hospitalBIP}:8000/docs" -ForegroundColor Gray
Write-Host "  MinIO: http://${hospitalBIP}:9001" -ForegroundColor Gray
Write-Host "  Grafana: http://${hospitalBIP}:3001" -ForegroundColor Gray

Write-Host ""
Write-Host "Default Login: admin@example.com / admin" -ForegroundColor Yellow
Write-Host ""

$choice = Read-Host "Open browsers? (Y/n)"
if ($choice -eq "" -or $choice -eq "y" -or $choice -eq "Y") {
    Write-Host ""
    Write-Host "Opening browsers..." -ForegroundColor Cyan
    Start-Process "http://${hospitalAIP}:8000"
    Start-Sleep -Seconds 1
    Start-Process "http://${hospitalBIP}:8000"
    Write-Host "✓ Browsers opened" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Quick Commands ===" -ForegroundColor Cyan
Write-Host "Update federation peer IPs:" -ForegroundColor Yellow
Write-Host "  Hospital A -> B: Update FEDERATION_PEER_HOSPITAL_B=${hospitalBIP}:50051" -ForegroundColor Gray
Write-Host "  Hospital B -> A: Update FEDERATION_PEER_HOSPITAL_A=${hospitalAIP}:50051" -ForegroundColor Gray
