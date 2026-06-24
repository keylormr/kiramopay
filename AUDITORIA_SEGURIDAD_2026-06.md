# Auditoría de seguridad — Junio 2026 (dominios nuevos)

**Fecha:** 2026-06-24
**Alcance:** revisión de los dominios incorporados **después** de `AUDITORIA_2026-06.md`
(escrow, B2B keys/webhooks, payouts/PayoutRail, asistente LLM, MFA TOTP, SINPE por
API) más temas transversales (gestión de secretos, IDOR/authz, SSRF, semántica de
la ventana MFA). Método: lectura directa del código + verificación cruzada de cada
hallazgo. Los P0 del núcleo (cripto, límite SINPE atómico, revocación de sesión,
PAN/CVV, RBAC admin) ya estaban cerrados (`CORRECCIONES_P0_2026-06.md`) y no se
re-listan.

> **Verificación (todo verde, local):** Frontend — typecheck + lint + 360 tests +
> build. Backend — se instaló Go 1.25.11 portable y un PostgreSQL 16.8 portable
> (sin Docker Desktop, que está roto en esta máquina): `go build` + `go vet` +
> `gosec` (0) + `golangci-lint` v2 (0) + **`go test ./... -p 1` con todos los
> paquetes en verde contra Postgres real**. Se añadió un test de integración del
> gate de dinero (`HasVerifiedMFA` single-use).

---

## 1. Hallazgos y estado

Severidad: **P0** = pérdida/robo de dinero, bypass de auth/MFA o toma de cuenta ·
**P1** = grave (fuga de secretos/PII, authz faltante de alcance acotado, SSRF
interno, DoS persistente) · **P2** = hardening.

| # | Hallazgo | Sev | Estado |
|---|----------|-----|--------|
| 1 | MockRail (riel mock) es el único riel en una ruta de dinero de prod: debita la wallet y no desembolsa | **P0** | ✅ Corregido |
| 2 | Cuenta admin sembrada con contraseña hardcodeada (`SEED_DEMO` en prod) → toma de control | **P0** | ✅ Corregido |
| 3 | Ventana MFA de alto monto no se consume ni liga a monto/destinatario (1 verify → N acciones en 5 min) | P1 | ✅ Corregido |
| 4 | Escrow release/refund no tenían step-up MFA (solo Fund) | P1 | ✅ Corregido |
| 5 | SSRF ciego en registro de webhooks (sin filtro de rangos privados; seguía redirects) | P1 | ✅ Corregido |
| 6 | Límite de gasto diario de wallet inerte (`daily_spent` sin writer tras migración 020) | P1 | ✅ Corregido |
| 7 | Racimo IDOR: leer/mutar recursos ajenos por `{id}` (tx, cross-border, split, ride, food, staking, alerta) | P1/P2 | ✅ Corregido |
| 8 | Mock rail: el prefijo del destino (controlado por el usuario) decide el resultado | P1 | ✅ Mitigado vía #1 (mock fuera de prod) |
| 9 | Reúso de `JWT_SECRET` como clave AES idéntica para TOTP y webhooks | P2 | ✅ Corregido (separación de dominio) |
| 10 | Webhook HMAC sin timestamp → replay de entregas | P2 | ✅ Corregido |
| 11 | `/metrics` público (fuga de internals: drift, volúmenes, rutas) | P2 | ✅ Corregido (token opcional) |
| 12 | Defaults inseguros de config no rechazados en prod (DB pwd default, CORS `*`) | P2 | ✅ Corregido |
| 13 | Inyección de prompt almacenada en el asistente (texto de cuenta → tool result) | P2 | ✅ Mitigado (data-fence) |
| 14 | Auth de WebSocket "confiaba" cualquier token (y logueaba parte de él) | P2 | ✅ Corregido |
| 15 | Biometría web guardaba usuario+password en plano en `localStorage` | P2 | ✅ Corregido |
| 16 | Payout regeneraba la idempotency-key en cada reintento de MFA | P2 | ✅ Corregido |
| 17 | API keys B2B nunca expiran (`ResolveKey` solo mira `status='active'`) | P2 | ⏳ Diferido |
| 18 | Rate-limiter y lockout fallan-abierto si Redis cae | P2 | ⏳ Diferido |
| 19 | TOTP/recovery sin lockout dedicado de fuerza bruta | P2 | ⏳ Diferido |
| 20 | Compensación de escrow puede dejar fondos atrapados en estado terminal | P2 | ⏳ Diferido |

**Refutados (verificados y descartados):** "redirects del webhook como bypass del
allowlist" (no había allowlist; el SSRF real es directo, ya cubierto en #5) y "TOTP
acepta `purpose` arbitrario del cliente" (el `purpose` del gate es fijo en el
servidor; subsumido por #3).

---

## 2. Correcciones aplicadas

**#1 MockRail fuera de producción** — `cmd/api/main.go`: el `MockRail` solo se
registra si `ENVIRONMENT != production`. En prod el registro queda vacío y las
rutas de payout rechazan toda petición (la validación exige un riel registrado)
hasta cablear un riel real. Cierra también #8.

**#2 Seeder sin credenciales hardcodeadas en prod** — `internal/database/seeder.go`:
las contraseñas demo solo se usan en `development`. Con `SEED_DEMO=true` en otro
entorno, cada usuario se siembra **solo** si su contraseña viene de
`SEED_PASSWORD_<CEDULA>` (sin fallback); si no, se omite. Documentado en
`.env.example`.

**#3 MFA de un solo uso** — `internal/mfa/mfa.go` + migración `033`: `HasVerifiedMFA`
ahora **consume atómicamente** (UPDATE … `consumed_at` … `FOR UPDATE SKIP LOCKED`
… RETURNING) una verificación in-window por movimiento. Una verificación TOTP
autoriza exactamente UNA acción de alto monto (transfer/escrow/payout), no una
serie ilimitada. El short-circuit de idempotencia previo al gate (en transacciones)
evita re-consumir en reintentos.

**#4 Step-up MFA en escrow Release/Refund** — `internal/escrow/service.go`: ambas
patas de pago ahora gatean igual que Fund (nil-guard intacto). Resolve queda
admin-only (RBAC); pendiente de gate dedicado.

**#5 Guard SSRF de webhooks** — `internal/b2b/ssrfguard.go` (nuevo): valida la URL
en el registro (`CreateEndpoint`) **y** en el dial (`net.Dialer.Control`,
anti DNS-rebinding) contra loopback/privados/link-local/metadata/CGNAT; el cliente
del dispatcher **no sigue redirects**. Seam de test (`B2B_ALLOW_PRIVATE_WEBHOOK_TARGETS`,
default OFF) para `httptest`. Tests unitarios nuevos del guard.

**#6 Límite diario de wallet** — `internal/transaction/{service,repository}.go`:
nuevo `DailyOutgoingMinor` computa el gasto saliente del día desde `transactions`
(el cap dejó de funcionar al perder el writer de `daily_spent`); el check usa el
valor computado.

**#7 IDOR** — chequeo de propiedad en `transaction`, `country`, `splitpay`,
`marketplace` (ride+food, lectura y cambio de estado) y `crypto` (staking y alerta
scope por `user_id` en el repo). Cada handler deriva el usuario del contexto y
verifica pertenencia antes de leer/mutar.

**#9 Separación de claves** — `cmd/api/main.go`: el material de clave de TOTP y de
webhooks lleva prefijo de dominio distinto → claves AES distintas entre sí y del
secreto de firma JWT. (La rotación independiente con vars dedicadas queda como
follow-up.)

**#10 HMAC con timestamp** — `internal/b2b/{model,dispatcher}.go`: nuevo
`SignWithTimestamp` firma `"<unix>.<body>"` + header `X-Kiramopay-Timestamp`;
guía de integración actualizada (rechazar fuera de tolerancia + comparación en
tiempo constante).

**#11 `/metrics`** — `cmd/api/main.go`: gateable por `METRICS_TOKEN` (si vacío,
queda abierto para Prometheus).

**#12 Config** — `internal/config/config.go`: `ValidateForProduction` rechaza el
password DB por defecto y `CORS_ORIGINS='*'`.

**#13 Asistente** — `internal/assistant/claude.go`: los resultados de tools se
envuelven en un "data-fence" que instruye al modelo a tratarlos como datos, no
instrucciones. La barrera real sigue siendo la confirmación determinista + MFA del
cliente.

**#14 WebSocket** — `internal/websocket/client.go`: `/ws/prices` es un feed público;
el token ya no se confía, valida ni loguea (no otorga identidad).

**#15 Biometría web** — `src/services/biometric.ts`: el fallback web ya no persiste
credenciales; degrada a pedir contraseña y limpia credenciales legadas.

**#16 Payout idempotency-key** — `src/views/payout/PayoutView.tsx`: la key se genera
una vez y se reusa en el reintento de MFA (mismo payout).

---

## 3. Pendientes (diferidos, con razón)

- **#17 Expiración de API keys** — requiere columna `expires_at` (migración) +
  cambio en `ResolveKey`. Mitigación actual: solo hash en DB, secreto una vez,
  revocación manual.
- **#18 Rate-limit/lockout fail-open** — decisión de diseño: conviene un fallback
  in-process (fail-degraded) en rutas sensibles; solo se manifiesta con Redis caído.
- **#19 Lockout de TOTP/recovery** — añadir contador de fallos + límite dedicado
  (espejar el patrón del OTP). Mitigado parcialmente por replay-protection
  (`last_used_step`) y entropía de recovery (~40 bits, no fuerza-bruteable).
- **#20 Compensación de escrow** — añadir estado "reconciling" o un poller que
  re-drene postings ausentes (espejar el poller de payouts). Requiere doble fallo
  raro (Post + revert) que un atacante no dispara a demanda.

Estos cuatro tocan migraciones/diseño y se difirieron por no poder compilar/probar
el backend en este entorno; recomendado abordarlos con la suite de integración
disponible.

---

## 4. Verificación

- **Frontend:** `npm run typecheck` ✅ · `eslint` ✅ · `vitest run` **360/360** ✅
  · `npm run build` ✅.
- **Backend (local, Postgres real):** `go build` ✅ · `go vet` ✅ · `gosec` ✅ (0) ·
  `golangci-lint` v2 ✅ (0) · `go test ./... -p 1` ✅ (todos los paquetes). Migración
  nueva `033_mfa_single_use.sql` (aditiva) + `consumed_at` en `testutil`. Tests
  actualizados/añadidos: firma de webhook con timestamp; `RemovePriceAlert` con
  `userID`; seam SSRF en integración B2B; **nuevo** test de single-use del gate MFA.
- **Deploy:** las migraciones pendientes ahora incluyen la **033** (junto a
  028–032). Activación de seeding en prod requiere `SEED_PASSWORD_<CEDULA>`.

### Hallazgo colateral (preexistente, fuera de alcance)

Al correr la integración contra Postgres en zona horaria local (UTC-6) afloró que
`webhook_deliveries.next_attempt_at` es `TIMESTAMP` (sin zona) en vez de
`TIMESTAMPTZ`: con el servidor DB fuera de UTC, el backoff de reintento de
webhooks se calcula mal (6h de desfase). **No es de seguridad ni regresión** —
reproduce en el código original y no se manifiesta con la DB en UTC (CI/Render).
Recomendado migrar esa columna (y revisar otras `TIMESTAMP`) a `TIMESTAMPTZ`.
