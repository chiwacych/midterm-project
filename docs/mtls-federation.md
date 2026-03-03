# mTLS Federation Setup Guide

## Overview
This document describes the mutual TLS (mTLS) security implementation for secure hospital-to-hospital federation in the medical image storage and sharing system.

## What is mTLS?
Mutual TLS (mTLS) is a security protocol where both the client and server authenticate each other using X.509 certificates. Unlike standard TLS where only the server presents a certificate, mTLS requires both parties to exchange and verify certificates.

## Implementation Details

### Certificate Authority (CA)
- **Purpose**: Trust anchor for the federation network
- **Algorithm**: RSA 4096-bit
- **Validity**: 10 years
- **Location**: `certs/ca-cert.pem`, `certs/ca-key.pem`
- **Subject**: `CN=Hospital Federation CA`

### Hospital Certificates
Each hospital in the federation network has its own certificate:

#### Hospital A
- **Certificate**: `certs/hospital-a-cert.pem`
- **Private Key**: `certs/hospital-a-key.pem`
- **Subject**: `CN=hospital-a.local`
- **Usage**: Server authentication for federation gRPC service

#### Hospital B
- **Certificate**: `certs/hospital-b-cert.pem`
- **Private Key**: `certs/hospital-b-key.pem`
- **Subject**: `CN=hospital-b.local`
- **Usage**: Server and client authentication for federation

## Architecture

### Federation gRPC Service (Go)
- **Port**: 50051
- **TLS Version**: 1.3 (minimum)
- **Authentication**: `tls.RequireAndVerifyClientCert`
- **Environment Variables**:
  - `TLS_CERT_FILE`: Path to hospital certificate
  - `TLS_KEY_FILE`: Path to hospital private key
  - `TLS_CA_FILE`: Path to CA certificate

#### Configuration in `docker-compose.yml`
```yaml
federation:
  environment:
    - TLS_CERT_FILE=/certs/hospital-a-cert.pem
    - TLS_KEY_FILE=/certs/hospital-a-key.pem
    - TLS_CA_FILE=/certs/ca-cert.pem
  volumes:
    - ./certs:/certs:ro
```

### FastAPI Service
The FastAPI service detects mTLS status through environment variables and displays it in the federation network API:

**Endpoint**: `GET /api/federation/network/status`

**Response**:
```json
{
  "hospital": {
    "id": "hospital-a",
    "name": "Hospital A",
    "status": "healthy"
  },
  "security": {
    "mtls_enabled": true,
    "encryption": "TLS 1.3",
    "certificate_status": "valid"
  },
  "federation": {
    "grpc_service": "healthy",
    "peers_count": 1,
    "active_connections": 1
  },
  "statistics": {
    "active_exchanges": 5,
    "total_consents": 12
  }
}
```

### Frontend UI
The React frontend displays mTLS status in the Federation Network page:

#### Security Status Card
- Green gradient background when mTLS is enabled
- Shows encryption type (TLS 1.3)
- Displays active exchange count
- Warning indicator if mTLS is disabled

#### Node Cards
Each federation node shows:
- 🔐 mTLS badge if secure connection
- Node health status
- Network latency
- Capabilities

## Certificate Generation

### Using PowerShell Script
```powershell
.\scripts\generate-mtls-certs.ps1
```

This script:
1. Generates CA certificate and private key
2. Creates certificates for Hospital A and Hospital B
3. Signs hospital certificates with CA
4. Validates all certificates
5. Saves files to `certs/` directory

### Manual Generation (Linux/Mac)
```bash
# Generate CA
openssl genrsa -out certs/ca-key.pem 4096
openssl req -new -x509 -days 3650 -key certs/ca-key.pem \
  -out certs/ca-cert.pem \
  -subj "/CN=Hospital Federation CA"

# Generate Hospital A certificate
openssl genrsa -out certs/hospital-a-key.pem 4096
openssl req -new -key certs/hospital-a-key.pem \
  -out certs/hospital-a.csr \
  -subj "/CN=hospital-a.local"
openssl x509 -req -days 3650 \
  -in certs/hospital-a.csr \
  -CA certs/ca-cert.pem \
  -CAkey certs/ca-key.pem \
  -CAcreateserial \
  -out certs/hospital-a-cert.pem

# Repeat for Hospital B...
```

## Deployment

### Local Development
1. Generate certificates: `.\scripts\generate-mtls-certs.ps1`
2. Start services: `docker-compose up -d`
3. Verify mTLS: `curl http://localhost:8000/api/federation/network/status`
4. Check logs: `docker-compose logs federation | Select-String "mTLS"`

Expected log output:
```
federation-grpc  | 2026/02/01 20:02:04 🔐 Enabling mTLS (Mutual TLS) for secure federation...
federation-grpc  | 2026/02/01 20:02:04 ✓ mTLS enabled with certificate: /certs/hospital-a-cert.pem
```

### Multipass VM Deployment
1. Copy certificates to each VM:
```bash
# On Hospital A VM
multipass transfer certs/ca-cert.pem hospital-a:/home/ubuntu/medimage/certs/
multipass transfer certs/hospital-a-cert.pem hospital-a:/home/ubuntu/medimage/certs/
multipass transfer certs/hospital-a-key.pem hospital-a:/home/ubuntu/medimage/certs/

# On Hospital B VM
multipass transfer certs/ca-cert.pem hospital-b:/home/ubuntu/medimage/certs/
multipass transfer certs/hospital-b-cert.pem hospital-b:/home/ubuntu/medimage/certs/
multipass transfer certs/hospital-b-key.pem hospital-b:/home/ubuntu/medimage/certs/
```

2. Update docker-compose on each VM with correct environment variables
3. Add peer hospital endpoints:
```yaml
fastapi:
  environment:
    - FEDERATION_PEER_HOSPITAL_B=hospital-b.local:50051
```

4. Restart services on both VMs

## Security Considerations

### Certificate Management
- **Rotation**: Certificates are valid for 10 years. Plan rotation before expiry.
- **Storage**: Private keys must be kept secure. Never commit to version control.
- **Access**: Only the federation service should have read access to private keys.

### Network Security
- **Firewall**: Only expose port 50051 to trusted federation peers
- **VPN**: Consider running federation over VPN for additional security
- **Monitoring**: Log all connection attempts and certificate validation failures

### Certificate Revocation
If a certificate is compromised:
1. Remove the compromised peer from `FEDERATION_PEER_*` configuration
2. Generate new certificates for the affected hospital
3. Redistribute CA certificate if CA is compromised
4. Update and restart all services

## Testing mTLS

### Verify Federation Service
```powershell
# Check service logs
docker-compose logs federation | Select-String "mTLS"

# Test API endpoint
curl http://localhost:8000/api/federation/network/status | ConvertFrom-Json | Select-Object -ExpandProperty security
```

Expected output:
```json
{
  "mtls_enabled": true,
  "encryption": "TLS 1.3",
  "certificate_status": "valid"
}
```

### Test Certificate Validation
```bash
# Verify certificate chain
openssl verify -CAfile certs/ca-cert.pem certs/hospital-a-cert.pem

# Expected output:
# certs/hospital-a-cert.pem: OK
```

### Test Connection
```bash
# Test gRPC connection with mTLS
grpcurl -insecure \
  -cert certs/hospital-b-cert.pem \
  -key certs/hospital-b-key.pem \
  -cacert certs/ca-cert.pem \
  localhost:50051 \
  FederationService/Health
```

## Troubleshooting

### mTLS Not Enabled
**Symptom**: API shows `"mtls_enabled": false`

**Solutions**:
1. Check environment variables are set:
   ```powershell
   docker-compose exec fastapi printenv | Select-String TLS
   ```
2. Verify certificate files exist in container:
   ```powershell
   docker-compose exec fastapi ls -l /certs/
   ```
3. Check docker-compose.yml has volume mount: `./certs:/certs:ro`

### Certificate Verification Failed
**Symptom**: "x509: certificate signed by unknown authority"

**Solutions**:
1. Ensure CA certificate is included in `TLS_CA_FILE`
2. Verify certificate chain with `openssl verify`
3. Check certificate dates haven't expired
4. Regenerate certificates if corrupted

### Connection Refused
**Symptom**: "connection refused" when connecting to peer

**Solutions**:
1. Check federation service is running: `docker-compose ps federation`
2. Verify firewall allows port 50051
3. Test network connectivity: `ping hospital-b.local`
4. Check peer endpoint configuration

## Performance Impact
- **Handshake Overhead**: ~50-100ms for initial connection
- **Throughput**: Minimal impact (<5%) after handshake
- **CPU Usage**: Slightly higher for encryption/decryption
- **Recommended**: Use connection pooling for frequent communications

## Compliance
mTLS implementation helps meet compliance requirements for:
- **HIPAA**: Secure transmission of PHI
- **GDPR**: Protection of personal health data
- **HITECH**: Encryption of electronic health records

## References
- Go TLS Configuration: https://pkg.go.dev/crypto/tls
- gRPC Security: https://grpc.io/docs/guides/auth/
- X.509 Certificates: https://tools.ietf.org/html/rfc5280
- TLS 1.3 Specification: https://tools.ietf.org/html/rfc8446

## Support
For issues or questions:
1. Check logs: `docker-compose logs federation fastapi`
2. Verify configuration in `docker-compose.yml`
3. Test API: `GET /api/federation/network/status`
4. Review this documentation

---

**Last Updated**: February 1, 2026
**Version**: 1.0
**Status**: ✅ Production Ready
