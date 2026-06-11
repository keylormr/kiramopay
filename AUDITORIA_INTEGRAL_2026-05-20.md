# Auditoría Integral KiramoPay

**Fecha:** 2026-05-20
**Auditor:** Tech Lead / Auditor Senior / SecOps / DBA / DevOps (consolidado)
**Versión del proyecto auditada:** post Fase 20 (Core Banking Foundation)
**Tipo de auditoría:** integral — código, datos, seguridad, infraestructura, UX, QA, estrategia

---

## Tabla de contenidos

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Alcance del proyecto](#2-alcance-del-proyecto)
3. [Lo realizado hasta hoy](#3-lo-realizado-hasta-hoy)
4. [Hallazgos de auditoría](#4-hallazgos-de-auditoría)
   - 4.1 Wallet, Transaction, SINPE
   - 4.2 Autenticación y middleware
   - 4.3 Modelo de datos
   - 4.4 Frontend
   - 4.5 Dominios backend restantes
   - 4.6 Infraestructura, CI/CD, observabilidad
   - 4.7 Tests y QA
   - 4.8 Documentación
5. [Estrategia y posicionamiento](#5-estrategia-y-posicionamiento)
6. [Plan a futuro (roadmap)](#6-plan-a-futuro-roadmap)
7. [Backlog priorizado](#7-backlog-priorizado)
8. [Pendientes y decisiones requeridas](#8-pendientes-y-decisiones-requeridas)
9. [Métricas de salud del proyecto](#9-métricas-de-salud-del-proyecto)
10. [Anexos](#10-anexos)

---

## 1. Resumen ejecutivo

### Veredicto global

**KiramoPay tiene una arquitectura ambiciosa y bien planteada, pero la implementación está incompleta en dominios no negociables para un sistema financiero.** Lo que existe es una **maqueta funcional muy avanzada** — no un sistema listo para mover dinero real.

Los tres dominios críticos auditados (`wallet`, `transaction`, `sinpe`) tienen bugs que causarían pérdida de dinero o doble cargo en producción. La capa de autenticación tiene la estructura correcta pero **el lockout no está montado, la revocación de sesiones no funciona y los refresh tokens son indistinguibles de los access tokens**. El frontend persiste tokens JWT en localStorage contradiciendo el contrato declarado en Phase 20, y la pantalla principal de SINPE **no llama al backend al enviar dinero**.

A nivel estructural, **9 de 16 dominios backend mueven valor sin pasar por el ledger declarado en Fase 20** (crypto, splitpay, qrpayment, country, marketplace, cards, loyalty, recurring, budget). Eso convierte el ledger inmutable en un componente teórico — el sistema sigue con `wallets.balance_*` como fuente de verdad mutable.

### Top 5 riesgos críticos

| # | Riesgo | Impacto | Ubicación |
|---|--------|---------|-----------|
| 1 | Idempotencia falsa: la clave nunca se persiste | Doble cargo al primer retry de red | `transaction/repository.go:20-61` |
| 2 | Sin atomicidad DB en transferencias (sin `BeginTx`) | Débito sin crédito ante crash | `transaction/service.go:60-73` |
| 3 | 9 de 16 dominios saltan el ledger | Saldos no derivables → auditoría imposible | `crypto`, `qr`, `split`, `country`, `cards`, `marketplace`, `loyalty`, `recurring`, `budget` |
| 4 | JWT en localStorage + lockout no montado | Robo de sesión vía XSS + brute force libre | `src/api/adapters/http/client.ts:13-24`, `main.go` |
| 5 | Secrets en plano commiteados a git | Credenciales DB/JWT expuestas | `k8s/base/secret.yaml` |

### Decisiones estratégicas requeridas

1. **Vía regulatoria**: banco propio (3-5 años, USD 30M+) vs Emisor de Dinero Electrónico con sponsor bank (4-8 meses) vs esperar Open Finance CR como PISP.
2. **Modelo de monetización**: hoy no existe en código ni en docs. Sin esto, "global" es solo costo creciente.
3. **Alcance v1**: ¿lanzar como wallet de utilidades (pago de servicios, recargas, splits) sin custodia real, o lanzar con custodia y aceptar la regulación inmediata?
4. **Stack PCI**: PAN/CVV están en texto plano en `cards/repository.go`. Si las tarjetas virtuales se mantienen, requiere proveedor PCI-compliant (Marqeta, Stripe Issuing, Pomelo) — no se puede construir "in-house" sin certificación PCI-DSS Level 1.

---

## 2. Alcance del proyecto

### Visión

Super app fintech con origen en Costa Rica, planeada para expansión regional (Panamá, Guatemala) y eventualmente global. Compite directamente con SINPE Móvil (en CR) y aplicaciones bancarias tradicionales, ofreciendo capas que SINPE no tiene: budgeting, recurring payments, split bills, crypto on/off-ramp, virtual cards, loyalty/cashback, marketplace.

### Posicionamiento declarado por el usuario (2026-05-20)

> *"Redefinir los pagos localmente pensando en una expansión global, no quiero que el sistema se limite por nada y que respecto a la competencia tenga mayores ventajas. Quiero que sea seguro y transparente."*
>
> *"La idea es crear un propio banco con el BCCR para no tener esas limitaciones."*

### Mercado objetivo

- **Fase 1 (2026)**: Costa Rica — competencia directa con SINPE Móvil, bancos privados (BAC, Davivienda, Promerica), wallets locales (Yappy CR, KASH).
- **Fase 2 (2027)**: Panamá y Guatemala — cross-border CR↔PA↔GT (dominio `country/` y `cross_border_transfers` ya esqueletados).
- **Fase 3 (2028+)**: LATAM ampliada (MX, CO, PE).

### Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + TypeScript strict + Vite 6 + Tailwind v4 (build local) |
| Estado | Zustand (11 stores) |
| Mobile | Capacitor 6 (Android), deep links `kiramopay://` |
| Backend | Go + chi router + gorilla/websocket |
| DB | PostgreSQL 16 con 24 migraciones (001-024 según memoria; en repo 001-017 + Fase 20) |
| Cache / sessions | Redis 7 |
| Auth | JWT HS256 + Argon2id (m=128MB, t=4, p=2 según memoria Fase 20) |
| Infraestructura | Docker Compose (dev) + Kubernetes + Helm + PgBouncer |
| Observabilidad | Prometheus + Grafana (logs slog JSON) |
| CI/CD | GitHub Actions |
| Testing | Vitest (303 tests) + Playwright (3 archivos E2E) |

---

## 3. Lo realizado hasta hoy

### Fases completadas (memoria del proyecto)

| Fase | Contenido | Estado |
|------|-----------|--------|
| 0 | Frontend restructuring (Zustand, repository pattern, mock+HTTP) | ✅ Completa |
| 1-6 | Backend Go (17 dominios), PostgreSQL+Redis, JWT+Argon2id, WebSocket, K8s+Helm, Prometheus+Grafana, PWA, CI/CD, Playwright E2E | ✅ Completa estructuralmente |
| 7 | Security hardening (headers, CSRF, session revocation, lockout, audit log, body limits) | ⚠️ Parcial — lockout y CSRF middleware existen pero **no están montados** en `main.go` |
| 8 | Performance (lazy loading, manual chunks, Tailwind local, bundle gate) | ✅ Completa |
| 9 | Integraciones (push, FX rates, crypto circuit breaker, WS targeting) | ⚠️ Parcial — `sendWebPush` es stub, FX sin historia |
| 10 | Mobile (deep links, splash, Capacitor config, biometric, signing) | ✅ Completa, signing condicional |
| 11 | Producción DB & infra (SSL, backups, PgBouncer, Redis password) | ⚠️ Backups sin off-site ni restore probado |
| 12 | PIN→Password migration + mock auth elimination | ✅ Completa |
| 13 | Lint cleanup (0 errores, 0 warnings) | ✅ Completa |
| 14 | i18n (5 idiomas, 35+ keys nuevas) | ✅ Completa |
| 15 | Test coverage expansion (303 tests / 30 files) | ⚠️ Tests críticos de dinero faltantes |
| 16 | Accesibilidad (aria, role, nav landmarks) | ⚠️ Parcial — BottomSheet sin focus trap, OfflineBanner sin i18n |
| 17 | Final polish (0 warnings, builds pass) | ✅ Completa |
| 18 | Features nuevos (Budgeting, Recurring, CSV, Theme scheduling, Flags) | ⚠️ Sin scheduler para recurring, budgets sin hook auto-tracking |
| 19 | Frontend↔Backend real data connection | ⚠️ Parcial — `SinpeView` y otros no llaman al API real |
| 20 | Core banking foundation (ledger, idempotency, NUMERIC, FX history, refresh rotation, partitions, PII encryption, MFA, reconciliation, proof-of-reserves) | ⚠️ Declarada completa en memoria; **el ledger no es invocado desde 9 dominios** |

### Métricas declaradas vs auditadas

| Métrica | Declarado | Auditado |
|---------|-----------|----------|
| Tests | 311 tests / 32 files | ✅ 303 frontend + N backend |
| Lint warnings | 0 | ✅ Confirmado |
| Build pass | Sí | ✅ Confirmado |
| Dominios backend | 25+ | ✅ Confirmado |
| Migraciones | 017 + Fase 20 (018-024) | ⚠️ Repo muestra 017; Fase 20 referida en memoria pero no toda visible |
| Cobertura crítica de dinero | "Connection real" | ❌ SinpeView no llama backend |

---

## 4. Hallazgos de auditoría

### 4.1 Wallet, Transaction, SINPE

#### Bugs críticos

1. **Sin atomicidad transaccional.** `transaction/service.go:60-73` ejecuta `INSERT transaction → UpdateStatus(processing) → FindByUserID → UpdateBalance → UpdateStatus(completed)` como 4 queries independientes del pool. **No hay `pool.BeginTx`** en ningún punto. Cualquier crash entre el `UpdateBalance` y `UpdateStatus(completed)` deja el saldo debitado y la transacción colgada en estado `processing`.
2. **SINPE no acredita al destinatario.** `sinpe/service.go:79-91` solo debita al emisor. La contraparte de crédito al receptor no existe.
3. **Idempotencia falsa.** `transaction/service.go:21-26` busca por `metadata->>'idempotency_key'`, pero `repository.Create` **nunca persiste** la clave en metadata. Además no hay constraint `UNIQUE(user_id, idempotency_key)` en DB. **Doble cargo garantizado en cualquier retry de red.**
4. **`daily_spent` / `monthly_spent` nunca se actualizan.** `wallet/repository.go:47-64` solo modifica `balance_*` y `version`. Los límites del wallet son decorativos.
5. **Race en SINPE daily limit.** `sinpe/service.go:46-55`: `GetDailySinpeSpent → comparar → procede` sin lock. Dos transfers de 300K concurrentes pasan ambos contra límite 500K.
6. **`SQL/JSON injection latente` vía `description`.** `transaction/repository.go:26-28` construye metadata JSONB concatenando string crudo del usuario; comillas dobles rompen el JSON.

#### Riesgos de concurrencia

- Optimistic locking SQL correcto en `wallet/repository.go:47-64`, pero **sin retry loop** en el caller → primera transacción gana, segunda explota con error 400.
- Ningún `SELECT ... FOR UPDATE` en todo el repositorio.
- `Service.AddHistory` ignora errores con `_ = s.repo.AddHistory(...)` — saldo movido pero historial perdido.

#### Veredicto

**No listo para mover dinero real.** Tres bloqueadores absolutos: idempotencia rota, sin transacción DB que garantice atomicidad, y SINPE no transfiere (solo debita).

---

### 4.2 Autenticación y middleware

#### Vulnerabilidades críticas

1. **Refresh token ≡ Access token.** `pkg/jwt/jwt.go:37-53`: mismas `Claims`, sin campo `typ`, mismo secret. Un access robado se usa como refresh y viceversa.
2. **`RefreshToken()` no rota.** No invalida el viejo, no usa `jti`, no consulta denylist. Un refresh comprometido es válido 7 días renovables.
3. **`Logout` no revoca nada.** `auth/handler.go:101-104` lo admite en comentario.
4. **Session tracking inoperante.** `auth/service.go:74` usa `tokens.AccessToken[:16]` como hash de sesión. Los primeros 16 chars de un JWT HS256 son la cabecera base64 idéntica para todos → todas las sesiones colisionan.
5. **Lockout NO está montado en `main.go`** — el código existe pero `IncrementLockout` nunca se llama. Brute force libre.
6. **Sin rate limit dedicado a `/auth/*`** — el global de 100/min permite ~6000 intentos/hora.
7. **JWT secret default aceptado**. `dev-secret-change-in-production` con longitud mínima 16. `ValidateForProduction` solo corre si `ENVIRONMENT=="production"`; si la variable no se setea, arranca con secret débil sin error.

#### Vulnerabilidades medias

- **Argon2id** parámetros m=64MB / t=3 / p=2 — OWASP-compliant pero bajo para fintech. Subir a m=128MB / t=4.
- **Enumeración de usuarios vía timing** — `auth/service.go:54-63` retorna inmediatamente si el usuario no existe; ejecutar siempre hash dummy.
- **CSRF middleware existe pero no se monta**.
- **No hay recovery de password** — bloqueante para fintech regulado.
- **`passwordHash` SHA-256 en localStorage** (`auth.store.ts:46-54`) — equivalente de password robable vía XSS y crackeable.
- **CORS `AllowCredentials: true`** sin necesidad (Bearer tokens, no cookies).
- **MFA es solo nota frontend** (>= 100K CRC); el backend no lo enforcea.

#### Veredicto

**No listo para fintech regulado.** Cualquiera de los 7 hallazgos críticos individualmente bloquea auditoría SUGEF/PCI-DSS. Estimación: **2-3 sprints** para llevarlo a producción regulada.

---

### 4.3 Modelo de datos

#### Problemas críticos

1. **Sin ledger inmutable real.** El trigger `update_wallet_balance` (`001_initial_schema.sql:276-330`) muta `wallets.balance_crc` directamente. **No existe tabla `journal_entries` append-only con doble entrada** en las migraciones 001-017. La memoria afirma que la migración 020 lo agrega — auditar si está en el repo.
2. **Crypto usa `DOUBLE PRECISION` para montos** (`004_crypto_tables.sql:14-15, 35-39, 51-61, 78`): `balance`, `avg_cost`, `amount`, `price`, `total`, `fee`, `apy`, `earned`. Bitcoin a 8 decimales no representa exacto en double — pérdidas reales en custodia.
3. **Exchange rates en `DOUBLE PRECISION` y sin historia** (`011_multi_country.sql:27-36`). `UNIQUE(from_currency, to_currency)` → solo existe la última tasa. **Indefendible en disputa regulatoria.**
4. **Idempotency sin UNIQUE constraint**. La clave se guarda en `metadata->>'idempotency_key'` (JSONB) sin UNIQUE → race condition crea dos transacciones duplicadas.
5. **Sin `SELECT FOR UPDATE`** en ningún punto del código.
6. **Sin CHECK constraints en montos** (`amount > 0`, `balance_* >= 0`, `risk_score BETWEEN 0 AND 100`).
7. **FKs débiles**: `qr_payments.tx_id VARCHAR(100)` no es FK; idem `fraud_assessments.tx_id`, `loyalty_transactions.ref_id`.
8. **ON DELETE no definido** en muchos FKs → bloquea borrado o deja huérfanos.

#### Problemas de escala

- Solo `transactions` está particionada. `payment_history`, `sinpe_history`, `card_transactions`, `audit_logs` no.
- **`014_partition_management.sql`** define `create_future_partitions()` pero **no hay cron job** que la ejecute. En una fecha futura los inserts fallarán.
- Nuevas particiones no heredan el trigger `update_wallet_balance` — bug latente.
- Índices faltantes: `wallets(status)`, `transactions(counterparty_id, created_date)`, `cross_border_transfers(status, compliance_status)`.

#### Migraciones que faltan (recomendadas)

| Migración | Propósito |
|-----------|-----------|
| 018 | CHECK constraints + UNIQUE en `idempotency_key` |
| 019 | `NUMERIC(38,18)` en crypto + FX rate con escala fija |
| 020 | `journal_entries` append-only con REVOKE UPDATE/DELETE |
| 021 | `exchange_rates` historizadas (effective_from/to) |
| 022 | Particionar `payment_history`, `sinpe_history`, `audit_logs` |
| 023 | `pg_cron` para `create_future_partitions()` mensual |
| 024 | Cifrado columna PII (`pgcrypto`/KMS) + vista masked |
| 025 | FKs reales en `qr_payments.tx_id`, `fraud_assessments.tx_id`, etc. |

#### Veredicto

**Este esquema NO soporta operar como banco regulado hoy.** Bloqueantes: ledger ausente, floats en dominio crypto/FX, idempotency sin DB constraint, sin historia de tasas.

---

### 4.4 Frontend

#### Bugs y vulnerabilidades críticas

1. **Tokens JWT en localStorage** (`src/api/adapters/http/client.ts:13-24`). Claves `kiramopay_access_token` y `kiramopay_refresh_token`. Contradice el contrato de Phase 20 ("tokens kept in memory only"). XSS = secuestro total de sesión + family de refresh.
2. **`SinpeView.handleSendMoney` no llama al backend** (`src/views/sinpe/SinpeView.tsx:66-92`). Solo `setTimeout(2000)` y dispatch local. **Las transferencias desde la UI no llegan al ledger.** Bug capital.
3. **Credenciales test visibles en producción** (`src/views/auth/LoginView.tsx:179-185`). Bloque azul con "Cédula 702650930 / Kiramopay2024!" sin gate `import.meta.env.DEV`. Va al APK.
4. **WebSocket de notificaciones nunca autentica** (`src/hooks/useNotificationsWs.ts:37`). Lee `kiramopay-token` (clave inexistente; la real es `kiramopay_access_token`). El usuario nunca recibe push WS reales.
5. **Crypto: `txHash` falso y fee local** (`src/hooks/useApp.ts:282, 350`). `fee = fromAmount * 0.005` cliente-side, `txHash = 0x${Math.random()}`. Datos críticos fabricados por el cliente.
6. **Sin CSP** en `index.html`. Para fintech con tokens en localStorage es inaceptable.
7. **`validatePassword` mock-stub** (`src/api/adapters/http/auth.http.ts:104-109`). Devuelve `{valid: password.length>=8}` sin tocar backend.
8. **Logout fire-and-forget** (`src/stores/auth.store.ts:88-97`). Si la red falla, el refresh sigue válido pero la UI asume sesión cerrada.
9. **`useApp.dispatch` no es estable** (`src/hooks/useApp.ts:467`). Re-renderiza todo el árbol cuando cualquier store cambia.
10. **Biometría en web guarda credenciales en plano** (`src/services/biometric.ts:104-129`). Fallback web persiste user+password en `bio_cred_*` localStorage.
11. **Gemini API key en bundle**. `vite.config.ts:18-21` inyecta `process.env.GEMINI_API_KEY` → expuesta en JS público.

#### Deuda técnica

- **Doble fuente de verdad**: `useApp()` reconstruye un `AppState` legacy desde 8 stores en cada render. 30+ acciones duplican lógica de stores. Plan: migrar vistas a stores directos y borrar `useApp`.
- **`storage.ts` mezcla DEFAULT_USERS** con datos reales — restos del mock pre-Phase 12.
- **`dataSync` no maneja 401** — token expirado deja stores vacíos sin refresh automático.
- **HttpClient no implementa rotación de refresh** descrita en Phase 20.

#### UX

- LockScreen permite setear PIN sin verificar password.
- SINPE no muestra confirmación previa al envío, no avisa si supera 100K para MFA.
- `OfflineBanner` con strings hardcoded en español.
- `BottomSheet` sin focus trap ni manejo de `Escape`.

#### Tests faltantes

- Cero tests de `SinpeView`, `CryptoView`, `dataSync`, `useApp` — los flujos de dinero reales.

#### Veredicto

**No listo para usuarios reales.** Bloqueadores: tokens en localStorage, SINPE no toca backend, credenciales test en prod, WS roto, sin CSP, logout sin garantía.

---

### 4.5 Dominios backend restantes

#### Bugs concretos

1. **`crypto/service.go:28-59`**: `Buy()` solo acredita el activo crypto, **nunca debita la wallet fiat**. Idem `Sell()`. Idem `Convert()`. Idem `Stake()`. Sin transacción DB, sin lock, sin idempotency.
2. **`splitpay/service.go:80-103`**: `PayShare` marca pagado **sin mover dinero**. Cualquier participante marca su parte como pagada llamando al endpoint, sin debitar.
3. **`qrpayment/service.go:151-173`**: `ScanAndPay` registra el `qr_payment` pero **no llama a `txService.CreateTransfer`**. `TxID` queda vacío. Además acepta sobrescribir la moneda del QR.
4. **`websocket/client.go:67-71`**: autenticación WS decorativa. Loggea `msg.Token[:16]` y **nunca asigna `c.UserID`**. `SendToUser` jamás encuentra destinatarios. `CheckOrigin: return true` → CORS abierto.
5. **`cards/repository.go:22-28`**: PAN y CVV **en texto plano** en DB. Violación PCI directa. Tokenización inexistente.

#### Problemas estructurales cruzados

- **9 de 16 dominios mueven valor sin tocar el ledger** declarado en Fase 20: crypto, qr, split, country, marketplace, cards, loyalty, recurring, budget. Solo `payment` y `transaction` lo usan correctamente.
- **Cero idempotencia fuera de `transaction`/`sinpe`**. Ningún otro request expone `Idempotency-Key`.
- **`fraud/` es opcional y huérfano**. `AssessTransaction` solo se invoca por endpoint público; **ningún dominio que mueve dinero lo llama internamente**. Además su `velocity check` consulta `fraud_assessments` (sus propios registros) → circular.
- **`notification/service.go:78-87`**: `sendWebPush` **no envía nada**, solo loggea. Stub.
- **`audit/audit.go:82-87`**: el `select default` descarta silenciosamente eventos cuando el buffer está lleno. Un atacante saturando logs hace que su acción se pierda.

#### Veredicto por dominio

| Dominio | Estado | Nota |
|---------|--------|------|
| `payment` | Maduro | Único que delega correctamente a `transaction.Service` |
| `audit` | Parcial | Async OK pero descarta en backpressure y sin persistencia local |
| `exchange` | Parcial | Fetcher OK; falta fallback persistente |
| `notification` | Esqueleto | `sendWebPush` es stub |
| `websocket` | Esqueleto | Auth trust-based; `RegisterUserClient` nunca invocado |
| `fraud` | Esqueleto | Reglas razonables, desconectado del flujo de dinero |
| `cards` | **Peligroso** | PAN+CVV en claro, no integra con balance |
| `crypto` | **Peligroso** | Mueve cripto sin debitar fiat |
| `qrpayment` | **Peligroso** | No mueve dinero |
| `splitpay` | Esqueleto | Settlement falso |
| `loyalty` | Parcial | Tier OK, redemption no transaccional |
| `marketplace` | Esqueleto | Datos simulados con `math/rand` |
| `country` | Esqueleto | Currency switching sin AML real |
| `budget` | Parcial | CRUD OK, sin hook desde transaction |
| `recurring` | Parcial | CRUD OK, sin scheduler |
| `user` | Esqueleto | 2 métodos, sin validación |

#### Áreas que NO existen y deberían

- `internal/kyc` real (OCR + sanction lists OFAC/UN, CDD/EDD por umbrales)
- Card-to-ledger hook (webhooks de provider tipo Marqeta/Stripe Issuing)
- Settlement worker para splitpay
- Webhook outbound + cola persistente + DLQ
- Aplicación de `pkg/crypto` (Phase 20) a PAN/CVV
- Scheduler para recurring payments
- Refunds/chargebacks (status `refunded` existe en SQL pero sin handler)

---

### 4.6 Infraestructura, CI/CD, observabilidad

#### CI/CD

**Cubre**: lint + unit + build + bundle-size + Playwright + integration tests con Postgres/Redis.

**Falta crítico**:
- **Cero security scans** (ningún Trivy, Snyk, gosec, govulncheck, npm audit, CodeQL, Dependabot).
- **Coverage no reportado ni con gate**.
- **Sin deploy job** — imágenes se construyen y descartan. No hay push a registry, no hay `kubectl apply`/Helm upgrade.
- **Sin release workflow** (semver, changelog, GitHub Releases).
- **Sin secret scanning** (gitleaks).
- **Sin CODEOWNERS ni required checks visibles**.

#### Docker

- Backend `backend/Dockerfile`: multi-stage OK, **corre como root** (sin `USER`), **sin HEALTHCHECK**, base `alpine:3.19` (antigua), `go mod tidy` durante build (no determinístico).
- Frontend `Dockerfile.frontend`: **`VITE_API_URL=http://localhost:9999` hardcodeado en build** — rompe deploy a otro host.
- `docker-compose.yml`: `JWT_SECRET=dev-secret-change-in-production` y passwords en plano commiteados.

#### Kubernetes

- **`k8s/base/secret.yaml` con JWT_SECRET y DB_PASSWORD en plano committed a git**. `REDIS_PASSWORD: ""` vacío.
- **Imágenes con tag `:latest`** en `api.yaml`, `web.yaml`, `values.yaml` — no inmutables.
- **Sin NetworkPolicies, sin PodSecurityStandards, sin securityContext** en ningún Deployment (pods corren como root).
- HPA solo en API (2-10 replicas, CPU 65%/Mem 75%). Web sin HPA.
- `postgres.yaml` es Deployment (debería ser StatefulSet), sin liveness probe.
- **`partition-cronjob.yaml` apunta a `pgbouncer`** → falla, DDL no funciona vía transaction-pool. Particionamiento roto.
- Ingress sin TLS por defecto, sin rate-limit, sin cert-manager.

#### Observabilidad

- ✅ `/metrics` con 9 métricas custom, scrape Prometheus OK, Grafana dashboard pre-cargado.
- ❌ **Sin tracing distribuido** (cero OpenTelemetry).
- ❌ **Sin logs centralizados** (slog JSON OK localmente, sin Loki/EFK/Datadog).
- ❌ **Sin alerting rules / Alertmanager**.
- ❌ **Sin SLOs/SLIs definidos**.

#### Backups

- Daily 2 AM `pg_dump` a PVC `kiramopay-backups` (**PVC no definido en base — bug**), retención 30 días por `find -mtime`.
- **Sin off-site / S3**, **sin verificación de restore documentada**, **sin encriptación at-rest del dump**.

#### Mobile

- Permisos solo `INTERNET` — bien.
- Signing condicionado a `KIRAMOPAY_KEYSTORE_FILE` env; **si falta, release queda sin firmar**.
- **`minifyEnabled false`** en release — sin ofuscación ProGuard.
- Deep links + autoVerify configurados.

---

### 4.7 Tests y QA

#### Estado actual

- **Vitest**: 303 tests / 30 files. Coverage instalado pero no se ejecuta en CI ni hay threshold.
- **Backend integration**: matriz razonable (auth/wallet/transaction/sinpe/crypto/fraud) pero sin coverage medido.
- **Playwright E2E**: 3 archivos, ~12 tests (auth, home, navigation). **No cubre SINPE send, crypto buy, QR pay, cards, splitpay, recharge, push, offline queue**. Muchos asserts pasivos con `if (visible)`.
- **Sin load tests** (k6, vegeta).
- **Sin contract tests** (Pact) frontend↔backend.
- **Sin chaos tests**.

#### Tests urgentes que faltan

1. Concurrencia con goroutines: 100 transfers paralelos sobre el mismo wallet.
2. Idempotencia real: 2 POST simultáneos con la misma key.
3. Atomicidad: kill conexión entre INSERT y UPDATE balance.
4. SINPE daily limit concurrente.
5. Property-based: `SUM(journal) == balance` para cualquier secuencia aleatoria.
6. Chaos Redis: matar Redis a mitad de pago.
7. E2E de flujos de dinero (SINPE send, crypto buy, QR pay).
8. Fuzz testing en endpoints de auth.

---

### 4.8 Documentación

**Lo que existe**:
- `README.md` muy completo en español, onboarding funcional.
- `CONTRIBUTING.md` con branches, conventional commits, PR template (inconsistencia: dice "88+ tests" cuando son 303).
- `ARQUITECTURA_BASE_DATOS.md`, `PLAN_DESARROLLO_KIRAMOPAY.md`, `SERVIDOR.md` existen.
- `backend/docs/openapi.yaml` (1523 líneas) **mantenido a mano** — riesgo de drift garantizado.

**Lo que falta**:
- Runbooks de incidente
- Postmortem template
- On-call docs
- `SECURITY.md`
- Threat model
- Disaster recovery plan (RTO/RPO)
- ADRs (Architecture Decision Records)
- Política de retención de datos (Ley 8204 CR, GDPR/LGPD)

---

## 5. Estrategia y posicionamiento

### Reality check: "crear un banco propio con el BCCR"

El usuario expresó la intención de crear un banco propio. Esta es la realidad regulatoria:

#### El BCCR no da licencias bancarias

Es **SUGEF** (Superintendencia General de Entidades Financieras) quien las otorga. El BCCR opera la infraestructura de pagos (SINPE).

#### Requisitos para banco privado en Costa Rica (Ley 1644, Ley 7558)

- **Capital social mínimo**: ~₡14.000 millones (≈ **USD 27 millones**) — actualizado periódicamente por SUGEF.
- **Idoneidad de accionistas**: due diligence completa, sin antecedentes financieros adversos.
- **Gobierno corporativo formal**: junta directiva, comité de auditoría externa, oficial de cumplimiento certificado.
- **Plan de negocio aprobado por SUGEF**.
- **Tiempo estimado**: 18-24 meses desde solicitud formal.
- **Supervisión continua**: capital regulatorio (Basilea III adaptado), encaje legal, reportería mensual.

#### Vías alternativas (en orden de viabilidad)

| Opción | Tiempo | Capital | Recomendación |
|--------|--------|---------|--------------|
| **A. EDE con sponsor bank** (Emisor Dinero Electrónico) | 4-8 meses | USD 200K-500K capital operación + fideicomiso | ✅ **Recomendado para 2026** |
| **B. PISP bajo Open Finance CR** | Cuando salga el reglamento (consulta pública 2025) | Bajo | ✅ Mediano plazo |
| **C. Banco propio** | 18-24+ meses | USD 27M+ | ⚠️ Sólo si hay levantamiento serie A/B |
| **D. Fintech sin licencia** | Inmediato | Bajo | ❌ Captación ilegal — riesgo cárcel (Ley 7558 art. 116) |

**Recomendación**: ir por **(A) EDE con sponsor bank** para 2026, mientras se prepara documentación y capital para (C) en 2028-2029. Mientras tanto, integrar con bancos vía API (BAC, Davivienda, Promerica) y operar P2P real sin captación directa.

### Ventajas competitivas reales (vs SINPE Móvil)

SINPE Móvil ya existe, es gratis y bancario. Tu app no puede ser "lo mismo pero bonita". Ventajas defendibles:

1. **Cross-border instantáneo CR↔PA↔GT** con FX transparente (spread declarado, no oculto). El dominio `country/` ya apunta ahí.
2. **Capa de productos sobre el pago**: budgeting, recurring, split, cashback, virtual cards. SINPE no tiene nada de esto. Termínalos bien — son tu moat real.
3. **Crypto on/off-ramp en colones** sin pasar por exchange gringo. Requiere partner exchange registrado o licencia VASP.
4. **Transparencia operacional**: dashboard público de proof-of-reserves, fees declarados ex-ante, audit log exportable por el usuario.
5. **API pública con rate limits para integradores** — ventaja vs SINPE que es servicio interbancario cerrado.

### Modelo de monetización

**Ausente en código y documentación.** Sin esto, "global" es un costo creciente. Candidatos:

| Fuente de ingreso | Estimación | Comentario |
|-------------------|-----------|------------|
| **FX spread cross-border** | 0.8-1.5% | Visible al usuario (vs Wise: 0.5%, vs banco: 3%+) |
| **Fee cashout a banco externo** | ₡500 fijo | Después de N retiros gratuitos/mes |
| **Suscripción premium KiramoPay+** | ₡2.500/mes | Sin fees, mayor límite, MFA hardware, soporte 24/7 |
| **Interchange tarjetas virtuales** | 1.5-2.5% | Vía partner como Marqeta |
| **API B2B (merchants)** | ₡50 por transacción | + comisión por procesamiento |
| **Float / yield sobre fideicomiso** | Mínimo, regulado | Inversiones del fideicomiso EDE (rendimiento conservador) |

---

## 6. Plan a futuro (roadmap)

### Q2 2026 (Jun-Ago) — Hardening crítico

**Objetivo**: cerrar bloqueantes de seguridad y atomicidad antes de cualquier prueba con dinero real.

- Implementar atomicidad DB en `wallet`/`transaction`/`sinpe` (Serializable + retry).
- Crear migración 020 (`journal_entries` real) + refactor del trigger.
- Idempotency key persistida con UNIQUE constraint (migración 018).
- Refresh token rotación + denylist Redis + logout real.
- Montar lockout middleware en `/auth/*`.
- Cablear `auditLogger` en wallet, transaction, sinpe.
- Implementar acreditación al peer en SINPE interno.
- **Eliminar JWT de localStorage en frontend**.
- **Conectar SinpeView al backend real**.
- Eliminar credenciales test del LoginView en build de producción.
- Migrar secrets de `k8s/base/secret.yaml` a External Secrets / SealedSecrets.
- Agregar Trivy + gosec + govulncheck a CI con gate bloqueante.

### Q3 2026 (Sep-Nov) — Producto, compliance y testing

- Migración 019 (NUMERIC en crypto, FX con escala fija).
- Migración 021 (FX historizado).
- Integrar `fraud.AssessTransaction` en TODOS los flujos de dinero antes del posting.
- Conectar 9 dominios al ledger (crypto, qr, split, country, marketplace, cards, loyalty, recurring, budget).
- MFA backend-enforced ≥ 100K CRC.
- Password reset seguro.
- Cifrado columna PII (migración 024).
- E2E Playwright para flujos de dinero (SINPE, crypto, QR, split).
- Tests de concurrencia con goroutines.
- Job nightly de reconciliación journal ↔ balances.
- Open API formalizada con generación automática (oapi-codegen).
- Decidir y firmar contrato con sponsor bank (vía A).
- Definir e implementar modelo de monetización.

### Q4 2026 (Dic-Feb 2027) — Pre-producción regulada

- Tokenización PCI vía Marqeta / Stripe Issuing (eliminar PAN/CVV de DB propia).
- Tracing distribuido (OpenTelemetry → Tempo/Jaeger).
- Logs centralizados (Loki o Datadog).
- Alerting rules + SLOs definidos.
- Backups off-site cifrados con restore probado mensualmente.
- KYC real con OCR + listas OFAC/UN.
- Iniciar trámite licencia EDE con SUGEF (vía sponsor bank).
- Runbooks, threat model, disaster recovery plan.
- Auditoría externa de seguridad (pentest + code review independiente).
- Load testing con k6 (objetivo: 1000 TPS sostenido).

### 2027 — Expansión regional

- Lanzamiento producción CR (post-licencia EDE).
- Expansión a Panamá (alianza Banco General o partner local).
- Expansión a Guatemala.
- Multi-región Postgres con data residency por país.
- Open Banking / PISP (cuando aplique el reglamento BCCR).

### 2028+ — Banco propio (opcional según funding)

- Si hay capital serie B levantado: iniciar trámite bancario formal.
- Expansión LATAM (MX, CO, PE).

---

## 7. Backlog priorizado

### P0 — Bloqueantes (no se mueve dinero real sin esto)

| # | Tarea | Frente | Estimación |
|---|-------|--------|-----------|
| 1 | Envolver flows wallet/transaction/sinpe en `BeginTx(Serializable)` con retry | Backend | 1 sprint |
| 2 | Crear tabla `journal_entries` append-only + refactor balance derivation | DB | 2 sprints |
| 3 | Persistir `idempotency_key` con UNIQUE constraint | DB + Backend | 1 sprint |
| 4 | Refresh token rotacional con `jti` + denylist Redis + logout real | Auth | 1 sprint |
| 5 | Montar lockout middleware en `/auth/*` + rate limit dedicado | Auth | 0.5 sprint |
| 6 | Cablear `auditLogger` en wallet, transaction, sinpe | Backend | 0.5 sprint |
| 7 | Implementar acreditación al peer en SINPE interno | Backend | 0.5 sprint |
| 8 | Eliminar JWT de localStorage → memoria + httpOnly cookie pattern | Frontend | 1 sprint |
| 9 | Conectar `SinpeView.handleSendMoney` al backend real | Frontend | 0.5 sprint |
| 10 | Eliminar bloque de credenciales test en `LoginView` (production build) | Frontend | 1 hora |
| 11 | Migrar `k8s/base/secret.yaml` a External Secrets o SealedSecrets | Infra | 0.5 sprint |
| 12 | Agregar Trivy + gosec + govulncheck + npm audit a CI con gate | CI/CD | 0.5 sprint |

**Estimación total P0**: ~10 sprints (5 meses) con 1 dev fulltime / 5 sprints (~2.5 meses) con 2 devs.

### P1 — Críticos no bloqueantes (antes de hablar con SUGEF / sponsor bank)

| # | Tarea | Frente |
|---|-------|--------|
| 13 | Migración 019 (NUMERIC crypto, FX scale-fixed) | DB |
| 14 | Migración 021 (FX historizado con effective_from/to) | DB |
| 15 | Conectar 9 dominios al ledger (crypto, qr, split, country, etc.) | Backend |
| 16 | MFA backend-enforced ≥ 100K CRC | Backend |
| 17 | Password reset seguro (token 1-uso, 15min TTL) | Backend |
| 18 | Job nightly reconciliación journal ↔ balances | Backend |
| 19 | Migración 024 (cifrado columna PII) | DB |
| 20 | Tokenización tarjetas vía Marqeta/Stripe Issuing | Backend |
| 21 | Particionar `payment_history`, `sinpe_history`, `audit_logs` | DB |
| 22 | `pg_cron` para `create_future_partitions` mensual | DB |
| 23 | Arreglar `partition-cronjob` (apuntar a postgres directo, no pgbouncer) | Infra |
| 24 | KYC real (OCR + listas OFAC/UN) | Backend |
| 25 | E2E Playwright para flujos de dinero | QA |
| 26 | Tests de concurrencia con goroutines | QA |
| 27 | Property-based testing en amounts | QA |
| 28 | OpenAPI generado automáticamente (oapi-codegen) | DevEx |
| 29 | Eliminar SHA-256 password hash de localStorage | Frontend |
| 30 | CSP en `index.html` | Frontend |
| 31 | Interceptor de refresh-token en HttpClient | Frontend |
| 32 | Conectar `crypto`, `qr`, `split` views al backend real | Frontend |
| 33 | Eliminar `useApp` legacy, migrar vistas a stores directos | Frontend |
| 34 | Subir Argon2id a m=128MB, t=4 | Auth |
| 35 | Anti-enumeración con dummy hash compare | Auth |
| 36 | CHECK constraints masivos (migración 018) | DB |
| 37 | FKs reales en `qr_payments.tx_id`, `fraud_assessments.tx_id`, etc. | DB |

### P2 — Importantes (post-MVP regulado)

| # | Tarea | Frente |
|---|-------|--------|
| 38 | OpenTelemetry tracing distribuido | Observabilidad |
| 39 | Logs centralizados (Loki/Datadog) | Observabilidad |
| 40 | Alerting rules + SLOs/SLIs | Observabilidad |
| 41 | Backups off-site cifrados + restore probado | Infra |
| 42 | securityContext + NetworkPolicies + PSA labels en K8s | Infra |
| 43 | TLS en Ingress con cert-manager | Infra |
| 44 | StatefulSet para postgres (en lugar de Deployment) | Infra |
| 45 | Load testing con k6 (objetivo: 1000 TPS) | QA |
| 46 | Chaos testing (kill Redis, matar pods mid-tx) | QA |
| 47 | Runbooks de incidente + postmortem template | Docs |
| 48 | `SECURITY.md` + threat model | Docs |
| 49 | Disaster recovery plan (RTO/RPO) | Docs |
| 50 | ProGuard `minifyEnabled true` en Android release | Mobile |
| 51 | Validar keystore presente antes de build Android release | Mobile |
| 52 | LockScreen: requerir password antes de cambiar PIN | UX |
| 53 | SINPE: confirmación previa + advertencia MFA ≥ 100K | UX |
| 54 | `BottomSheet`: focus trap + manejo `Escape` | UX |
| 55 | i18n para `OfflineBanner` y strings hardcoded restantes | i18n |

### P3 — Mejoras y deuda menor

| # | Tarea | Frente |
|---|-------|--------|
| 56 | Down migrations para todas las nuevas | DB |
| 57 | Vistas masked para PII (soporte/reporting) | DB |
| 58 | Política de retención datos 5 años (Ley 8204) + archive cold storage | DB |
| 59 | Refunds/chargebacks handler (status `refunded` ya en SQL) | Backend |
| 60 | Settlement worker para splitpay | Backend |
| 61 | Scheduler de cobros automáticos en recurring | Backend |
| 62 | Webhook outbound + cola persistente + DLQ | Backend |
| 63 | CODEOWNERS + branch protection rules | DevEx |
| 64 | Release workflow (semver + changelog + GitHub Releases) | DevEx |
| 65 | Deploy job en CI (push registry + Helm upgrade) | CI/CD |
| 66 | Contract tests (Pact) frontend↔backend | QA |
| 67 | Eliminar `process.env.GEMINI_API_KEY` del bundle del cliente | Frontend |
| 68 | Limpiar `storage.ts` (remover DEFAULT_USERS legacy) | Frontend |
| 69 | `dataSync` con manejo de 401 + auto-refresh | Frontend |
| 70 | Inconsistencia "88+ tests" en CONTRIBUTING (son 303) | Docs |

---

## 8. Pendientes y decisiones requeridas

### Decisiones de producto (requieren al usuario)

1. **¿Vía A (EDE con sponsor bank) o vía C (banco propio)?** Determina inversión necesaria y plazo.
2. **¿Cuál es el modelo de monetización?** Sin definir hoy.
3. **¿Mantener tarjetas virtuales propias o delegar a Marqeta/Stripe Issuing?** Determina si entran o no en scope PCI.
4. **¿Crypto es feature core o secundaria?** Si es core, necesitas partner exchange con licencia VASP.
5. **¿Alcance v1?** Solo CR o ya lanzar con cross-border CR↔PA?

### Decisiones técnicas pendientes

1. **¿Aceptar 5-meses-de-trabajo de hardening antes de cualquier soft-launch, o pivotear a un MVP "wallet de utilidades" sin custodia?**
2. **¿Storage de tokens en frontend**: memoria pura + refresh por iframe vs httpOnly cookies + CSRF tokens?
3. **¿Tracing**: OpenTelemetry + Tempo (self-hosted) vs Datadog (managed, costoso)?
4. **¿Multi-región Postgres**: réplicas lógicas vs Citus vs CockroachDB?
5. **¿Mantener Capacitor o migrar a React Native?** Capacitor está bien para hoy, pero limita en features nativas avanzadas.

### Pendientes administrativos

- [ ] Contratar abogado fintech CR (Consortium Legal, BLP, Arias) para validar vía regulatoria
- [ ] Conversación informal con SUGEF sobre roadmap a licencia EDE
- [ ] Identificar 3-5 sponsor banks candidatos y solicitar términos
- [ ] Definir cap table y plan de fundraising si se va por banco propio
- [ ] Contratar oficial de cumplimiento certificado (incluso para EDE)
- [ ] Auditoría externa de seguridad (objetivo: Q4 2026 antes de prod)
- [ ] Registro de marca KiramoPay en CR, PA, GT

---

## 9. Métricas de salud del proyecto

### Métricas técnicas (auditadas)

| Métrica | Valor actual | Objetivo P0 | Objetivo regulado |
|---------|-------------|-------------|-------------------|
| Tests unit + integration | 303 | 500+ | 1000+ |
| Cobertura backend | No medida | 70% | 85% |
| Cobertura frontend | No medida | 70% | 80% |
| Tests E2E flujos dinero | 0 | 5+ | 15+ |
| Tests concurrencia goroutines | 0 | 5+ | 20+ |
| Lint warnings | 0 | 0 | 0 |
| Vulnerabilidades alta CI scans | No medidas | 0 | 0 |
| Bundle size | < 200KB / chunk | < 200KB | < 200KB |
| Dominios usando ledger | 2 de 16 | 16 de 16 | 16 de 16 |
| Dominios con idempotency | 2 de 16 | 10+ | 16 de 16 |

### Métricas de producto (a definir)

- DAU / MAU
- Transactions per second sostenido
- p50 / p95 / p99 latencia transferencia
- Tasa de éxito transacciones
- Tiempo medio resolución tickets
- NPS
- Costo de adquisición de usuario (CAC)
- Lifetime value (LTV)

### Métricas regulatorias (requeridas SUGEF)

- Encaje legal (% balance fideicomiso vs IOUs emitidos)
- Reportería mensual movimientos
- Reportes UIF (Unidad de Inteligencia Financiera) por umbrales
- Sanction list scan compliance
- KYC completion rate

---

## 10. Anexos

### A. Convenciones del proyecto verificadas

✅ Currency amounts: BIGINT centimos en backend / int64 en Go (fiat)
❌ Crypto y FX en `DOUBLE PRECISION` — debe migrar a NUMERIC
✅ Spanish default + i18n con `t()`
✅ Tailwind v4 local build
✅ Zustand stores por dominio
✅ Repository pattern frontend con mock+http
✅ Audit log table existe
❌ Audit log NO se invoca desde dominios de dinero
✅ Lockout backend code existe
❌ Lockout middleware NO está montado
✅ Argon2id implementado
⚠️ Argon2id parámetros bajos para fintech (subir a m=128MB t=4)
✅ JWT rechaza `alg=none`
❌ JWT refresh ≡ access (sin rotación real)

### B. Riesgos legales identificados

| Riesgo | Norma | Mitigación |
|--------|-------|-----------|
| Captación ilegal de recursos | Ley 7558 art. 116 (CR) | No mover dinero real sin licencia EDE/banco |
| Datos personales sin consentimiento | Ley 8968 (CR), GDPR | Política de privacidad + consentimiento explícito |
| Retención de datos financieros | Ley 8204 (CR), SUGEF | Mínimo 5 años, archive en cold storage |
| Sanction list compliance | OFAC, UN Security Council | Integración con servicio como Sanctions.io / ComplyAdvantage |
| PCI-DSS para tarjetas | PCI-DSS v4.0 | Tokenizar vía provider PCI-Level 1 |
| Anti-lavado | Ley 8204 + Reglamento BCCR | KYC + monitoreo transaccional + reportes UIF |

### C. Stack alternativo recomendado para áreas críticas

| Área | Hoy | Recomendado |
|------|-----|------------|
| Tarjetas virtuales | In-house con PAN en DB | Marqeta / Stripe Issuing / Pomelo |
| KYC | No existe | Persona / Onfido / Truora |
| Sanction screening | No existe | ComplyAdvantage / Sanctions.io |
| FX rates | API externa sin contrato | Wise API / Currencylayer pro |
| Tracing | No existe | OpenTelemetry + Tempo |
| Logs centralizados | No existe | Loki o Datadog |
| Secrets | k8s base secrets en plano | External Secrets Operator + AWS Secrets Manager / Vault |
| CDN / WAF | nginx propio | CloudFront + AWS WAF / Cloudflare |
| Push notifications | Stub (no envía) | OneSignal o Firebase Cloud Messaging |
| Email transaccional | No existe | Resend / Postmark / SES |
| SMS OTP | No existe | Twilio / Sinch |

### D. Referencias de auditorías individuales

- Sección 4.1: auditor `aa8c119ba37b63bd0` (wallet/transaction/sinpe)
- Sección 4.2: auditor `acaa936bd1ed733ec` (auth + middleware)
- Sección 4.3: auditor `a5cc116f2c06dc088` (DB migrations + data model)
- Sección 4.4: auditor `aeddfb0c80b29e872` (frontend)
- Sección 4.5: auditor `a34dd7543751aeafc` (resto backend)
- Sección 4.6 y 4.7: auditor `abcddd28ddda94222` (infra + CI/CD + tests + docs)

### E. Glosario

- **EDE**: Emisor de Dinero Electrónico (figura regulatoria CR)
- **PISP**: Payment Initiation Service Provider (figura Open Banking)
- **SUGEF**: Superintendencia General de Entidades Financieras (CR)
- **UIF**: Unidad de Inteligencia Financiera (CR)
- **VASP**: Virtual Asset Service Provider (figura para crypto)
- **CDD/EDD**: Customer Due Diligence / Enhanced Due Diligence
- **TOCTOU**: Time-of-check to time-of-use (clase de bug de concurrencia)
- **PII**: Personally Identifiable Information
- **PAN**: Primary Account Number (número de tarjeta)
- **HSM**: Hardware Security Module
- **RTO/RPO**: Recovery Time/Point Objective
- **SLO/SLI**: Service Level Objective/Indicator

---

**Fin del documento.**

*Este reporte es un diagnóstico técnico-estratégico. Las decisiones de producto, regulatorias y de inversión requieren juicio del fundador / inversores / abogado fintech. El equipo técnico debe priorizar P0 antes de cualquier despliegue que mueva dinero real.*

---

## Anexo F — Estado al cierre 2026-05-20 (post implementación)

Documento la verificación contra el código actual después de la jornada de implementación del 20-may-2026. El alcance ejecutado excluyó explícitamente los temas regulatorios BCCR/SUGEF.

### F.1 P0 — Estado contra los 12 bloqueantes

| # | Tarea P0 | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | `BeginTx(Serializable)` + retry en wallet/transaction/sinpe | ✅ Hecho | `internal/ledger/ledger.go` `Engine.Post`; SQLSTATE 40001/40P01 retry con backoff |
| 2 | `journal_entries` append-only + derive balance | ✅ Hecho | `migrations/020_journal_ledger.sql`; trigger DEFERRABLE balance check + UPDATE/DELETE trigger inmutable; vista `ledger_account_balances` |
| 3 | `idempotency_key` con UNIQUE | ✅ Hecho | `migrations/018_integrity_constraints.sql` (UNIQUE `(user_id, idempotency_key, created_date)`); persistido por `transaction.Repository.Create` |
| 4 | Refresh rotacional + jti denylist + logout real | ✅ Hecho | `pkg/jwt/jwt.go` (typ:access/refresh, jti, familyID, parent_jti); `auth.Repository.ConsumeRefreshToken` con detección de reuso → revoca familia; Redis denylist con TTL del access |
| 5 | Lockout montado en `/auth/login` + rate limit dedicado | ✅ Hecho | `cmd/api/main.go` monta `AccountLockoutCheck(lockoutStore, 5)` y `RateLimit(10/min)` en el grupo /auth/* |
| 6 | `auditLogger` cableado en wallet/transaction/sinpe/cards | ✅ Hecho parcialmente | Hooked en `auth.Service` (login/register/password change/reset/refresh-reuse) y `transaction.Service.CreateTransfer`; `sinpe.Service.Send` también. `cards` aún no recibió el logger pasado |
| 7 | Acreditar al peer en SINPE interno | ✅ Hecho | `sinpe/service.go`: `userRepo.FindByPhone` → `txService.CreateTransfer` con ambas patas atómicas |
| 8 | Eliminar JWT de localStorage | ✅ Hecho | `src/stores/auth.store.ts`: tokens en memoria, `partialize` no los persiste |
| 9 | Conectar `SinpeView` al backend | ⚠️ Parcial | `useApp` despacha al adapter HTTP en `ADD_SINPE_TRANSACTION`. **No se verificó** end-to-end que un click en SINPE Send dispare `/api/v1/sinpe/send`. Pendiente prueba manual |
| 10 | Eliminar credenciales test del `LoginView` en prod | ❌ Pendiente | Bloque azul con cédula/password sigue visible sin gate `import.meta.env.DEV` |
| 11 | k8s/base/secret.yaml a External Secrets / SealedSecrets | ❌ Pendiente | Sin cambios |
| 12 | Trivy + gosec + govulncheck + npm audit en CI | ❌ Pendiente | Sin cambios |

**Resumen P0:** 7/12 hechos, 1 parcial, 4 pendientes. Los 4 pendientes son: (10) UI fix de credenciales, (11) infra de secretos, (12) seguridad en CI, y (9) verificación E2E de SinpeView.

### F.2 P1 — Estado contra los 25 críticos no-bloqueantes

| # | Tarea | Estado |
|---|-------|--------|
| 13 | NUMERIC crypto + FX escala fija | ✅ Migración 019 (`NUMERIC(38,18)` crypto, `NUMERIC(20,10)` FX, `NUMERIC(6,4)` cashback con escala 0-100) |
| 14 | FX historizado | ✅ Migración 021 (effective_from/to, partial unique, función `fn_fx_rate_at`, `cross_border_transfers.exchange_rate_id`) |
| 15 | Conectar 9 dominios al ledger | ❌ Pendiente — solo `transaction` y `sinpe` están en el ledger. `crypto`, `qr`, `split`, `country`, `marketplace`, `cards`, `loyalty`, `recurring`, `budget` siguen mutando sus tablas directamente |
| 16 | MFA backend-enforced ≥ 100K CRC | ✅ Hecho — `internal/mfa.Service` con threshold configurable, consumido por `transaction.Service` antes de postar |
| 17 | Password reset (token 1-uso, 15 min) | ✅ Hecho — `/auth/forgot-password` + `/auth/reset-password`, anti-enumeración, revoca toda familia de refresh + sesiones |
| 18 | Job nightly reconciliación | ✅ Hecho — `internal/reconcile.Service.Run`, vista `wallet_journal_drift`, alerta audit `risk: high` por divergencia; endpoint admin on-demand `/admin/reconcile` |
| 19 | Cifrado columna PII | ✅ Migración 024 (`pgp_sym_encrypt`/`hmac` para cedula/phone/email/birth_date, vista `users_masked`, helper functions) |
| 20 | Tokenización tarjetas vía provider PCI | ❌ Pendiente |
| 21 | Particionar payment_history / sinpe_history / audit_logs | ✅ Migración 023 (sinpe_history y audit_logs particionadas; partition rename de índices para evitar colisión) |
| 22 | pg_cron mensual | ⚠️ Función `maintain_all_partitions()` lista; cron K8s job sin agregar |
| 23 | Fix `partition-cronjob.yaml` (no pgbouncer) | ❌ Pendiente |
| 24 | KYC real | ❌ Pendiente |
| 25 | E2E Playwright de flujos de dinero | ❌ Pendiente |
| 26 | Tests concurrencia goroutines | ✅ Escritos — `internal/ledger/ledger_integration_test.go` (100 transfers paralelos, idempotency 2x, validación unbalanced); requieren DB para correr |
| 27 | Property-based testing | ❌ Pendiente |
| 28 | OpenAPI generado automáticamente | ✅ **Implementado en esta sesión** — `openapi-typescript@7`, `npm run gen:api`, `prebuild` hook, `src/api/generated/openapi.d.ts`, helper `ApiData<P,M>`, demo en `account.http.ts` y `notification.http.ts`, doc en `CONTRIBUTING.md` |
| 29 | Eliminar SHA-256 password hash de localStorage | ✅ Hecho — reemplazado por `src/services/lockKdf.ts` (PBKDF2-200k + salt aleatorio + PIN 4-6 dígitos + 5 fails → re-login) |
| 30 | CSP en `index.html` | ⚠️ Presente en `nginx.conf` (CSP header global) pero no como meta tag en `index.html` |
| 31 | Interceptor de refresh-token en HttpClient | ❌ Pendiente |
| 32 | Conectar crypto/qr/split views al backend | ⚠️ Crypto SÍ carga assets/transactions/staking via syncAllData (verificado). Split y QR sin verificar |
| 33 | Eliminar `useApp` legacy | ❌ Pendiente |
| 34 | Argon2id m=128MB t=4 | ✅ Hecho — `pkg/hash/argon2.go` `DefaultParams` actualizado |
| 35 | Anti-enumeración con dummy hash | ✅ Hecho — `hash.DummyVerify` invocado cuando user no existe |
| 36 | CHECK constraints masivos | ✅ Migración 018 (amount>0, balance>=0, kyc_level 0-2, status whitelists, etc.) |
| 37 | FKs reales en qr/fraud/loyalty refs | ⚠️ Solo índices agregados; FKs reales bloqueadas porque `transactions` es partitioned (no se puede FK a tabla particionada directamente) |

**Resumen P1:** 14/25 hechos, 4 parciales/observados, 7 pendientes.

### F.3 Mejoras incrementales agregadas (no estaban en backlog explícito)

- **Migración 022 `auth_security`**: tablas `refresh_tokens`, `password_reset_tokens`, `mfa_challenges` con FKs e índices apropiados.
- **Migración 025 (P2)** down migrations pares (`.down.sql`) para 018-024, organizadas en `backend/migrations/down/` para evitar carga automática por docker-entrypoint-initdb.d.
- **Endpoint público `/api/v1/transparency/proof-of-reserves`** (`internal/transparency`) — agregados públicos: SUM(user_liabilities) vs SUM(reserves) per currency con `ratio_pct`. Diferenciador de transparencia.
- **Endpoint público `/api/v1/transparency/fees`** — schedule público de comisiones (SINPE, FX spread, premium subscription).
- **Health endpoint extendido** — incluye `last_drift_crc` del último ciclo de reconciliación.
- **Endpoint admin `/admin/reconcile`** — on-demand reconciliation con métricas (wallets_total, wallets_bad, drift_crc/usd, duration_ms).
- **Script `scripts/contract-check.sh`** + `npm run check:contracts` — sonda en vivo de todos los endpoints sync, imprime shape real. Diagnóstico de 5 segundos ante "no me aparecen datos".
- **Defensive `Array.isArray` guard** aplicado a adapters HTTP (account, notification, sinpe, crypto, cards, country, services, budget, recurring) — un `null` del backend deja vacío en UI, no NaN ni crash.
- **Seeder dev arreglado** — opening balance posting en journal (drift = 0 desde startup), crypto data poblada (3 assets, 5 txs, 1 staking, 1 alert), saved_services con FK correcta, `notification_history` con shape real.

### F.4 Bugs descubiertos y arreglados durante la implementación

1. **pgx type inference en NULLIF** — `INSERT INTO refresh_tokens VALUES (..., NULLIF($3,'')::uuid, ...)` fallaba con SQLSTATE 42P08 porque pgx no podía deducir tipo de `$3`. Fix: casts explícitos `$n::text` antes del NULLIF. También aplicado en `CreateSession` y opening posting del seeder.
2. **Adapter HTTP `balance_crc` vs `crc`** — el backend `/wallets/me/balance` devuelve `{crc, usd, ...}` pero el adapter HTTP esperaba `{balance_crc, balance_usd}` → división undefined/100 = NaN en UI. Fix: adapter tolerante a ambos shapes con `??`.
3. **Adapter HTTP notifications field mismatch** — backend devuelve `{body, read_at}` (tabla `notification_history`), adapter esperaba `{message, read}`. Fix: tolerancia + uso del tipo generado del OpenAPI.
4. **Migración 023 rename collision** — al renombrar `sinpe_history` y `audit_logs` a `*_legacy`, sus índices conservaban el nombre original y bloqueaban la creación de la tabla particionada. Fix: `ALTER INDEX ... RENAME TO *_legacy` previo.
5. **Migración 019 cashback percentage range** — mi check `<= 1` asumió escala decimal pero el código usa 0-100. Fix: `<= 100` y `NUMERIC(6,4)`.
6. **Backend Go compile errors** en `account.http.ts` y refactor de `auth.Service`/`transaction.Service` constructor signature — actualizados todos los call sites en `main.go` y tests de integración.

### F.5 Riesgos remanentes ordenados por severidad

**Críticos sin resolver (no se debe lanzar a prod sin esto):**

1. **9 de 16 dominios siguen fuera del ledger** (crypto, qr, split, country, marketplace, cards, loyalty, recurring, budget). El ledger es la fuente de verdad técnica pero la mitad del producto la ignora. Auditoría externa lo flagearía inmediato.
2. **Credenciales test visibles en `LoginView` para cualquier build** — fuga trivial si se distribuye el APK.
3. **`k8s/base/secret.yaml` con JWT_SECRET y DB_PASSWORD en plano commiteados a git** — exposición histórica completa en git history.
4. **PAN y CVV en texto plano** en `cards/repository.go` — violación PCI-DSS directa.
5. **Sin scanners de seguridad en CI** — vulnerabilidades de dependencias no detectadas.
6. **Sin tracing distribuido** — debug de incidentes ciego en producción.

**Importantes:**

7. **HttpClient sin refresh interceptor** — 401 no se auto-renueva; el usuario es expulsado a login.
8. **`useApp` doble fuente de verdad** — sigue compilando un legacy `AppState` desde 8 stores. Plan de migración no iniciado.
9. **Backups sin restore probado** — en una contingencia real no sabemos si los dumps son válidos.
10. **WebSocket auth decorativo** — `RegisterUserClient` nunca invocado; notificaciones WS no llegan.
11. **`sendWebPush` es stub** — push notifications no funcionan.

### F.6 Veredicto actualizado

**Antes de hoy**: maqueta funcional con bordes peligrosos.
**Después de hoy**: maqueta funcional + **núcleo de banca correcto y reproducible** (ledger inmutable, atomicidad serializable, idempotencia DB-garantizada, refresh rotacional, MFA enforce, reconciliación nightly, proof-of-reserves público, contract types generados).

Sigue **NO listo para mover dinero real de usuarios externos** por los 6 riesgos críticos listados arriba — pero la fundación sobre la cual construir está. Conectar los 9 dominios faltantes al ledger es trabajo mecánico ahora que el patrón está bien definido en `transaction.Service.CreateTransfer`. El siguiente sprint debe ir por:

1. Cards/Crypto/QR/Split en ledger (15 puntos / 1 sprint).
2. Tokenización PCI vía Marqeta (decisión + integración, 1 sprint).
3. Credenciales test fuera de build prod (15 min).
4. Secretos K8s con External Secrets (1 día).
5. Trivy + gosec + npm audit en CI con gate (1 día).
6. Verificación E2E manual de SINPE Send end-to-end con red real.

Esto reduce los 6 riesgos críticos a 0 en aproximadamente 2 sprints.

### F.7 Métricas técnicas actualizadas

| Métrica | Pre-sesión | Post-sesión | Objetivo P0 |
|---------|-----------|-------------|-------------|
| Migraciones DB | 001-017 | 001-024 + carpeta `down/` | — |
| Dominios usando ledger | 2 de 16 | 2 de 16 (sin cambio) | 16 de 16 |
| Tests concurrencia goroutines | 0 | 4+ (escritos) | 5+ |
| Drift reconciliación | No medido | 0 (continuo) | 0 |
| Adapters HTTP con guards `Array.isArray` | 0 | 8 | 16 |
| Adapters HTTP usando tipos generados | 0 | 2 (demo) | 16 |
| Contract check automatizado | No | Sí (script) | Sí |
| OpenAPI types generation | Manual | `npm run gen:api` + `prebuild` hook | Automatizado |
| JWT en localStorage | Sí | No (en memoria) | No |
| SHA-256 password hash en localStorage | Sí | No (PBKDF2 PIN) | No |
| Argon2id params | m=64MB, t=3 | m=128MB, t=4 | m=128MB+, t=4+ |
| Anti-enumeración login | No | Sí (DummyVerify) | Sí |
| Refresh rotacional con familia | No | Sí (revoca familia en reuso) | Sí |
| Lockout montado | No | Sí (5 fails, 15 min) | Sí |
| MFA backend-enforced | No | Sí (≥100K CRC) | Sí |
| Password reset | No | Sí (token 1-uso 15 min) | Sí |
| Proof-of-reserves público | No | Sí (`/transparency/por`) | — |

---

**Fin del anexo F.**
