# Quick Access to Hospital UIs
# Opens all hospital interfaces in your default browser

$HOSPITAL_A_IP = "172.29.134.2"
$HOSPITAL_B_IP = "172.29.138.240"

Write-Host "=== Opening Hospital UIs ===" -ForegroundColor Green
Write-Host ""

Write-Host "🏥 Hospital A URLs:" -ForegroundColor Cyan
Write-Host "  API Docs:  http://$HOSPITAL_A_IP:8000/docs" -ForegroundColor White
Write-Host "  MinIO:     http://$HOSPITAL_A_IP:9001" -ForegroundColor White
Write-Host "  Grafana:   http://$HOSPITAL_A_IP:3001" -ForegroundColor White

Write-Host ""
Write-Host "🏥 Hospital B URLs:" -ForegroundColor Cyan
Write-Host "  API Docs:  http://$HOSPITAL_B_IP:8000/docs" -ForegroundColor White
Write-Host "  MinIO:     http://$HOSPITAL_B_IP:9001" -ForegroundColor White
Write-Host "  Grafana:   http://$HOSPITAL_B_IP:3001" -ForegroundColor White

Write-Host ""
Write-Host "Opening in browser..." -ForegroundColor Yellow
Write-Host ""

# Open Hospital A API Docs (Primary Interface)
Start-Process "http://$HOSPITAL_A_IP:8000/docs"
Start-Sleep -Seconds 1

# Open Hospital B API Docs
Start-Process "http://$HOSPITAL_B_IP:8000/docs"
Start-Sleep -Seconds 1

Write-Host "✅ Opened API Documentation for both hospitals" -ForegroundColor Green
Write-Host ""
Write-Host "Login Credentials:" -ForegroundColor Yellow
Write-Host "  Email: admin@example.com" -ForegroundColor White
Write-Host "  Password: admin" -ForegroundColor White
Write-Host ""
Write-Host "To open other UIs, choose:" -ForegroundColor Cyan
Write-Host "  [M] MinIO Console" -ForegroundColor White
Write-Host "  [G] Grafana Dashboard" -ForegroundColor White
Write-Host "  [Q] Quit" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Enter choice"

switch ($choice.ToUpper()) {
    "M" {
        Write-Host "Opening MinIO consoles..." -ForegroundColor Yellow
        Start-Process "http://$HOSPITAL_A_IP:9001"
        Start-Process "http://$HOSPITAL_B_IP:9001"
        Write-Host "MinIO Login: minioadmin / minioadmin123" -ForegroundColor Green
    }
    "G" {
        Write-Host "Opening Grafana dashboards..." -ForegroundColor Yellow
        Start-Process "http://$HOSPITAL_A_IP:3001"
        Start-Process "http://$HOSPITAL_B_IP:3001"
        Write-Host "Grafana Login: admin / admin" -ForegroundColor Green
    }
    "Q" {
        Write-Host "Done!" -ForegroundColor Green
    }
    default {
        Write-Host "Invalid choice. Exiting." -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "For complete UI guide, see: UI_ACCESS_GUIDE.md" -ForegroundColor Cyan
