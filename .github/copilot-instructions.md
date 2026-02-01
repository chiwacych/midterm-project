# Copilot AI Agent Instructions for medimage-store-fed-share

## Project Overview
- **Distributed file storage system** using FastAPI (API/UI), MinIO (object storage, 3-node cluster), PostgreSQL (metadata), and Redis (cache).
- Designed for fault tolerance, replication, and real-time health monitoring.

## Architecture & Data Flow
- **FastAPI app** (see `app/main.py`) exposes REST API and web UI, orchestrates uploads/downloads, manages metadata, and handles replication.
- **MinIO nodes** (3 containers) store file objects; all uploads are replicated to all nodes (see `app/minio_client.py`).
- **PostgreSQL** (see `app/database.py`, `app/models.py`) stores file metadata, logs, and node health.
- **Redis** (see `app/redis_client.py`) caches file metadata, file lists, and node health for performance.
- **Replication logic** and failover are managed in `app/replication_manager.py`.

## Developer Workflows
- **Start/stop all services:**
  - `docker-compose up -d --build` (or use `scripts/setup.ps1` on Windows for guided setup)
  - `docker-compose down` to stop
- **Check health:**
  - `docker-compose ps` (wait for all services to be healthy)
  - Web UI: [http://localhost:8000](http://localhost:8000)
  - MinIO consoles: [http://localhost:9001](http://localhost:9001), [9002], [9003]
- **Logs:** `docker-compose logs -f` or `docker-compose logs fastapi`
- **API docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

## Project-Specific Patterns & Conventions
- **All file uploads** are replicated to all MinIO nodes; partial replication is tracked and surfaced in API/UI.
- **Metadata and health** are always written to PostgreSQL, but reads may be served from Redis cache (see cache TTLs in README).
- **Node health** is checked and cached; failover is automatic for downloads if a node is down.
- **No authentication** on FastAPI endpoints (demo mode); MinIO consoles use basic auth (see README for credentials).
- **Configuration** is managed via `docker-compose.yml` (env vars for DB, Redis, MinIO endpoints/creds).
- **Testing fault tolerance:** Simulate node failures with `docker stop minio2` etc.; verify continued access and partial replication.

## Key Files & Directories
- `app/main.py` — FastAPI entrypoint, API/UI logic
- `app/minio_client.py` — MinIO cluster operations, replication
- `app/replication_manager.py` — Replication/failover logic
- `app/database.py`, `app/models.py` — PostgreSQL integration, ORM models
- `app/redis_client.py` — Redis cache logic
- `docker-compose.yml` — Service definitions, environment config
- `scripts/setup.ps1` — Windows setup script (checks Docker, starts services, shows endpoints)
- `README.md` — Full architecture, workflows, troubleshooting, and test scenarios

## Integration & External Dependencies
- **MinIO**: S3-compatible, 3-node cluster, accessed via Python SDK and REST
- **PostgreSQL**: Used for all metadata, logs, and health tracking
- **Redis**: Used for caching, not as a source of truth
- **Grafana/Prometheus**: (Optional) for monitoring, see `grafana/` and `prometheus.yml`

## Troubleshooting & Tips
- If services fail to start, run `docker-compose down -v` then `docker-compose up -d --build`
- For cache issues, flush Redis: `docker-compose exec redis redis-cli FLUSHDB`
- For node failures, restart with `docker start minio2` etc.
- See README for more test scenarios and troubleshooting steps

---
**For more details, always consult the latest README.md.**
