# Master Deployment Script
# Deploy both hospitals with complete production configuration

param(
    [switch]$HospitalA,
    [switch]$HospitalB,
    [switch]$Both,
    [switch]$Clean,
    [switch]$Start
)

$ErrorActionPrep = "Stop"

if (-not ($HospitalA -or $HospitalB -or $Both)) {
    Write-Host "🏥 Hospital Deployment System" -ForegroundColor Cyan
    Write-Host "=" * 60
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  .\scripts\deploy-hospitals.ps1 -HospitalA    Deploy Hospital A"
    Write-Host "  .\scripts\deploy-hospitals.ps1 -HospitalB    Deploy Hospital B"
    Write-Host "  .\scripts\deploy-hospitals.ps1 -Both         Deploy both hospitals"
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Yellow
    Write-Host "  -Clean    Clean VM before deployment"
    Write-Host "  -Start    Automatically start services after deployment"
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Yellow
    Write-Host "  .\scripts\deploy-hospitals.ps1 -Both -Clean -Start"
    Write-Host "  .\scripts\deploy-hospitals.ps1 -HospitalA -Start"
    Write-Host ""
    exit 0
}

function Deploy-Hospital {
    param(
        [string]$Name,
        [string]$ID,
        [string]$Peer = "",
        [string]$PeerEndpoint = ""
    )
    
    Write-Host "`n" + ("=" * 70) -ForegroundColor Cyan
    Write-Host "🏥 Deploying $Name" -ForegroundColor Green
    Write-Host ("=" * 70) -ForegroundColor Cyan
    
    $params = @{
        VM = $ID
        HospitalID = $ID
        HospitalName = $Name
    }
    
    if ($Peer) {
        $params.PeerHospital = $Peer
        $params.PeerEndpoint = $PeerEndpoint
    }
    
    if ($Clean) {
        $params.Clean = $true
    }
    
    & .\scripts\deploy-to-vm.ps1 @params
    
    if ($Start) {
        Write-Host "`n🚀 Starting services on $Name..." -ForegroundColor Yellow
        $vmPath = "/home/ubuntu/medimage"
        multipass exec $ID -- sudo bash "$vmPath/start.sh"
    }
}

# Get VMs IPs for peer configuration
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

if ($Both -or $HospitalA) {
    $hospitalBIP = Get-VMIP "hospital-b"
    $peerEndpoint = if ($hospitalBIP) { "${hospitalBIP}:50051" } else { "hospital-b.local:50051" }
    
    Deploy-Hospital -Name "Hospital A" -ID "hospital-a" -Peer "hospital-b" -PeerEndpoint $peerEndpoint
}

if ($Both -or $HospitalB) {
    $hospitalAIP = Get-VMIP "hospital-a"
    $peerEndpoint = if ($hospitalAIP) { "${hospitalAIP}:50051" } else { "hospital-a.local:50051" }
    
    Deploy-Hospital -Name "Hospital B" -ID "hospital-b" -Peer "hospital-a" -PeerEndpoint $peerEndpoint
}

Write-Host "`n" + ("=" * 70) -ForegroundColor Cyan
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host ("=" * 70) -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Quick Reference:" -ForegroundColor Yellow
Write-Host ""

if ($Both -or $HospitalA) {
    $ipA = Get-VMIP "hospital-a"
    Write-Host "Hospital A:" -ForegroundColor Cyan
    if ($ipA) {
        Write-Host "  URL:        http://$ipA" -ForegroundColor White
        Write-Host "  API:        http://${ipA}/api" -ForegroundColor White
        Write-Host "  Federation: ${ipA}:50051" -ForegroundColor White
    }
    Write-Host "  Shell:      multipass shell hospital-a" -ForegroundColor Gray
    Write-Host "  Logs:       multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs -f" -ForegroundColor Gray
    Write-Host ""
}

if ($Both -or $HospitalB) {
    $ipB = Get-VMIP "hospital-b"
    Write-Host "Hospital B:" -ForegroundColor Cyan
    if ($ipB) {
        Write-Host "  URL:        http://$ipB" -ForegroundColor White
        Write-Host "  API:        http://${ipB}/api" -ForegroundColor White
        Write-Host "  Federation: ${ipB}:50051" -ForegroundColor White
    }
    Write-Host "  Shell:      multipass shell hospital-b" -ForegroundColor Gray
    Write-Host "  Logs:       multipass exec hospital-b -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs -f" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "🔧 Using Makefiles:" -ForegroundColor Yellow
Write-Host "  make -f Makefile.hospital-a status" -ForegroundColor Gray
Write-Host "  make -f Makefile.hospital-b logs" -ForegroundColor Gray
Write-Host ""
Write-Host "🔗 Federation Registry:" -ForegroundColor Yellow
Write-Host "  Self-register hospitals:" -ForegroundColor Gray
if ($Both -or $HospitalA) {
    $ipA = Get-VMIP "hospital-a"
    if ($ipA) {
        Write-Host "    curl -X POST http://${ipA}/api/federation/registry/self-register" -ForegroundColor Gray
    }
}
if ($Both -or $HospitalB) {
    $ipB = Get-VMIP "hospital-b"
    if ($ipB) {
        Write-Host "    curl -X POST http://${ipB}/api/federation/registry/self-register" -ForegroundColor Gray
    }
}
Write-Host "  Or use the UI Federation Network page (Registry tab)" -ForegroundColor Gray
Write-Host ""
