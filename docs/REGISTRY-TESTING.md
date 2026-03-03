# Federation Registry Testing Guide

## Quick Start

### 1. Start Hospital A
```powershell
cd c:\Users\WN\chiwa-hub\chiwa-edu\midterm-project\medimage-store-and-fed-share

# Deploy to VM
.\scripts\deploy-hospitals.ps1 -HospitalA -Start

# Or start locally
docker-compose up -d
```

### 2. Register Hospital A
```powershell
# Using CLI
python scripts\registry_cli.py register --url http://192.168.64.10

# Or using curl
curl -X POST http://192.168.64.10/api/federation/registry/self-register
```

### 3. Start Hospital B
```powershell
.\scripts\deploy-hospitals.ps1 -HospitalB -Start
```

### 4. Register Hospital B
```powershell
python scripts\registry_cli.py register --url http://192.168.64.11
```

### 5. Hospital B Discovers Hospital A Automatically
```powershell
# Check discovery status
python scripts\registry_cli.py discover hospital-b --url http://192.168.64.11

# Expected output:
# ✅ Found 1 peer(s):
# 
# ╔════════════╦════════════╦═══════════════════════╦════════╦═══════════════╗
# ║ ID         ║ Name       ║ Endpoint              ║ Status ║ File Sharing  ║
# ╠════════════╬════════════╬═══════════════════════╬════════╬═══════════════╣
# ║ hospital-a ║ Hospital A ║ 192.168.64.10:50051   ║ active ║ True          ║
# ╚════════════╩════════════╩═══════════════════════╩════════╩═══════════════╝
```

## CLI Commands

### Register Hospital
```powershell
# Self-register using local certificates
python scripts\registry_cli.py register --url http://<hospital-ip>

# Output:
# 📝 Registering hospital...
# ✅ Successfully registered: hospital-a
#    Federation endpoint: 192.168.64.10:50051
#    Discovered 0 peer(s)
```

### Discover Peers
```powershell
# Basic discovery
python scripts\registry_cli.py discover hospital-a --url http://192.168.64.10

# Verbose (shows certificates)
python scripts\registry_cli.py discover hospital-a --url http://192.168.64.10 -v
```

### List All Hospitals
```powershell
python scripts\registry_cli.py list --url http://192.168.64.10

# Output:
# 📋 Listing all hospitals in federation...
# 
# Total: 2 hospital(s)
# 
# ╔════════════╦════════════╦═══════════════════════╦════════╦═════════════════════╗
# ║ ID         ║ Name       ║ Endpoint              ║ Status ║ Registered          ║
# ╠════════════╬════════════╬═══════════════════════╬════════╬═════════════════════╣
# ║ hospital-a ║ Hospital A ║ 192.168.64.10:50051   ║ active ║ 2026-02-05 10:00:00 ║
# ║ hospital-b ║ Hospital B ║ 192.168.64.11:50051   ║ active ║ 2026-02-05 10:05:00 ║
# ╚════════════╩════════════╩═══════════════════════╩════════╩═════════════════════╝
```

### Get Hospital Details
```powershell
python scripts\registry_cli.py info hospital-a --url http://192.168.64.10

# Output:
# ============================================================
# Hospital: Hospital A
# ============================================================
# 
# 🏥 Identity:
#    ID:           hospital-a
#    Organization: Hospital A Medical Center
#    Contact:      admin@hospital-a.local
# 
# 🌐 Network:
#    Federation:   192.168.64.10:50051
#    API:          http://192.168.64.10
#    Region:       US
# 
# 📜 Certificate:
#    Fingerprint:  abc123...
#    CA:           def456...
#    Valid From:   2026-01-01 00:00:00
#    Valid To:     2036-01-01 00:00:00
# 
# ⚙️  Capabilities:
#    File Sharing:     True
#    Patient Records:  True
#    DICOM Imaging:    True
#    Max File Size:    500 MB
# 
# 📊 Status:
#    Status:       active
#    Registered:   2026-02-05 10:00:00
#    Version:      1.0
```

## API Endpoints

### POST /api/federation/registry/self-register
Self-register this hospital (automatic).

**Request:** None (uses local config)

**Response:**
```json
{
  "success": true,
  "hospital_id": "hospital-a",
  "message": "Self-registration successful",
  "federation_endpoint": "192.168.64.10:50051",
  "peer_count": 0,
  "peers": []
}
```

### GET /api/federation/registry/discover?hospital_id=hospital-a
Discover all peer hospitals.

**Response:**
```json
{
  "success": true,
  "peers": [
    {
      "hospital_id": "hospital-b",
      "hospital_name": "Hospital B",
      "organization": "Hospital B Medical Center",
      "federation_endpoint": "192.168.64.11:50051",
      "api_endpoint": "http://192.168.64.11",
      "certificate_pem": "base64-encoded-cert...",
      "certificate_fingerprint": "sha256-hash...",
      "ca_fingerprint": "sha256-hash...",
      "certificate_not_before": "2026-01-01T00:00:00Z",
      "certificate_not_after": "2036-01-01T00:00:00Z",
      "capabilities": {
        "file_sharing": true,
        "patient_records": true,
        "dicom_imaging": true,
        "max_file_size_mb": 500
      },
      "status": "active",
      "contact_email": "admin@hospital-b.local",
      "registration_timestamp": "2026-02-05T10:05:00Z"
    }
  ],
  "total_peers": 1
}
```

### GET /api/federation/registry/list
List all hospitals (summary).

**Response:**
```json
{
  "success": true,
  "total_hospitals": 2,
  "hospitals": [
    {
      "hospital_id": "hospital-a",
      "hospital_name": "Hospital A",
      "federation_endpoint": "192.168.64.10:50051",
      "status": "active",
      "registered_at": "2026-02-05T10:00:00Z"
    },
    {
      "hospital_id": "hospital-b",
      "hospital_name": "Hospital B",
      "federation_endpoint": "192.168.64.11:50051",
      "status": "active",
      "registered_at": "2026-02-05T10:05:00Z"
    }
  ]
}
```

### GET /api/federation/registry/hospital/{hospital_id}
Get detailed info for specific hospital.

**Response:** Complete HospitalMetadata object (see above)

## Testing Workflow

### Scenario 1: Two Hospitals Join Network

```powershell
# 1. Deploy and start Hospital A
.\scripts\deploy-hospitals.ps1 -HospitalA -Start

# Wait for services to start (check http://192.168.64.10/health)

# 2. Register Hospital A
python scripts\registry_cli.py register --url http://192.168.64.10
# Output: Successfully registered, 0 peers

# 3. Deploy and start Hospital B
.\scripts\deploy-hospitals.ps1 -HospitalB -Start

# 4. Register Hospital B
python scripts\registry_cli.py register --url http://192.168.64.11
# Output: Successfully registered, 1 peer discovered (Hospital A)

# 5. Hospital A discovers Hospital B (automatic after 5 minutes)
# Or manually trigger:
python scripts\registry_cli.py discover hospital-a --url http://192.168.64.10
# Output: Found 1 peer (Hospital B)

# 6. List all hospitals
python scripts\registry_cli.py list --url http://192.168.64.10
# Output: 2 hospitals
```

### Scenario 2: Third Hospital Joins

```powershell
# 1. Create Hospital C VM
multipass launch --name hospital-c --cpus 4 --memory 8G --disk 40G

# 2. Deploy Hospital C
.\scripts\deploy-to-vm.ps1 -VM hospital-c -HospitalID hospital-c `
    -HospitalName "Hospital C" `
    -PeerHospital hospital-a `
    -PeerEndpoint "192.168.64.10:50051"

# 3. Start services
multipass exec hospital-c -- sudo bash /home/ubuntu/medimage/start.sh

# 4. Register Hospital C
python scripts\registry_cli.py register --url http://<hospital-c-ip>
# Output: Successfully registered, 2 peers discovered (A and B)

# 5. Existing hospitals auto-discover C within 5 minutes
# Or manually check:
python scripts\registry_cli.py list --url http://192.168.64.10
# Output: 3 hospitals
```

### Scenario 3: Verify mTLS Connection

```powershell
# 1. Check federation network status
curl http://192.168.64.10/api/federation/network/status | ConvertFrom-Json

# Should show:
# {
#   "mtls_enabled": true,
#   "peer_count": 2,
#   "peers": [...]
# }

# 2. Test gRPC connection
# This is handled automatically by the federation service
# Check logs: multipass exec hospital-a -- docker-compose logs federation
```

## Automatic Discovery

The **Peer Discovery Service** runs in the background on each hospital:

- **Interval**: Every 5 minutes
- **Action**: Queries registry for new peers
- **Auto-config**: Automatically configures mTLS connections

**Check discovery status:**
```powershell
curl http://192.168.64.10/api/federation/network/status
```

**Logs:**
```
🔍 Running peer discovery...
✨ Discovered new peer: Hospital B at 192.168.64.11:50051
⚙️  Configured peer: Hospital B
   Federation: 192.168.64.11:50051
   API: http://192.168.64.11
   mTLS: Enabled (verified via CA)
   Certificate: abc123...
✅ Discovery complete: 1 new, 0 updated, 1 total peers
```

## Troubleshooting

### Hospital Not Found in Registry
```powershell
# Register it
python scripts\registry_cli.py register --url http://<hospital-ip>
```

### Peer Discovery Not Working
```powershell
# Check if service is running
curl http://<hospital-ip>/api/federation/network/status

# Check logs
multipass exec hospital-a -- docker-compose logs fastapi | Select-String "discovery"

# Manually trigger discovery
python scripts\registry_cli.py discover hospital-a --url http://<hospital-ip>
```

### Certificate Verification Failed
```powershell
# Check certificates are deployed
multipass exec hospital-a -- ls -la /home/ubuntu/medimage/certs/

# Verify fingerprints match
python scripts\registry_cli.py info hospital-a --url http://<hospital-ip>

# Re-generate if needed
.\certs\generate-mtls-certs.ps1
```

### Connection Refused
```powershell
# Check if API is running
curl http://<hospital-ip>/health

# Check firewall
multipass exec hospital-a -- sudo ufw status

# Check if gRPC port is open
multipass exec hospital-a -- sudo netstat -tulpn | Select-String "50051"
```

## Dependencies

Install Python packages:
```powershell
pip install requests tabulate
```

Or add to `app/requirements.txt`:
```
tabulate==0.9.0  # For CLI table formatting
```

## Summary

✅ **Self-Registration**: Each hospital registers itself automatically
✅ **Auto-Discovery**: Background service finds new peers every 5 minutes  
✅ **Certificate Verification**: All peers verified via CA
✅ **mTLS Ready**: Certificates exchanged, connections secure
✅ **CLI Tools**: Easy testing and management
✅ **REST API**: Programmatic access to registry

**No manual configuration needed!** Just deploy and register.
