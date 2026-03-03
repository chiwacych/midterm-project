#!/usr/bin/env pwsh
# Fix VM Performance Issues
# This script increases CPU and memory for both hospital VMs

Write-Host "=== Fixing VM Performance Issues ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Current Issues:" -ForegroundColor Yellow
Write-Host "  - VMs have only 1 CPU (need at least 2-4 CPUs for 11 containers)" -ForegroundColor Yellow
Write-Host "  - VMs have only 892MB RAM (need at least 2GB for 11 containers)" -ForegroundColor Yellow
Write-Host "  - High load average causing slow SSH/exec commands" -ForegroundColor Yellow
Write-Host ""

$hospitals = @("hospital-a", "hospital-b")

foreach ($hospital in $hospitals) {
    Write-Host "Processing $hospital..." -ForegroundColor Cyan
    
    # Stop the VM
    Write-Host "  1. Stopping $hospital..." -ForegroundColor Gray
    multipass stop $hospital
    Start-Sleep -Seconds 3
    
    # Increase resources (2 CPUs, 3GB RAM should be minimum)
    Write-Host "  2. Increasing resources to 4 CPUs and 4GB RAM..." -ForegroundColor Gray
    multipass set "local.$hospital.cpus=4"
    multipass set "local.$hospital.memory=4G"
    
    # Start the VM
    Write-Host "  3. Starting $hospital..." -ForegroundColor Gray
    multipass start $hospital
    Start-Sleep -Seconds 5
    
    # Wait for SSH to be ready
    Write-Host "  4. Waiting for SSH..." -ForegroundColor Gray
    $maxRetries = 10
    $retries = 0
    while ($retries -lt $maxRetries) {
        try {
            $null = multipass exec $hospital -- echo "ready" 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  ✓ SSH ready" -ForegroundColor Green
                break
            }
        } catch {}
        $retries++
        Start-Sleep -Seconds 2
    }
    
    # Restart Docker containers
    Write-Host "  5. Restarting Docker containers..." -ForegroundColor Gray
    multipass exec $hospital -- bash -c "cd /home/ubuntu && docker compose restart" 2>$null
    
    Write-Host "  ✓ $hospital configured: 4 CPUs, 4GB RAM" -ForegroundColor Green
    Write-Host ""
}

Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
Write-Host ""

foreach ($hospital in $hospitals) {
    Write-Host "$hospital info:" -ForegroundColor Yellow
    multipass info $hospital | Select-String "CPU|Memory|Load"
    Write-Host ""
}

Write-Host "=== Performance Test ===" -ForegroundColor Cyan
Write-Host "Testing command speed..."
$elapsed = Measure-Command { multipass exec hospital-a -- echo "test" }
Write-Host "Simple command took: $($elapsed.TotalSeconds) seconds" -ForegroundColor $(if ($elapsed.TotalSeconds -lt 1.5) { "Green" } elseif ($elapsed.TotalSeconds -lt 3) { "Yellow" } else { "Red" })
Write-Host ""
Write-Host "Expected: < 1.5 seconds (Good), < 3 seconds (Acceptable), > 3 seconds (Still slow)" -ForegroundColor Gray
Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
