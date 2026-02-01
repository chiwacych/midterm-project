# Testing the Midterm Stack

Use this to verify backend, federation gRPC, frontend, auth, files, and consent.

## 1. Start the stack

```bash
# From project root
docker-compose up -d

# Wait for services (Postgres, Redis, MinIO, Kafka, Federation, FastAPI)
docker-compose ps
```

Ensure `fastapi-dfs` and `federation-grpc` are running. Frontend runs separately:

```bash
cd frontend
npm install
npm run dev
```

- API: http://localhost:8000  
- API docs: http://localhost:8000/docs  
- Frontend: http://localhost:3000 (proxies /api to 8000)  
- Federation gRPC: localhost:50051  

## 2. Backend & Federation gRPC

- **Health**
  - `GET http://localhost:8000/api/nodes/health` — MinIO nodes (no auth).
  - `GET http://localhost:8000/api/federation/health` — Federation gRPC + MinIO. If federation is down, returns 503.

- **Auth**
  - `POST http://localhost:8000/api/auth/signup` — Body: `{"email":"p@test.com","password":"pass123","full_name":"Patient"}`. Should return `access_token`, `refresh_token`.
  - `POST http://localhost:8000/api/auth/login` — Body: `{"email":"p@test.com","password":"pass123"}`. Same.
  - `GET http://localhost:8000/api/auth/me` — Header: `Authorization: Bearer <access_token>`. Should return user (id, email, role).

- **Files (auth required)**
  - `GET http://localhost:8000/api/files` — Header: `Authorization: Bearer <token>`. List files (patients see only their own).
  - `POST http://localhost:8000/api/upload` — Form: `file`, `description` (optional). Header: `Authorization: Bearer <token>`. Upload; duplicate SHA256 returns 409.
  - `GET http://localhost:8000/api/files/{id}/download` — Header: `Authorization: Bearer <token>`. Download; 403 if no consent for non-owner.
  - `DELETE http://localhost:8000/api/files/{id}` — Header: `Authorization: Bearer <token>`. Delete (owner or admin).

- **Consent (patient)**
  - `GET http://localhost:8000/api/consent` — List consents.
  - `POST http://localhost:8000/api/consent` — Body: `{"scope":"all","granted_to_role":"doctor"}`. Grant.
  - `POST http://localhost:8000/api/consent/{id}/revoke` — Revoke.

## 3. Frontend (manual)

1. **Login/Signup**
   - Open http://localhost:3000 → redirect to login.
   - Sign up (e.g. patient@test.com, password). Should land on dashboard.
   - Logout, log in again. Should work.

2. **Dashboard**
   - After login, dashboard shows stats (total files, storage, success rate) if API is up.

3. **Files**
   - Go to Files. Upload a file. List should show it. Download (button) and Delete (button) should work.
   - Upload the same file again (same content) → should get duplicate error (409).

4. **Consent (patient only)**
   - Log in as a **patient** (sign up with a new email).
   - Go to Consent. Grant consent: scope “All my files”, granted to “Doctor”. Submit. List should show the new consent.
   - Click Revoke. Consent should show as Revoked.

5. **Federation health**
   - In API docs (http://localhost:8000/docs), call `GET /api/federation/health`. With federation container running, should return 200 and `federation.ok` and `minio_nodes`. If federation is stopped, 503.

## 4. Quick curl examples

```bash
# Signup
curl -s -X POST http://localhost:8000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"p2@test.com","password":"pass123"}' | jq .

# Login and save token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"p2@test.com","password":"pass123"}' | jq -r .access_token)

# List files
curl -s http://localhost:8000/api/files -H "Authorization: Bearer $TOKEN" | jq .

# Federation health
curl -s http://localhost:8000/api/federation/health | jq .
```

## 5. Troubleshooting

- **503 on /api/federation/health** — Federation container not running or not reachable. Check `docker-compose ps` and `FEDERATION_GRPC_HOST` (e.g. `federation:50051` in compose).
- **409 on upload (duplicate)** — Expected when file content (SHA256) already exists (DB or federation).
- **403 on download** — Consent required for non-owner; grant consent as patient for the file/scope.
- **CORS errors in browser** — Backend has CORS for `http://localhost:3000`. Ensure frontend runs on 3000 and API on 8000.
- **Frontend “Failed to load”** — Ensure backend is up and proxy target in Vite is `http://localhost:8000`.
