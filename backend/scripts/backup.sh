#!/bin/bash
# KiramoPay PostgreSQL Backup Script
# Usage: ./backup.sh [backup_dir]
# Requires: pg_dump, gzip
# Environment: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

set -euo pipefail

BACKUP_DIR="${1:-/var/backups/kiramopay}"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/kiramopay_${TIMESTAMP}.sql.gz"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting backup..."

# Perform compressed backup
PGPASSWORD="${DB_PASSWORD:-kiramopay_dev}" pg_dump \
  -h "${DB_HOST:-localhost}" \
  -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-kiramopay}" \
  -d "${DB_NAME:-kiramopay}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  -f "${BACKUP_FILE}"

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[$(date)] Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Rotate old backups
echo "[$(date)] Removing backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "kiramopay_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

REMAINING=$(ls -1 "${BACKUP_DIR}"/kiramopay_*.sql.gz 2>/dev/null | wc -l)
echo "[$(date)] Backup rotation complete. ${REMAINING} backups remaining."
