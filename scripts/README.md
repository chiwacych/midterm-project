# Deployment Scripts

Scripts for deploying, managing, and testing the federated hospital network.

---

## Quick Start

```powershell
# Deploy a new hospital and start services
.\scripts\deploy.ps1 -Hospital hospital-a -Start

# Deploy with clean slate
.\scripts\deploy.ps1 -Hospital hospital-a -Clean -Start

# Deploy all running hospital VMs at once
.\scripts\deploy.ps1 -Hospital all -Start
```

---

## Deployment

### `deploy.ps1` — Primary deployment entry point
Deploys any hospital to a multipass VM. Auto-discovers peers from running VMs.

```powershell
.\scripts\deploy.ps1 [-Hospital <id>] [-Peers <list>] [-Clean] [-Start] [-SkipBuild] [-ShowHelp]
```

| Parameter | Description |
|-----------|-------------|
| `-Hospital` | Hospital ID (e.g. `hospital-a`, `hospital-c`) or `all`. Default: `hospital-a` |
| `-Peers` | Comma-separated peer IDs. Auto-detected from running VMs if omitted |
| `-Clean` | Wipe the VM before deploying |
| `-Start` | Start services immediately after deployment |
| `-SkipBuild` | Skip frontend npm build (faster re-deploys) |

**Examples:**
```powershell
# First hospital (standalone)
.\scripts\deploy.ps1 -Hospital hospital-a -Start

# Additional hospital — auto-finds peers
.\scripts\deploy.ps1 -Hospital hospital-b -Start

# New hospital-c with explicit peer
.\scripts\deploy.ps1 -Hospital hospital-c -Peers hospital-a -Clean -Start

# Redeploy backend only (no frontend rebuild)
.\scripts\deploy.ps1 -Hospital hospital-a -SkipBuild -Start
```

---

### `deploy-to-vm.ps1` — Core deployment engine
Called by `deploy.ps1`. Handles file transfer, docker-compose generation, and startup script creation. Can be called directly for advanced use.

```powershell
.\scripts\deploy-to-vm.ps1 -VM hospital-c -HospitalID hospital-c -HospitalName "Hospital C" -Peers "hospital-a"
```

---

## Certificates

### `generate-mtls-certs.ps1` — Generate mTLS certificates (Windows)
Creates CA + per-hospital TLS certificates used by the federation gRPC service.

```powershell
# Generate for default hospitals a and b
.\scripts\generate-mtls-certs.ps1

# Generate for additional hospital
.\scripts\generate-mtls-certs.ps1 -Hospitals @("hospital-c")
```

### `generate-mtls-certs.sh` — Same, for Linux/macOS
```bash
bash scripts/generate-mtls-certs.sh
```

> Certificates are written to `certs/` (gitignored — never committed).

---

## Health & Monitoring

### `check-hospitals.ps1` — Health check all running hospital VMs
Dynamically discovers all `hospital-*` VMs, checks API/MinIO/Prometheus endpoints, Docker container status, and libp2p peer counts.

```powershell
.\scripts\check-hospitals.ps1            # check all
.\scripts\check-hospitals.ps1 -Hospital hospital-a  # check one
```

### `access-hospitals.ps1` — Show access URLs / open in browser
Discovers running VMs, prints URLs and credentials, optionally opens browser.

```powershell
.\scripts\access-hospitals.ps1           # all hospitals
.\scripts\access-hospitals.ps1 -Open     # auto-open Web UI
.\scripts\access-hospitals.ps1 -Hospital hospital-a
```

### `check_replication.py` — MinIO replication checker
Verifies file replication across the 3-node MinIO cluster.

```bash
python scripts/check_replication.py
```

---

## Testing

### `test-federation.ps1` — Cross-hospital federation test (Windows)
Simulates a full patient data sharing workflow between two hospitals: login → create patient → upload image → grant consent → federated access from second hospital.

```powershell
.\scripts\test-federation.ps1
```

### `test-federation.sh` — Same, for Linux/macOS
```bash
bash scripts/test-federation.sh
```

### `registry_cli.py` — Federation registry CLI
Query and manage the federation registry from the command line.

```bash
python scripts/registry_cli.py list
python scripts/registry_cli.py register --url http://<ip>
python scripts/registry_cli.py discover hospital-a
python scripts/registry_cli.py info hospital-b
```

---

## VM Management

### `setup.ps1` — First-time Windows setup
Checks Docker Desktop, starts services locally, shows endpoint summary.

### `fix-vm-performance.ps1` — Increase VM resources
Stops VMs, increases CPUs to 4 and RAM to 4 GB, restarts.

```powershell
.\scripts\fix-vm-performance.ps1
```

### `increase-vm-disk.ps1` — Increase VM disk size to 20 GB
```powershell
.\scripts\increase-vm-disk.ps1
```

### `update-hosts-admin.ps1` — Update Windows hosts file (run as Admin)
Adds `hospital-a.local` / `hospital-b.local` entries to `C:\Windows\System32\drivers\etc\hosts`.

---

## Kafka / Infrastructure

### `create-kafka-topics.sh` — Create required Kafka topics
```bash
bash scripts/create-kafka-topics.sh
```

### `failover.sh` — Simulate node failover
Tests fault tolerance by stopping a MinIO node and verifying continued access.

```bash
bash scripts/failover.sh
```

---

## Default Credentials (per hospital)

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@<hospital-id>.local` | `admin123` |
| Doctor | `doctor@<hospital-id>.local` | `doctor123` |

Created automatically by `POST /api/auth/seed` on first `start.sh` run.

---

## Adding a New Hospital

```powershell
# 1. Create VM
multipass launch --name hospital-c --cpus 2 --memory 4G --disk 30G 22.04

# 2. Generate certificate
.\scripts\generate-mtls-certs.ps1 -Hospitals @("hospital-c")

# 3. Deploy (auto-discovers peers from running VMs)
.\scripts\deploy.ps1 -Hospital hospital-c -Start
# → bootstraps to first peer, discovers rest via libp2p peer exchange
# → seeds admin@hospital-c.local / admin123 and doctor@hospital-c.local / doctor123
```
