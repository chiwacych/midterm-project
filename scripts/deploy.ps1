# Unified Hospital Deployment Script
# Deploy any hospital independently without affecting others

param(
    [Parameter(Mandatory=$false)]
    [string]$Hospital = "hospital-a",
    
    [Parameter(Mandatory=$false)]
    [string[]]$Peers = @(),
    
    [switch]$Clean,
    [switch]$Start,
    [switch]$SkipBuild,
    [switch]$ShowHelp
)

$ErrorActionPreference = "Stop"

# Build hospital config dynamically from the ID
# e.g. "hospital-c" -> Name="Hospital C", VM="hospital-c"
function Build-HospitalConfig {
    param([string]$HospitalID, [string[]]$PeerList)
    
    # Derive display name: "hospital-c" -> "Hospital C"
    $suffix = ($HospitalID -replace '^hospital-', '').ToUpper()
    $displayName = "Hospital $suffix"
    
    return @{
        ID   = $HospitalID
        Name = $displayName
        VM   = $HospitalID
        Peers = $PeerList
    }
}

function Show-Help {
    Write-Host @"
🏥 Hospital Deployment System
$("=" * 70)

Deploy any hospital independently to multipass VMs with full production stack.
Supports N hospitals — not limited to hospital-a/b.

USAGE:
  .\scripts\deploy.ps1 [-Hospital <name>] [-Peers <list>] [options]

PARAMETERS:
  -Hospital <name>   Which hospital to deploy (default: hospital-a)
                     Any name matching 'hospital-X' pattern (e.g. hospital-c)
                     Use 'all' to deploy all existing hospital VMs
  -Peers <list>      Comma-separated peer hospital IDs
                     Auto-detected from running VMs if omitted
  -Clean             Clean VM before deployment (removes all data)
  -Start             Start services automatically after deployment
  -SkipBuild         Skip frontend build (use existing dist/)
  -ShowHelp          Display this help message

EXAMPLES:
  # Deploy Hospital A (auto-discovers peers from running VMs)
  .\scripts\deploy.ps1

  # Deploy Hospital A and start services
  .\scripts\deploy.ps1 -Hospital hospital-a -Start

  # Deploy a NEW Hospital C with explicit peers
  .\scripts\deploy.ps1 -Hospital hospital-c -Peers hospital-a,hospital-b -Clean -Start

  # Deploy Hospital B with clean slate
  .\scripts\deploy.ps1 -Hospital hospital-b -Clean -Start

  # Deploy all hospital VMs
  .\scripts\deploy.ps1 -Hospital all -Start

  # Quick redeploy without rebuild
  .\scripts\deploy.ps1 -Hospital hospital-a -SkipBuild -Start

WHAT IT DOES:
  ✓ Validates VM exists (creates if needed)
  ✓ Generates mTLS certificates
  ✓ Builds frontend (unless -SkipBuild)
  ✓ Transfers all application files
  ✓ Configures docker-compose with environment
  ✓ Generates peers.conf for libp2p bootstrap
  ✓ Seeds default users (admin + doctor) on first start
  ✓ Sets up federation registry
  ✓ Optionally starts services

DEFAULT USERS (created automatically on -Start):
  admin@<hospital-id>.local / admin123   (role: admin)
  doctor@<hospital-id>.local / doctor123 (role: doctor)

POST-DEPLOYMENT:
  Web UI:       http://<vm-ip>
  API:          http://<vm-ip>/api
  Federation:   <vm-ip>:50051
  Registry:     Use UI or: curl -X POST http://<vm-ip>/api/federation/registry/self-register

MANAGEMENT:
  # Check status
  multipass exec <hospital> -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml ps

  # View logs
  multipass exec <hospital> -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs -f

  # Restart services
  multipass exec <hospital> -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml restart

  # Stop services
  multipass exec <hospital> -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml down

$("=" * 70)
"@ -ForegroundColor Cyan
    exit 0
}

if ($ShowHelp) {
    Show-Help
}

function Get-VMIP {
    param([string]$VMName)
    
    try {
        $info = multipass info $VMName --format csv 2>$null
        if ($info -match "IPv4,([0-9.]+)") {
            return $matches[1]
        }
    } catch {
        return $null
    }
    return $null
}

# Auto-discover peer hospitals from running multipass VMs
function Get-HospitalVMs {
    param([string]$ExcludeID = "")
    
    $vms = @()
    try {
        $vmList = multipass list --format csv 2>$null | Select-Object -Skip 1
        foreach ($line in $vmList) {
            $parts = $line -split ','
            $vmName = $parts[0].Trim()
            $vmState = $parts[1].Trim()
            if ($vmName -match '^hospital-' -and $vmState -eq 'Running' -and $vmName -ne $ExcludeID) {
                $vms += $vmName
            }
        }
    } catch {}
    return $vms
}

function Normalize-PeerList {
    param(
        [string[]]$PeerInput,
        [string]$SelfHospital = ""
    )

    $normalized = @()
    foreach ($raw in $PeerInput) {
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }

        foreach ($candidate in ($raw -split ',')) {
            $peer = $candidate.Trim().ToLower()
            if ([string]::IsNullOrWhiteSpace($peer)) { continue }
            if ($SelfHospital -and $peer -eq $SelfHospital) { continue }

            if ($peer -notmatch '^hospital-[a-z0-9]+$') {
                Write-Host "  ⚠ Ignoring invalid peer ID: $peer" -ForegroundColor Yellow
                continue
            }

            $normalized += $peer
        }
    }

    return @($normalized | Select-Object -Unique)
}

function Wait-HospitalReady {
    param(
        [string]$VMName,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            multipass exec $VMName -- bash -c "curl -fsS http://localhost/health >/dev/null || curl -fsS http://localhost:8000/health >/dev/null" | Out-Null
            if ($LASTEXITCODE -eq 0) {
                return $true
            }
        } catch {
            # Service is still starting.
        }

        Start-Sleep -Seconds 5
    }

    return $false
}

function Deploy-Hospital {
    param(
        [hashtable]$Config
    )
    
    Write-Host "`n$("=" * 70)" -ForegroundColor Cyan
    Write-Host "🏥 Deploying $($Config.Name)" -ForegroundColor Green
    Write-Host "$("=" * 70)" -ForegroundColor Cyan
    
    # Build parameters for deploy-to-vm.ps1
    $params = @{
        VM = $Config.VM
        HospitalID = $Config.ID
        HospitalName = $Config.Name
        Peers = ($Config.Peers -join ",")
    }
    
    if ($Clean) { $params.Clean = $true }
    if ($SkipBuild) { $params.SkipBuild = $true }
    
    # Execute deployment (deploy-to-vm.ps1 handles peers.conf generation via -Peers)
    & "$PSScriptRoot\deploy-to-vm.ps1" @params
    
    # Start services if requested
    if ($Start) {
        Write-Host "`n🚀 Starting services on $($Config.Name)..." -ForegroundColor Yellow
        multipass exec $Config.VM -- sudo bash "/home/ubuntu/medimage/start.sh"
        
        # Wait for services to be healthy
        Write-Host "⏳ Waiting for health endpoint (up to 3 minutes)..." -ForegroundColor Gray
        $ready = Wait-HospitalReady -VMName $Config.VM -TimeoutSeconds 180
        if ($ready) {
            Write-Host "✓ Health endpoint is responding" -ForegroundColor Green
        } else {
            Write-Host "⚠ Health endpoint is not ready yet (services may still be warming up)" -ForegroundColor Yellow
        }
        
        # Show access information
        $ip = Get-VMIP $Config.VM
        if ($ip) {
            Write-Host "`n✅ $($Config.Name) is running!" -ForegroundColor Green
            Write-Host "   Web UI:       http://$ip" -ForegroundColor White
            Write-Host "   API:          http://$ip/api" -ForegroundColor White
            Write-Host "   DICOM Viewer: http://$ip/dicom-viewer" -ForegroundColor White
            Write-Host "   OHIF Local:   http://$ip:8042/viewer" -ForegroundColor White
            Write-Host "   Federation:   ${ip}:50051" -ForegroundColor White
            Write-Host "   Registry:     http://$ip/api/federation/registry/list" -ForegroundColor White
        }
    }
}

# Main deployment logic
Write-Host @"
🏥 Hospital Deployment System
$("=" * 70)
"@ -ForegroundColor Cyan

if ($Hospital -eq "all" -or $Hospital -eq "both") {
    # Discover all hospital VMs
    $allHospitals = @()
    if ($Hospital -eq "both") {
        # Legacy: "both" means hospital-a + hospital-b
        $allHospitals = @("hospital-a", "hospital-b")
    } else {
        # "all" discovers running hospital-* VMs
        $allHospitals = @(Get-HospitalVMs)
        if ($allHospitals.Count -eq 0) {
            Write-Host "❌ No running hospital-* VMs found" -ForegroundColor Red
            Write-Host "  Create a VM first: multipass launch --name hospital-c --cpus 4 --memory 8G --disk 40G" -ForegroundColor Yellow
            exit 1
        }
    }
    
    Write-Host "📦 Deploying $($allHospitals.Count) hospitals: $($allHospitals -join ', ')" -ForegroundColor Yellow
    Write-Host ""
    
    foreach ($h in $allHospitals) {
        $peerList = Normalize-PeerList -PeerInput ($allHospitals | Where-Object { $_ -ne $h }) -SelfHospital $h
        $config = Build-HospitalConfig -HospitalID $h -PeerList $peerList
        Deploy-Hospital -Config $config
    }
    
    # Set up cross-VM /etc/hosts so all hospitals can resolve each other
    Write-Host "`n🌐 Setting up cross-VM DNS (via /etc/hosts)..." -ForegroundColor Yellow
    
    # Collect all IPs
    $hospitalIPs = @{}
    foreach ($h in $allHospitals) {
        $ip = Get-VMIP $h
        if ($ip) { $hospitalIPs[$h] = $ip }
    }
    
    # Write all entries to each VM's /etc/hosts
    foreach ($h in $allHospitals) {
        if (-not $hospitalIPs.ContainsKey($h)) { continue }
        $hostsEntries = ($hospitalIPs.GetEnumerator() | ForEach-Object { "$($_.Value) $($_.Key).local" }) -join "`n"
        multipass exec $h -- bash -c "sudo sed -i '/\.local`$/d' /etc/hosts; echo '$hostsEntries' | sudo tee -a /etc/hosts > /dev/null" 2>$null
        $otherCount = $allHospitals.Count - 1
        Write-Host "  ✓ $h : added $($allHospitals.Count) host entries ($otherCount peers)" -ForegroundColor Green
    }
    
    Write-Host "`n$("=" * 70)" -ForegroundColor Cyan
    Write-Host "✅ All $($allHospitals.Count) Hospitals Deployed!" -ForegroundColor Green
    Write-Host "$("=" * 70)" -ForegroundColor Cyan
    
    # Show quick reference
    Write-Host "`n📋 Quick Reference:" -ForegroundColor Yellow
    Write-Host ""
    
    foreach ($h in $allHospitals) {
        $ip = $hospitalIPs[$h]
        if ($ip) {
            $suffix = ($h -replace '^hospital-', '').ToUpper()
            Write-Host "Hospital $suffix :  http://$ip  ($h.local)" -ForegroundColor Cyan
            Write-Host "  Self-register: curl -X POST http://${ip}/api/federation/registry/self-register" -ForegroundColor Gray
        }
    }
    
    Write-Host ""
    Write-Host "💡 Use the UI Federation Network page (Registry tab) to manage federation" -ForegroundColor Yellow
    Write-Host ""
    
} else {
    # Deploy single hospital
    # Validate hospital ID format
    if ($Hospital -notmatch '^hospital-[a-z0-9]+$') {
        Write-Host "❌ Invalid hospital ID: $Hospital" -ForegroundColor Red
        Write-Host "  Must match pattern: hospital-<id> (e.g. hospital-a, hospital-c, hospital-3)" -ForegroundColor Yellow
        exit 1
    }
    
    # Auto-discover peers from running VMs if none given
    if ($Peers.Count -eq 0) {
        $Peers = @(Get-HospitalVMs -ExcludeID $Hospital)
        if ($Peers.Count -gt 0) {
            Write-Host "🔍 Auto-discovered peers: $($Peers -join ', ')" -ForegroundColor Gray
        }
    }

    $Peers = Normalize-PeerList -PeerInput $Peers -SelfHospital $Hospital
    if ($Peers.Count -gt 0) {
        Write-Host "🔗 Using peers: $($Peers -join ', ')" -ForegroundColor Gray
    }
    
    $config = Build-HospitalConfig -HospitalID $Hospital -PeerList $Peers
    Deploy-Hospital -Config $config
    
    Write-Host "`n$("=" * 70)" -ForegroundColor Cyan
    Write-Host "✅ Deployment Complete!" -ForegroundColor Green
    Write-Host "$("=" * 70)" -ForegroundColor Cyan
    
    $ip = Get-VMIP $config.VM
    if ($ip) {
        Write-Host "`n📋 Access Information:" -ForegroundColor Yellow
        Write-Host "  Web UI:       http://$ip" -ForegroundColor White
        Write-Host "  API Docs:     http://$ip/docs" -ForegroundColor White
        Write-Host "  DICOM Viewer: http://$ip/dicom-viewer" -ForegroundColor White
        Write-Host "  OHIF Local:   http://$ip:8042/viewer" -ForegroundColor White
        Write-Host "  Federation:   ${ip}:50051" -ForegroundColor White
        Write-Host ""
        Write-Host "🔗 Federation Registry:" -ForegroundColor Yellow
        Write-Host "  Self-register: curl -X POST http://${ip}/api/federation/registry/self-register" -ForegroundColor Gray
        Write-Host "  Or use the UI: http://$ip → Federation Network → Registry tab" -ForegroundColor Gray
        Write-Host ""
    }
    
    Write-Host "📖 Quick Commands:" -ForegroundColor Yellow
    Write-Host "  Status:  multipass exec $($config.VM) -- sudo docker compose -f /home/ubuntu/medimage/docker-compose.yml ps" -ForegroundColor Gray
    Write-Host "  Logs:    multipass exec $($config.VM) -- sudo docker compose -f /home/ubuntu/medimage/docker-compose.yml logs -f" -ForegroundColor Gray
    Write-Host "  Shell:   multipass shell $($config.VM)" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "🎉 Done!" -ForegroundColor Green
Write-Host ""
