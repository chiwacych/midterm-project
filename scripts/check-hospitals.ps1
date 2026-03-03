# Hospital Systems Health Check Script
# Dynamically discovers all running hospital-* VMs and checks health

param([string]$Hospital = "all")

Write-Host "=== Hospital Systems Health Check ===" -ForegroundColor Green
Write-Host ""

# Discover running hospital VMs dynamically
$discoveredHospitals = @{}
try {
    $vmList = multipass list --format csv 2>$null | Select-Object -Skip 1
    foreach ($line in $vmList) {
        $parts = $line -split ','
        $vmName  = $parts[0].Trim()
        $vmState = $parts[1].Trim()
        if ($vmName -match '^hospital-' -and $vmState -eq 'Running') {
            if ($Hospital -eq 'all' -or $Hospital -eq $vmName) {
                $info = multipass info $vmName 2>$null | Out-String
                if ($info -match 'IPv4:\s+([\d\.]+)') {
                    $discoveredHospitals[$vmName] = $matches[1]
                }
            }
        }
    }
} catch {}

if ($discoveredHospitals.Count -eq 0) {
    Write-Host "❌ No running hospital-* VMs found" -ForegroundColor Red
    exit 1
}

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
    param([string]$VMName, [string]$IP)

    $suffix = ($VMName -replace '^hospital-', '').ToUpper()
    $displayName = "Hospital $suffix"

    Write-Host "$displayName  ($VMName / $IP)" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray

    $services = @{
        "Web UI / API"  = "http://${IP}/api/health"
        "MinIO Console" = "http://${IP}:9001"
        "Prometheus"    = "http://${IP}:9090"
    }

    $allHealthy = $true
    foreach ($service in $services.GetEnumerator()) {
        $result = Check-Service -Name $service.Key -Url $service.Value
        if (-not $result) { $allHealthy = $false }
    }

    # Check Docker containers
    Write-Host ""
    Write-Host "  Docker Containers:" -ForegroundColor White
    try {
        $containers = multipass exec $VMName -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml ps --format "table {{.Name}}\t{{.Status}}" 2>$null
        if ($containers) {
            $containers -split "`n" | Select-Object -Skip 1 | Where-Object { $_.Trim() -ne "" } | ForEach-Object {
                if ($_ -match "Up|running") {
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

# Check each discovered hospital dynamically
$healthResults = @{}
foreach ($entry in $discoveredHospitals.GetEnumerator()) {
    $healthResults[$entry.Key] = Check-Hospital -VMName $entry.Key -IP $entry.Value
}

# Federation connectivity check (libp2p peer mesh)
$vmList = @($discoveredHospitals.Keys)
if ($vmList.Count -ge 2) {
    Write-Host "Federation / libp2p Connectivity" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    foreach ($vm in $vmList) {
        $ip = $discoveredHospitals[$vm]
        try {
            $peers = multipass exec $vm -- bash -c "curl -sf http://localhost:8000/api/federation/peers 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get(\"peers_count\",\"?\"))'" 2>$null
            if ($peers -match '^\d+') {
                Write-Host "  ✓ $vm  peers_count=$peers" -ForegroundColor Green
            } else {
                Write-Host "  ⚠ $vm  could not query peers" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "  ✗ $vm  unreachable" -ForegroundColor Red
        }
    }
    Write-Host ""
}

# Summary
$allOk = ($healthResults.Values | Where-Object { -not $_ }).Count -eq 0
Write-Host "=== System Status Summary ===" -ForegroundColor Green
Write-Host ""

if ($allOk) {
    Write-Host "✓ All $($discoveredHospitals.Count) hospital(s) operational" -ForegroundColor Green
    Write-Host ""
    Write-Host "Run federation test: .\scripts\test-federation.ps1" -ForegroundColor Cyan
} else {
    Write-Host "⚠ Some issues detected" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Cyan
    foreach ($entry in $healthResults.GetEnumerator()) {
        if (-not $entry.Value) {
            Write-Host "  - Check $($entry.Key): multipass exec $($entry.Key) -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml ps" -ForegroundColor White
        }
    }
}

Write-Host ""
Write-Host "Service URLs:" -ForegroundColor Cyan
foreach ($entry in $discoveredHospitals.GetEnumerator()) {
    $n = $entry.Key; $ip = $entry.Value
    Write-Host "  $n :  http://$ip  |  MinIO: http://${ip}:9001  |  Prometheus: http://${ip}:9090" -ForegroundColor White
}
