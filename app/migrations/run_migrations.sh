#!/bin/bash
# Run all migrations in order
# Usage: ./run_migrations.sh

set -e

# Database connection details (from environment or defaults)
DB_HOST=${POSTGRES_HOST:-postgres-primary}
DB_PORT=${POSTGRES_PORT:-5432}
DB_USER=${POSTGRES_USER:-dfsuser}
DB_PASS=${POSTGRES_PASSWORD:-dfspassword}
DB_NAME=${POSTGRES_DB:-dfs_metadata}

MIGRATIONS_DIR="$(dirname "$0")"

echo "Running migrations on $DB_NAME..."

for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
        echo "Applying: $(basename "$migration")"
        PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$migration"
        echo "✓ Applied: $(basename "$migration")"
    fi
done

echo "All migrations completed successfully!"
