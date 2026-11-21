#!/usr/bin/env bash
# Sella el registro de auditoria mes por mes, fuera de la base.
#
# Por cada mes CERRADO de audit_logs que todavia no tiene sello, exporta sus
# filas, las comprime, las cifra con la misma clave que los respaldos y las sube
# al bucket de respaldos junto con un manifiesto (cuantas filas, huella SHA-256
# del contenido y del archivo). El manifiesto es el sello: un mes con
# manifiesto no se vuelve a exportar ni se sobrescribe.
#
# Para que sirve:
#   * el respaldo diario se guarda 30 dias; el registro de auditoria hay que
#     conservarlo 5 anos (10 con un reporte de operacion sospechosa o un
#     requerimiento de autoridad). Este archivo es la copia de largo plazo.
#   * la huella permite demostrar despues que el mes no se altero. Con el
#     bloqueo contra borrado del bucket (si el proveedor lo ofrece; ver
#     DR_RUNBOOK.md), ni siquiera quien tenga las llaves del bucket lo puede
#     reescribir antes de tiempo.
#   * cuando un mes venza, se purga quitando su particion de la base: ya existe
#     afuera.
#
# Lo usa .github/workflows/db-backup.yml todos los dias (si no hay nada que
# sellar, no hace nada) y se puede correr a mano.
#
# Requiere:
#   DATABASE_URL           DSN de produccion (Neon)
#   BACKUP_ENCRYPTION_KEY  la misma frase de los respaldos
#   S3_ENDPOINT, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# Opcional:
#   AUDIT_PREFIX           carpeta dentro del bucket (por defecto kiramopay/auditoria)
#
# Para leer un mes sellado:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY \
#     -in 2026-10.csv.gz.enc | gunzip > 2026-10.csv
#   sha256sum 2026-10.csv   # tiene que dar el sha256_csv del manifiesto
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
AUDIT_PREFIX="${AUDIT_PREFIX:-kiramopay/auditoria}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

COLUMNAS="id, user_id, action, resource_type, resource_id, ip_address, user_agent, details, risk_level, created_at, created_date"

psql_() {
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"
}

existe() {
  aws s3api head-object --endpoint-url "$S3_ENDPOINT" \
    --bucket "$S3_BUCKET" --key "$1" >/dev/null 2>&1
}

# El ultimo mes sellado. Los meses se sellan en orden y el script se detiene en
# el primer error, asi que todo mes anterior con filas ya tiene su sello.
ULTIMO="$(aws s3api list-objects-v2 --endpoint-url "$S3_ENDPOINT" \
  --bucket "$S3_BUCKET" --prefix "$AUDIT_PREFIX/" \
  --query 'Contents[].Key' --output text 2>/dev/null | tr '\t' '\n' | \
  sed -n 's#^.*/\([0-9]\{4\}-[0-9]\{2\}\)\.json$#\1#p' | sort | tail -1 || true)"

if [ -n "$ULTIMO" ]; then
  DESDE="$(date -u -d "${ULTIMO}-01 +1 month" +%Y-%m-%d)"
  echo "==> ultimo mes sellado: $ULTIMO; se busca desde $DESDE"
else
  DESDE="1970-01-01"
  echo "==> no hay meses sellados todavia"
fi

# Solo meses cerrados: el mes en curso todavia recibe eventos. El filtro por
# created_date (la clave de particion) deja fuera las particiones ya selladas.
MESES="$(psql_ -c "SELECT DISTINCT to_char(created_date, 'YYYY-MM') FROM audit_logs
  WHERE created_date >= DATE '$DESDE'
    AND created_date < date_trunc('month', CURRENT_DATE)::date
  ORDER BY 1")"

if [ -z "$MESES" ]; then
  echo "OK: no hay meses cerrados sin sellar"
  exit 0
fi

SELLADOS=0
for MES in $MESES; do
  BASE="$AUDIT_PREFIX/$MES"
  if existe "$BASE.json"; then
    echo "    $MES ya esta sellado; no se toca"
    continue
  fi
  INICIO="${MES}-01"
  FIN="$(date -u -d "${INICIO} +1 month" +%Y-%m-%d)"
  CSV="$WORKDIR/$MES.csv"

  echo "==> $MES: exportar"
  # Orden fijo y formato fijo: el mismo mes exportado dos veces da el mismo
  # archivo y la misma huella.
  psql_ -c "SET datestyle TO ISO, YMD" -c "SET timezone TO 'UTC'" \
    -c "\\copy (SELECT $COLUMNAS FROM audit_logs WHERE created_date >= DATE '$INICIO' AND created_date < DATE '$FIN' ORDER BY created_at, id) TO '$CSV' WITH (FORMAT csv, HEADER true)"

  FILAS=$(( $(wc -l <"$CSV") - 1 ))
  if [ "$FILAS" -le 0 ]; then
    echo "    $MES no tiene filas; nada que sellar"
    continue
  fi
  SHA_CSV="$(sha256sum "$CSV" | awk '{print $1}')"
  PRIMERO="$(psql_ -c "SELECT min(created_at) FROM audit_logs WHERE created_date >= DATE '$INICIO' AND created_date < DATE '$FIN'")"
  ULTIMA="$(psql_ -c "SELECT max(created_at) FROM audit_logs WHERE created_date >= DATE '$INICIO' AND created_date < DATE '$FIN'")"

  echo "    $FILAS filas; huella del contenido $SHA_CSV"
  gzip -n -9 "$CSV"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$CSV.gz" -out "$CSV.gz.enc" -pass env:BACKUP_ENCRYPTION_KEY
  SHA_ARCHIVO="$(sha256sum "$CSV.gz.enc" | awk '{print $1}')"

  cat >"$WORKDIR/$MES.json" <<JSON
{
  "mes": "$MES",
  "filas": $FILAS,
  "primer_evento": "$PRIMERO",
  "ultimo_evento": "$ULTIMA",
  "sha256_csv": "$SHA_CSV",
  "archivo": "$MES.csv.gz.enc",
  "sha256_archivo": "$SHA_ARCHIVO",
  "columnas": "$COLUMNAS",
  "formato": "CSV con encabezado, ordenado por created_at e id; gzip; AES-256-CBC con PBKDF2 de 200000 iteraciones (openssl enc), con la clave de los respaldos",
  "sellado_en": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

  echo "==> $MES: subir a s3://$S3_BUCKET/$BASE.csv.gz.enc"
  aws s3 cp --endpoint-url "$S3_ENDPOINT" --only-show-errors \
    "$CSV.gz.enc" "s3://$S3_BUCKET/$BASE.csv.gz.enc"
  # El manifiesto va al final: es lo que marca el mes como sellado. Si la
  # subida del archivo fallo, no hay manifiesto y manana se reintenta.
  aws s3 cp --endpoint-url "$S3_ENDPOINT" --only-show-errors \
    "$WORKDIR/$MES.json" "s3://$S3_BUCKET/$BASE.json"

  existe "$BASE.csv.gz.enc" || { echo "ERROR: el archivo de $MES no quedo en el bucket" >&2; exit 1; }
  existe "$BASE.json" || { echo "ERROR: el manifiesto de $MES no quedo en el bucket" >&2; exit 1; }

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      [ "$SELLADOS" -eq 0 ] && printf '| Mes | Filas | SHA-256 del contenido |\n|---|---|---|\n'
      printf '| %s | %s | `%s` |\n' "$MES" "$FILAS" "$SHA_CSV"
    } >>"$GITHUB_STEP_SUMMARY"
  fi
  SELLADOS=$((SELLADOS + 1))
done

echo "OK: $SELLADOS mes(es) sellado(s) en s3://$S3_BUCKET/$AUDIT_PREFIX/"
