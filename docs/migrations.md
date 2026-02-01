# Midterm Migration

This document points to the full implementation roadmap.

**See [migration-roadmap.md](./migration-roadmap.md)** for the complete checklist and status of features (auth, Go federation, Kafka, consent, frontend, etc.).

## Quick reference

- **Backend (FastAPI):** Auth (JWT RS256, RBAC), consent models & API, duplicate rejection (SHA256), audit logging (Kafka), CORS & security headers.
- **Go Federation:** `proto/`, `federation/` gRPC service with MinIO pool, file streaming, SHA256 duplicate detection, JWT validation; Docker integration.
- **Kafka:** Zookeeper + Kafka in docker-compose; Python `aiokafka` producer for audit events; topic `medimage.audit`.
- **Frontend (React+TS):** Vite app in `frontend/` with login/signup, auth context, protected routes, dashboard, file browser (upload/download/delete).

Run the stack: `docker-compose up -d`. API: http://localhost:8000, docs: http://localhost:8000/docs. Frontend: `cd frontend && npm install && npm run dev` (proxy to API).
