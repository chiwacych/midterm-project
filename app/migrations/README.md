# Database Migrations

This directory contains PostgreSQL migration scripts for the MedImage DFS application.

## Migration Files

| File | Description |
|------|-------------|
| `001_add_user_profile_fields.sql` | Adds profile fields to users table |
| `002_create_audit_log_table.sql` | Creates audit_log table for event tracking |
| `003_create_access_requests_table.sql` | Creates access_requests table |

## Running Migrations

### Using Docker (Recommended)

```bash
# From project root
docker exec -i postgres-primary psql -U dfsuser -d dfs_metadata < app/migrations/001_add_user_profile_fields.sql
docker exec -i postgres-primary psql -U dfsuser -d dfs_metadata < app/migrations/002_create_audit_log_table.sql
docker exec -i postgres-primary psql -U dfsuser -d dfs_metadata < app/migrations/003_create_access_requests_table.sql
```

### Using the Shell Script

```bash
cd app/migrations
chmod +x run_migrations.sh
./run_migrations.sh
```

## Important Notes

- Migrations use `IF NOT EXISTS` to be idempotent (safe to run multiple times)
- Always backup the database before running migrations in production
- Test migrations on a staging environment first
