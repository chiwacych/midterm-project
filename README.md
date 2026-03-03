# Fault-Tolerant Medical Imaging Storage and Exchange Platform

## 🎯 Project Overview

A **federated, fault-tolerant medical imaging storage and exchange platform** implementing modern distributed systems principles with secure cross-facility data sharing. The system demonstrates distributed object storage using MinIO clusters, federated communication via gRPC with mutual TLS, event-driven architecture using Apache Kafka, and multi-facility simulation using Multipass virtual machines.

**Developed for:** APT 3065 — Advanced Programming Techniques (Summer 2026)  
**Project:** Fault-Tolerant Medical Imaging Storage and Exchange Platform  
**Compliance Framework:** Kenya Data Protection Act (2019)

### Key Features

**Federated Architecture:**
- ✅ **Multi-hospital deployment** via Multipass VMs (hospital-a, hospital-b, hospital-n)
- ✅ **gRPC federation service** (Go) with mutual TLS for secure inter-facility communication
- ✅ **Automated protocol buffer generation** during Docker builds
- ✅ **Cross-facility file sharing** with patient consent workflow
- ✅ **Real-time peer discovery** and latency measurement

**High Availability & Fault Tolerance:**
- ✅ **3-node MinIO cluster** per facility with erasure coding
- ✅ **PostgreSQL primary + 2 read replicas** per facility
- ✅ **Automatic failover** for file downloads when nodes fail
- ✅ **Health monitoring** with real-time status dashboard
- ✅ **Redis caching** for sub-100ms metadata queries

**Security & Compliance (Kenya Data Protection Act 2019):**
- ✅ **mTLS encryption** for all inter-facility communication (TLS 1.3)
- ✅ **JWT RS256 authentication** with role-based access control (RBAC)
- ✅ **Patient consent management** with grant/revoke workflows
- ✅ **Immutable audit logging** via Kafka event streaming
- ✅ **Data sovereignty** — all patient data remains within facility infrastructure

### Technical Stack

**Backend Services:**
- **FastAPI** (Python 3.11) — REST API, file orchestration, metadata management
- **Go gRPC Service** — Federation layer with streaming file transfer, mTLS
- **PostgreSQL 15** — Primary + 2 streaming replicas per facility
- **Apache Kafka 7.0** — Event bus for audit trail and cross-facility notifications
- **Redis 7** — In-memory cache for metadata and health status

**Storage & Distribution:**
- **MinIO** (3-node cluster per facility) — S3-compatible distributed object storage
- **Protocol Buffers** — Auto-generated from canonical `.proto` during Docker builds

**Frontend:**
- **React 18 + TypeScript** — Modern web interface
- **Vite** — Fast development build tool
- **React Router v6** — Client-side routing with protected routes

**Deployment & Orchestration:**
- **Multipass** — Lightweight Ubuntu VMs simulating hospital nodes
- **Docker & Docker Compose** — Service containerisation and orchestration
- **PowerShell Scripts** — Automated deployment to N hospitals

---

## 🏗️ System Architecture

### Federated Multi-Facility Topology

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         HOSPITAL A (Multipass VM)                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  FastAPI + React Frontend                                            │    │
│  │  • REST API  • Web UI  • Metadata Management  • Replication Control  │    │
│  └────────────────────┬─────────────────────────────────────────────────┘    │
│            ┌──────────┼─────────────┐                                        │
│            ▼          ▼             ▼                                        │
│    ┌────────────┬────────────┬────────────┐                                 │
│    │  MinIO-1   │  MinIO-2   │  MinIO-3   │  ◄─ 3-Node Cluster (Erasure)   │
│    └────────────┴────────────┴────────────┘                                 │
│            │          │             │                                        │
│    ┌───────┴──────────┴─────────────┴──────┐                               │
│    │  PostgreSQL (Primary + 2 Replicas)     │  ◄─ Streaming Replication     │
│    └────────────────────────────────────────┘                               │
│            │                                                                 │
│    ┌───────┴──────┬─────────────┬───────────────────┐                      │
│    │ Redis Cache  │ Kafka Broker│ gRPC Federation   │                      │
│    │ (Metadata)   │ (Audit Log) │ Service (Go+mTLS) │                      │
│    └──────────────┴─────────────┴───────────────────┘                      │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
                               │ mTLS gRPC (port 50051)
                               │ File Transfer + Peer Discovery
                               │
┌──────────────────────────────┴───────────────────────────────────────────────┐
│                         HOSPITAL B (Multipass VM)                             │
│  [Same architecture as Hospital A]                                            │
│  • Independent infrastructure                                                 │
│  • Secure mTLS communication                                                  │
│  • Patient consent enforcement                                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Layer Architecture (Per Facility)

1. **Storage Layer**: MinIO 3-node cluster with erasure coding
2. **Database Layer**: PostgreSQL primary + 2 read replicas (streaming replication)
3. **Caching Layer**: Redis for sub-100ms metadata queries
4. **Application Layer**: FastAPI REST API + React web interface
5. **Federation Layer**: Go gRPC service with mTLS, Kafka event bus
6. **Monitoring Layer**: Prometheus + Grafana (optional)

---

## 🧩 Application Stack

### Core Components

1. **FastAPI** - Main application interface
   - RESTful API endpoints
   - File upload/download handling
   - Replication management
   - Web UI serving

2. **MinIO Cluster** - Distributed object storage (3 nodes)
   - **MinIO1** (Port 9000) - Primary node
   - **MinIO2** (Port 9010) - Replica node
   - **MinIO3** (Port 9020) - Replica node
   - Each file is replicated across all 3 nodes

3. **PostgreSQL** - Metadata storage
   - File metadata (filename, size, checksum, etc.)
   - Upload logs and history
   - Replication status tracking
   - Node health monitoring

4. **Redis** - Caching layer
   - File metadata caching
   - File list caching
   - Node health status caching
   - Download statistics

---

## ✨ Core Requirements & Implementation

### 1. File Upload with Replication
- ✅ Files uploaded via FastAPI REST API
- ✅ Automatic replication to all 3 MinIO nodes
- ✅ Checksum verification (SHA-256)
- ✅ Upload progress tracking
- ✅ Concurrent upload to multiple nodes

### 2. Metadata Storage
- ✅ File information (name, size, type, upload time)
- ✅ User tracking
- ✅ Upload logs with timestamps
- ✅ Replication status per node
- ✅ Node health monitoring

### 3. Caching Layer
- ✅ Redis caching for metadata
- ✅ File list caching (5-minute TTL)
- ✅ Node health caching (1-minute TTL)
- ✅ Cache hit/miss statistics
- ✅ Popular files tracking

### 4. Fault Tolerance & Transparency
- ✅ Files accessible even if 1-2 nodes fail
- ✅ Real-time node health monitoring
- ✅ Automatic failover to healthy nodes
- ✅ Replication verification endpoint
- ✅ Visual indicators in UI

---

## 🚀 Getting Started

### Prerequisites

- **Windows 10/11** with Hyper-V enabled (for Multipass)
- **Multipass** installed ([multipass.run](https://multipass.run))
- **PowerShell 5.1+** for deployment scripts
- **Docker** and **Docker Compose** (installed inside VMs)
- At least **8GB RAM** available for VMs
- **20GB disk space** minimum

### Quick Start — Deploy Two Hospitals

1. **Navigate to project directory**
   ```powershell
   cd medimage-store-and-fed-share
   ```

2. **Run the automated deployment script**
   ```powershell
   .\scripts\deploy.ps1 -Hospital "both" -Start
   ```
   This will:
   - Generate mTLS certificates for both hospitals
   - Provision two Multipass VMs (`hospital-a`, `hospital-b`)
   - Transfer project files and configure each facility
   - Start all Docker services on both nodes
   - Configure cross-hospital networking in `/etc/hosts`

3. **Wait for services to initialize** (~2-3 minutes)
   ```powershell
   multipass exec hospital-a -- docker compose ps
   multipass exec hospital-b -- docker compose ps
   ```

4. **Get VM IP addresses**
   ```powershell
   multipass list
   ```

5. **Access the web interfaces**
   - Hospital A: `http://<hospital-a-ip>:8000`
   - Hospital B: `http://<hospital-b-ip>:8000`
   - API Documentation: `http://<hospital-a-ip>:8000/docs`

### Manual Deployment (Single Hospital)

```powershell
# Deploy hospital-c
.\scripts\deploy.ps1 -Hospital "hospital-c" -Start

# Check status
multipass exec hospital-c -- docker compose ps

# View logs
multipass exec hospital-c -- docker compose logs -f fastapi
```

### Managing the System

**Stop services on a hospital:**
```powershell
multipass exec hospital-a -- bash -c "cd /home/ubuntu/medimage && docker compose down"
```

**Restart services:**
```powershell
multipass exec hospital-a -- bash -c "cd /home/ubuntu/medimage && docker compose up -d"
```

**Delete a hospital VM:**
```powershell
multipass delete hospital-a
multipass purge
```

**Clean up everything:**
```powershell
.\scripts\deploy.ps1 -Hospital "all" -Clean
multipass purge
```

---

## 📚 API Documentation

### Interactive API Docs
- **Swagger UI**: `http://<hospital-ip>:8000/docs`
- **ReDoc**: `http://<hospital-ip>:8000/redoc`

### Key API Endpoints

#### Authentication

**Login**
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "doctor@hospital-a.local",
  "password": "password"
}

Response: {
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 1800
}
```

**Signup**
```http
POST /api/auth/signup
Content-Type: application/json

{
  "email": "patient@example.com",
  "password": "securepass",
  "full_name": "John Doe",
  "role": "patient"
}
```

#### File Operations (Requires JWT)

**Upload File**
```http
POST /api/files/upload
Authorization: Bearer <access_token>
Content-Type: multipart/form-data

Parameters:
  - file: File (required)
  - patient_id: Integer (required)
  - modality: String (e.g., "CT", "MRI")
  - description: String

Response: {
  "file_id": 123,
  "checksum": "sha256...",
  "replicated_nodes": ["minio1", "minio2", "minio3"]
}
```

**List Files**
```http
GET /api/files?patient_id=1
Authorization: Bearer <access_token>

Response: {
  "files": [...],
  "source": "cache"  # or "database"
}
```

**Download File**
```http
GET /api/files/{file_id}/download
Authorization: Bearer <access_token>

Returns: File stream (with consent check)
```

#### Federation Endpoints

**Get Federation Network Status**
```http
GET /api/federation/network/status
Authorization: Bearer <access_token>

Response: {
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
    "grpc_message": "ok",
    "peers_count": 1,
    "active_connections": 1
  },
  "peers": [
    {
      "id": "hospital-b",
      "name": "Hospital B",
      "endpoint": "hospital-b.local:50051",
      "status": "reachable",
      "latency_ms": 15.3,
      "mtls_enabled": true
    }
  ]
}
```

**Request File from Remote Hospital**
```http
POST /api/federation/request
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "remote_hospital_id": "hospital-b",
  "patient_id": 1,
  "file_id": 5,
  "reason": "Patient referral for specialist consultation"
}
```

#### Consent Management

**Grant Consent**
```http
POST /api/consent
Authorization: Bearer <access_token> # Patient token
Content-Type: application/json

{
  "requesting_facility": "hospital-b",
  "expires_days": 30
}
```

**Revoke Consent**
```http
DELETE /api/consent/{consent_id}
Authorization: Bearer <access_token>
```

**List My Consents**
```http
GET /api/consent
Authorization: Bearer <access_token>
```

#### System Monitoring

**Node Health Check**
```http
GET /api/nodes/health
Authorization: Bearer <access_token>

Response: {
  "nodes": {
    "minio1": {"healthy": true, "response_time_ms": 5},
    "minio2": {"healthy": true, "response_time_ms": 4},
    "minio3": {"healthy": false, "error": "Connection timeout"}
  }
}
```

**Audit Trail**
```http
GET /api/audit?event_type=file.download&limit=50
Authorization: Bearer <access_token> # Admin only

Response: {
  "events": [
    {
      "id": 123,
      "timestamp": "2026-02-14T18:30:00Z",
      "event_type": "file.download",
      "user_id": 5,
      "patient_id": 1,
      "file_id": 10,
      "ip_address": "172.29.129.233",
      "status": "success"
    }
  ]
}
```

---

## 🎨 Web UI Features

React 18 + TypeScript frontend with role-based views:

### Authentication & User Management
- **Login/Signup Pages**: JWT-based authentication with email/password
- **Role-Based Access**: Different dashboards for Admin, Doctor, and Patient roles
- **Protected Routes**: Automatic redirect to login for unauthenticated users

### Patient Dashboard
- **File Browser**: View own medical images with metadata (modality, patient ID, upload date)
- **Upload Medical Images**: Upload DICOM/imaging files with patient assignment
- **Consent Management**: Grant or revoke consent for cross-facility access
- **Consent History**: View which facilities have access to specific files

### Doctor Dashboard
- **File Management**: Upload patient files, assign to patient accounts
- **Cross-Facility Requests**: Search for patient files across federated hospitals
- **Consent Verification**: See consent status before accessing remote files
- **Download Medical Images**: Access consented files with audit trail logging

### Admin Dashboard
- **Federation Network Status**: Real-time health monitoring of peer facilities
- **MinIO Cluster Status**: Storage node health across all 3 MinIO nodes
- **System Statistics**: Total files, storage usage, cache hit rate, gRPC latency
- **Audit Trail Viewer**: Review all file access events and authentication logs
- **User Management**: Create accounts, assign roles (Admin/Doctor/Patient)

---

## 🔧 Configuration

### Multipass VM Deployment

Each hospital facility is deployed to a separate Multipass VM with its own `docker-compose.yml`.

**Hospital-Specific Variables** (auto-configured by `scripts/deploy.ps1`):
- `HOSPITAL_ID`: Unique identifier (e.g., `hospital-a`, `hospital-b`)
- `HOSPITAL_NAME`: Human-readable name (e.g., "Kenyatta National Hospital")
- `EXTERNAL_IP`: VM IP address for inter-facility communication
- `PEER_HOSPITALS`: Comma-separated list of peer facility endpoints

**Database Configuration:**
- `DATABASE_URL`: PostgreSQL connection string (primary node)
- `POSTGRES_USER=dfsuser`, `POSTGRES_PASSWORD=dfspassword`
- `POSTGRES_DB=dfs_metadata`
- Streaming replication configured for 2 replica nodes

**Redis Cache:**
- `REDIS_URL=redis://redis:6379`
- TTL: 5 minutes for file lists, 10 minutes for node health

**MinIO Storage:**
- 3-node cluster per facility with erasure coding
- `MINIO_ROOT_USER=minioadmin`, `MINIO_ROOT_PASSWORD=minioadmin123`
- Endpoints: `minio1:9000`, `minio2:9000`, `minio3:9000`

**gRPC Federation Service:**
- `GRPC_PORT=50051` (inter-facility communication)
- `MTLS_CERT_PATH`, `MTLS_KEY_PATH`, `MTLS_CA_PATH`: mTLS certificate paths
- Auto-generated by `scripts/generate-mtls-certs.ps1`

**JWT Authentication:**
- `JWT_PUBLIC_KEY`: RS256 public key for token verification
- `JWT_PRIVATE_KEY`: RS256 private key for token signing
- `JWT_ALGORITHM=RS256`, `ACCESS_TOKEN_EXPIRE_MINUTES=30`, `REFRESH_TOKEN_EXPIRE_DAYS=7`

**Kafka Audit Logging:**
- `KAFKA_BOOTSTRAP_SERVERS=kafka:9092`
- Topics: `file-events`, `auth-events`

---

## 🔐 Security & Compliance

### Authentication & Authorization
- **JWT RS256 Tokens**: Asymmetric signing with 2048-bit RSA keys
- **Access Tokens**: 30-minute expiry with user_id, email, role claims
- **Refresh Tokens**: 7-day expiry for seamless re-authentication
- **Role-Based Access Control (RBAC)**: Three roles with distinct permissions:
  - `admin`: Full system access, user management, audit trail review
  - `doctor`: Upload patient files, cross-facility search, consented downloads
  - `patient`: View own files, manage consent grants/revocations

### Inter-Facility Security (mTLS)
- **Mutual TLS**: All gRPC communication uses TLS 1.3 with client certificate validation
- **Certificate Authority**: Self-signed CA managed by deployment scripts
- **Automatic Certificate Discovery**: Peer certificates embedded in `/etc/hosts` configuration
- **mTLS Verification**: Both client and server authenticate each other before data transfer

### Patient Consent Enforcement
- **Access Control**: All file downloads check active consent records
- **Explicit Consent Required**: Patients must explicitly grant consent before cross-facility sharing
- **Revocation Support**: Patients can revoke consent at any time (immediate effect)
- **Audit Trail**: Every consent grant/revocation logged to Kafka with timestamp

### Immutable Audit Logging
- **Kafka-Backed Logs**: All file access and authentication events stored in Kafka topics
- **Append-Only**: Event logs cannot be modified or deleted
- **Retention Policy**: 90-day retention (configurable for compliance requirements)
- **Event Types**: File uploads, downloads, consent changes, login attempts, role changes

### Kenya Data Protection Act 2019 Alignment
- **Data Sovereignty**: Patient data stored only at originating facility (no central repository)
- **Consent-Based Sharing**: Explicit consent required for cross-border data transfers
- **Right to Access**: Patients can view all their files and consent history
- **Right to Erasure**: Patients can request file deletion (admin approval required)
- **Data Minimization**: Only necessary metadata replicated across facilities

---

## 🎯 Distributed Systems Concepts Demonstrated

### 1. **Federated Architecture**
- **Implementation:** Multi-facility deployment with independent infrastructure
- **Communication:** gRPC with mutual TLS for secure inter-facility data exchange
- **Discovery:** Automated peer discovery and latency measurement
- **Data Sovereignty:** Patient data never leaves facility infrastructure without explicit consent

### 2. **Fault Tolerance & Replication**
- **Storage:** 3-node MinIO clusters with erasure coding (survives 1 node failure)
- **Database:** PostgreSQL streaming replication (1 primary + 2 replicas)
- **Recovery:** Automatic failover for read operations; manual promotion for write failures
- **Validation:** Health monitoring with automatic unhealthy node detection

### 3. **Data Consistency**
- **Strong Consistency:** SHA-256 checksums ensure file integrity across nodes
- **Replication Verification:** API endpoint validates 3-way replication status
- **Transaction Safety:** PostgreSQL ACID guarantees for metadata operations
- **Eventual Consistency:** Kafka audit events may arrive out-of-order (acceptable for logging)

### 4. **Concurrency & Performance**
- **Read Scaling:** Redis caching achieves <100ms query latency
- **Database Replicas:** Read queries distributed across 2 replica nodes
- **Concurrent Uploads:** MinIO handles parallel writes with S3 multipart protocol
- **gRPC Streaming:** Efficient large file transfer with backpressure control

### 5. **Transparency**
- **Location Transparency:** Users don't know which MinIO node stores their file
- **Failure Transparency:** System automatically routes around failed nodes
- **Replication Transparency:** 3-way replication is automatic and invisible to users
- **Access Transparency:** Unified API regardless of which facility hosts the data

### 6. **Security & Compliance**
- **Authentication:** JWT RS256 with 30-minute access tokens, 7-day refresh tokens
- **Authorization:** Role-Based Access Control (Admin, Doctor, Patient)
- **Encryption:** mTLS for inter-facility communication (TLS 1.3)
- **Audit Trail:** Immutable Kafka-backed logs for all data access events
- **Consent Management:** Patient controls cross-facility sharing

### 7. **Protocol Design**
- **gRPC Protocol Buffers:** Strongly-typed service contracts for federation
- **Auto-Generated Stubs:** Proto file compiled during Docker builds (Go + Python)
- **Streaming RPC:** Efficient binary file transfer without loading entire file in memory
- **Health Checks:** gRPC health protocol for service availability monitoring

---

## 📊 Testing Fault Tolerance & Federation

### Test Scenario 1: Cross-Facility File Sharing with Consent

1. **Setup**: Deploy two hospitals (hospital-a and hospital-b)
2. **Upload**: Doctor at hospital-a uploads patient imaging file
3. **Search**: Doctor at hospital-b searches for the patient's files (should find 0 results)
4. **Grant Consent**: Patient grants consent to hospital-b via consent management UI
5. **Re-Search**: Doctor at hospital-b searches again (should now see the file)
6. **Download**: Doctor downloads file from hospital-a via gRPC streaming
7. **Audit**: Check audit logs for consent grant and file download events
8. **Revoke**: Patient revokes consent
9. **Verify**: Doctor at hospital-b can no longer access the file

### Test Scenario 2: MinIO Node Failure

1. Upload a file (verify 3/3 replication across MinIO nodes)
   ```powershell
   multipass exec hospital-a -- docker ps | grep minio
   ```
2. Stop one MinIO node:
   ```powershell
   multipass exec hospital-a -- docker stop minio2
   ```
3. Try downloading the file - should still work (failover to minio1 or minio3)
4. Check node health dashboard - should show `minio2` as unhealthy
5. New uploads will show partial success (2/3 replication)
6. Restart node:
   ```powershell
   multipass exec hospital-a -- docker start minio2
   ```
7. Verify node returns to healthy status

### Test Scenario 3: Database Replica Failover

1. Check current database connections:
   ```powershell
   multipass exec hospital-a -- docker-compose logs fastapi | grep "postgres"
   ```
2. Stop the primary database:
   ```powershell
   multipass exec hospital-a -- docker stop postgres-primary
   ```
3. Verify read operations still work (served by replicas)
4. Attempt write operation (upload) - should fail gracefully
5. Promote a replica to primary:
   ```powershell
   multipass exec hospital-a -- docker exec postgres-replica-1 pg_ctl promote
   ```
6. Update `DATABASE_URL` in docker-compose.yml to point to new primary
7. Restart FastAPI:
   ```powershell
   multipass exec hospital-a -- docker-compose restart fastapi
   ```
8. Verify write operations now work

### Test Scenario 4: gRPC mTLS Validation

1. Attempt connection without client certificate:
   ```bash
   grpcurl -plaintext hospital-b.example.com:50051 federation.v1.FederationService/GetNetworkStatus
   ```
   **Expected**: Connection refused (TLS required)

2. Attempt with invalid certificate:
   ```bash
   grpcurl -cert invalid.crt -key invalid.key hospital-b.example.com:50051 ...
   ```
   **Expected**: Certificate validation error

3. Valid mTLS connection:
   ```bash
   grpcurl -cert hospital-a.crt -key hospital-a.key -cacert ca.crt hospital-b.example.com:50051 federation.v1.FederationService/GetNetworkStatus
   ```
   **Expected**: Returns network status JSON

### Test Scenario 5: Cache Performance

1. Upload several patient files
2. List files via API (check response header: `X-Data-Source: database`)
3. List files again within 5 minutes (check header: `X-Data-Source: cache`)
4. Compare response times:
   - Database: ~150-300ms
   - Cache: ~15-50ms (10x faster)
5. Wait 5+ minutes (cache TTL expires)
6. List files again (should be from database)

### Test Scenario 6: Patient Consent Revocation

1. Patient grants consent to hospital-b
2. Doctor at hospital-b successfully downloads file
3. Patient revokes consent (via UI or API)
4. Doctor at hospital-b attempts to download same file
5. **Expected**: 403 Forbidden with error: "Patient has not granted consent"
6. Check Kafka audit log:
   ```powershell
   multipass exec hospital-a -- docker exec kafka kafka-console-consumer --topic file-events --bootstrap-server localhost:9092 --from-beginning
   ```
7. Verify consent revocation event is logged

---

## 📈 Performance Metrics

### Benchmarks (Measured on Multipass VMs)

- **Upload Speed**: ~3-8 MB/s per file (limited by disk I/O, not network)
- **Download Speed**: ~10-25 MB/s (gRPC streaming with compression)
- **Cache Hit Rate**: 65-85% after initial warming period
- **Cache Response Time**: <50ms (vs ~200ms for database queries)
- **Replication Time**: <2 seconds for files <50MB (3-node MinIO cluster)
- **gRPC Latency**: <10ms for local network, 50-150ms for cross-facility (depends on network)
- **Database Failover**: Query continues without interruption (replica promotion ~5-10 seconds)

### Monitoring Endpoints

- **System Statistics**: `GET /api/stats` (total files, storage, cache hit rate)
- **Node Health**: `GET /api/nodes/health` (MinIO cluster status per facility)
- **Federation Status**: `GET /api/federation/network-status` (peer facilities, gRPC health, latency)
- **Audit Logs**: `GET /api/audit/recent?limit=100` (recent file/auth events)
- **MinIO Console**: `http://<hospital-ip>:9001` (storage metrics, bucket usage)
- **Prometheus Metrics**: `http://<hospital-ip>:9090` (optional, for Grafana dashboards)

---

## 🛠️ Troubleshooting

### Issue: Multipass VMs won't start

**Solution:**
```powershell
multipass list
multipass delete hospital-a hospital-b
multipass purge
.\scripts\deploy.ps1 -NumHospitals 2
```

### Issue: Services won't start on VM

**Solution:**
```powershell
multipass exec hospital-a -- docker-compose down --remove-orphans
multipass exec hospital-a -- docker-compose up -d --build
```

### Issue: gRPC connection failures between facilities

**Check:**
1. mTLS certificates are present:
   ```powershell
   multipass exec hospital-a -- ls -la /home/ubuntu/medimage-store-and-fed-share/certs/
   ```
2. Federation service is running:
   ```powershell
   multipass exec hospital-a -- docker ps | grep federation
   ```
3. Port 50051 is accessible:
   ```powershell
   Test-NetConnection -ComputerName <peer-ip> -Port 50051
   ```
4. Check `/etc/hosts` has peer IPs:
   ```powershell
   multipass exec hospital-a -- cat /etc/hosts
   ```

### Issue: Login returns 401 Unauthorized

**Check:**
1. User exists in database:
   ```powershell
   multipass exec hospital-a -- docker exec postgres-primary psql -U dfsuser -d dfs_metadata -c "SELECT email, role FROM users;"
   ```
2. JWT keys are configured:
   ```powershell
   multipass exec hospital-a -- docker exec fastapi env | grep JWT
   ```
3. FastAPI logs for errors:
   ```powershell
   multipass exec hospital-a -- docker-compose logs fastapi | tail -50
   ```

---

## 📝 Project Structure

```
medimage-store-and-fed-share/
├── app/                          # FastAPI backend application
│   ├── main.py                   # API routes and application entry
│   ├── auth.py                   # JWT authentication logic
│   ├── consent_check.py          # Patient consent verification
│   ├── models.py                 # SQLAlchemy ORM models
│   ├── database.py               # PostgreSQL connection
│   ├── redis_client.py           # Redis cache manager
│   ├── minio_client.py           # MinIO cluster operations
│   ├── replication_manager.py    # Multi-node replication logic
│   ├── federation_client.py      # gRPC client for inter-facility calls
│   ├── kafka_client.py           # Kafka producer for audit logs
│   ├── metrics.py                # Prometheus metrics exporter
│   ├── audit.py                  # Audit logging utilities
│   ├── Dockerfile                # FastAPI container image (with proto codegen)
│   ├── requirements.txt          # Python dependencies
│   ├── routers/                  # Modular API route definitions
│   │   ├── auth.py               # Authentication endpoints
│   │   └── consent.py            # Consent management endpoints
│   └── proto/                    # gRPC protocol buffers
│       ├── federation.proto      # Federation service definition
│       ├── federation_pb2.py     # Generated Python protobuf classes
│       └── federation_pb2_grpc.py# Generated Python gRPC stubs
├── federation/                 # Go gRPC federation service
│   ├── main.go                   # gRPC server entry point
│   ├── Dockerfile                # Go container image (with proto codegen)
│   ├── go.mod                    # Go module dependencies
│   ├── internal/server/          # Server implementation
│   │   ├── server.go             # Federation RPC handlers
│   │   ├── jwt.go                # JWT validation for gRPC metadata
│   │   └── minio.go              # MinIO client for file streaming
│   └── pkg/federationv1/         # Generated Go protobuf/gRPC code
│       ├── federation.pb.go
│       └── federation_grpc.pb.go
├── frontend/                   # React TypeScript web UI
│   ├── src/
│   │   ├── pages/                # Page components
│   │   │   ├── Login.tsx
│   │   │   ├── Signup.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── FileBrowser.tsx
│   │   │   └── Consent.tsx
│   │   ├── components/           # Reusable components
│   │   │   ├── Layout.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── contexts/             # React Context providers
│   │   │   └── AuthContext.tsx   # JWT auth state management
│   │   └── api/client.ts         # Axios HTTP client with interceptors
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── scripts/                    # Deployment automation
│   ├── deploy.ps1                # Deploy N hospitals to Multipass VMs
│   ├── generate-mtls-certs.ps1   # Generate mTLS certificates
│   ├── setup.ps1                 # Initial setup script
│   ├── check_replication.py      # Verify MinIO replication status
│   ├── failover.sh               # Database failover automation
│   └── create-kafka-topics.sh    # Initialize Kafka topics
├── proto/                      # Shared protocol buffer definitions
│   └── federation.proto          # Source of truth (copied to app/ and federation/)
├── postgres-config/            # PostgreSQL initialization
│   ├── primary-init.sh           # Primary node setup
│   └── replica-init.sh           # Replica node streaming replication
├── grafana/                    # Optional Grafana dashboards
│   ├── dashboard.yml
│   └── datasource.yml
├── docker-compose.yml          # Service orchestration (per hospital)
├── prometheus.yml              # Metrics scraping configuration
└── README.md                   # This file
```

---

## 📚 References & Resources

### Documentation
- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [PostgreSQL Streaming Replication](https://www.postgresql.org/docs/15/warm-standby.html)
- [Redis Documentation](https://redis.io/documentation)
- [gRPC Documentation](https://grpc.io/docs/)
- [Protocol Buffers Guide](https://protobuf.dev/)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Multipass Documentation](https://multipass.run/docs)

### Kenya Data Protection Act 2019
- [Official Kenya Data Protection Act 2019](http://kenyalaw.org/kl/fileadmin/pdfdownloads/Acts/2019/TheDataProtectionAct__No24of2019.pdf)
- [Office of the Data Protection Commissioner (ODPC) Guidelines](https://www.odpc.go.ke/)

### Research Papers & Standards
- "The Google File System" (Ghemawat et al., 2003)
- "Designing Data-Intensive Applications" (Martin Kleppmann, 2017)
- "DICOM Standard for Medical Imaging" (NEMA PS3, 2023)
- "Health Level Seven (HL7) FHIR Standard"

---

## 📞 Support & Contact

For questions or issues:
1. Check the [Troubleshooting](#🛠️-troubleshooting) section
2. Review [API Documentation](#📡-api-documentation)
3. Check logs: `multipass exec hospital-a -- docker-compose logs`
4. Review [testing scenarios](#📊-testing-fault-tolerance--federation)

---

## 📄 License

This project is created for educational purposes as part of **APT 3065 - Distributed Systems (Midterm Project)**.

**Course**: APT 3065 - Advanced Distributed Systems  
**Institution**: Kenyatta University  
**Academic Year**: 2024/2025

---

**Built for APT 3065 Midterm Project - Federated Medical Imaging Storage Platform**
