# Certificate Authority (CA) - Where and How It Runs

## Quick Answer

**The CA doesn't "run" anywhere** - it's a **static offline CA** model.

The Certificate Authority exists as:
- **Private Key**: `certs/ca-key.pem` (kept secure on your development machine)
- **Certificate**: `certs/ca-cert.pem` (distributed to all hospitals as trust anchor)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Development Machine / Certificate Management Server        │
│  (Your Local Computer)                                      │
│                                                              │
│  certs/                                                     │
│  ├── ca-key.pem ← 🔒 PRIVATE - Keep Secure!                │
│  ├── ca-cert.pem ← Trust Anchor (distribute to hospitals)   │
│  ├── hospital-a-key.pem                                     │
│  ├── hospital-a-cert.pem                                    │
│  ├── hospital-b-key.pem                                     │
│  └── hospital-b-cert.pem                                    │
│                                                              │
│  Script: scripts/generate-mtls-certs.ps1                    │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Transfer certificates
                          │ (multipass transfer)
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐
   │Hospital A  │  │Hospital B  │  │Hospital C  │
   │VM          │  │VM          │  │VM          │
   │            │  │            │  │            │
   │certs/      │  │certs/      │  │certs/      │
   │├─ca-cert   │  │├─ca-cert   │  │├─ca-cert   │
   │├─hosp-a-cert│  │├─hosp-b-cert│  │├─hosp-c-cert│
   │└─hosp-a-key│  │└─hosp-b-key│  │└─hosp-c-key│
   └────────────┘  └────────────┘  └────────────┘
```

## What Is This CA Model?

### Offline CA (Static Trust Anchor)
This is a **self-signed root CA** that:
- ✅ Creates a trust domain for the hospital federation
- ✅ Signs all hospital certificates once during setup
- ✅ Doesn't need to run as a service
- ✅ Private key stays offline (most secure)
- ❌ Can't revoke certificates dynamically
- ❌ Can't issue new certificates automatically

### How It Works

#### 1. **Certificate Generation** (One-time setup)
```powershell
# Run on your development machine
.\scripts\generate-mtls-certs.ps1
```

This script:
```
Step 1: Generate CA
  - Creates ca-key.pem (4096-bit RSA private key)
  - Creates ca-cert.pem (self-signed, valid 10 years)
  
Step 2: Generate Hospital A certificates
  - Creates hospital-a-key.pem (private key)
  - Creates CSR (Certificate Signing Request)
  - CA signs the CSR → hospital-a-cert.pem
  
Step 3: Generate Hospital B certificates
  - Same process for Hospital B

Step 4: Clean up temporary files (CSRs)
```

#### 2. **Certificate Distribution** (Deployment)
```powershell
# Deploy script transfers certificates to VMs
.\scripts\deploy-to-vm.ps1 -VM hospital-a

# Transfers:
multipass transfer certs/ca-cert.pem hospital-a:/home/ubuntu/medimage/certs/
multipass transfer certs/hospital-a-cert.pem hospital-a:/home/ubuntu/medimage/certs/
multipass transfer certs/hospital-a-key.pem hospital-a:/home/ubuntu/medimage/certs/
```

#### 3. **Runtime Verification** (In Services)
Each hospital's services (FastAPI, Federation gRPC) load:
- **ca-cert.pem**: To verify peer certificates
- **hospital-X-cert.pem**: Their identity certificate
- **hospital-X-key.pem**: Their private key

```yaml
# docker-compose.yml
fastapi:
  environment:
    - TLS_CERT_FILE=/certs/hospital-a-cert.pem
    - TLS_KEY_FILE=/certs/hospital-a-key.pem
    - TLS_CA_FILE=/certs/ca-cert.pem  ← Trust anchor

federation:
  environment:
    - TLS_CERT_FILE=/certs/hospital-a-cert.pem
    - TLS_KEY_FILE=/certs/hospital-a-key.pem
    - TLS_CA_FILE=/certs/ca-cert.pem  ← Trust anchor
```

## Trust Chain Verification

```
Hospital A connects to Hospital B:

┌─────────────────────────────────────────────────────────┐
│  Hospital A (Client)                                     │
│                                                          │
│  1. Load ca-cert.pem (trust anchor)                     │
│  2. Connect to Hospital B:50051                         │
│  3. Hospital B presents hospital-b-cert.pem             │
│  4. Verify:                                             │
│     ✓ Certificate signed by CA (using ca-cert.pem)      │
│     ✓ Certificate not expired                           │
│     ✓ Certificate CN matches hostname                   │
│  5. Present hospital-a-cert.pem                         │
│  6. Hospital B verifies same way                        │
│  7. ✅ mTLS connection established                      │
└─────────────────────────────────────────────────────────┘
```

## CA File Locations

### Development Machine
```
c:\Users\WN\chiwa-hub\chiwa-edu\midterm-project\medimage-store-and-fed-share\
└── certs/
    ├── ca-key.pem       ← 🔒 KEEP SECURE - Never transfer to VMs!
    ├── ca-cert.pem      ← Distribute to all hospitals
    ├── hospital-a-key.pem
    ├── hospital-a-cert.pem
    ├── hospital-b-key.pem
    └── hospital-b-cert.pem
```

### Hospital VMs
```
/home/ubuntu/medimage/
└── certs/
    ├── ca-cert.pem              ← Trust anchor (same for all)
    ├── hospital-X-cert.pem      ← This hospital's identity
    └── hospital-X-key.pem       ← This hospital's private key
```

### Docker Containers
```
/certs/
├── ca-cert.pem              ← Mounted from VM
├── hospital-X-cert.pem      ← Mounted from VM
└── hospital-X-key.pem       ← Mounted from VM
```

## Security Considerations

### ✅ What This Model Provides
- **Trust Domain**: All hospitals trust certificates signed by this CA
- **Mutual Authentication**: Both sides verify each other
- **Encryption**: TLS 1.3 with strong cipher suites
- **Simple Management**: No CA service to maintain
- **Offline CA**: Private key never exposed to network

### ⚠️ Limitations
- **No Revocation**: Can't revoke compromised certificates
  - Solution: Short validity periods + periodic rotation
- **No Online Issuance**: Can't issue new certificates automatically
  - Solution: Pre-generate certificates or manual process
- **No OCSP/CRL**: No online certificate status checking
  - Solution: Federation registry with certificate fingerprints

### 🔐 Best Practices
1. **Protect CA Private Key**:
   ```powershell
   # Never commit to git
   echo "certs/*.pem" >> .gitignore
   
   # Restrict permissions
   icacls certs\ca-key.pem /inheritance:r /grant:r "%USERNAME%:R"
   ```

2. **Backup CA Key Securely**:
   ```powershell
   # Encrypt and store in secure location
   # Option 1: Azure Key Vault
   # Option 2: Hardware Security Module (HSM)
   # Option 3: Encrypted backup drive
   ```

3. **Certificate Rotation**:
   ```powershell
   # Regenerate hospital certificates periodically
   # Keep same CA for continuity
   .\scripts\generate-mtls-certs.ps1 -RotateCertificates
   ```

## Adding a New Hospital

When a new hospital (Hospital C) joins:

```powershell
# 1. Generate certificate on development machine
cd certs
openssl genrsa -out hospital-c-key.pem 4096
openssl req -new -key hospital-c-key.pem -out hospital-c-csr.pem \
  -subj "/C=US/ST=State/L=City/O=Hospital C/CN=hospital-c.local"
openssl x509 -req -days 3650 -in hospital-c-csr.pem \
  -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial \
  -out hospital-c-cert.pem

# 2. Transfer to Hospital C VM
multipass transfer ca-cert.pem hospital-c:/home/ubuntu/medimage/certs/
multipass transfer hospital-c-cert.pem hospital-c:/home/ubuntu/medimage/certs/
multipass transfer hospital-c-key.pem hospital-c:/home/ubuntu/medimage/certs/

# 3. Deploy Hospital C
.\scripts\deploy-to-vm.ps1 -VM hospital-c -HospitalID hospital-c

# 4. Hospital C auto-registers and discovers peers
# (Federation registry handles this automatically)
```

## Alternative: Online CA Service

If you need dynamic certificate issuance, you could run a CA service:

```yaml
# docker-compose-ca.yml (optional)
services:
  ca-service:
    image: smallstep/step-ca
    ports:
      - "9000:9000"
    environment:
      - DOCKER_STEPCA_INIT_NAME=Hospital Federation CA
      - DOCKER_STEPCA_INIT_DNS_NAMES=ca.federation.local
    volumes:
      - ca-data:/home/step
```

This would provide:
- ✅ Automatic certificate issuance via ACME protocol
- ✅ Certificate revocation (OCSP/CRL)
- ✅ Short-lived certificates with auto-renewal
- ✅ REST API for certificate management

**But for your current needs, the static offline CA is sufficient and more secure!**

## Verification

### Check CA Certificate
```powershell
# On development machine
openssl x509 -in certs/ca-cert.pem -text -noout

# Shows:
# Subject: CN=Federation CA, O=Hospital Federation
# Issuer: CN=Federation CA (self-signed)
# Validity: 10 years
# Public Key: RSA 4096 bit
```

### Check Hospital Certificate
```powershell
# Verify hospital cert signed by CA
openssl verify -CAfile certs/ca-cert.pem certs/hospital-a-cert.pem
# Output: certs/hospital-a-cert.pem: OK

# Check certificate details
openssl x509 -in certs/hospital-a-cert.pem -text -noout
# Shows:
# Subject: CN=hospital-a.local, O=Hospital A
# Issuer: CN=Federation CA (our CA!)
```

### Test mTLS Connection
```powershell
# From Hospital A VM
grpcurl -insecure \
  -cert /home/ubuntu/medimage/certs/hospital-a-cert.pem \
  -key /home/ubuntu/medimage/certs/hospital-a-key.pem \
  -cacert /home/ubuntu/medimage/certs/ca-cert.pem \
  hospital-b.local:50051 list

# Should connect successfully with mTLS
```

## Summary

| Aspect | Details |
|--------|---------|
| **CA Type** | Self-signed, offline root CA |
| **CA Location** | Development machine (`certs/ca-key.pem`, `certs/ca-cert.pem`) |
| **Running Service?** | ❌ No - static certificates only |
| **Certificate Issuance** | Manual, via OpenSSL commands |
| **Validity Period** | 10 years (3650 days) |
| **Trust Model** | All hospitals trust `ca-cert.pem` |
| **Verification** | Each service verifies peer certs against CA |
| **Revocation** | Not supported (use certificate rotation) |
| **Security** | CA private key kept offline (most secure) |

## Key Takeaways

1. **CA = Trust Anchor File**: The CA is just `ca-cert.pem` distributed to all hospitals
2. **No CA Service**: It's a static file, not a running process
3. **Offline = Secure**: Private key never exposed to network
4. **Simple Model**: Perfect for small federations (2-10 hospitals)
5. **Federation Registry**: Provides discovery and trust verification at runtime

**The CA establishes the trust domain, the Federation Registry enables discovery and onboarding!** 🔐
