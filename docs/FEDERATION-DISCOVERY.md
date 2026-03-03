# Federation Discovery and Onboarding Guide

## Problem Statement

When deploying a new hospital into the federation network:
1. How does it discover existing hospitals?
2. How do existing hospitals discover and trust the new hospital?
3. How do they complete the initial mTLS handshake?

## Solution: Federation Registry Service

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Federation Registry                         │
│  (Centralized or Distributed Service)                       │
│                                                              │
│  - Hospital Metadata Store                                  │
│  - Certificate Verification                                 │
│  - Proof of Identity Validation                             │
│  - Peer Discovery API                                       │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │Hospital A│        │Hospital B│        │Hospital C│
    │          │        │          │        │          │
    │ 1. Self- │        │ 2. Disc- │        │ 3. Auto  │
    │ Register │        │   overs  │        │   Config │
    └──────────┘        └──────────┘        └──────────┘
```

### Hospital Metadata Schema

Each hospital publishes:

```json
{
  "hospital_id": "hospital-a",
  "hospital_name": "Hospital A",
  "organization": "Hospital A Medical Center",
  
  // Network Endpoints
  "federation_endpoint": "192.168.1.10:50051",
  "api_endpoint": "http://192.168.1.10",
  
  // Certificate Information
  "certificate_pem": "base64-encoded certificate",
  "certificate_fingerprint": "sha256-hash-of-cert",
  "ca_fingerprint": "sha256-hash-of-ca",
  "certificate_not_before": "2026-01-01T00:00:00Z",
  "certificate_not_after": "2036-01-01T00:00:00Z",
  
  // Capabilities
  "capabilities": {
    "file_sharing": true,
    "patient_records": true,
    "dicom_imaging": true,
    "max_file_size_mb": 500
  },
  
  // Trust Verification
  "proof_of_identity": "base64-signature",
  "registration_timestamp": "2026-02-05T00:00:00Z",
  
  // Contact
  "contact_email": "tech@hospital-a.org"
}
```

### Proof of Identity

To prove ownership of the certificate's private key:

1. **Hospital generates signature**:
   ```python
   message = f"{hospital_id}{federation_endpoint}{timestamp}"
   signature = private_key.sign(SHA256(message))
   proof = base64.encode(signature)
   ```

2. **Registry verifies signature**:
   ```python
   cert = load_certificate(hospital_metadata.certificate_pem)
   public_key = cert.public_key()
   public_key.verify(signature, message)  # Throws if invalid
   ```

This proves the hospital owns the private key without transmitting it.

### Registration Flow

```
New Hospital (Hospital C)
     │
     │ 1. Generate metadata with proof
     ├──────────────────────────────────────────┐
     │                                           │
     │ POST /api/federation/registry/register   │
     │ {                                         │
     │   "metadata": { ... }                    │
     │ }                                         │
     │                                           │
     ▼                                           ▼
┌────────────────────────────────────────────────────┐
│         Federation Registry Service                │
│                                                    │
│  1. Verify certificate issued by CA ✓              │
│  2. Verify certificate fingerprint ✓               │
│  3. Verify proof of identity ✓                     │
│  4. Check certificate validity ✓                   │
│  5. Register hospital                              │
│  6. Return list of peers                           │
└────────────────────────────────────────────────────┘
     │
     │ Response:
     │ {
     │   "success": true,
     │   "peer_count": 2,
     │   "peers_discovered": ["hospital-a", "hospital-b"]
     │ }
     │
     ▼
Hospital C now knows about A & B
```

### Discovery Flow

```
Existing Hospital (Hospital A)
     │
     │ GET /api/federation/registry/discover?hospital_id=hospital-a
     │
     ▼
┌────────────────────────────────────────────────────┐
│         Federation Registry Service                │
│                                                    │
│  Returns all peers except hospital-a:              │
│  [                                                 │
│    {                                               │
│      "hospital_id": "hospital-b",                  │
│      "federation_endpoint": "...",                 │
│      "certificate_pem": "...",                     │
│      ...                                           │
│    },                                              │
│    {                                               │
│      "hospital_id": "hospital-c",  ← NEW!          │
│      ...                                           │
│    }                                               │
│  ]                                                 │
└────────────────────────────────────────────────────┘
     │
     ▼
Hospital A discovers Hospital C
Auto-configures mTLS connection
```

### Automatic Discovery Service

Runs in background on each hospital:

```python
class PeerDiscoveryService:
    """
    Periodically checks registry for new peers.
    Automatically configures mTLS connections.
    """
    
    async def discover_peers(self):
        # Query registry every 5 minutes
        peers = registry.discover_peers(self.hospital_id)
        
        for peer in peers:
            if peer.is_new:
                # New peer discovered!
                self._configure_peer(peer)
                logger.info(f"✨ Discovered: {peer.name}")
```

## API Endpoints

### 1. Self-Registration (Automatic)
```
POST /api/federation/registry/self-register

Uses local certificates to register this hospital.
No body required - reads from environment.

Response:
{
  "success": true,
  "hospital_id": "hospital-a",
  "federation_endpoint": "192.168.1.10:50051",
  "peer_count": 2,
  "peers": [...]
}
```

### 2. Manual Registration
```
POST /api/federation/registry/register

Body:
{
  "metadata": { HospitalMetadata }
}

Response:
{
  "success": true,
  "hospital_id": "hospital-c",
  "message": "Hospital registered successfully",
  "peer_count": 2
}
```

### 3. Discover Peers
```
GET /api/federation/registry/discover?hospital_id=hospital-a

Response:
{
  "success": true,
  "peers": [ array of HospitalMetadata ],
  "total_peers": 2
}
```

### 4. List All Hospitals
```
GET /api/federation/registry/list

Response:
{
  "success": true,
  "total_hospitals": 3,
  "hospitals": [
    {
      "hospital_id": "hospital-a",
      "hospital_name": "Hospital A",
      "federation_endpoint": "...",
      "status": "active"
    },
    ...
  ]
}
```

## Onboarding Process

### New Hospital Joins Network

1. **Generate mTLS certificates** (on development machine):
   ```powershell
   # Generate certificate signed by your offline CA
   .\scripts\generate-mtls-certs.ps1
   
   # This creates:
   # - certs/hospital-X-cert.pem (signed by CA)
   # - certs/hospital-X-key.pem (private key)
   # - Reuses existing certs/ca-cert.pem (trust anchor)
   
   # Note: CA doesn't run as a service - it's offline certificate generation
   ```

2. **Deploy hospital** with certificates:
   ```powershell
   .\scripts\deploy-hospitals.ps1 -HospitalC -Start
   ```

3. **Self-register** (automatic on startup):
   ```
   POST /api/federation/registry/self-register
   ```
   
   OR manually:
   ```powershell
   curl -X POST http://<hospital-c-ip>/api/federation/registry/self-register
   ```

4. **Existing hospitals auto-discover** (background service):
   - Runs every 5 minutes
   - Finds new Hospital C
   - Configures mTLS connection
   - Logs: "✨ Discovered new peer: Hospital C at 192.168.1.12:50051"

5. **Hospital C discovers existing peers**:
   ```
   GET /api/federation/registry/discover?hospital_id=hospital-c
   ```

6. **mTLS connections established**:
   - All hospitals now have each other's certificates
   - Can initiate secure connections
   - No manual configuration needed!

## Trust Model

### Certificate Trust Chain

The CA is a **static offline CA** (not a running service):
- Generated once: `scripts/generate-mtls-certs.ps1`
- Private key (`ca-key.pem`) stays on development machine
- Public cert (`ca-cert.pem`) distributed to all hospitals as trust anchor
- See [CA-ARCHITECTURE.md](CA-ARCHITECTURE.md) for details

```
┌──────────────────────────────────────────────┐
│  Certificate Authority (CA)                  │
│  [Static Offline - Not a Running Service]    │
│                                              │
│  Location: Development Machine               │
│  - ca-key.pem (private - keep secure!)       │
│  - ca-cert.pem (trust anchor - distribute)   │
│  - Fingerprint: abc123...                    │
└──────────────────────────────────────────────┘
              │
              │ Signs (one-time, offline)
              │
    ┌─────────┴─────────┬─────────┬─────────┐
    ▼                   ▼         ▼         ▼
┌─────────┐      ┌─────────┐  ┌─────────┐  ...
│Hospital │      │Hospital │  │Hospital │
│   A     │      │   B     │  │   C     │
│(has CA  │      │(has CA  │  │(has CA  │
│ cert)   │      │ cert)   │  │ cert)   │
└─────────┘      └─────────┘  └─────────┘

Trust Verification:
1. Hospital C presents certificate
2. Hospital A verifies:
   - Issued by trusted CA ✓
   - Certificate not expired ✓
   - Fingerprint matches registry ✓
3. Connection allowed ✓
```

### Security Guarantees

✅ **Authentication**: Only hospitals with CA-signed certificates can join
✅ **Non-repudiation**: Proof of identity signature prevents impersonation
✅ **Integrity**: Certificate fingerprints prevent tampering
✅ **Confidentiality**: mTLS encrypts all traffic with TLS 1.3
✅ **Freshness**: Certificate validity periods prevent replay attacks

## Deployment Integration

### Docker Compose Environment Variables

```yaml
fastapi:
  environment:
    - HOSPITAL_ID=hospital-c
    - HOSPITAL_NAME=Hospital C
    - TLS_CERT_FILE=/certs/hospital-c-cert.pem
    - TLS_KEY_FILE=/certs/hospital-c-key.pem
    - TLS_CA_FILE=/certs/ca-cert.pem
    # Optional: Explicit registry endpoint
    - FEDERATION_REGISTRY_URL=http://registry.federation.local
```

### Startup Sequence

```
1. FastAPI starts
2. Loads certificates
3. Initializes registry client
4. Self-registers (if not already registered)
5. Starts peer discovery service
6. Discovers existing peers
7. Configures mTLS connections
8. Ready for federation!
```

## Alternative: Distributed Registry

Instead of centralized registry, can use:

1. **Blockchain**: Immutable ledger of hospital registrations
2. **Gossip Protocol**: Hospitals share peer info peer-to-peer
3. **DNS-SD**: Service discovery via DNS TXT records
4. **Consul/etcd**: Service mesh with health checks

Current implementation uses **centralized REST API** for simplicity, but can be replaced with any of the above.

## Testing

### Register Hospital A
```powershell
curl -X POST http://localhost:8000/api/federation/registry/self-register
```

### Discover Peers
```powershell
curl http://localhost:8000/api/federation/registry/discover?hospital_id=hospital-a
```

### List All Hospitals
```powershell
curl http://localhost:8000/api/federation/registry/list
```

## Benefits

✅ **Zero Manual Configuration**: Hospitals auto-discover each other
✅ **Secure by Design**: Cryptographic proof required for registration
✅ **Automatic Updates**: Discovery service finds new peers
✅ **Scalable**: Registry can be distributed/replicated
✅ **Auditable**: All registrations logged with timestamps
✅ **Flexible**: Easy to add/remove hospitals

## Future Enhancements

1. **Certificate Rotation**: Auto-update when hospitals renew certificates
2. **Health Monitoring**: Track peer availability
3. **Geographic Routing**: Prefer nearby hospitals
4. **Load Balancing**: Distribute requests across replicas
5. **Smart Contracts**: Blockchain-based registration
6. **Zero-Knowledge Proofs**: Enhanced privacy

---

**Status**: ✅ Complete federation discovery and onboarding system implemented!
