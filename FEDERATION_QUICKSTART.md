# Federation Network - Quick Start Guide

## 🏥 Complete Hospital System Architecture

Each VM runs a **fully independent hospital system** with:
- FastAPI REST API & Web UI (port 8000)
- PostgreSQL database (port 5432)
- MinIO 3-node cluster (ports 9000-9003)
- Redis cache (port 6379)
- Kafka event streaming (port 9092)
- Federation gRPC server (port 50051)
- Grafana monitoring (port 3001)
- Prometheus metrics (port 9090)

## Current Status

✅ **Completed:**
- Main platform development complete
- UI with light/dark themes
- Patient-oriented upload queue
- Two multipass VMs ready:
  - hospital-a (172.29.136.54)
  - hospital-b (172.29.140.113)
- Docker installed on both VMs
- Hospital-specific configurations created
- Deployment & testing scripts ready

🔄 **Next Step:**
- Deploy complete hospital systems to VMs
- Test cross-hospital file exchange

## Quick Commands

### Deploy Complete Hospital Systems

```powershell
# Deploy Hospital A (Full Stack)
cd scripts
.\deploy-hospital-a.ps1

# Deploy Hospital B (Full Stack)
.\deploy-hospital-b.ps1
```

### Check Status

```powershell
# List VMs
multipass list

### Check Hospital Status

```powershell
# Automated health check script
.\scripts\check-hospitals.ps1

# Manual checks
# List VMs
multipass list

# Check all Hospital A containers
multipass exec hospital-a -- docker ps

# Check all Hospital B containers
multipass exec hospital-b -- docker ps

# View specific service logs
multipass exec hospital-a -- docker compose logs -f fastapi
multipass exec hospital-a -- docker compose logs -f federation
multipass exec hospital-a -- docker compose logs -f minio1
```

### Test Cross-Hospital File Exchange

```powershell
# Automated federation test (recommended)
.\scripts\test-federation.ps1

# Manual test commands available in the automated script
```

## Service URLs

### Hospital A (172.29.136.54)
- **API**: http://172.29.136.54:8000
- **API Docs**: http://172.29.136.54:8000/docs
- **MinIO Console**: http://172.29.136.54:9001 (minioadmin/minioadmin123)
- **Grafana**: http://172.29.136.54:3001 (admin/admin)
- **gRPC**: 172.29.136.54:50051

### Hospital B (172.29.140.113)
- **API**: http://172.29.140.113:8000
- **API Docs**: http://172.29.140.113:8000/docs
- **MinIO Console**: http://172.29.140.113:9001 (minioadmin/minioadmin123)
- **Grafana**: http://172.29.140.113:3001 (admin/admin)
- **gRPC**: 172.29.140.113:50051

### Local Development
- API: http://localhost:8000
- Frontend: http://localhost:3000 (when running Vite dev server)
- MinIO: http://localhost:9001-9003 (three nodes)
- Grafana: http://localhost:3001

## Troubleshooting

### Docker not installed
```powershell
# Manually install Docker on VM
multipass exec hospital-a -- bash -c 'curl -fsSL https://get.docker.com -o get-docker.sh'
multipass exec hospital-a -- bash -c 'sudo sh get-docker.sh'
multipass exec hospital-a -- bash -c 'sudo usermod -aG docker ubuntu'
```

### Services not starting
```powershell
multipass exec hospital-a -- docker compose logs
multipass exec hospital-a -- docker compose restart
```

### Services not starting
```powershell
# Check container status
multipass exec hospital-a -- docker compose ps

# View service logs
multipass exec hospital-a -- docker compose logs fastapi
multipass exec hospital-a -- docker compose logs federation
multipass exec hospital-a -- docker compose logs postgres

# Restart all services
multipass exec hospital-a -- docker compose restart

# Full rebuild if needed
multipass exec hospital-a -- docker compose down
multipass exec hospital-a -- docker compose up -d --build
```

### Network connectivity issues
```powershell
# Test VM-to-VM connectivity
multipass exec hospital-a -- ping -c 3 172.29.140.113
multipass exec hospital-b -- ping -c 3 172.29.136.54

# Check gRPC port accessibility
multipass exec hospital-a -- nc -zv 172.29.140.113 50051
multipass exec hospital-b -- nc -zv 172.29.136.54 50051

# Check if federation service is listening
multipass exec hospital-a -- docker compose exec federation netstat -tuln | grep 50051
```

### Database connection issues
```powershell
# Check PostgreSQL status
multipass exec hospital-a -- docker compose logs postgres

# Verify database initialization
multipass exec hospital-a -- docker compose exec postgres psql -U medimage -d medimage_db -c "\\dt"

# Restart database and dependent services
multipass exec hospital-a -- docker compose restart postgres fastapi
```

### Reset Hospital System
```powershell
# Stop and remove all containers, volumes
multipass exec hospital-a -- docker compose down -v

# Redeploy
.\scripts\deploy-hospital-a.ps1
```

### Reset VM Completely
```powershell
multipass stop hospital-a
multipass delete hospital-a
multipass purge
# Then re-run VM creation from setup.ps1
```

## Deployment Workflow

1. ✅ **VMs Ready**: Both hospital VMs created with Docker installed
2. 🔄 **Deploy Systems**: Run `.\scripts\deploy-hospital-a.ps1` and `.\scripts\deploy-hospital-b.ps1`
3. ⏳ **Verify Health**: Run `.\scripts\check-hospitals.ps1` to verify all services
4. ⏳ **Test Federation**: Run `.\scripts\test-federation.ps1` for end-to-end testing
5. ⏳ **Monitor**: Use Grafana dashboards and logs to monitor operations

## Default Credentials

- **Admin Account**: admin@example.com / admin
- **MinIO**: minioadmin / minioadmin123
- **PostgreSQL**: medimage / medimage123
- **Grafana**: admin / admin

## Security Notes

⚠️ **Before Production:**
- Change all default passwords
- Configure SSL/TLS certificates
- Set up VPN or secure network between hospitals
- Enable proper authentication on all services
- Review and harden security configurations
- Implement proper backup and disaster recovery
- Ensure DPA/GDPR compliance audit

## Documentation

- **Quick Start**: This file
- **Full Federation Setup**: `docs/federation-setup.md`
- **Architecture**: `README.md`
- **Patient-Centered Design**: `DPA_PATIENT_CENTERED_IMPLEMENTATION.md`
- **Testing Guide**: `docs/testing.md`
- **Migration Guide**: `docs/migrations.md`
