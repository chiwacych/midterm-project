# Federation Discovery & Cross-VM DNS Resolution

## Problem Statement

Hospitals deployed on separate Multipass VMs could not discover each other through the federation registry. After calling `self-register` and `discover-now`, each hospital only saw itself — no peers were ever found.

### Symptoms

- `POST /api/federation/registry/self-register` returned `peer_count: 0`
- `POST /api/federation/registry/discover-now` returned an empty peers list
- `GET /api/federation/registry/list` showed only the local hospital
- No errors in FastAPI logs — failures were silent

---

## Root Causes (4 issues)

### 1. Local-Only Registry Design

Each hospital's `FederationRegistry` was purely in-memory with a local JSON file backup. The `self-register` endpoint wrote only to the local registry dict. The `discover-now` endpoint only queried the local dict. **There was no mechanism for one hospital to push or pull data from another.**

**Before fix** — data flow was entirely local:
```
Hospital A: self-register → writes to A's dict → discovers peers from A's dict → finds nothing
Hospital B: self-register → writes to B's dict → discovers peers from B's dict → finds nothing
```

### 2. Docker Container DNS Isolation

`/etc/hosts` entries for `hospital-a.local` and `hospital-b.local` were added to the VM hosts, but Docker containers have their own `/etc/hosts` file. The FastAPI container could not resolve `.local` hostnames.

```
# VM host (OK):
$ ping hospital-b.local → 172.29.141.207 ✓

# Inside Docker container (FAIL):
$ ping hospital-b.local → Name or service not known ✗
```

### 3. Wrong API Port in Peer URL Construction

`FEDERATION_PEER_HOSPITAL_B=hospital-b.local:50051` — the env var used the gRPC port (50051). The `_get_peer_api_endpoints()` helper extracted the hostname and built URLs with no port specified, defaulting to port 80. FastAPI runs on port 8000.

```python
# Bug: produced http://hospital-b.local (port 80)
endpoints[peer_id] = f"http://{host}"

# Fix: produces http://hospital-b.local:8000
endpoints[peer_id] = f"http://{host}:{api_port}"
```

### 4. HOST_IP Environment Variable Was Invalid

`docker-compose.yml` had `HOST_IP=\` (a backslash). The self-register endpoint used this value as the hospital's IP address, producing invalid federation/API endpoints like `\:50051`.

### 5. Missing `data/` Directory

`export_registry()` wrote to `data/federation-registry.json`, but the `data/` directory didn't exist inside the container, causing a `FileNotFoundError` crash.

---

## Solution

### A. Cross-Hospital Registry Sync (app/routers/federation_registry.py)

Three new mechanisms enable hospitals to share registry data:

#### `POST /api/federation/registry/announce`
Receives registration metadata pushed from a remote hospital. When Hospital B self-registers, it announces itself to Hospital A by POSTing its metadata to this endpoint. Hospital A validates and registers the remote hospital in its local registry.

#### `_announce_to_peers(metadata)`
Background task triggered after self-registration. Pushes the hospital's own metadata to every known peer's `/announce` endpoint. Peers are discovered from:
- `FEDERATION_PEER_*` environment variables
- Existing local registry entries

#### `_pull_remote_registries()`
Background task triggered after self-registration. Pulls each known peer's registry via `GET /export` and merges unknown hospitals into the local registry. This handles the case where a peer was already registered before we came online.

**After fix** — bidirectional data flow:
```
Hospital A: self-register → writes to A's dict
                          → announces to B's /announce (background)
                          → pulls B's /export (background)

Hospital B: self-register → writes to B's dict
                          → announces to A's /announce (background)  ← A learns about B
                          → pulls A's /export (background)           ← B learns about A
```

### B. Docker DNS via `extra_hosts` (docker-compose.yml)

Added `extra_hosts` to the FastAPI service so `.local` hostnames resolve inside the container:

```yaml
fastapi:
  # ...
  extra_hosts:
    - "hospital-a.local:172.29.129.233"
    - "hospital-b.local:172.29.141.207"
```

This injects entries into the container's `/etc/hosts`:
```
172.29.129.233  hospital-a.local
172.29.141.207  hospital-b.local
```

### C. Correct API Port (app/routers/federation_registry.py)

```python
api_port = os.getenv("API_PORT", "8000")
endpoints[peer_id] = f"http://{host}:{api_port}"
```

### D. HOST_IP Fix (docker-compose.yml + code)

Set the actual VM IP in docker-compose.yml:
```yaml
- HOST_IP=172.29.129.233   # Hospital A
- HOST_IP=172.29.141.207   # Hospital B
```

Added defensive stripping in self-register:
```python
ip_address = os.getenv("HOST_IP", "").strip().strip("\\")
```

### E. Directory Creation (app/federation_registry.py)

```python
def export_registry(self, file_path: str):
    os.makedirs(os.path.dirname(file_path) or ".", exist_ok=True)
    # ... write JSON
```

---

## Files Modified

| File | Change |
|------|--------|
| `app/routers/federation_registry.py` | Added `/announce` endpoint, `_announce_to_peers()`, `_pull_remote_registries()`, `_get_peer_api_endpoints()` with correct port, HOST_IP strip |
| `app/federation_registry.py` | Added `os.makedirs` in `export_registry()`, added `import os` |
| `docker-compose.yml` (on each VM) | Fixed `HOST_IP`, added `extra_hosts` for `.local` DNS |
| `scripts/deploy-to-vm.ps1` | Updated `start.sh` template with `/etc/hosts` management and auto-discover |
| `scripts/deploy.ps1` | Added cross-VM `/etc/hosts` setup when deploying both hospitals |
| `scripts/fix-compose.sh` | Utility to patch docker-compose.yml on a VM (HOST_IP + extra_hosts) |

---

## Verification

After deploying the fix:

```bash
# 1. Self-register Hospital A
curl -X POST http://hospital-a:8000/api/federation/registry/self-register
# → {"success": true, "peer_count": 0}

# 2. Self-register Hospital B
curl -X POST http://hospital-b:8000/api/federation/registry/self-register
# → {"success": true, "peer_count": 1, "peers": [{"id": "hospital-a", ...}]}
#    ^ Hospital B already found A via background pull

# 3. Wait 3 seconds, check Hospital A's registry
curl http://hospital-a:8000/api/federation/registry/list
# → {"total_hospitals": 2, "hospitals": ["hospital-a", "hospital-b"]}
#    ^ Hospital A received B's announcement

# 4. Manual discovery (also works)
curl -X POST http://hospital-a:8000/api/federation/registry/discover-now
# → {"total_peers": 1, "peers": [{"id": "hospital-b", "api": "http://172.29.141.207:8000"}]}
```

---

## Deployment Checklist

When deploying to new VMs, ensure:

1. **VM IPs are known** — run `hostname -I` on each VM
2. **`HOST_IP`** is set correctly in each VM's `docker-compose.yml`
3. **`extra_hosts`** is present in the fastapi service with all peer IPs
4. **`FEDERATION_PEER_*`** env vars point to peer hostnames (e.g., `hospital-b.local:50051`)
5. **VM-level `/etc/hosts`** has entries for all peer `.local` hostnames (for non-Docker tools)

The `scripts/deploy-to-vm.ps1` and `scripts/deploy.ps1` handle steps 2–5 automatically.
