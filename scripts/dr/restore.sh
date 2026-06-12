#!/usr/bin/env bash
# DR restore: fetch a backup from the bucket (latest by default), decrypt it
# and pg_restore it into TARGET_DATABASE_URL. Used by the monthly restore
# drill and by hand during an incident (see DR_RUNBOOK.md).
#
# Required env:
#   TARGET_DATABASE_URL    where to restore (NEVER point this at prod casually)
#   BACKUP_ENCRYPTION_KEY  passphrase used at backup time
#   S3_ENDPOINT / S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
# Optional:
#   BACKUP_KEY             explicit object key; default = latest under prefix
#   BACKUP_PREFIX          default kiramopay/db
#   RESTORE_CONFIRM        set to "yes" to skip the interactive confirmation
set -euo pipefail

: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
BACKUP_PREFIX="${BACKUP_PREFIX:-kiramopay/db}"

if [ -z "${BACKUP_KEY:-}" ]; then
  echo "==> locating latest backup under s3://$S3_BUCKET/$BACKUP_PREFIX/"
  # Timestamped names sort lexicographically — the max IS the latest.
  BACKUP_KEY="$(aws s3api list-objects-v2 --endpoint-url "$S3_ENDPOINT" \
    --bucket "$S3_BUCKET" --prefix "$BACKUP_PREFIX/" \
    --query 'Contents[].Key' --output text | tr '\t' '\n' | \
    grep '\.dump\.enc$' | sort | tail -1)"
  [ -n "$BACKUP_KEY" ] || { echo "ERROR: no backups found" >&2; exit 1; }
fi
echo "    using $BACKUP_KEY"

if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  printf 'About to RESTORE into:\n  %s\nType "restore" to continue: ' "$TARGET_DATABASE_URL"
  read -r answer
  [ "$answer" = "restore" ] || { echo "aborted"; exit 1; }
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> download + checksum"
aws s3 cp --endpoint-url "$S3_ENDPOINT" --only-show-errors \
  "s3://$S3_BUCKET/$BACKUP_KEY" "$WORKDIR/backup.dump.enc"
if aws s3 cp --endpoint-url "$S3_ENDPOINT" --only-show-errors \
  "s3://$S3_BUCKET/$BACKUP_KEY.sha256" "$WORKDIR/expected.sha256" 2>/dev/null; then
  ACTUAL="$(sha256sum "$WORKDIR/backup.dump.enc" | awk '{print $1}')"
  EXPECTED="$(cat "$WORKDIR/expected.sha256")"
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "ERROR: checksum mismatch (expected $EXPECTED, got $ACTUAL)" >&2
    exit 1
  fi
  echo "    checksum OK"
else
  echo "    WARNING: no .sha256 manifest found; continuing without checksum"
fi

echo "==> decrypt"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$WORKDIR/backup.dump.enc" -out "$WORKDIR/backup.dump" \
  -pass env:BACKUP_ENCRYPTION_KEY

echo "==> pg_restore into target"
# --clean --if-exists rebuilds objects; --no-owner because the restoring role
# differs from the original. Exit code 0 required — partial restores are
# treated as failures.
pg_restore --no-owner --no-privileges --clean --if-exists \
  --dbname="$TARGET_DATABASE_URL" "$WORKDIR/backup.dump"

echo "OK: restore complete from $BACKUP_KEY"
