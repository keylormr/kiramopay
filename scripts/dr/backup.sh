#!/usr/bin/env bash
# DR backup: pg_dump the production database, encrypt it, and ship it to an
# S3-compatible bucket INDEPENDENT of the database provider (R2/B2/S3/MinIO).
# Used by .github/workflows/db-backup.yml and runnable by hand.
#
# Required env:
#   DATABASE_URL           production DSN (Neon)
#   BACKUP_ENCRYPTION_KEY  passphrase for AES-256 encryption
#   S3_ENDPOINT            e.g. https://<account>.r2.cloudflarestorage.com
#   S3_BUCKET              bucket name
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  bucket credentials
# Optional:
#   RETENTION_DAYS         prune objects older than this (default 30)
#   BACKUP_PREFIX          key prefix inside the bucket (default kiramopay/db)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_PREFIX="${BACKUP_PREFIX:-kiramopay/db}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
NAME="kiramopay-${STAMP}.dump"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> pg_dump (custom format, consistent snapshot)"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  --file="$WORKDIR/$NAME"

SIZE=$(wc -c <"$WORKDIR/$NAME")
echo "    dump size: ${SIZE} bytes"
# A dump under 50KB means we dumped an empty/wrong database — fail loudly
# instead of archiving garbage.
if [ "$SIZE" -lt 51200 ]; then
  echo "ERROR: dump suspiciously small (${SIZE} bytes); refusing to upload" >&2
  exit 1
fi

echo "==> encrypt (AES-256-CBC, PBKDF2)"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$WORKDIR/$NAME" -out "$WORKDIR/$NAME.enc" \
  -pass env:BACKUP_ENCRYPTION_KEY
sha256sum "$WORKDIR/$NAME.enc" | awk '{print $1}' >"$WORKDIR/$NAME.enc.sha256"

KEY="$BACKUP_PREFIX/${STAMP:0:4}/${STAMP:4:2}/$NAME.enc"
echo "==> upload s3://$S3_BUCKET/$KEY"
aws s3 cp --endpoint-url "$S3_ENDPOINT" --only-show-errors \
  "$WORKDIR/$NAME.enc" "s3://$S3_BUCKET/$KEY"
aws s3 cp --endpoint-url "$S3_ENDPOINT" --only-show-errors \
  "$WORKDIR/$NAME.enc.sha256" "s3://$S3_BUCKET/$KEY.sha256"

echo "==> verify upload"
aws s3api head-object --endpoint-url "$S3_ENDPOINT" \
  --bucket "$S3_BUCKET" --key "$KEY" >/dev/null

echo "==> prune objects older than ${RETENTION_DAYS} days"
# Filenames embed their UTC date (kiramopay-YYYYMMDD-HHMMSS.*), so retention
# is computed from the name — independent of object mtime quirks. A bucket
# lifecycle rule is still recommended as the primary mechanism (see runbook).
CUTOFF="$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d 2>/dev/null || date -u -v "-${RETENTION_DAYS}d" +%Y%m%d)"
aws s3api list-objects-v2 --endpoint-url "$S3_ENDPOINT" \
  --bucket "$S3_BUCKET" --prefix "$BACKUP_PREFIX/" \
  --query 'Contents[].Key' --output text 2>/dev/null | tr '\t' '\n' | \
while read -r key; do
  [ -n "$key" ] || continue
  base="$(basename "$key")"
  d="$(printf '%s' "$base" | sed -n 's/^kiramopay-\([0-9]\{8\}\)-.*/\1/p')"
  if [ -n "$d" ] && [ "$d" -lt "$CUTOFF" ]; then
    echo "    pruning $key"
    aws s3 rm --endpoint-url "$S3_ENDPOINT" --only-show-errors "s3://$S3_BUCKET/$key"
  fi
done

echo "OK: backup s3://$S3_BUCKET/$KEY (${SIZE} bytes plaintext)"
