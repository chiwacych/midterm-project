# Deployment Scripts

Streamlined scripts for deploying hospitals to multipass VMs.

## Quick Start

```powershell
# Deploy Hospital A and start services
.\scripts\deploy.ps1 -Hospital hospital-a -Start

# Deploy Hospital B with clean slate
.\scripts\deploy.ps1 -Hospital hospital-b -Clean -Start

# Deploy both hospitals
.\scripts\deploy.ps1 -Hospital both -Start
```

## Main Scripts

### 🚀 deploy.ps1 (PRIMARY - USE THIS)
**Unified deployment script for all hospitals.**

Single entry point for deploying any hospital independently. Replaces the old separate scripts.

**Usage:**
```powershell
.\scripts\deploy.ps1 [-Hospital <name>] [-Clean] [-Start] [-SkipBuild]
```

**Parameters:**
- `-Hospital` - Which hospital: `hospital-a`, `hospital-b`, or `both` (default: hospital-a)
- `-Clean` - Clean VM before deployment (removes all data)
- `-Start` - Start services automatically after deployment
- `-SkipBuild` - Skip frontend build (faster redeployment)

**Examples:**
```powershell
# Deploy Hospital A (minimal)
.\scripts\deploy.ps1

# Deploy and start
.\scripts\deploy.ps1 -Hospital hospital-a -Start

# Fresh deployment with cleanup
.\scripts\deploy.ps1 -Hospital hospital-b -Clean -Start

# Deploy both hospitals
.\scripts\deploy.ps1 -Hospital both -Start

# Quick redeploy without frontend rebuild
.\scripts\deploy.ps1 -SkipBuild -Start
```

### ⚙️ deploy-to-vm.ps1 (INTERNAL)
**Core deployment engine called by deploy.ps1.**

Handles actual file transfer, docker-compose generation, and VM configuration. Not meant to be called directly unless you need custom deployment parameters.

## Deprecated Scripts (Can be removed)

These scripts are redundant with the new unified deploy.ps1:

- ❌ `deploy-hospitals.ps1` - Replaced by `deploy.ps1 -Hospital both`
- ❌ `deploy-hospital-a.ps1` - Replaced by `deploy.ps1 -Hospital hospital-a`
- ❌ `deploy-hospital-b.ps1` - Replaced by `deploy.ps1 -Hospital hospital-b`

## Utility Scripts

### 🔐 generate-mtls-certs.ps1
Generate mTLS certificates for hospitals (CA + hospital certs).

```powershell
.\scripts\generate-mtls-certs.ps1
```

### 🏥 check-hospitals.ps1
Check status of all hospital VMs and services.

```powershell
.\scripts\check-hospitals.ps1
```

### 🔍 access-hospitals.ps1
Show access URLs and quick commands for hospitals.

```powershell
.\scripts\access-hospitals.ps1
```

### 🧪 test-federation.ps1
Test federation connectivity between hospitals.

```powershell
.\scripts\test-federation.ps1
```

## Workflow Examples

### First-Time Setup

```powershell
# 1. Generate certificates (if not already done)
.\scripts\generate-mtls-certs.ps1

# 2. Deploy both hospitals
.\scripts\deploy.ps1 -Hospital both -Start

# 3. Wait for services to be ready (check status)
.\scripts\check-hospitals.ps1

# 4. Register hospitals in federation registry (via UI or API)
# Use UI: http://<hospital-ip> → Federation Network → Registry tab → Self-Register
# Or API: curl -X POST http://<hospital-ip>/api/federation/registry/self-register
```

### Add New Hospital (Non-Disruptive)

```powershell
# Deploy only Hospital B without affecting Hospital A
.\scripts\deploy.ps1 -Hospital hospital-b -Start

# Hospital A continues running unaffected
```

### Update Single Hospital

```powershell
# Make code changes...

# Redeploy just Hospital A
.\scripts\deploy.ps1 -Hospital hospital-a -Start

# Hospital B remains untouched
```

### Quick Code Update (Skip Frontend Build)

```powershell
# If only backend changes, skip frontend build
.\scripts\deploy.ps1 -Hospital hospital-a -SkipBuild -Start
```

### Clean Deployment

```powershell
# Remove all data and start fresh
.\scripts\deploy.ps1 -Hospital hospital-a -Clean -Start
```

## Post-Deployment

After deployment, access your hospitals:

### Web UI
- Hospital A: `http://<hospital-a-ip>`
- Hospital B: `http://<hospital-b-ip>`

### API Documentation
- Hospital A: `http://<hospital-a-ip>/docs`
- Hospital B: `http://<hospital-b-ip>/docs`

### Federation Registry
Self-register hospitals:
```bash
# Hospital A
curl -X POST http://<hospital-a-ip>/api/federation/registry/self-register

# Hospital B
curl -X POST http://<hospital-b-ip>/api/federation/registry/self-register
```

Or use the UI: **Federation Network → Registry tab → Self-Register button**

### Manual Peer Discovery
Trigger immediate peer discovery (instead of waiting 5 minutes):
```bash
curl -X POST http://<hospital-ip>/api/federation/registry/discover-now
```

Or use the UI: **Federation Network page → "Discover Peers Now" button**

## VM Management

### Check Services
```powershell
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml ps
```

### View Logs
```powershell
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs -f
```

### Shell Access
```powershell
multipass shell hospital-a
```

### Restart Services
```powershell
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml restart
```

### Stop Services
```powershell
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml down
```

## Architecture

### Deployment Flow

```
deploy.ps1
    ├─> Validates VM exists
    ├─> Generates certificates (if needed)
    ├─> Builds frontend (unless -SkipBuild)
    └─> Calls deploy-to-vm.ps1
            ├─> Cleans VM (if -Clean)
            ├─> Creates directory structure
            ├─> Transfers files
            │   ├─> FastAPI app
            │   ├─> Federation service (Go)
            │   ├─> Frontend build
            │   ├─> Certificates
            │   ├─> PostgreSQL scripts
            │   ├─> Federation registry
            │   └─> Peer discovery
            ├─> Generates docker-compose.yml
            ├─> Creates startup script
            └─> Optionally starts services
```

### Hospital Independence

Each hospital has:
- ✅ Separate VM (isolated compute)
- ✅ Separate data volumes (isolated storage)
- ✅ Separate docker-compose (isolated services)
- ✅ Separate certificates (isolated identity)
- ✅ Can be deployed/updated independently

### Federation Registry

- **Storage**: `/home/ubuntu/medimage/data/federation-registry.json`
- **Auto-discovery**: Runs every 5 minutes
- **Manual discovery**: UI button or API endpoint
- **Persistence**: Survives container restarts

## Troubleshooting

### VM Not Found
```powershell
# Create VM
multipass launch --name hospital-a --cpus 4 --memory 8G --disk 40G
```

### Certificates Missing
```powershell
# Generate certificates
.\scripts\generate-mtls-certs.ps1
```

### Frontend Build Issues
```powershell
# Rebuild frontend manually
cd frontend
npm install
npm run build
```

### Services Won't Start
```powershell
# Check logs
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml logs

# Try clean deployment
.\scripts\deploy.ps1 -Hospital hospital-a -Clean -Start
```

### Can't Access UI
```powershell
# Get VM IP
multipass info hospital-a

# Check if services are running
multipass exec hospital-a -- sudo docker-compose -f /home/ubuntu/medimage/docker-compose.yml ps
```

## Migration from Old Scripts

If you were using the old scripts:

**Old:**
```powershell
.\scripts\deploy-hospitals.ps1 -Both -Start
.\scripts\deploy-hospital-a.ps1
.\scripts\deploy-hospital-b.ps1
```

**New:**
```powershell
.\scripts\deploy.ps1 -Hospital both -Start
.\scripts\deploy.ps1 -Hospital hospital-a
.\scripts\deploy.ps1 -Hospital hospital-b
```

You can safely delete the old scripts:
- `deploy-hospitals.ps1`
- `deploy-hospital-a.ps1`
- `deploy-hospital-b.ps1`

## Contributing

When adding new hospitals:

1. Add configuration to `$HospitalConfig` in `deploy.ps1`:
```powershell
"hospital-c" = @{
    ID = "hospital-c"
    Name = "Hospital C"
    VM = "hospital-c"
    Peer = "hospital-a"  # or appropriate peer
}
```

2. Generate certificates:
```powershell
.\scripts\generate-mtls-certs.ps1
```

3. Deploy:
```powershell
.\scripts\deploy.ps1 -Hospital hospital-c -Start
```
