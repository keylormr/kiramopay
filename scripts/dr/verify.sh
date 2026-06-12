#!/usr/bin/env bash
# DR verify: integrity checks against a RESTORED database. A backup that was
# never restored and verified is a hypothesis, not a backup — this script is
# what turns the monthly drill into proof.
#
# Required env:
#   TARGET_DATABASE_URL   the restored database to verify
set -euo pipefail

: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"

q() { psql "$TARGET_DATABASE_URL" -X -A -t -c "$1"; }

FAIL=0
check() { # check <name> <got> <want-expression-description>
  local name="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    echo "  OK   $name"
  else
    echo "  FAIL $name (got: $got, want: $want)" >&2
    FAIL=1
  fi
}

echo "==> critical tables exist"
for t in users wallets transactions journal_postings journal_entries \
         ledger_accounts escrow_agreements api_keys webhook_endpoints \
         schema_migrations; do
  got="$(q "SELECT to_regclass('public.$t') IS NOT NULL")"
  check "table $t" "$got" "t"
done

echo "==> migrations recorded"
MIGS="$(q 'SELECT COUNT(*) FROM schema_migrations')"
echo "  applied migrations: $MIGS"
if [ "${MIGS:-0}" -lt 1 ]; then
  echo "  FAIL: schema_migrations is empty" >&2
  FAIL=1
fi

echo "==> double-entry invariant: every posting balances per currency"
UNBALANCED="$(q "
  SELECT COUNT(*) FROM (
    SELECT posting_id, currency
    FROM journal_entries
    GROUP BY posting_id, currency
    HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
  ) x")"
check "unbalanced postings" "$UNBALANCED" "0"

echo "==> wallet cache vs journal (snapshot must be self-consistent)"
HAS_VIEW="$(q "SELECT to_regclass('public.wallet_journal_drift') IS NOT NULL")"
if [ "$HAS_VIEW" = "t" ]; then
  DRIFT="$(q 'SELECT COUNT(*) FROM wallet_journal_drift WHERE drift_crc <> 0 OR drift_usd <> 0')"
  check "drifted wallets" "$DRIFT" "0"
else
  echo "  SKIP wallet_journal_drift view not present in this snapshot"
fi

echo "==> basic volumetrics (informational)"
for t in users transactions journal_entries; do
  echo "  $t: $(q "SELECT COUNT(*) FROM $t") rows"
done

if [ "$FAIL" -ne 0 ]; then
  echo "VERIFY FAILED" >&2
  exit 1
fi
echo "OK: restored database passes integrity verification"
