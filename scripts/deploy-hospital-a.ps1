# PowerShell script to deploy Complete Hospital A System
# This deploys a FULL hospital system with all services on the VM
# Run this from the scripts directory

$HOSPITAL_NAME = "hospital-a"
$HOSPITAL_IP = "172.29.134.2"

Write-Host "=== Deploying Complete Hospital A System ===" -ForegroundColor Green
Write-Host "This will deploy:" -ForegroundColor Cyan
Write-Host "  - FastAPI Backend (port 8000)" -ForegroundColor White
Write-Host "  - PostgreSQL Database (port 5432)" -ForegroundColor White
Write-Host "  - MinIO 3-node cluster (ports 9000-9003)" -ForegroundColor White
Write-Host "  - Redis Cache (port 6379)" -ForegroundColor White
Write-Host "  - Kafka Event Streaming (port 9092)" -ForegroundColor White
Write-Host "  - Federation gRPC (port 50051)" -ForegroundColor White
Write-Host "  - Grafana Monitoring (port 3001)" -ForegroundColor White
Write-Host ""

# Step 1: Install Docker in VM
Write-Host "Step 1: Installing Docker..." -ForegroundColor Cyan
multipass exec $HOSPITAL_NAME -- bash -c 'sudo apt-get update && sudo apt-get install -y ca-certificates curl'
multipass exec $HOSPITAL_NAME -- bash -c 'sudo install -m 0755 -d /etc/apt/keyrings'
multipass exec $HOSPITAL_NAME -- bash -c 'sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc'
multipass exec $HOSPITAL_NAME -- bash -c 'sudo chmod a+r /etc/apt/keyrings/docker.asc'
multipass exec $HOSPITAL_NAME -- bash -c 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null'
multipass exec $HOSPITAL_NAME -- bash -c 'sudo apt-get update'
multipass exec $HOSPITAL_NAME -- bash -c 'sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'
multipass exec $HOSPITAL_NAME -- bash -c 'sudo usermod -aG docker ubuntu'

# Step 2: Create directories
Write-Host "Step 2: Creating directories..." -ForegroundColor Cyan
multipass exec $HOSPITAL_NAME -- bash -c "mkdir -p /home/ubuntu/app /home/ubuntu/federation /home/ubuntu/postgres-config /home/ubuntu/grafana /home/ubuntu/frontend"

# Step 3: Transfer files
Write-Host "Step 3: Transferring complete project..." -ForegroundColor Cyan
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $PROJECT_ROOT
multipass transfer docker-compose.hospital-a.yml "${HOSPITAL_NAME}:/home/ubuntu/docker-compose.yml"
multipass transfer app "${HOSPITAL_NAME}:/home/ubuntu/" --recursive
multipass transfer federation "${HOSPITAL_NAME}:/home/ubuntu/" --recursive  
multipass transfer postgres-config "${HOSPITAL_NAME}:/home/ubuntu/" --recursive
multipass transfer grafana "${HOSPITAL_NAME}:/home/ubuntu/" --recursive
multipass transfer prometheus.yml "${HOSPITAL_NAME}:/home/ubuntu/"
multipass transfer frontend/dist "${HOSPITAL_NAME}:/home/ubuntu/frontend/" --recursive

# Step 4: Build and start all services
Write-Host "Step 4: Building Docker images..." -ForegroundColor Cyan
multipass exec $HOSPITAL_NAME -- bash -c "cd /home/ubuntu && docker compose build"

# Step 5: Start all hospital services
Write-Host "Step 5: Starting all hospital services..." -ForegroundColor Cyan
multipass exec $HOSPITAL_NAME -- bash -c "cd /home/ubuntu && docker compose up -d"

Write-Host ""
Write-Host "Step 6: Waiting for services to be healthy..." -ForegroundColor Cyan
Start-Sleep -Seconds 30

# Step 7: Initialize database
Write-Host "Step 7: Initializing database..." -ForegroundColor Cyan
multipass exec $HOSPITAL_NAME -- bash -c "cd /home/ubuntu && docker compose exec -T fastapi python -c 'from app.database import init_db; init_db()'"

# Step 8: Create admin user
Write-Host "Step 8: Creating admin user..." -ForegroundColor Cyan
multipass exec $HOSPITAL_NAME -- bash -c "cd /home/ubuntu && docker compose exec -T fastapi python create_admin.py"

Write-Host ""
Write-Host "=== Hospital A System Deployment Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Hospital A URLs:" -ForegroundColor Yellow
Write-Host "  API: http://${HOSPITAL_IP}:8000" -ForegroundColor White
Write-Host "  API Docs: http://${HOSPITAL_IP}:8000/docs" -ForegroundColor White
Write-Host "  MinIO Console: http://${HOSPITAL_IP}:9001 (minioadmin / minioadmin123)" -ForegroundColor White
Write-Host "  Grafana: http://${HOSPITAL_IP}:3001 (admin / admin)" -ForegroundColor White
Write-Host "  Federation gRPC: ${HOSPITAL_IP}:50051" -ForegroundColor White
Write-Host ""
Write-Host "Default Login:" -ForegroundColor Yellow
Write-Host "  Email: admin@example.com" -ForegroundColor White
Write-Host "  Password: admin" -ForegroundColor White
Write-Host ""
Write-Host "Useful Commands:" -ForegroundColor Cyan
Write-Host "  Check status: multipass exec $HOSPITAL_NAME -- docker ps" -ForegroundColor White
Write-Host "  View logs: multipass exec $HOSPITAL_NAME -- docker compose logs -f" -ForegroundColor White
Write-Host "  Shell access: multipass shell $HOSPITAL_NAME" -ForegroundColor White