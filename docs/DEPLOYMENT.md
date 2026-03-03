# Production Deployment Guide

This guide covers deploying the Medical Image Storage and Federation System to multipass VMs as complete, production-ready environments.

## Overview

Each hospital VM is deployed as a **self-contained, production-ready system** with:
- ✅ Complete application stack (FastAPI, Federation, MinIO, PostgreSQL, Redis, Kafka)
- ✅ Nginx reverse proxy for professional web server
- ✅ mTLS-secured federation with TLS 1.3
- ✅ High availability (3-node MinIO cluster, PostgreSQL replicas)
- ✅ Monitoring (Prometheus)
- ✅ Automated build and deployment scripts
- ✅ Health checks and automatic restarts

## Prerequisites

1. **Multipass installed**:
   ```powershell
   winget install Canonical.Multipass
   ```

2. **VMs created**:
   ```powershell
   multipass launch --name hospital-a --cpus 4 --memory 8G --disk 40G
   multipass launch --name hospital-b --cpus 4 --memory 8G --disk 40G
   ```

3. **mTLS certificates generated**:
   ```powershell
   .\scripts\generate-mtls-certs.ps1
   ```

## Quick Start

### Deploy Both Hospitals (Recommended)
```powershell
# Complete automated deployment with service startup
.\scripts\deploy-hospitals.ps1 -Both -Start

# Or use Makefiles
make -f Makefile.hospital-a all
make -f Makefile.hospital-b all
```

### Deploy Individual Hospital
```powershell
# Hospital A only
.\scripts\deploy-hospitals.ps1 -HospitalA -Start

# Hospital B only
.\scripts\deploy-hospitals.ps1 -HospitalB -Start
```

### Clean Deployment
```powershell
# Remove existing deployment and redeploy
.\scripts\deploy-hospitals.ps1 -Both -Clean -Start
```

## Deployment Architecture

### Hospital A
```
VM: hospital-a (Ubuntu 22.04)
├── Nginx (Port 80) → Reverse Proxy
├── FastAPI (Port 8000) → Application Server
├── Federation gRPC (Port 50051) → mTLS Secured
├── MinIO Cluster (Ports 9000, 9010, 9020) → Object Storage
├── PostgreSQL Primary + 2 Replicas (Port 5432) → Database
├── Redis (Port 6379) → Cache
├── Kafka + Zookeeper → Message Queue
└── Prometheus (Port 9090) → Monitoring
```

### Hospital B
Same architecture, configured as peer to Hospital A

## Makefile Commands

### Hospital A
```bash
make -f Makefile.hospital-a help      # Show all commands
make -f Makefile.hospital-a build     # Build frontend locally
make -f Makefile.hospital-a deploy    # Deploy to VM
make -f Makefile.hospital-a start     # Start services
make -f Makefile.hospital-a stop      # Stop services
make -f Makefile.hospital-a restart   # Restart services
make -f Makefile.hospital-a logs      # View logs (follow)
make -f Makefile.hospital-a status    # Check service status
make -f Makefile.hospital-a shell     # SSH into VM
make -f Makefile.hospital-a clean     # Clean deployment
make -f Makefile.hospital-a all       # Full deployment
```

### Hospital B
```bash
make -f Makefile.hospital-b [command]
```

## Manual Commands

### View Logs
```powershell
# All services
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs -f

# Specific service
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs -f fastapi
```

### Check Status
```powershell
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml ps
```

### Restart Service
```powershell
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml restart fastapi
```

### SSH Into VM
```powershell
multipass shell hospital-a
```

### Stop All Services
```powershell
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml down
```

### Restart All Services
```powershell
multipass exec hospital-a -- sudo bash /home/ubuntu/medimage/start.sh
```

## Accessing Services

After deployment, get VM IPs:
```powershell
multipass list
```

### Hospital A Example (IP: 192.168.64.10)
- **Web UI**: http://192.168.64.10
- **API**: http://192.168.64.10/api
- **API Docs**: http://192.168.64.10/docs
- **Federation**: 192.168.64.10:50051
- **MinIO Console**: http://192.168.64.10:9001 (minioadmin/minioadmin123)
- **Prometheus**: http://192.168.64.10:9090

### Hospital B Example (IP: 192.168.64.11)
Same ports as Hospital A

## Deployment Process Details

### What Gets Deployed

1. **Application Code**:
   - FastAPI backend (all Python files)
   - Frontend build (dist/)
   - Federation Go service (all Go files)
   - PostgreSQL init scripts

2. **Configuration**:
   - docker-compose.yml (hospital-specific)
   - nginx.conf (optimized reverse proxy)
   - Environment variables (mTLS, hospital ID, peer endpoints)

3. **Security**:
   - mTLS certificates (CA + hospital certificates)
   - Proper file permissions (600 for private keys)
   - Security headers in nginx

4. **Infrastructure**:
   - Docker and Docker Compose (auto-installed if missing)
   - Data directories for persistent storage
   - Startup scripts for automated deployment

### Build Process on VM

When you run `start.sh` on the VM:

1. **Install Dependencies**:
   - Docker (if not present)
   - Docker Compose (if not present)

2. **Build Images**:
   - Federation service (Go build)
   - FastAPI application (Python dependencies)

3. **Start Services**:
   - Start all containers with docker-compose
   - Wait for health checks
   - Display service status

4. **Verify**:
   - Show service URLs
   - Display security status
   - Provide management commands

## Differences from Local Development

| Aspect | Local Development | Production VM |
|--------|------------------|---------------|
| **Frontend** | Hot reload (npm run dev) | Production build served by FastAPI |
| **Reverse Proxy** | Direct access to :8000 | Nginx on port 80 |
| **mTLS** | Optional | Enabled by default |
| **Volumes** | Local directories | Named Docker volumes |
| **Networking** | Host network | Bridge network |
| **Federation** | Single instance | Peer-to-peer with other hospitals |
| **Restarts** | Manual | Automatic (unless-stopped) |
| **Logs** | Console | Docker logs |

## Production Best Practices

### Security
✅ mTLS enabled with TLS 1.3
✅ Private keys have restricted permissions (600)
✅ Security headers configured in nginx
✅ No default passwords (change in production!)

### Reliability
✅ Health checks on all services
✅ Automatic restart policies
✅ 3-node MinIO cluster for HA
✅ PostgreSQL replicas for read scaling

### Performance
✅ Nginx gzip compression enabled
✅ Connection pooling configured
✅ Redis caching enabled
✅ Optimized buffer sizes for large files

### Monitoring
✅ Prometheus metrics collection
✅ Nginx access logs (detailed format)
✅ Docker container logs
✅ Health check endpoints

## Troubleshooting

### VM Not Starting
```powershell
# Check VM status
multipass list

# View VM info
multipass info hospital-a

# Restart VM
multipass restart hospital-a
```

### Services Not Healthy
```powershell
# Check service logs
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs

# Check specific service
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs fastapi
```

### Federation Not Connecting
```powershell
# Check mTLS certificates
multipass exec hospital-a -- ls -la /home/ubuntu/medimage/certs/

# Check federation logs
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs federation

# Test peer connectivity
multipass exec hospital-a -- ping hospital-b.local
```

### Disk Space Issues
```powershell
# Check disk usage
multipass exec hospital-a -- df -h

# Clean Docker resources
multipass exec hospital-a -- sudo docker system prune -a

# Increase disk size
.\scripts\increase-vm-disk.ps1
```

### Port Conflicts
If you get port conflicts, check what's using the ports:
```powershell
multipass exec hospital-a -- sudo netstat -tlnp | grep ':80\|:8000\|:50051'
```

## Updating Deployment

### Update Code Only
```powershell
# Rebuild and redeploy
.\scripts\deploy-hospitals.ps1 -HospitalA

# Restart services
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml restart
```

### Update with Clean Build
```powershell
# Clean and redeploy
.\scripts\deploy-hospitals.ps1 -HospitalA -Clean -Start
```

### Rolling Update (No Downtime)
```powershell
# Deploy new version
.\scripts\deploy-hospitals.ps1 -HospitalA

# Rebuild specific service
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml build fastapi

# Rolling restart
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml up -d fastapi
```

## Backup and Restore

### Backup Data
```powershell
# Backup PostgreSQL
multipass exec hospital-a -- sudo docker exec postgres-primary pg_dump -U dfsuser dfs_metadata > backup.sql

# Backup MinIO data
multipass exec hospital-a -- sudo tar -czf minio-backup.tar.gz /home/ubuntu/medimage/data/minio*
```

### Restore Data
```powershell
# Restore PostgreSQL
cat backup.sql | multipass exec hospital-a -- sudo docker exec -i postgres-primary psql -U dfsuser dfs_metadata

# Restore MinIO
multipass transfer minio-backup.tar.gz hospital-a:/tmp/
multipass exec hospital-a -- sudo tar -xzf /tmp/minio-backup.tar.gz -C /
```

## Performance Tuning

### VM Resources
```powershell
# Stop VM
multipass stop hospital-a

# Resize (if needed)
multipass set local.hospital-a.cpus=6
multipass set local.hospital-a.memory=12G
multipass set local.hospital-a.disk=60G

# Start VM
multipass start hospital-a
```

### Docker Resources
Edit `/home/ubuntu/medimage/docker-compose.yml` on VM and add:
```yaml
services:
  fastapi:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

## Maintenance

### Regular Tasks
- **Weekly**: Check logs for errors
- **Monthly**: Update Docker images
- **Quarterly**: Review and clean old data
- **Yearly**: Rotate mTLS certificates (if needed)

### Health Check Script
```powershell
# Check both hospitals
multipass exec hospital-a -- curl -s http://localhost/health
multipass exec hospital-b -- curl -s http://localhost/health
```

## Support

For issues:
1. Check service logs: `make -f Makefile.hospital-a logs`
2. Verify service status: `make -f Makefile.hospital-a status`
3. Review this guide
4. Check main README.md for application-specific issues

---

**Production Ready**: This deployment system creates complete, self-contained hospital systems suitable for production use with proper security, monitoring, and high availability configurations.
