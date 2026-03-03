#!/usr/bin/env pwsh
# Hospital System Quick Access
# Dynamically discovers all running hospital-* VMs and shows access URLs

param(
    [string]$Hospital = "all",   # specific hospital ID or 'all'
    [switch]$Open                 # auto-open browser without prompting
)

Write-Host "" 
Write-Host "🏥 Hospital System Access" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor DarkGray
Write-Host ""

# Discover running hospital VMs
$hospitalVMs = @()
try {
    $vmList = multipass list --format csv 2>$null | Select-Object -Skip 1
    foreach ($line in $vmList) {
        $parts = $line -split ','
        $vmName  = $parts[0].Trim()
        $vmState = $parts[1].Trim()
        if ($vmName -match '^hospital-' -and $vmState -eq 'Running') {
            if ($Hospital -eq 'all' -or $Hospital -eq $vmName) {
                $hospitalVMs += $vmName
            }
        }
    }
} catch {}

if ($hospitalVMs.Count -eq 0) {
    Write-Host "❌ No running hospital-* VMs found" -ForegroundColor Red
    Write-Host "   Start a VM: multipass start hospital-a" -ForegroundColor Yellow
    exit 1
}

# Collect IPs
$hospitalData = @()
foreach ($vm in $hospitalVMs) {
    $info = multipass info $vm 2>$null | Out-String
    $ip   = if ($info -match 'IPv4:\s+([\d\.]+)') { $matches[1] } else { $null }
    if ($ip) {
        $suffix = ($vm -replace '^hospital-', '').ToUpper()
        $hospitalData += [PSCustomObject]@{ VM = $vm; Name = "Hospital $suffix"; IP = $ip }
    }
}

# Print access table
foreach ($h in $hospitalData) {
    Write-Host "$($h.Name) ($($h.VM))" -ForegroundColor Green
    Write-Host "  IP:        $($h.IP)" -ForegroundColor Gray
    Write-Host "  Web UI:    http://$($h.IP)" -ForegroundColor Cyan
    Write-Host "  API Docs:  http://$($h.IP)/docs" -ForegroundColor Gray
    Write-Host "  MinIO:     http://$($h.IP):9001  (minioadmin / minioadmin123)" -ForegroundColor Gray
    Write-Host "  Prometheus:http://$($h.IP):9090" -ForegroundColor Gray
    Write-Host "  libp2p:    curl http://$($h.IP)/api/federation/node/info" -ForegroundColor Gray
    Write-Host ""
}

# Default credentials
Write-Host "🔐 Default Credentials (per hospital):" -ForegroundColor Yellow
foreach ($h in $hospitalData) {
    $id = $h.VM
    Write-Host "  $($h.Name):  admin@${id}.local / admin123  |  doctor@${id}.local / doctor123" -ForegroundColor Gray
}
Write-Host ""

# Browser prompt (skip if -Open passed)
$openChoice = if ($Open) { "1" } else {
    Write-Host "Open in browser?" -ForegroundColor Cyan
    Write-Host "  [1] Web UI (main app)" -ForegroundColor White
    Write-Host "  [2] API Docs" -ForegroundColor White
    Write-Host "  [3] MinIO Console" -ForegroundColor White
    Write-Host "  [N] Skip" -ForegroundColor White
    Read-Host "Choice"
}

$urlMap = @{ "1" = "/"; "2" = "/docs"; "3" = ":9001" }
if ($urlMap.ContainsKey($openChoice)) {
    $suffix = $urlMap[$openChoice]
    foreach ($h in $hospitalData) {
        $url = if ($suffix -match '^:') { "http://$($h.IP)$suffix" } else { "http://$($h.IP)$suffix" }
        Write-Host "  Opening $($h.Name): $url" -ForegroundColor Gray
        Start-Process $url
        Start-Sleep -Milliseconds 600
    }
    Write-Host "✓ Opened" -ForegroundColor Green
}

Write-Host ""
Write-Host "📋 Useful Commands:" -ForegroundColor Cyan
foreach ($h in $hospitalData) {
    Write-Host "  # $($h.Name)" -ForegroundColor DarkGray
    Write-Host "  multipass exec $($h.VM) -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml ps" -ForegroundColor Gray
    Write-Host "  multipass exec $($h.VM) -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs -f" -ForegroundColor Gray
    Write-Host ""
}
