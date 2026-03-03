# Run this script as Administrator to update hosts file
# Right-click -> Run as Administrator

$hostsPath = "C:\Windows\System32\drivers\etc\hosts"

Write-Host "Updating Windows hosts file..." -ForegroundColor Yellow

# Backup
$backupPath = "$hostsPath.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $hostsPath $backupPath
Write-Host "Backup created: $backupPath" -ForegroundColor Gray

# Remove old entries
$hostsContent = Get-Content $hostsPath | Where-Object { $_ -notmatch "hospital-[ab]\.local" }

# Add new entries
$hostsContent += ""
$hostsContent += "# Hospital Management System - Professional Setup"
$hostsContent += "127.0.0.1 hospital-a.local"
$hostsContent += "127.0.0.1 hospital-b.local"

# Write
$hostsContent | Out-File -FilePath $hostsPath -Encoding ascii -Force

Write-Host "✓ Hosts file updated!" -ForegroundColor Green
Write-Host ""
Write-Host "You can now access:" -ForegroundColor Cyan
Write-Host "  http://hospital-a.local" -ForegroundColor Green
Write-Host "  http://hospital-b.local" -ForegroundColor Green

Read-Host "`nPress Enter to exit"
