# Correcciones P0 — Junio 2026

**Fecha:** 2026-06-05
**Alcance:** remediación de los bloqueantes P0 de `AUDITORIA_2026-06.md`.
**Verificación:** Go 1.23.4 (portable). `go build ./...` ✅, `go vet ./...` ✅, `gofmt` ✅, **suite de tests completa en verde** (`go test ./...` → ok). Los tests de **integración** (crypto/sinpe/auth/transaction/ledger) hacen *skip* sin PostgreSQL; requieren `make docker-up && make test-integration` para validación en runtime.

---

## Resumen

| P0 | Estado | Enfoque |
|----|--------|---------|
| P0-1 Crypto regala dinero | ✅ Corregido | `Buy/Sell` ahora mueven fiat por el ledger vía `transaction.Service` |
| P0-2 Crypto floats | ✅ Corregido (lado fiat) | Fiat en céntimos `int64`; eliminado el fee float `*0.005` |
| P0-3 Dominios fuera del ledger | ✅ Corregido (movers de fiat) | crypto, qr, splitpay ahora postean al ledger |
| P0-4 Revocación de sesiones con error ignorado | ✅ Corregido | Cambio de password + revocación en una sola tx serializable |
| P0-5 Límite diario SINPE no atómico | ✅ Corregido | Advisory lock por-usuario serializa check + débito |
| P0-6 PAN/CVV en texto plano | ✅ Corregido | CVV ya no se persistía; el PAN ya no se almacena (solo `last4` + máscara) |

---

## Detalle por corrección

### P0-1 / P0-2 / P0-3 — Crypto, QR y SplitPay pasan por el ledger

**Problema:** `crypto.Buy/Sell/Convert` acreditaban el activo cripto sin debitar fiat (dinero gratis), con fees en `float64`. `qrpayment.ScanAndPay` y `splitpay.PayShare` registraban el pago sin mover dinero.

**Solución:** reutilizar el camino de dinero ya correcto (`transaction.Service`), que encapsula balance-check + MFA + idempotencia + posting de doble-entrada en tx serializable.

- **crypto** (`internal/crypto/service.go`): `Buy` debita fiat con `CreateTransaction(TypeCryptoBuy)` (céntimos `int64`) **antes** de acreditar el activo; `Sell` debita el activo y acredita fiat con `CreateTransaction(TypeCryptoSell)`, con **compensación** (re-crédito del activo) si el crédito fiat falla. Idempotencia por `idempotency_key` (campo nuevo en `BuyRequest/SellRequest`). Nuevos tipos `TypeCryptoBuy/TypeCryptoSell` en `transaction/model.go`; `TypeCryptoBuy` marcado saliente en `isOutgoing`.
- **qrpayment** (`internal/qrpayment/service.go`): `ScanAndPay` ahora llama `CreateTransfer` (payer→creator), guarda el `TxID`, e **ignora el override de moneda del payer** (la moneda la fija el QR — cierre de la vuln. de mayo). Idempotencia `qr:{qrID}:{payerID}`.
- **splitpay** (`internal/splitpay/service.go`): `PayShare` localiza la cuota del usuario y **liquida dinero real** (participante→creador) vía `CreateTransfer` antes de marcar pagado; la cuota del propio creador no mueve dinero. Idempotencia `split:{groupID}:{userID}`.
- **Cableado** (`cmd/api/main.go`): `crypto/qr/splitpay` reciben `txService`.

**Residual (P1, documentado, no bloqueante):** la *cantidad* cripto (`AssetRecord.Balance`, `Amount`) sigue como `float64` en Go (la columna DB ya es `NUMERIC(38,18)` por migración 019). Migrar a un tipo decimal (p. ej. `shopspring/decimal`) es invasivo y queda como P1. `Convert` (cripto↔cripto, sin fiat) se mantiene; no mueve dinero fiat.

### P0-4 — Revocación de sesiones atómica

**Problema:** `ChangePassword`/`ResetPassword` usaban `_, _ = db.Exec(...)` para revocar refresh-tokens y sesiones — si fallaban, el password cambiaba pero las sesiones viejas sobrevivían (account-takeover).

**Solución** (`internal/auth/repository.go` + `service.go`): nuevo `ChangePasswordAndRevokeSessions` que actualiza el hash y revoca refresh-tokens + sesiones en **una sola tx serializable**; todo o nada. `ChangePassword` y `ResetPassword` ahora propagan el error.

### P0-5 — Límite diario SINPE atómico

**Problema:** `Send` leía `GetDailySinpeSpent` y luego debitaba en operaciones separadas (race: dos envíos concurrentes superan el tope de 500K). El comentario decía "Atomic" pero no lo era.

**Solución** (`internal/sinpe/repository.go` + `service.go`): `AcquireUserSendLock` toma un `pg_advisory_lock` por-usuario (clave FNV) que serializa el check + débito de envíos concurrentes del mismo usuario; se libera con `defer` en contexto desacoplado. Además, el historial del emisor (del que depende el límite) ya no se ignora en silencio: se registra como evento de auditoría de alto riesgo si falla.

### P0-6 — PAN/CVV

**Hallazgo:** el **CVV ya no se persistía** (el `INSERT` de `CreateCard` no lo incluía; se devuelve solo en creación y se enmascara en lecturas). El problema real era el **PAN en texto plano**.

**Solución** (`internal/cards/repository.go` + `model.go`): `CreateCard` ya **no almacena el PAN completo** — guarda solo la forma enmascarada + `last4`. El PAN se devuelve una única vez en la respuesta de creación y se descarta. No se puede filtrar lo que no se almacena. La emisión real debe sostener el PAN en un proveedor PCI-Level-1 (Marqeta/Stripe Issuing), referenciado por `provider_card_id`.

---

## Limpieza preexistente (ajena a los P0, para dejar la suite verde)

Dos tests del repo estaban rotos **antes** de este trabajo y bloqueaban `go test ./...`:
- `internal/notification/notification_test.go`: variable `s` declarada y no usada → eliminada.
- `internal/config/config_test.go`: el fixture "AllSecure" usaba un JWT secret de 29 chars que la validación endurecida (Fase 20, ≥32) rechaza → extendido a ≥32.

---

## Validación en runtime (ejecutada contra PostgreSQL real)

Se levantó PostgreSQL 16 (Docker) + Redis y se corrieron los tests de integración (`-p 1` para serializar paquetes que comparten la misma DB de test):

| Paquete | Resultado | Qué prueba |
|---------|-----------|------------|
| `crypto` (Buy/Sell/GetAssets/GetTransactions) | ✅ PASS | El débito fiat por el ledger ocurre antes de acreditar el activo |
| `sinpe` | ✅ PASS | Advisory lock + envío con límite diario |
| `transaction` | ✅ PASS | CreateTransaction/CreateTransfer |
| `auth` | ✅ PASS | Cambio de password atómico + revocación de sesiones |
| `ledger` (core: Post, idempotencia, inmutabilidad) | ✅ PASS | Doble-entrada y journal append-only |
| `ledger` `TestConcurrent100Transfers` | ⚠️ FAIL | **Preexistente, ajeno a estas correcciones** — ver abajo |

### Hallazgos de infraestructura de test (descubiertos al verificar)

1. **`testutil.createSchema` no creaba las tablas `crypto_*`** → los tests de integración de crypto nunca habían sido funcionales (erraban con `relation "crypto_assets" does not exist`). **Corregido**: se añadieron `crypto_assets/transactions/staking/price_alerts` (NUMERIC) al esquema de test y a la lista de truncate.
2. **`TestConcurrent100Transfers` (ledger) falla por contención**: 100 postings concurrentes sobre 2 wallets agotan el presupuesto de 4 reintentos del ledger (SQLSTATE 40001/40P01) en este PostgreSQL (alpine sobre Docker en Windows, más lento que el CI nativo). **No está relacionado con estas correcciones** (`ledger.go` no fue modificado). Recomendación P1: subir `maxAttempts` y/o ampliar el jitter del backoff en `ledger.Engine`.
3. Los tests de integración **no son seguros para correr paquetes en paralelo** (IDs de usuario fijos sobre una DB compartida). Ejecutar con `make test-integration` (que usa el orden por defecto) o `-p 1`.

### Cómo reproducir

```bash
cd backend
make docker-up            # postgres + redis
make test-db-create       # crea kiramopay_test
make test-integration     # crypto Buy/Sell con débito fiat real, SINPE, auth, ledger
```

Tests nuevos recomendados (P1): concurrencia del advisory lock SINPE, idempotencia de crypto/qr/split, y compensación de `Sell`.

---

# P1 — KYC / AML (foundation)

**Fecha:** 2026-06-05. **Estado:** implementado y verificado contra PostgreSQL real (3/3 tests de integración en verde).

## Qué se construyó

Nuevo dominio `internal/kyc` (model/screener-en-repo/service/handler) + migración `025_kyc.sql`, montado sobre los campos `users.kyc_level` / `kyc_status` ya existentes.

- **Migración 025**: `kyc_verifications` (ciclo submit→review), `kyc_documents` (solo referencias + hash SHA-256, NUNCA bytes de imagen), `sanction_list` (watchlist OFAC/UN/local, sembrada con entradas ficticias), `sanction_screenings` (traza de auditoría de cada screening). CHECK constraints en status/result.
- **Screening de sanciones**: `Repository.ScreenSanctions` hace match normalizado (lowercase/trim/colapso de espacios) + contención bidireccional contra `sanction_list`. Interfaz lista para sustituir el match local por un proveedor (ComplyAdvantage / Sanctions.io) sin tocar la lógica.
- **Flujo KYC**:
  - `POST /api/v1/kyc/submit` — el usuario declara nombre legal, documento y refs de documentos; se corre screening. Un hit deja la verificación en `screening_hit` (nunca auto-aprobable) + evento de auditoría `kyc_sanction_hit` de alto riesgo.
  - `GET /api/v1/kyc/status` — nivel, estado y límites vigentes.
  - `POST /api/v1/admin/kyc/{id}/decision` — aprobar/rechazar (admin). **Aprobar sube `kyc_level` y escala los límites de la wallet** (`ApplyApproval` en una sola tx). Un `screening_hit` no se puede aprobar.
- **Límites por nivel** (`kyc.LevelLimits`, centimos): L0 ₡100k/₡500k · L1 ₡500k/₡5M · L2 ₡2M/₡20M.
- **Gate AML en el registro**: `auth.Register` consulta una interfaz `SanctionScreener` (implementada por `kyc.Service.ScreenIsClear`); un nombre sancionado **bloquea el alta** (`register_sanction_block`, alto riesgo). Fail-open ante errores de infraestructura, fail-closed ante un hit. Sin ciclo de imports (interfaz definida en `auth`).

## Verificación (PostgreSQL real)

| Test | Resultado |
|------|-----------|
| `TestKYC_SubmitClean_ThenApprove_RaisesLevelAndLimits` | ✅ — submit limpio → aprobar → `kyc_level` y `wallets.daily/monthly_limit` actualizados |
| `TestKYC_SubmitSanctionedName_FlagsHit_AndCannotApprove` | ✅ — nombre en watchlist → `screening_hit`, aprobación rechazada |
| `TestKYC_ScreenIsClear` | ✅ — el gate de registro distingue sancionado vs limpio |

`auth`, `crypto`, `sinpe`, `transaction` siguen en verde en serie (`-p 1`) tras la integración.

## Limitaciones / siguientes pasos (documentados, no bloqueantes)

- Los endpoints `/admin/kyc/*` solo requieren autenticación (no hay rol admin en el repo). **TODO: middleware de rol admin (RBAC)** — aplica también a `/admin/fraud/*` y `/admin/reconcile` existentes.
- El match de sanciones es normalizado + substring; producción necesita **proveedor real** (fuzzy, alias, fecha de nacimiento, score) — la interfaz ya lo permite.
- Falta **liveness/OCR** del documento (hoy se confía en las refs declaradas) y **reportes UIF** por umbrales.
- Los nuevos usuarios mantienen los límites por defecto de la wallet hasta verificarse; para AML estricto, bajar el default de la wallet a nivel 0 en el registro (follow-up de una línea).

## Infra de test corregida al verificar

`testutil.createSchema` no tenía `kyc_verified_at` en `users` ni las tablas KYC → añadidas (con seed idempotente de `sanction_list`). Nota: la DB de test debe recrearse al cambiar el esquema inline (`CREATE TABLE IF NOT EXISTS` no altera tablas existentes): `DROP/CREATE DATABASE kiramopay_test`.

---

# P1 — Quick wins (RBAC admin, validación de teléfono, logout logging)

**Fecha:** 2026-06-05. **Estado:** implementado y verificado.

## RBAC admin (P1) — los `/admin/*` ya no eran solo-autenticados

- **Migración `026_user_roles.sql`**: columna `users.role` (`user`/`admin`/`support`, CHECK), default `user`; promueve a `admin` al usuario cédula 700000000.
- **`middleware.RequireAdmin(AdminChecker)`**: gatea por rol, **fail-closed** (usuario ausente → 401; no-admin o error del checker → 403). Desacoplado vía interfaz `AdminChecker` (implementada por `user.Repository.IsAdmin`).
- **`main.go`**: todas las rutas `/admin/*` (KYC decision, fraud alerts/restrict, reconcile) envueltas en un grupo con `RequireAdmin(userRepo)`.
- **Tests**: `middleware/admin_test.go` — 4/4 (admin pasa, no-admin 403, sin usuario 401, error→403 fail-closed). ✅

## Validación de teléfono SINPE (P1-3)

`sinpe.Send` rechaza números no válidos antes de debitar: `validCRMobile` exige 8 dígitos CR empezando en 6/7/8, con prefijo `+506`/`506` opcional. Test unitario `validate_test.go` (11 casos válidos/ inválidos). ✅

## Logout logging (P1-1)

`auth.Logout` ya no traga en silencio los errores de revocación de la familia de refresh: ahora los registra con `slog.Warn` (la revocación primaria del access-jti sigue propagando error). 

## Verificación

build + vet + gofmt limpios. Unit: `RequireAdmin` (4/4), `validCRMobile` (ok). Integración serial (`-p 1`): **auth ✅, sinpe ✅, kyc ✅** (la columna `role` se añadió al esquema de test; `SeedTestUser2` ahora es `admin`).

## P1 restantes (pendientes)

decimal en cantidad cripto · reportes UIF + OCR/liveness en KYC.

---

# P1-7 — Auto-refresh de token + sesión consistente (frontend)

**Fecha:** 2026-06-07. **Estado:** implementado y verificado (build + lint 0 errores + tests).

**Problema:** el `HttpClient` no manejaba 401 — al expirar el access token (15 min) los requests fallaban sin reintentar; y como `auth.store` persiste `isAuthenticated` pero NO los tokens (memoria por seguridad), tras recargar la página el usuario "parecía logueado" pero todo request fallaba sin re-auth.

**Solución:**
- **`IAuthRepository.refresh` + `HttpAuthRepository.refresh`**: intercambian el refresh token por un par nuevo vía `POST /auth/refresh` (con `auth=false` para no recursar en el manejo de 401).
- **`HttpClient`**: en un 401 con `auth=true`, hace **un** refresh silencioso (dedupe: una sola llamada compartida por todos los 401 concurrentes), reintenta el request original una vez, y si el refresh falla invoca `authFailureHandler` (forceLogout) devolviendo `SESSION_EXPIRED`. Guardia `isRetry` contra bucles.
- **`auth.store`**: `refresh()` (rota tokens en memoria) y `forceLogout()` (limpia sesión local sin llamar al backend); ambos registrados a nivel módulo como handlers del `HttpClient`.
- **Cold-start resuelto automáticamente**: tras recargar, el primer request 401 → refresh falla (sin refresh token persistido) → `forceLogout` → login. Sin sesión fantasma.

**Verificación:** `npm run build` OK (chunks < 200KB); `npm run lint` 0 errores; **6 tests nuevos** (`client.test.ts`: refresh+replay, forceLogout en fallo, dedupe de 401 concurrentes, no-refresh para `auth=false`; `auth.repository.test.ts`: refresh OK / refresh inválido) + se corrigió un test obsoleto que aún afirmaba tokens en localStorage (contradecía el endurecimiento de Fase 20). Suite: **324/325** (la única falla restante es `HomeView` "CRC Base", test de UI obsoleto del refactor de diseño, ajeno a este trabajo — registrado como tarea aparte).

---

# P1 — Robustez del ledger (concurrencia de cuentas calientes)

**Fecha:** 2026-06-05. **Estado:** implementado y verificado (3/3 corridas del stress-test en verde).

**Problema:** `TestConcurrent100Transfers` (100 transferencias concurrentes sobre las mismas 2 wallets) fallaba bajo `SERIALIZABLE`: agotaba los 4 reintentos con abortos 40001/40P01. Causa raíz doble: (1) `applyWalletDelta` iteraba el map `cacheDelta` en **orden aleatorio** → deadlocks (40P01); (2) `SERIALIZABLE` (SSI) aborta agresivamente bajo contención de una sola fila.

**Solución (decidida con el owner): READ COMMITTED + `SELECT ... FOR UPDATE`** — el patrón canónico de ledgers para cuentas calientes. En `internal/ledger/ledger.go`:
- Pre-bloqueo de las filas de wallet afectadas con `FOR UPDATE` en **orden determinista** (userIDs ordenados) → las transferencias concurrentes **encolan** en el lock en vez de abortar; el orden fijo descarta deadlocks.
- Aplicación de los deltas de cache también en orden ordenado.
- Cambio de aislamiento `Serializable` → `ReadCommitted`. Correctitud preservada: el balance por-posting lo fuerza el trigger DEFERRED, la idempotencia el `UNIQUE`, y el cache es un `+= delta` commutativo sobre fila bloqueada.
- Manejo de la carrera de idempotencia que READ COMMITTED expone: una violación `23505` en el insert del posting se trata como `errIdempotencyRace` y se reintenta (el siguiente intento encuentra al ganador ya commiteado → `ErrIdempotent`).
- `maxAttempts` 4→8 y backoff con **jitter real** (antes era determinista pese al comentario).

**Verificación:** el paquete `ledger` pasa 3/3 corridas (incl. el stress-test, ~6s vs 22s+ y fallando antes). Sin regresión: `auth/crypto/sinpe/transaction/kyc/ledger` todos en verde en serie.

---

# P1-5 — Security scanning en CI

**Fecha:** 2026-06-05. **Estado:** jobs añadidos a `.github/workflows/ci.yml` + hallazgos locales triados.

- **Toolchain**: bump de Go `1.22` → `1.23` en todos los jobs (cierra vulns de stdlib reachable que reportó govulncheck: `GO-2025-3420` net/http y `GO-2025-3373` crypto/x509, ambos fixed en 1.23.5).
- **Jobs nuevos (gating)**:
  - `backend-vulncheck`: `govulncheck ./...`.
  - `backend-gosec`: gosec SAST (`-severity=medium -exclude=G404` — G404 es math/rand no-criptográfico).
  - `secret-scan`: gitleaks (historial completo).
  - `frontend-audit`: `npm audit --omit=dev --audit-level=high`.
  - `trivy-fs`: Trivy filesystem scan (HIGH/CRITICAL, `ignore-unfixed`).
- **Hallazgos de gosec triados (6, todos valores controlados)**: 4× G115 (conversión entera: longitudes de salt/key Argon2, `MaxConns` de pool, clave FNV de advisory-lock) y 2× G304 (lectura de `openapi.yaml` y de migraciones por path interno). Anotados con `// #nosec <rule> -- <justificación>` para mantener las reglas activas en código futuro.

**Nota**: los `/admin/*` requerían solo autenticación → ahora gateados por `RequireAdmin` (ver sección RBAC). `gosec`/`govulncheck` ejecutados localmente con Go 1.23.4 portable durante la verificación.
