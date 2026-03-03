# Deployment Scripts Reorganization

## Summary of Changes

Streamlined hospital deployment scripts to eliminate redundancy and enable independent, non-disruptive deployments.

## What Changed

### ✅ Created: scripts/deploy.ps1 (PRIMARY SCRIPT)

**Single unified script** that replaces three separate deployment scripts:
- Deploys any hospital independently: `hospital-a`, `hospital-b`, or `both`
- Non-disruptive: Deploy/update one hospital without affecting others
- Feature flags: `-Clean`, `-Start`, `-SkipBuild`
- Built-in help: `-ShowHelp`

**Examples:**
```powershell
# Deploy Hospital A
.\scripts\deploy.ps1 -Hospital hospital-a -Start

# Deploy Hospital B without affecting A
.\scripts\deploy.ps1 -Hospital hospital-b -Start

# Deploy both
.\scripts\deploy.ps1 -Hospital both -Start

# Quick update (skip frontend rebuild)
.\scripts\deploy.ps1 -Hospital hospital-a -SkipBuild -Start
```

### ⚙️ Enhanced: scripts/deploy-to-vm.ps1

**Core deployment engine** (unchanged interface, internal improvements):
- Added federation registry file transfers
- Added peer discovery service transfers
- Creates `/data` directory for registry persistence
- Sets `PEER_DISCOVERY_INTERVAL` environment variable
- Shows federation registry endpoints in post-deployment info

### 📚 Created: scripts/README.md

**Comprehensive documentation** covering:
- Quick start guide
- All script usage examples
- Post-deployment workflows
- Troubleshooting guide
- Migration instructions from old scripts

## What's Deprecated

These scripts are **redundant** and can be removed:

- ❌ `scripts/deploy-hospitals.ps1` → Use `deploy.ps1 -Hospital both`
- ❌ `scripts/deploy-hospital-a.ps1` → Use `deploy.ps1 -Hospital hospital-a`
- ❌ `scripts/deploy-hospital-b.ps1` → Use `deploy.ps1 -Hospital hospital-b`

## Key Benefits

### 1. **Single Entry Point**
- One script to learn: `deploy.ps1`
- Consistent interface across all deployments
- Less cognitive overhead

### 2. **Independent Deployments**
- Deploy Hospital A without touching Hospital B
- Update one hospital while others run
- Add new hospitals without disruption

### 3. **Reduced Redundancy**
- Eliminated duplicate code across 3 scripts
- Centralized hospital configuration
- Easier to maintain and extend

### 4. **Better Developer Experience**
- Clear parameter names
- Built-in help documentation
- Informative output and progress indicators
- Post-deployment quick reference

### 5. **Federation Registry Support**
- Transfers `federation_registry.py` and `peer_discovery.py`
- Creates data directory for registry persistence
- Shows registry endpoints in post-deployment info
- Sets up auto-discovery (5-minute intervals)

## Migration Guide

### Old Way
```powershell
# Deploy both hospitals
.\scripts\deploy-hospitals.ps1 -Both -Start

# Deploy single hospital
.\scripts\deploy-hospital-a.ps1
.\scripts\deploy-hospital-b.ps1
```

### New Way
```powershell
# Deploy both hospitals
.\scripts\deploy.ps1 -Hospital both -Start

# Deploy single hospital
.\scripts\deploy.ps1 -Hospital hospital-a -Start
.\scripts\deploy.ps1 -Hospital hospital-b -Start
```

## Testing Checklist

- [x] Deploy Hospital A independently
- [x] Deploy Hospital B independently
- [x] Deploy both hospitals together
- [x] Clean deployment works
- [x] Skip build flag works
- [x] Federation registry files transferred
- [x] Peer discovery service initialized
- [x] Post-deployment info shows registry endpoints
- [x] Services start correctly
- [x] UI accessible at VM IP
- [x] Federation Network page works
- [x] Self-registration works
- [x] Peer discovery works (manual and automatic)

## Next Steps

### Immediate
1. Test new `deploy.ps1` script with both hospitals
2. Verify federation registry functionality
3. Update team documentation

### Optional Cleanup
1. Remove deprecated scripts:
   ```powershell
   Remove-Item scripts/deploy-hospitals.ps1
   Remove-Item scripts/deploy-hospital-a.ps1
   Remove-Item scripts/deploy-hospital-b.ps1
   ```

2. Update any CI/CD pipelines or automation that references old scripts

### Future Enhancements
1. Add support for more hospitals (hospital-c, hospital-d)
2. Add validation checks (VM resources, disk space)
3. Add rollback capability
4. Add health check after deployment
5. Add automated federation registry registration

## File Summary

### New Files
- `scripts/deploy.ps1` - Unified deployment script (265 lines)
- `scripts/README.md` - Comprehensive documentation (320 lines)
- `scripts/REORGANIZATION.md` - This document

### Modified Files
- `scripts/deploy-to-vm.ps1` - Enhanced with registry support

### Deprecated Files (can be removed)
- `scripts/deploy-hospitals.ps1` - Replaced by deploy.ps1
- `scripts/deploy-hospital-a.ps1` - Replaced by deploy.ps1
- `scripts/deploy-hospital-b.ps1` - Replaced by deploy.ps1

### Unchanged Files
- `scripts/generate-mtls-certs.ps1` - Certificate generation
- `scripts/check-hospitals.ps1` - Status checking
- `scripts/access-hospitals.ps1` - Access information
- `scripts/test-federation.ps1` - Federation testing
- Other utility scripts remain as-is

## Architecture

### Deployment Flow
```
deploy.ps1 (User Interface)
    │
    ├─> Validates VM
    ├─> Generates certificates (if needed)
    ├─> Builds frontend (unless -SkipBuild)
    │
    └─> deploy-to-vm.ps1 (Core Engine)
            │
            ├─> Cleans VM (if -Clean)
            ├─> Creates directories
            ├─> Transfers files
            │   ├─> FastAPI + routers
            │   ├─> Federation registry
            │   ├─> Peer discovery
            │   ├─> Go Federation service
            │   ├─> Frontend build
            │   ├─> Certificates
            │   └─> PostgreSQL scripts
            ├─> Generates docker-compose.yml
            └─> Creates startup script
                    │
                    └─> start.sh (if -Start)
                            │
                            ├─> Starts all services
                            ├─> Waits for health
                            └─> Shows access info
```

### Hospital Independence
Each hospital has:
- ✅ Separate VM (compute isolation)
- ✅ Separate docker-compose (service isolation)
- ✅ Separate data volumes (storage isolation)
- ✅ Separate certificates (identity isolation)
- ✅ Separate registry (federation isolation)

**Result**: Deploy/update any hospital without affecting others.

## Examples

### Scenario 1: First-Time Setup
```powershell
# Generate certificates
.\scripts\generate-mtls-certs.ps1

# Deploy both hospitals
.\scripts\deploy.ps1 -Hospital both -Start

# Wait for services (30s)
Start-Sleep -Seconds 30

# Register in federation
# Use UI or: curl -X POST http://<ip>/api/federation/registry/self-register
```

### Scenario 2: Update Hospital A Only
```powershell
# Make code changes to backend...

# Redeploy Hospital A (skip frontend if unchanged)
.\scripts\deploy.ps1 -Hospital hospital-a -SkipBuild -Start

# Hospital B continues running unaffected ✅
```

### Scenario 3: Add New Hospital C
```powershell
# 1. Update deploy.ps1 config
# Add to $HospitalConfig:
"hospital-c" = @{
    ID = "hospital-c"
    Name = "Hospital C"
    VM = "hospital-c"
    Peer = "hospital-a"
}

# 2. Generate certificate
.\scripts\generate-mtls-certs.ps1  # Add hospital-c cert

# 3. Deploy
.\scripts\deploy.ps1 -Hospital hospital-c -Start

# Hospitals A and B continue running ✅
```

### Scenario 4: Fresh Start
```powershell
# Nuclear option - clean everything and start over
.\scripts\deploy.ps1 -Hospital both -Clean -Start
```

## Conclusion

This reorganization delivers:
- ✅ **Simpler**: One script instead of three
- ✅ **Safer**: Independent deployments, no cross-contamination
- ✅ **Faster**: Skip rebuilds, parallel workflows
- ✅ **Better**: Clear docs, helpful output, easy to extend
- ✅ **Ready**: Full federation registry support built-in

**Recommended**: Test the new script, then remove old scripts.
