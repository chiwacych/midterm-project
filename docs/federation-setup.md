# Federation Network Setup and Testing Guide

## Overview
This guide explains how to set up and test the federation network between Hospital A and Hospital B using multipass VMs.

## Prerequisites
- Multipass installed and running
- Docker Desktop installed (for local development)
- Two VMs created: hospital-a and hospital-b
- Both VMs must be running

## Architecture

```
┌─────────────────────┐         ┌─────────────────────┐
│   Hospital A VM     │         │   Hospital B VM     │
│  172.29.136.54      │◄────────►│  172.29.140.113     │
│                     │  gRPC   │                     │
│  API: :8001         │         │  API: :8002         │
│  gRPC: :50052       │         │  gRPC: :50053       │
│  MinIO: :9001       │         │  MinIO: :9002       │
│  Grafana: :3001     │         │  Grafana: :3002     │
│  PostgreSQL: :5435  │         │  PostgreSQL: :5436  │
└─────────────────────┘         └─────────────────────┘
```

## Step 1: Start VMs

```powershell
multipass start hospital-a hospital-b
multipass list
```

## Step 2: Deploy Hospital A

From the `scripts` directory:

```powershell
.\deploy-hospital-a.ps1
```

This will:
1. Install Docker in hospital-a VM
2. Transfer project files
3. Create environment configuration
4. Start all services via docker-compose

## Step 3: Deploy Hospital B

```powershell
.\deploy-hospital-b.ps1
```

This performs the same steps for hospital-b.

## Step 4: Verify Deployments

### Check Hospital A
```powershell
multipass exec hospital-a -- docker ps
multipass exec hospital-a -- docker compose logs fastapi
```

### Check Hospital B
```powershell
multipass exec hospital-b -- docker ps
multipass exec hospital-b -- docker compose logs fastapi
```

### Test API endpoints
```powershell
# Hospital A health check
curl http://172.29.136.54:8001/health

# Hospital B health check
curl http://172.29.140.113:8002/health
```

## Step 5: Test Federation Network

### Manual Testing

1. **Create a patient in Hospital A:**
```powershell
$tokenA = (Invoke-RestMethod -Method Post -Uri "http://172.29.136.54:8001/api/auth/login" `
  -ContentType "application/json" `
  -Body '{"email":"admin@example.com","password":"admin"}').access_token

$patientA = Invoke-RestMethod -Method Post -Uri "http://172.29.136.54:8001/api/patients" `
  -Headers @{Authorization="Bearer $tokenA"} `
  -ContentType "application/json" `
  -Body '{"first_name":"John","last_name":"Doe","date_of_birth":"1980-01-01","gender":"M","contact_info":"john@example.com"}'

$patientId = $patientA.id
Write-Host "Created patient: $patientId"
```

2. **Grant consent for Hospital B:**
```powershell
$consent = Invoke-RestMethod -Method Post -Uri "http://172.29.136.54:8001/api/consent" `
  -Headers @{Authorization="Bearer $tokenA"} `
  -ContentType "application/json" `
  -Body @"
{
  "patient_id": $patientId,
  "consented_hospital": "hospital-b",
  "data_categories": ["medical_images", "patient_info"],
  "purpose": "Cross-hospital consultation",
  "expiry_date": "2026-12-31"
}
"@

Write-Host "Consent granted"
```

3. **Query patient from Hospital B:**
```powershell
$tokenB = (Invoke-RestMethod -Method Post -Uri "http://172.29.140.113:8002/api/auth/login" `
  -ContentType "application/json" `
  -Body '{"email":"admin@example.com","password":"admin"}').access_token

$federatedPatient = Invoke-RestMethod -Method Get `
  -Uri "http://172.29.140.113:8002/api/federation/patients/${patientId}?source_hospital=hospital-a" `
  -Headers @{Authorization="Bearer $tokenB"}

$federatedPatient | ConvertTo-Json
```

4. **Upload and share medical images:**
```powershell
# Upload DICOM file to Hospital A
$file = "C:\path\to\test.dcm"
$form = @{
    file = Get-Item $file
    patient_id = $patientId
    description = "Test DICOM image"
}

$upload = Invoke-RestMethod -Method Post -Uri "http://172.29.136.54:8001/api/upload" `
  -Headers @{Authorization="Bearer $tokenA"} `
  -Form $form

$fileId = $upload.file_id

# Access from Hospital B via federation
$federatedFile = Invoke-RestMethod -Method Get `
  -Uri "http://172.29.140.113:8002/api/federation/files/${fileId}?source_hospital=hospital-a" `
  -Headers @{Authorization="Bearer $tokenB"} `
  -OutFile "federated_file.dcm"
```

## Monitoring

### View Federation Logs
```powershell
# Hospital A federation logs
multipass exec hospital-a -- docker compose logs -f federation

# Hospital B federation logs
multipass exec hospital-b -- docker compose logs -f federation
```

### Check gRPC Communication
```powershell
# From Hospital A to Hospital B
multipass exec hospital-a -- nc -zv 172.29.140.113 50053

# From Hospital B to Hospital A
multipass exec hospital-b -- nc -zv 172.29.136.54 50052
```

### Access Web Interfaces

- **Hospital A**:
  - API: http://172.29.136.54:8001
  - MinIO Console: http://172.29.136.54:9001
  - Grafana: http://172.29.136.54:3001

- **Hospital B**:
  - API: http://172.29.140.113:8002
  - MinIO Console: http://172.29.140.113:9002
  - Grafana: http://172.29.140.113:3002

## Troubleshooting

### Services not starting
```powershell
multipass exec hospital-a -- docker compose ps
multipass exec hospital-a -- docker compose logs
```

### Network connectivity issues
```powershell
# Check if VMs can reach each other
multipass exec hospital-a -- ping -c 3 172.29.140.113
multipass exec hospital-b -- ping -c 3 172.29.136.54
```

### Reset a hospital
```powershell
multipass exec hospital-a -- bash -c "cd /home/ubuntu && docker compose down -v"
multipass exec hospital-a -- bash -c "cd /home/ubuntu && docker compose up -d"
```

### Complete VM restart
```powershell
multipass stop hospital-a
multipass start hospital-a
```

## Security Notes

1. **JWT Tokens**: Change the default JWT secret in production
2. **Database Passwords**: Update default passwords in .env files
3. **MinIO Credentials**: Change minioadmin credentials
4. **Network Security**: Consider implementing VPN or mTLS for inter-hospital communication
5. **Consent Management**: Always verify consent before accessing federated data

## DPA Compliance

The federation network implements:
- **Consent-based access**: All cross-hospital data access requires explicit patient consent
- **Audit logging**: All federation operations are logged
- **Data minimization**: Only necessary data is shared
- **Purpose limitation**: Access is restricted to consented purposes
- **Access control**: Role-based permissions enforced on both sides

## Next Steps

1. Configure SSL/TLS certificates for production
2. Set up VPN between hospital networks
3. Implement automated consent renewal notifications
4. Add real-time audit log monitoring
5. Configure backup and disaster recovery procedures
