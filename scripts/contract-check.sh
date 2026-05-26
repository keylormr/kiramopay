#!/usr/bin/env bash
# Contract sanity check: login → call every authed endpoint that the
# frontend syncAllData() touches and print:
#   - HTTP status
#   - top-level shape (success/error)
#   - keys present in data[0] for arrays, data for objects
#
# Use this whenever you change a backend handler shape — diff the output
# against what src/api/adapters/http/*.ts expects.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:9999}"
CEDULA="${CEDULA:-702650930}"
PASSWORD="${PASSWORD:-Kiramopay2024!}"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "\033[31m✗\033[0m %s\n" "$1"; }

# Login
bold "→ POST /api/v1/auth/login"
LOGIN_BODY=$(curl -sS -X POST "$BASE_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"cedula\":\"$CEDULA\",\"password\":\"$PASSWORD\"}")

TOKEN=$(echo "$LOGIN_BODY" | python -c "import sys,json
try:
  d = json.load(sys.stdin)
  print(d['data']['tokens']['access_token'])
except Exception as e:
  sys.exit('login failed: ' + str(e))")

if [ -z "$TOKEN" ]; then
  fail "login produced no token"
  echo "$LOGIN_BODY"
  exit 1
fi
ok "login OK (token: ${TOKEN:0:30}...)"

probe() {
  local label="$1"
  local path="$2"
  bold ""
  bold "→ GET $path  ($label)"
  local body
  body=$(curl -sS -H "Authorization: Bearer $TOKEN" "$BASE_URL$path")
  echo "$body" | python -c "
import sys, json
try:
  d = json.loads(sys.stdin.read())
except Exception as e:
  print('  NON-JSON RESPONSE:', e)
  sys.exit(0)
if not isinstance(d, dict):
  print('  top-level not an object:', type(d).__name__)
  sys.exit(0)
print('  success=', d.get('success'))
if d.get('error'):
  print('  error=', d['error'])
data = d.get('data')
if isinstance(data, list):
  print('  data: list len=', len(data))
  if data:
    keys = list(data[0].keys()) if isinstance(data[0], dict) else type(data[0]).__name__
    print('  data[0] keys=', keys)
elif isinstance(data, dict):
  print('  data keys=', list(data.keys()))
else:
  print('  data type=', type(data).__name__, 'value=', repr(data)[:80])
"
}

probe "wallet object"     "/api/v1/wallets/me"
probe "balance summary"   "/api/v1/wallets/me/balance"
probe "transactions"      "/api/v1/transactions?limit=5"
probe "sinpe contacts"    "/api/v1/sinpe/contacts"
probe "sinpe history"     "/api/v1/sinpe/history"
probe "crypto assets"     "/api/v1/crypto/assets"
probe "crypto transactions" "/api/v1/crypto/transactions"
probe "crypto staking"    "/api/v1/crypto/staking"
probe "crypto alerts"     "/api/v1/crypto/alerts"
probe "crypto prices"     "/api/v1/crypto/prices"
probe "saved services"    "/api/v1/services/saved"
probe "services history"  "/api/v1/services/history"
probe "notifications"     "/api/v1/notifications"
probe "budgets"           "/api/v1/budgets"
probe "recurring"         "/api/v1/recurring"
probe "country wallets"   "/api/v1/country/wallets"
probe "exchange rates"    "/api/v1/exchange-rates"
probe "user profile"      "/api/v1/users/me"
probe "loyalty account"   "/api/v1/loyalty/account"
probe "fraud profile"     "/api/v1/fraud/profile"
probe "cards"             "/api/v1/cards"
probe "qr merchant"       "/api/v1/qr/merchant"

bold ""
bold "→ POR (public)"
probe_public() {
  local label="$1"
  local path="$2"
  bold ""
  bold "→ GET $path  ($label)"
  curl -sS "$BASE_URL$path" | python -m json.tool | head -20
}
probe_public "proof-of-reserves" "/api/v1/transparency/proof-of-reserves"
probe_public "fees"              "/api/v1/transparency/fees"

bold ""
ok "contract check complete"
