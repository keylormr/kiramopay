# Runbook de Disaster Recovery (DR)

Procedimiento operativo para respaldo y recuperación de KiramoPay en el stack
de producción actual (backend en Render, PostgreSQL en Neon, Redis en Upstash,
frontend en Vercel).

## Objetivos

| Métrica | Objetivo actual | Cómo |
|---|---|---|
| **RPO** (pérdida máxima de datos) | ≤ 24 h | Dump diario cifrado a bucket independiente. Intra-día cubre el PITR de Neon (ventana corta en free-tier). |
| **RTO** (tiempo máximo de recuperación) | ≤ 1 h | Restore guionado (`scripts/dr/restore.sh`) + drill mensual que lo mantiene ensayado. |

> Al pasar Neon a plan pago, el PITR se extiende (7–30 días) y el RPO efectivo
> baja a minutos. Este runbook no cambia: el respaldo externo sigue siendo la
> defensa contra pérdida de cuenta/región/proveedor.

## Qué se respalda (y qué no)

- **PostgreSQL (Neon)** — el ledger y TODO el estado de negocio. Es lo único
  irreemplazable. Dump `pg_dump --format=custom` diario, cifrado AES-256-CBC
  (PBKDF2, 200k iteraciones), subido a un bucket S3-compatible **de otro
  proveedor** que la DB, con checksum SHA-256 y retención de 30 días.
- **Redis (Upstash)** — NO se respalda a propósito: contiene estado efímero
  (rate limits, lockouts, denylist de access-tokens). Perderlo degrada, no
  destruye: los lockouts se reinician y la denylist es fail-closed.
- **Secretos de entorno** — ¡tan críticos como la DB! Guardar copia en un
  gestor de contraseñas (no en el repo):
  - `JWT_SECRET` — **sin él, los secretos TOTP de los usuarios quedan
    indescifrables** (están cifrados AES-GCM con clave derivada de él) y todas
    las sesiones se invalidan.
  - GUC `kiramopay.encryption_key` (si está seteado en la DB) — cifrado de PII
    de la migración 024.
  - `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` — push notifications.
  - `BACKUP_ENCRYPTION_KEY` — sin él, los respaldos son ruido aleatorio.
- **Código e infraestructura** — el repo en GitHub ES el respaldo (migraciones
  001–030 reconstruyen el esquema; `DEPLOY.md` reconstruye el deploy).

## Activación (una sola vez)

1. Crear un bucket S3-compatible en un proveedor **distinto de Neon**
   (Cloudflare R2 y Backblaze B2 tienen capa gratuita suficiente). Configurar
   una regla de lifecycle de 35 días como red de seguridad adicional.
2. En GitHub → Settings → Secrets and variables → Actions, crear **secrets**:
   `DATABASE_URL` (DSN de Neon), `BACKUP_ENCRYPTION_KEY` (generar:
   `openssl rand -base64 48`), `S3_ENDPOINT`, `S3_BUCKET`,
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
3. Crear la **variable** `BACKUPS_ENABLED` = `true` (misma pantalla, pestaña
   Variables). Hasta entonces los jobs quedan en skip, no en rojo.
4. Correr el workflow a mano una vez (Actions → *DB Backup (DR)* → Run
   workflow → `backup`) y verificar el objeto en el bucket.
5. Correr el drill a mano (`drill`) y verificar que pasa.

## Operación automática

- **Diario 02:00 CR**: backup cifrado al bucket + poda de >30 días.
- **Mensual (día 1, 03:00 CR)**: *restore drill* — restaura el último backup
  en un Postgres efímero y verifica integridad: tablas críticas presentes,
  migraciones registradas, **invariante de doble partida** (todo posting
  balancea por moneda) y **cero drift** wallet↔journal.
- **Si cualquiera falla, se abre un issue automáticamente** en el repo
  (además del email de GitHub por workflow fallido). Un backup en rojo
  significa que NO hay respaldo reciente: tratarlo como incidente, no como
  ruido.

## Procedimiento de incidente (pérdida de la DB)

1. **Congelar tráfico**: en Render, suspender el servicio del API (evita
   escrituras contra una DB equivocada o vacía).
2. **Provisionar la DB destino**: nuevo proyecto/branch en Neon (u otro
   Postgres 16+). Anotar el DSN.
3. **Restaurar** (desde una máquina con `psql`/`aws`/`openssl`):
   ```bash
   export TARGET_DATABASE_URL='postgres://...'   # la DB nueva
   export BACKUP_ENCRYPTION_KEY='...'
   export S3_ENDPOINT='...' S3_BUCKET='...'
   export AWS_ACCESS_KEY_ID='...' AWS_SECRET_ACCESS_KEY='...'
   bash scripts/dr/restore.sh        # usa el último backup; BACKUP_KEY=... para uno específico
   bash scripts/dr/verify.sh         # integridad: no continuar si falla
   ```
4. **Reconectar**: actualizar `DATABASE_URL` en Render con el DSN nuevo,
   re-aplicar los secretos de entorno (ver lista arriba) y reactivar el
   servicio. NO setear `RUN_MIGRATIONS=true` — el dump ya trae el esquema.
5. **Validar en caliente**: `GET /health` verde, login con usuario de prueba,
   `GET /api/v1/transparency/proof-of-reserves` coherente, y correr
   `POST /api/v1/admin/reconcile` — drift esperado: 0.
6. **Comunicar**: la ventana de datos perdidos es desde el timestamp del
   backup restaurado hasta el incidente (≤ 24 h por diseño).

## Limitaciones conocidas (estado free-tier)

- El RPO de 24 h es el costo de no pagar PITR extendido; transacciones del
  día del incidente pueden perderse. Mitigación: upgrade de Neon (~$19/mes).
- Render free duerme el servicio (cold start ~30–60 s); el workflow
  `keepalive.yml` lo mitiga pero no lo elimina. No es un problema de DR sino
  de disponibilidad.
- El drill restaura en Postgres 17 (forward-compatible con dumps de 16); si
  Neon migra de major version, revisar la versión del cliente en el workflow.
