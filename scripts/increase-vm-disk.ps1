# Increase Hospital VM Disk Sizes
# The VMs need more space for complete hospital systems (11 services each)

Write-Host "=== Increasing Hospital VM Disk Sizes ===" -ForegroundColor Green
Write-Host ""
Write-Host "Current disk size: 5GB" -ForegroundColor Yellow
Write-Host "Required size: 20GB minimum" -ForegroundColor Yellow
Write-Host ""

# Stop both VMs
Write-Host "Step 1: Stopping VMs..." -ForegroundColor Cyan
multipass stop hospital-a
multipass stop hospital-b

Write-Host ""
Write-Host "Step 2: Increasing disk sizes to 20GB..." -ForegroundColor Cyan
Write-Host "  This may take a few minutes..." -ForegroundColor Gray

# Increase disk size for Hospital A
multipass set local.hospital-a.disk=20GB

# Increase disk size for Hospital B
multipass set local.hospital-b.disk=20GB

Write-Host ""
Write-Host "Step 3: Starting VMs..." -ForegroundColor Cyan
multipass start hospital-a
multipass start hospital-b

Write-Host ""
Write-Host "Step 4: Verifying new disk sizes..." -ForegroundColor Cyan
Start-Sleep -Seconds 10

Write-Host ""
Write-Host "Hospital A:" -ForegroundColor Yellow
multipass exec hospital-a -- df -h /

Write-Host ""
Write-Host "Hospital B:" -ForegroundColor Yellow
multipass exec hospital-b -- df -h /

Write-Host ""
Write-Host "=== Disk Resize Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Deploy Hospital A: .\scripts\deploy-hospital-a.ps1" -ForegroundColor White
Write-Host "  2. Deploy Hospital B: .\scripts\deploy-hospital-b.ps1" -ForegroundColor White
