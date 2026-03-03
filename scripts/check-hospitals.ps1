# Hospital Systems Health Check Script
# Verifies both hospital systems are operational

$HOSPITAL_A_IP = "172.29.134.2"
$HOSPITAL_B_IP = "172.29.138.240"

Write-Host "=== Hospital Systems Health Check ===" -ForegroundColor Green
Write-Host ""

function Check-Service {
    param($Name, $Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
        Write-Host "  ✓ $Name" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  ✗ $Name - Not responding" -ForegroundColor Red
        return $false
    }
}

function Check-Hospital {
    param($Name, $IP)
    
    Write-Host "$Name ($IP)" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    
    $services = @{
        "FastAPI" = "http://${IP}:8000/docs"
        "MinIO Console" = "http://${IP}:9001"
        "Grafana" = "http://${IP}:3001"
    }
    
    $allHealthy = $true
    foreach ($service in $services.GetEnumerator()) {
        $result = Check-Service -Name $service.Key -Url $service.Value
        if (-not $result) { $allHealthy = $false }
    }
    
    # Check Docker containers
    Write-Host ""
    Write-Host "  Docker Containers:" -ForegroundColor White
    $vmName = if ($Name -eq "Hospital A") { "hospital-a" } else { "hospital-b" }
    try {
        $containers = multipass exec $vmName -- docker ps --format "table {{.Names}}\t{{.Status}}" 2>$null
        if ($containers) {
            $containers -split "`n" | Select-Object -Skip 1 | ForEach-Object {
                if ($_ -match "Up") {
                    Write-Host "    ✓ $_" -ForegroundColor Green
                } else {
                    Write-Host "    ⚠ $_" -ForegroundColor Yellow
                    $allHealthy = $false
                }
            }
        }
    } catch {
        Write-Host "    ✗ Could not check containers" -ForegroundColor Red
        $allHealthy = $false
    }
    
    Write-Host ""
    return $allHealthy
}

# Check Hospital A
$healthyA = Check-Hospital -Name "Hospital A" -IP $HOSPITAL_A_IP

# Check Hospital B
$healthyB = Check-Hospital -Name "Hospital B" -IP $HOSPITAL_B_IP

# Federation connectivity check
Write-Host "Federation Connectivity" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray

try {
    multipass exec hospital-a -- bash -c "nc -zv $HOSPITAL_B_IP 50051 2>&1" | Out-Null
    Write-Host "  ✓ Hospital A → Hospital B (gRPC:50051)" -ForegroundColor Green
    $fedA = $true
} catch {
    Write-Host "  ✗ Hospital A → Hospital B (gRPC:50051) - Not reachable" -ForegroundColor Red
    $fedA = $false
}

try {
    multipass exec hospital-b -- bash -c "nc -zv $HOSPITAL_A_IP 50051 2>&1" | Out-Null
    Write-Host "  ✓ Hospital B → Hospital A (gRPC:50051)" -ForegroundColor Green
    $fedB = $true
} catch {
    Write-Host "  ✗ Hospital B → Hospital A (gRPC:50051) - Not reachable" -ForegroundColor Red
    $fedB = $false
}

Write-Host ""

# Summary
Write-Host "=== System Status Summary ===" -ForegroundColor Green
Write-Host ""

if ($healthyA -and $healthyB -and $fedA -and $fedB) {
    Write-Host "✓ All systems operational" -ForegroundColor Green
    Write-Host "✓ Federation connectivity established" -ForegroundColor Green
    Write-Host ""
    Write-Host "Ready for cross-hospital file exchange testing!" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Run: .\scripts\test-federation.ps1" -ForegroundColor Yellow
} else {
    Write-Host "⚠ Some issues detected" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Cyan
    if (-not $healthyA) {
        Write-Host "  - Check Hospital A: multipass exec hospital-a -- docker compose ps" -ForegroundColor White
    }
    if (-not $healthyB) {
        Write-Host "  - Check Hospital B: multipass exec hospital-b -- docker compose ps" -ForegroundColor White
    }
    if (-not $fedA -or -not $fedB) {
        Write-Host "  - Check federation logs: multipass exec hospital-a -- docker compose logs federation" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "Service URLs:" -ForegroundColor Cyan
Write-Host "  Hospital A API: http://$HOSPITAL_A_IP:8000" -ForegroundColor White
Write-Host "  Hospital A Docs: http://$HOSPITAL_A_IP:8000/docs" -ForegroundColor White
Write-Host "  Hospital A MinIO: http://$HOSPITAL_A_IP:9001 (minioadmin/minioadmin123)" -ForegroundColor White
Write-Host "  Hospital A Grafana: http://$HOSPITAL_A_IP:3001 (admin/admin)" -ForegroundColor White
Write-Host ""
Write-Host "  Hospital B API: http://$HOSPITAL_B_IP:8000" -ForegroundColor White
Write-Host "  Hospital B Docs: http://$HOSPITAL_B_IP:8000/docs" -ForegroundColor White
Write-Host "  Hospital B MinIO: http://$HOSPITAL_B_IP:9001 (minioadmin/minioadmin123)" -ForegroundColor White
Write-Host "  Hospital B Grafana: http://$HOSPITAL_B_IP:3001 (admin/admin)" -ForegroundColor White
