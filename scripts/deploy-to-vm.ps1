# Universal VM Deployment Script
# Deploys complete production-ready hospital system to multipass VM

param(
    [Parameter(Mandatory=$true)]
    [string]$VM,
    
    [Parameter(Mandatory=$true)]
    [string]$HospitalID,
    
    [Parameter(Mandatory=$true)]
    [string]$HospitalName,
    
    # Comma-separated list of peer VM names for libp2p bootstrap.
    # Only ONE seed peer is needed — peer exchange discovers the rest.
    # Example: -Peers "hospital-a,hospital-b"
    [string]$Peers = "",
    
    [switch]$Clean,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$VM_PATH = "/home/ubuntu/medimage"

Write-Host "🏥 Deploying $HospitalName to VM: $VM" -ForegroundColor Cyan
Write-Host "=" * 70

# Validate VM exists
Write-Host "`n📋 Validating VM..." -ForegroundColor Yellow
try {
    $vmInfo = multipass info $VM 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "VM not found"
    }
    Write-Host "✓ VM '$VM' is running" -ForegroundColor Green
} catch {
    Write-Host "✗ VM '$VM' not found!" -ForegroundColor Red
    Write-Host "  Create with: multipass launch --name $VM --cpus 4 --memory 8G --disk 40G" -ForegroundColor Yellow
    exit 1
}

# Ensure certificates exist for this hospital
if (-not (Test-Path "certs/${HospitalID}-cert.pem") -or -not (Test-Path "certs/ca-cert.pem")) {
    Write-Host "`n🔐 Generating mTLS certificates for $HospitalID..." -ForegroundColor Yellow
    & .\scripts\generate-mtls-certs.ps1 -Hospitals @($HospitalID)
}

# Build frontend if not skipped
if (-not $SkipBuild) {
    Write-Host "`n🔨 Building frontend..." -ForegroundColor Yellow
    Push-Location frontend
    npm install --silent 2>&1 | Out-Null
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Frontend build failed!" -ForegroundColor Red
        exit 1
    }
    Pop-Location
    Write-Host "✓ Frontend built successfully" -ForegroundColor Green
}

# Clean VM if requested
if ($Clean) {
    Write-Host "`n🧹 Cleaning VM..." -ForegroundColor Yellow
    multipass exec $VM -- bash -c "cd $VM_PATH && (sudo docker compose down -v 2>/dev/null || sudo docker-compose -f $VM_PATH/docker-compose.yml down -v 2>/dev/null || true)"
    multipass exec $VM -- bash -c "sudo rm -rf $VM_PATH 2>/dev/null || true"
    Write-Host "✓ VM cleaned" -ForegroundColor Green
}

# Create directory structure
Write-Host "`n📁 Creating directory structure..." -ForegroundColor Yellow
$dirs = @(
    "$VM_PATH",
    "$VM_PATH/app",
    "$VM_PATH/app/data",
    "$VM_PATH/app/migrations",
    "$VM_PATH/app/proto",
    "$VM_PATH/app/routers",
    "$VM_PATH/app/grpc_gen",
    "$VM_PATH/federation",
    "$VM_PATH/federation/internal/kafka",
    "$VM_PATH/federation/internal/server",
    "$VM_PATH/federation/internal/p2p",
    "$VM_PATH/federation/proto",
    "$VM_PATH/federation/pkg/federationv1",
    "$VM_PATH/frontend/dist",
    "$VM_PATH/ohif",
    "$VM_PATH/certs",
    "$VM_PATH/nginx",
    "$VM_PATH/postgres-config",
    "$VM_PATH/data",
    "$VM_PATH/data/minio1",
    "$VM_PATH/data/minio2",
    "$VM_PATH/data/minio3"
)

foreach ($dir in $dirs) {
    multipass exec $VM -- mkdir -p $dir 2>$null
}
Write-Host "✓ Directories created" -ForegroundColor Green

# Transfer application files
Write-Host "`n📤 Transferring application files..." -ForegroundColor Yellow

# Helper function to transfer files
function Transfer-Files {
    param($Pattern, $Destination)
    Get-ChildItem $Pattern -File -ErrorAction SilentlyContinue | ForEach-Object {
        multipass transfer $_.FullName "${VM}:${Destination}/" 2>$null
    }
}

# FastAPI app
Write-Host "  → FastAPI application..." -ForegroundColor Gray
Transfer-Files "app/*.py" "$VM_PATH/app"
Transfer-Files "app/*.txt" "$VM_PATH/app"
Transfer-Files "app/Dockerfile" "$VM_PATH/app"
Transfer-Files "app/migrations/*.sql" "$VM_PATH/app/migrations"
Transfer-Files "app/migrations/*.sh" "$VM_PATH/app/migrations"
Transfer-Files "app/migrations/*.md" "$VM_PATH/app/migrations"
Transfer-Files "app/proto/*.py" "$VM_PATH/app/proto"
Transfer-Files "app/routers/*.py" "$VM_PATH/app/routers"
multipass exec $VM -- touch "$VM_PATH/app/grpc_gen/__init__.py" 2>$null
# Copy canonical proto file into app build context for Docker protoc generation
if (Test-Path "proto/federation.proto") {
    multipass transfer "proto/federation.proto" "${VM}:${VM_PATH}/app/proto/" 2>$null
} elseif (Test-Path "app/proto/federation.proto") {
    multipass transfer "app/proto/federation.proto" "${VM}:${VM_PATH}/app/proto/" 2>$null
}
if (Test-Path "app/data/federation-registry.json") {
    multipass transfer "app/data/federation-registry.json" "${VM}:${VM_PATH}/app/data/" 2>$null
}
Write-Host "  ✓ FastAPI transferred" -ForegroundColor Green
Write-Host "  → Federation registry & peer discovery..." -ForegroundColor Gray
if (Test-Path "app/federation_registry.py") {
    multipass transfer "app/federation_registry.py" "${VM}:${VM_PATH}/app/" 2>$null
}
if (Test-Path "app/peer_discovery.py") {
    multipass transfer "app/peer_discovery.py" "${VM}:${VM_PATH}/app/" 2>$null
}
Write-Host "  ✓ Federation registry components transferred" -ForegroundColor Green

# Federation service
Write-Host "  → Federation service..." -ForegroundColor Gray
Transfer-Files "federation/*.go" "$VM_PATH/federation"
Transfer-Files "federation/go.mod" "$VM_PATH/federation"
Transfer-Files "federation/go.sum" "$VM_PATH/federation"
Transfer-Files "federation/Dockerfile" "$VM_PATH/federation"
Transfer-Files "federation/internal/kafka/*.go" "$VM_PATH/federation/internal/kafka"
Transfer-Files "federation/internal/server/*.go" "$VM_PATH/federation/internal/server"
Transfer-Files "federation/internal/p2p/*.go" "$VM_PATH/federation/internal/p2p"
Transfer-Files "federation/pkg/federationv1/*.go" "$VM_PATH/federation/pkg/federationv1"
# Copy canonical proto file into federation build context for Docker protoc generation
if (Test-Path "proto/federation.proto") {
    multipass exec $VM -- mkdir -p "$VM_PATH/federation/proto" 2>$null
    multipass transfer "proto/federation.proto" "${VM}:${VM_PATH}/federation/proto/" 2>$null
} elseif (Test-Path "federation/proto/federation.proto") {
    multipass transfer "federation/proto/federation.proto" "${VM}:${VM_PATH}/federation/proto/" 2>$null
}
Write-Host "  ✓ Federation service transferred" -ForegroundColor Green

# Frontend
Write-Host "  → Frontend build..." -ForegroundColor Gray
multipass exec $VM -- bash -c "rm -rf $VM_PATH/frontend/dist/*" 2>$null
Get-ChildItem "frontend/dist" -Recurse | ForEach-Object {
    if ($_.PSIsContainer) {
        $relativePath = $_.FullName.Replace((Get-Item "frontend/dist").FullName, "").TrimStart("\")
        multipass exec $VM -- mkdir -p "$VM_PATH/frontend/dist/$relativePath" 2>$null
    } else {
        $relativePath = $_.FullName.Replace((Get-Item "frontend/dist").FullName, "").TrimStart("\")
        $destPath = "$VM_PATH/frontend/dist/" + (Split-Path -Parent $relativePath)
        multipass transfer $_.FullName "${VM}:${destPath}/" 2>$null
    }
}
Write-Host "  ✓ Frontend transferred" -ForegroundColor Green

# OHIF local viewer config
Write-Host "  → OHIF local viewer config..." -ForegroundColor Gray
if (Test-Path "ohif/nginx.conf") {
    multipass transfer "ohif/nginx.conf" "${VM}:${VM_PATH}/ohif/" 2>$null
}
if (Test-Path "ohif/app-config.js") {
    multipass transfer "ohif/app-config.js" "${VM}:${VM_PATH}/ohif/" 2>$null
}
Write-Host "  ✓ OHIF config transferred" -ForegroundColor Green

# Certificates
Write-Host "  → mTLS certificates..." -ForegroundColor Gray
multipass transfer "certs/ca-cert.pem" "${VM}:${VM_PATH}/certs/" 2>$null
multipass transfer "certs/${HospitalID}-cert.pem" "${VM}:${VM_PATH}/certs/" 2>$null
multipass transfer "certs/${HospitalID}-key.pem" "${VM}:${VM_PATH}/certs/" 2>$null
multipass exec $VM -- chmod 600 "$VM_PATH/certs/*-key.pem" 2>$null
Write-Host "  ✓ Certificates transferred" -ForegroundColor Green

# PostgreSQL scripts
Write-Host "  → PostgreSQL init scripts..." -ForegroundColor Gray
multipass transfer "postgres-config/primary-init.sh" "${VM}:${VM_PATH}/postgres-config/" 2>$null
multipass transfer "postgres-config/replica-init.sh" "${VM}:${VM_PATH}/postgres-config/" 2>$null
Write-Host "  ✓ PostgreSQL scripts transferred" -ForegroundColor Green

# Build optional seed-peer env vars for FastAPI auto-discovery.
# Use stable VM DNS names so hospitals can re-bootstrap after VM restarts.
$peerConfig = ""
if ($Peers) {
  $seedPeers = ($Peers -split ',') |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne '' -and $_ -ne $HospitalID } |
    Select-Object -Unique

  foreach ($peer in $seedPeers) {
    $peerEnvName = $peer.ToUpper().Replace('-', '_')
    $peerConfig += "      - FEDERATION_PEER_${peerEnvName}=${peer}.mshome.net:50051`n"
  }
}

# Generate docker-compose.yml
Write-Host "`n🐳 Generating docker-compose.yml..." -ForegroundColor Yellow

$dockerCompose = @"
version: '3.8'

networks:
  hospital-network:
    driver: bridge

volumes:
  postgres-primary-data:
  postgres-replica1-data:
  postgres-replica2-data:
  prometheus-data:
  fastapi-data:
  federation-data:

services:
  # MinIO Cluster (3 nodes for high availability)
  minio1:
    image: minio/minio:latest
    container_name: minio1
    hostname: minio1
    command: server --console-address ":9001" http://minio1/data http://minio2/data http://minio3/data
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin123
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - ./data/minio1:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - hospital-network
    restart: unless-stopped

  minio2:
    image: minio/minio:latest
    container_name: minio2
    hostname: minio2
    command: server --console-address ":9001" http://minio1/data http://minio2/data http://minio3/data
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin123
    ports:
      - "9010:9000"
      - "9011:9001"
    volumes:
      - ./data/minio2:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - hospital-network
    restart: unless-stopped

  minio3:
    image: minio/minio:latest
    container_name: minio3
    hostname: minio3
    command: server --console-address ":9001" http://minio1/data http://minio2/data http://minio3/data
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin123
    ports:
      - "9020:9000"
      - "9021:9001"
    volumes:
      - ./data/minio3:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - hospital-network
    restart: unless-stopped

  # PostgreSQL Primary Database
  postgres-primary:
    image: postgres:15-alpine
    container_name: postgres-primary
    environment:
      POSTGRES_USER: dfsuser
      POSTGRES_PASSWORD: dfspassword
      POSTGRES_DB: dfs_metadata
    volumes:
      - postgres-primary-data:/var/lib/postgresql/data
      - ./postgres-config/primary-init.sh:/docker-entrypoint-initdb.d/primary-init.sh
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dfsuser"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - hospital-network
    restart: unless-stopped

  # PostgreSQL Replicas (read-only)
  postgres-replica1:
    image: postgres:15-alpine
    container_name: postgres-replica1
    environment:
      POSTGRES_USER: dfsuser
      POSTGRES_PASSWORD: dfspassword
      POSTGRES_DB: dfs_metadata
    volumes:
      - postgres-replica1-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dfsuser"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - hospital-network
    restart: unless-stopped

  postgres-replica2:
    image: postgres:15-alpine
    container_name: postgres-replica2
    environment:
      POSTGRES_USER: dfsuser
      POSTGRES_PASSWORD: dfspassword
      POSTGRES_DB: dfs_metadata
    volumes:
      - postgres-replica2-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dfsuser"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - hospital-network
    restart: unless-stopped

  # Redis Cache
  redis:
    image: redis:7-alpine
    container_name: redis-cache
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - ./data/redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - hospital-network
    restart: unless-stopped

  # Zookeeper (for Kafka)
  zookeeper:
    image: confluentinc/cp-zookeeper:7.0.0
    container_name: zookeeper
    ports:
      - "2181:2181"
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000
    networks:
      - hospital-network
    restart: unless-stopped

  # Kafka Message Queue
  kafka:
    image: confluentinc/cp-kafka:7.0.0
    container_name: kafka
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:29092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    networks:
      - hospital-network
    restart: unless-stopped

  # Federation gRPC Service (mTLS enabled)
  federation:
    build: ./federation
    container_name: federation-grpc
    environment:
      - FEDERATION_GRPC_PORT=50051
      - MINIO1_ENDPOINT=minio1:9000
      - MINIO2_ENDPOINT=minio2:9000
      - MINIO3_ENDPOINT=minio3:9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin123
      - MINIO_BUCKET=dfs-files
      # libp2p configuration
      - HOSPITAL_ID=${HospitalID}
      - HOSPITAL_NAME=${HospitalName}
      - LIBP2P_PORT=4001
      - LIBP2P_EXTERNAL_IP=`${HOST_IP}
      - FASTAPI_HOST=fastapi
      - API_PORT=8000
      - DATA_DIR=/data
      - TLS_CERT_FILE=/certs/${HospitalID}-cert.pem
      - TLS_KEY_FILE=/certs/${HospitalID}-key.pem
      - TLS_CA_FILE=/certs/ca-cert.pem
    ports:
      - "50051:50051"
      - "4001:4001"
    depends_on:
      minio1:
        condition: service_healthy
      minio2:
        condition: service_healthy
      minio3:
        condition: service_healthy
    volumes:
      - ./certs:/certs:ro
      - federation-data:/data
    networks:
      - hospital-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "nc -z localhost 50051 || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 10s

  # FastAPI Application
  fastapi:
    build: ./app
    container_name: fastapi-app
    environment:
      - DATABASE_URL=postgresql://dfsuser:dfspassword@postgres-primary:5432/dfs_metadata
      - DATABASE_REPLICA1_URL=postgresql://dfsuser:dfspassword@postgres-replica1:5432/dfs_metadata
      - DATABASE_REPLICA2_URL=postgresql://dfsuser:dfspassword@postgres-replica2:5432/dfs_metadata
      - REDIS_URL=redis://redis:6379
      - KAFKA_BOOTSTRAP_SERVERS=kafka:29092
      - FEDERATION_GRPC_HOST=federation:50051
      - MINIO1_ENDPOINT=minio1:9000
      - MINIO2_ENDPOINT=minio2:9000
      - MINIO3_ENDPOINT=minio3:9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin123
      - TLS_CERT_FILE=/certs/${HospitalID}-cert.pem
      - TLS_KEY_FILE=/certs/${HospitalID}-key.pem
      - TLS_CA_FILE=/certs/ca-cert.pem
      - HOSPITAL_ID=${HospitalID}
      - HOSPITAL_NAME=${HospitalName}
      - API_PORT=8000
      - PEER_DISCOVERY_INTERVAL=120
      - HOST_IP=`${HOST_IP}
${peerConfig}
    ports:
      - "8000:8000"
      - "5000:8000"
    depends_on:
      kafka:
        condition: service_started
      federation:
        condition: service_started
      postgres-primary:
        condition: service_healthy
      postgres-replica1:
        condition: service_healthy
      postgres-replica2:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio1:
        condition: service_healthy
      minio2:
        condition: service_healthy
      minio3:
        condition: service_healthy
    volumes:
      - ./certs:/certs:ro
      - ./frontend/dist:/app/frontend/dist:ro
      - fastapi-data:/app/data
    networks:
      - hospital-network
    restart: unless-stopped

  # Local OHIF Viewer
  ohif:
    image: ohif/viewer:latest
    container_name: ohif-viewer
    depends_on:
      - fastapi
    ports:
      - "8042:80"
    volumes:
      - ./ohif/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./ohif/app-config.js:/usr/share/nginx/html/app-config.js:ro
    networks:
      - hospital-network
    restart: unless-stopped

  # Nginx Reverse Proxy
  nginx:
    image: nginx:alpine
    container_name: nginx-proxy
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - fastapi
    networks:
      - hospital-network
    restart: unless-stopped

  # Prometheus (optional monitoring)
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    volumes:
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"
    networks:
      - hospital-network
    restart: unless-stopped
"@

$tempFile = [System.IO.Path]::GetTempFileName()
$dockerCompose | Out-File -FilePath $tempFile -Encoding UTF8
multipass transfer $tempFile "${VM}:${VM_PATH}/docker-compose.yml" 2>$null
# Convert to Unix line endings
multipass exec $VM -- bash -c "sed -i 's/\r$//' '$VM_PATH/docker-compose.yml'" 2>$null
Remove-Item $tempFile
Write-Host "✓ docker-compose.yml generated" -ForegroundColor Green

# Generate nginx configuration
Write-Host "`n🌐 Generating nginx configuration..." -ForegroundColor Yellow
$nginxConf = @'
events {
    worker_connections 2048;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format detailed '$remote_addr - $remote_user [$time_local] '
                       '"$request" $status $body_bytes_sent '
                       '"$http_referer" "$http_user_agent" '
                       'rt=$request_time';
    
    access_log /var/log/nginx/access.log detailed;
    error_log /var/log/nginx/error.log warn;

    # Performance tuning
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;

    # Buffer sizes
    client_body_buffer_size 128k;
    client_max_body_size 500M;  # For large medical images
    client_header_buffer_size 1k;
    large_client_header_buffers 4 16k;

    # Timeouts
    client_body_timeout 60s;
    client_header_timeout 60s;
    send_timeout 60s;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript 
               application/x-javascript application/javascript 
               application/xml+rss application/json application/xml;

    upstream fastapi_backend {
        server fastapi:8000 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }

    server {
        listen 80 default_server;
        server_name _;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        # API endpoints
        location /api/ {
            proxy_pass http://fastapi_backend;
            
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection "";
            
            # Timeouts for large file uploads
            proxy_connect_timeout 600s;
            proxy_send_timeout 600s;
            proxy_read_timeout 600s;
            send_timeout 600s;
            
            # Buffering
            proxy_buffering on;
            proxy_buffer_size 4k;
            proxy_buffers 8 4k;
            proxy_busy_buffers_size 8k;
        }

        # Docs
        location /docs {
            proxy_pass http://fastapi_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # Static frontend files
        location / {
            proxy_pass http://fastapi_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        # Health check
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }

        # Metrics endpoint
        location /metrics {
            proxy_pass http://fastapi_backend;
            access_log off;
        }
    }
}
'@

$tempFile = [System.IO.Path]::GetTempFileName()
# Write with UTF8 encoding without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($tempFile, $nginxConf, $utf8NoBom)
multipass transfer $tempFile "${VM}:${VM_PATH}/nginx/nginx.conf" 2>$null
# Convert to Unix line endings
multipass exec $VM -- bash -c "dos2unix '$VM_PATH/nginx/nginx.conf' 2>/dev/null || sed -i 's/\r$//' '$VM_PATH/nginx/nginx.conf'" 2>$null
Remove-Item $tempFile
Write-Host "✓ nginx configuration generated" -ForegroundColor Green

# Create startup script
Write-Host "`n🚀 Creating startup script..." -ForegroundColor Yellow
$startScript = @"
#!/bin/bash
set -e

echo "=========================================="
echo "🏥 Starting ${HospitalName}"
echo "=========================================="
echo ""

cd ${VM_PATH}

# ── Resolve HOST_IP dynamically (survives VM restart) ──
export HOST_IP=`$(hostname -I | awk '{print `$1}')
echo "🌐 Detected HOST_IP: `$HOST_IP"

# Write HOST_IP to .env so docker-compose picks it up
echo "HOST_IP=`$HOST_IP" > .env
echo "✓ HOST_IP written to .env"

# ── Update /etc/hosts for local DNS resolution ──
# Remove stale hospital entries, then add current ones
sudo sed -i '/\.local\$/d' /etc/hosts

# Add our own hostname
echo "`$HOST_IP ${HospitalID}.local" | sudo tee -a /etc/hosts > /dev/null
echo "✓ Added ${HospitalID}.local -> `$HOST_IP to /etc/hosts"

# ── Dynamically resolve peer IPs from peers.conf ──
# peers.conf is written by deploy.ps1 with peer VM names.
# We resolve their CURRENT IPs here so that stale deploy-time IPs don't break federation.
rm -f docker-compose.override.yml

if [ -f peers.conf ]; then
    echo "🔍 Resolving peer IPs dynamically..."
    EXTRA_HOSTS=""
    while IFS= read -r PEER_ID || [ -n "`$PEER_ID" ]; do
        if [ -z "`$PEER_ID" ]; then continue; fi
        PEER_IP=""
        # Method 1: multipass internal DNS (dnsmasq on virtual bridge)
        PEER_IP=`$(getent hosts "`$PEER_ID" 2>/dev/null | awk '{print `$1}')
        # Method 2: .local from /etc/hosts (may have been set by deploy.ps1)
        if [ -z "`$PEER_IP" ]; then PEER_IP=`$(getent hosts "`${PEER_ID}.local" 2>/dev/null | awk '{print `$1}'); fi
        # Method 3: .mshome.net (Windows Hyper-V multipass DNS)
        if [ -z "`$PEER_IP" ]; then PEER_IP=`$(getent hosts "`${PEER_ID}.mshome.net" 2>/dev/null | awk '{print `$1}'); fi

        if [ -n "`$PEER_IP" ]; then
            echo "  ✓ `$PEER_ID -> `$PEER_IP"
            sudo sed -i "/`${PEER_ID}\.local/d" /etc/hosts
            echo "`$PEER_IP `${PEER_ID}.local" | sudo tee -a /etc/hosts > /dev/null
            EXTRA_HOSTS="`${EXTRA_HOSTS}      - \"`${PEER_ID}.local:`${PEER_IP}\"\n"
        else
            echo "  ⚠ Could not resolve `$PEER_ID (peer VM may be stopped)"
        fi
    done < peers.conf

    # Generate docker-compose.override.yml so containers can resolve peer hostnames
    if [ -n "`$EXTRA_HOSTS" ]; then
        printf 'version: "3.8"\nservices:\n  fastapi:\n    extra_hosts:\n' > docker-compose.override.yml
        echo -e "`$EXTRA_HOSTS" >> docker-compose.override.yml
        echo "✓ docker-compose.override.yml generated with peer DNS mappings"
    fi
else
    echo "ℹ No peers.conf found — skipping dynamic peer resolution"
fi

# Install Docker if needed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker ubuntu
    newgrp docker
    rm get-docker.sh
    echo "✓ Docker installed"
fi

# Resolve compose command (prefer Docker Compose plugin)
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE_CMD="docker-compose"
else
  echo "📦 Installing Docker Compose..."
  COMPOSE_VERSION=v2.24.0
  ARCH=`$(uname -m)`
  sudo curl -L "https://github.com/docker/compose/releases/download/`${COMPOSE_VERSION}/docker-compose-`$(uname -s)-`${ARCH}" -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
  COMPOSE_CMD="docker-compose"
  echo "✓ Docker Compose installed"
fi

compose() {
  if [ "`$COMPOSE_CMD" = "docker compose" ]; then
    sudo docker compose "`$@"
  else
    sudo docker-compose "`$@"
  fi
}

echo "✓ Using Compose command: `$COMPOSE_CMD"

# Stop existing services
echo "🛑 Stopping existing services..."
compose down 2>/dev/null || true

# Build images
echo ""
echo "🔨 Building Docker images..."
echo "   This may take 10-15 minutes on first run..."
BUILD_OK=0
for ATTEMPT in 1 2 3; do
  if [ `$ATTEMPT -gt 1 ]; then
    echo "   ↻ Build retry `$ATTEMPT/3 (waiting 12s)..."
    sleep 12
  fi
  if compose build --pull; then
    BUILD_OK=1
    break
  fi
done

# Fallback: use local cache if registry pull is temporarily unavailable
if [ `$BUILD_OK -ne 1 ]; then
  echo "   ⚠ Build with --pull failed, retrying without --pull..."
  if compose build; then
    BUILD_OK=1
  fi
fi

# Ensure required custom images exist before starting services.
if [ `$BUILD_OK -ne 1 ] || ! sudo docker image inspect medimage-federation:latest >/dev/null 2>&1 || ! sudo docker image inspect medimage-fastapi:latest >/dev/null 2>&1; then
  echo "❌ Docker image build failed (federation/fastapi images unavailable)."
  echo "   This is usually a transient Docker Hub connectivity issue."
  exit 1
fi

# Start services
echo ""
echo "🚀 Starting services..."
compose up -d

# Wait for health checks
echo ""
echo "⏳ Waiting for services to be healthy (60s)..."
sleep 60

# Auto self-register in federation after services are healthy
echo ""
echo "🔗 Auto-registering in federation..."
curl -s -X POST "http://localhost/api/federation/registry/self-register" -o /dev/null && echo "  ✓ Self-registered" || echo "  (self-register will retry on next discovery cycle)"

# Seed default users (admin + doctor)
echo ""
echo "👤 Seeding default users..."
SEED_RESULT=`$(curl -sf -X POST "http://localhost:8000/api/auth/seed" 2>/dev/null || true)
if [ -n "`$SEED_RESULT" ]; then
    echo "`$SEED_RESULT" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    for u in d.get('users',[]):
        print(f\"  ✓ {u['role']:8s} {u['email']} ({u['status']})\")
except: print('  (could not parse seed response)')
" 2>/dev/null
else
    echo "  ⚠ Seed request failed (API may not be ready yet)"
fi

# Give peers a moment to come up then trigger discovery
sleep 5
echo "🔍 Triggering peer discovery..."
curl -s -X POST "http://localhost/api/federation/registry/discover-now" -o /dev/null && echo "  ✓ Discovery complete" || echo "  (discovery will retry automatically)"

# ── libp2p peer bootstrap ──
# Disable set -e for bootstrap — [ ] && continue returns 1 and kills the script
set +e
echo ""
echo "🔗 Bootstrapping libp2p peers..."
BOOTSTRAP_SUCCESS=0
if [ -f peers.conf ]; then
    # Retry loop — peer VMs may still be starting
    for ATTEMPT in 1 2 3; do
        if [ `$ATTEMPT -gt 1 ]; then
            echo "  ↻ Retry attempt `$ATTEMPT/3 (waiting 15s)..."
            sleep 15
        fi
        while IFS= read -r PEER_ID || [ -n "`$PEER_ID" ]; do
            if [ -z "`$PEER_ID" ]; then continue; fi

            PEER_IP=""
            PEER_IP=`$(getent hosts "`$PEER_ID" 2>/dev/null | awk '{print `$1}')
            if [ -z "`$PEER_IP" ]; then
                PEER_IP=`$(getent hosts "`${PEER_ID}.local" 2>/dev/null | awk '{print `$1}')
            fi
            if [ -z "`$PEER_IP" ]; then
                PEER_IP=`$(getent hosts "`${PEER_ID}.mshome.net" 2>/dev/null | awk '{print `$1}')
            fi

            if [ -n "`$PEER_IP" ]; then
                echo "  Fetching peer-id from `$PEER_ID (`$PEER_IP)..."
                PEER_INFO=`$(curl -sf "http://`${PEER_IP}:8000/api/federation/node/info" 2>/dev/null || true)
                if [ -n "`$PEER_INFO" ]; then
                    REMOTE_PEER_ID=`$(echo "`$PEER_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('peer_id',''))" 2>/dev/null)
                    if [ -n "`$REMOTE_PEER_ID" ]; then
                        MULTIADDR="/ip4/`${PEER_IP}/tcp/4001/p2p/`${REMOTE_PEER_ID}"
                        echo "  Adding peer: `$MULTIADDR"
                        RESULT=`$(curl -sf -X POST "http://localhost:8000/api/federation/peers/add" \
                            -H "Content-Type: application/json" \
                            -d "[\"`$MULTIADDR\"]" 2>/dev/null || true)
                      ADD_OK=`$(echo "`$RESULT" | python3 -c "import sys,json
          try:
            d=json.load(sys.stdin)
            print('1' if d.get('success') else '0')
          except Exception:
            print('0')" 2>/dev/null)
                      if [ "`$ADD_OK" = "1" ]; then
                            echo "  ✓ Connected to `$PEER_ID via libp2p"
                            BOOTSTRAP_SUCCESS=1
                        else
                        ADD_MSG=`$(echo "`$RESULT" | python3 -c "import sys,json
          try:
            d=json.load(sys.stdin)
            print(d.get('message',''))
          except Exception:
            print('')" 2>/dev/null)
                        if [ -n "`$ADD_MSG" ]; then
                          echo "  ⚠ libp2p connect to `$PEER_ID failed: `$ADD_MSG"
                        else
                          echo "  ⚠ libp2p connect to `$PEER_ID failed: `$RESULT"
                        fi
                        fi
                    else
                        echo "  ⚠ No peer_id from `$PEER_ID"
                    fi
                else
                    echo "  ⚠ `$PEER_ID not reachable yet"
                fi
            else
                echo "  ⚠ Could not resolve `$PEER_ID"
            fi
        done < peers.conf

        # If we connected to at least one peer, peer exchange will discover the rest
        if [ `$BOOTSTRAP_SUCCESS -eq 1 ]; then break; fi
    done

    if [ `$BOOTSTRAP_SUCCESS -eq 1 ]; then
        echo "  ✓ Bootstrap complete — peer exchange will discover remaining peers"
    else
        echo "  ⚠ No peers reachable yet — they will connect when they start"
    fi
else
    echo "  ℹ No peers.conf — skipping libp2p bootstrap"
fi
set -e

# Show status
echo ""
echo "📊 Service Status:"
compose ps

echo ""
echo "=========================================="
echo "✅ ${HospitalName} Started Successfully!"
echo "=========================================="
echo ""

# Get VM IP
VM_IP=`$HOST_IP

echo "🌐 Access Points:"
echo "   Web UI:       http://`${VM_IP}"
echo "   API:          http://`${VM_IP}/api"
echo "   API Docs:     http://`${VM_IP}/docs"
echo "   Federation:   `${VM_IP}:50051"
echo "   libp2p:       `${VM_IP}:4001"
echo "   MinIO:        http://`${VM_IP}:9001"
echo "   Prometheus:   http://`${VM_IP}:9090"
echo "   DICOM Viewer: http://`${VM_IP}/dicom-viewer"
echo "   OHIF Local:   http://`${VM_IP}:8042/viewer"
echo ""
echo "🔐 Security:"
echo "   mTLS Enabled: Yes (TLS 1.3)"
echo "   libp2p:       Noise encryption"
echo "   Certificate:  ${HospitalID}-cert.pem"
echo ""
echo "👤 Default Users:"
echo "   Admin:   admin@${HospitalID}.local / admin123"
echo "   Doctor:  doctor@${HospitalID}.local / doctor123"
echo ""
echo "🔗 libp2p Node Info:"
curl -sf "http://localhost:8000/api/federation/node/info" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f\"   Peer ID:      {d.get('peer_id','unknown')}\")
    for a in d.get('listen_addrs', []):
        print(f\"   Listen:       {a}\")
except: print('   (not available yet)')
" 2>/dev/null || echo "   (node info not available yet)"
echo ""
echo "Federation Registry:"
echo "   Registry:     http://`${VM_IP}/api/federation/registry/list"
echo "   Self-Register: curl -X POST http://`${VM_IP}/api/federation/registry/self-register"
echo "   Discover Now: curl -X POST http://`${VM_IP}/api/federation/registry/discover-now"
echo "   Auto-discovery runs every 5 minutes"
echo ""
echo "Useful Commands:"
echo "   Compose: sudo `$COMPOSE_CMD"
echo "   Logs:    sudo `$COMPOSE_CMD logs -f [service]"
echo "   Restart: sudo `$COMPOSE_CMD restart [service]"
echo "   Stop:    sudo `$COMPOSE_CMD down"
echo ""
"@

$tempFile = [System.IO.Path]::GetTempFileName()
# Write with UTF8 encoding without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($tempFile, $startScript, $utf8NoBom)
multipass transfer $tempFile "${VM}:${VM_PATH}/start.sh" 2>$null
# Convert to Unix line endings and make executable
multipass exec $VM -- bash -c "dos2unix '$VM_PATH/start.sh' 2>/dev/null || sed -i 's/\r$//' '$VM_PATH/start.sh'" 2>$null
multipass exec $VM -- chmod +x "$VM_PATH/start.sh" 2>$null
Remove-Item $tempFile
Write-Host "✓ Startup script created" -ForegroundColor Green

# Generate peers.conf (libp2p seed peers for bootstrap)
if ($Peers) {
    Write-Host "`n🔗 Generating peers.conf..." -ForegroundColor Yellow
    $peerList = ($Peers -split ',') |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne '' -and $_ -ne $HospitalID } |
        Select-Object -Unique

    if ($peerList.Count -gt 0) {
      $peersContent = ($peerList -join "`n") + "`n"
      $peersFile = [System.IO.Path]::GetTempFileName()
      $utf8NoBom = New-Object System.Text.UTF8Encoding $false
      [System.IO.File]::WriteAllText($peersFile, $peersContent.Replace("`r`n", "`n"), $utf8NoBom)
      multipass transfer $peersFile "${VM}:${VM_PATH}/peers.conf" 2>$null
      multipass exec $VM -- bash -c "sed -i 's/\r$//' '$VM_PATH/peers.conf'" 2>$null
      Remove-Item $peersFile
      Write-Host "  Seed peers: $($peerList -join ', ')" -ForegroundColor Gray
      Write-Host "  ✓ peers.conf generated (peer exchange will discover the rest)" -ForegroundColor Green
    } else {
        Write-Host "  ℹ No valid external peers after filtering; skipping peers.conf" -ForegroundColor Gray
    }
} else {
    Write-Host "`nℹ No -Peers specified — skipping peers.conf (standalone node)" -ForegroundColor Gray
}

Write-Host "`n" + ("=" * 70) -ForegroundColor Cyan
Write-Host "✅ Deployment Package Ready!" -ForegroundColor Green
Write-Host ("=" * 70) -ForegroundColor Cyan
Write-Host ""
Write-Host "📦 Files transferred to VM:$VM" -ForegroundColor Yellow
Write-Host "   Path: $VM_PATH" -ForegroundColor Gray
Write-Host ""
Write-Host "🚀 To start services, run:" -ForegroundColor Yellow
Write-Host "   multipass exec $VM -- sudo bash $VM_PATH/start.sh" -ForegroundColor White
Write-Host ""
Write-Host "Or use the Makefile:" -ForegroundColor Yellow
Write-Host "   make -f Makefile.$HospitalID start" -ForegroundColor White
Write-Host ""
