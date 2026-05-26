#!/bin/bash
# KiramoPay PostgreSQL Restore Script
# Usage: ./restore.sh <backup_file>
# Requires: pg_restore
# Environment: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup_file>"
  echo "Available backups:"
  ls -lh /var/backups/kiramopay/kiramopay_*.sql.gz 2>/dev/null || echo "  No backups found"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "[$(date)] WARNING: This will overwrite the current database!"
echo "Backup file: ${BACKUP_FILE}"
echo "Target database: ${DB_NAME:-kiramopay} on ${DB_HOST:-localhost}:${DB_PORT:-5432}"
echo ""
read -p "Are you sure? (yes/no): " CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
  echo "Restore cancelled."
  exit 0
fi

echo "[$(date)] Starting restore..."

PGPASSWORD="${DB_PASSWORD:-kiramopay_dev}" pg_restore \
  -h "${DB_HOST:-localhost}" \
  -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-kiramopay}" \
  -d "${DB_NAME:-kiramopay}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "${BACKUP_FILE}"

echo "[$(date)] Restore complete."
