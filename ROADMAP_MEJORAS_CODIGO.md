# Roadmap de mejoras de código — KiramoPay

Plan accionable para arrancar, en sesiones siguientes, cada mejora de código
que quedó identificada. Cada ítem está dimensionado para iniciarse en frío:
objetivo, estado actual, alcance, archivos clave, enfoque, pruebas, bloqueos y
esfuerzo. Complementa la visión de `ESTRATEGIA_PRODUCTO_MARCA.md` (el *por qué*
de negocio) y `ROADMAP_JPC.md` (la ruta regulatoria, que NO es código).

## Convenciones por sesión (recordatorio)

- Rama nueva desde `origin/main`, **sin prefijo `claude/`**; nombre descriptivo.
- Ciclo por fase: implementar → `go build/vet/test` + `golangci-lint` (backend,
  `GOTOOLCHAIN=go1.25.11`) y/o `npm run typecheck/lint/test:run/build`
  (frontend) → si verde, **commit sin atribución** → PR → CI → merge.
- Backend lint corre con golangci-lint **v2** (`backend/.golangci.yml`).
- **Sin `Co-Authored-By` ni footers de IA** en commits/PRs.

## Prioridad recomendada

| # | Mejora | Esfuerzo | Bloqueos | Valor |
|---|---|---|---|---|
| 1 | ~~Frontend de escrow + API keys (Fase C)~~ ✅ HECHO | M | deploy de migr. para prod | Alto (cierra el bloque B2B end-to-end) |
| 2 | ~~`PayoutRail` + adapter mock~~ ✅ HECHO | S–M | ninguno (mock) | Medio (deja lista la interoperabilidad) |
| 3 | ~~Chatbot Gemini — Fases 3a + 3b~~ ✅ HECHO | L | activar `GEMINI_API_KEY` | Alto (diferenciador de marca) |
| 4 | ~~Dashboards Grafana + alerting + SLOs (Fase D)~~ ✅ HECHO (código) | M | infra (Prometheus/Grafana/AM) para datos reales | Medio (operación) |

> Empezar por **#1** (producto visible, ya hay backend), intercalar **#2** (rápido
> y desbloquea narrativa de remesas), luego **#3** (el grande), y **#4** cuando
> haya infra de observabilidad levantada.

---

## 1. Frontend de escrow + gestión de API keys (Fase C) ✅ HECHO

> **Implementado.** Repos+adapters HTTP-only para `escrow` y `b2b` (espejan
> `mfa`), registrados en el `ApiLayer` (http y mock enrutan al backend real).
> `src/views/escrow/EscrowView.tsx` (overlay desde Perfil): lista, crear, y
> acciones según rol/estado (fund/release/refund/dispute/cancel). `ApiKeysSheet`
> + `WebhooksSheet` (Perfil › Herramientas de comercio): crear/listar/revocar
> keys y registrar/listar/borrar webhooks, mostrando el secreto **una sola vez**
> con copy (como los recovery codes de TOTP) + entregas recientes. i18n: 72
> claves nuevas ×5 idiomas. Tests de adapter (espejan `mfa.http.test.ts`).
> typecheck/lint/test(341)/build **verdes**. Para verlo en prod: deploy de
> migraciones 028–032; en local funciona con `VITE_API_URL` al backend.

**Objetivo.** Dar UI a las dos features B2B que ya existen en backend (escrow,
API keys + webhooks), de modo que un usuario/comercio las use sin curl.

**Estado actual.** Backend completo (PRs #12, #13, #15). Frontend: solo existe
`src/api/repositories/mfa.repository.ts` como precedente HTTP-only. **No hay
repos/adapters/vistas de escrow ni de B2B.** El trabajo de TOTP
(`TwoFactorSheet.tsx`, `mfa.http.ts`, wiring en `ApiLayer`) es **la plantilla
exacta a espejar**.

**Alcance.**
- Repos + adapters HTTP para `escrow` y `b2b` (keys/webhooks). Patrón
  repository, registrados en `src/api/index.ts` (`ApiLayer`) y en
  `adapters/http/index.ts` + `adapters/mock/index.ts`.
- Vistas:
  - Escrow: lista de acuerdos, detalle con acciones según rol/estado
    (fund/release/refund/dispute/cancel), crear acuerdo. Reusar `BottomSheet`.
  - Seguridad/Comercio: crear/listar/revocar API keys (mostrar `full` una sola
    vez con copy-to-clipboard, como los recovery codes de TOTP); registrar/
    listar/borrar webhooks; ver deliveries.
- i18n en los 5 idiomas (`src/i18n/translations.ts`).
- Entradas de navegación (en ProfileView para keys/webhooks; vista propia o tab
  para escrow).

**Archivos clave.**
- `src/api/repositories/{escrow,b2b}.repository.ts` (nuevos)
- `src/api/adapters/http/{escrow,b2b}.http.ts` (nuevos)
- `src/api/index.ts`, `src/api/adapters/{http,mock}/index.ts` (wiring)
- `src/views/...` (vistas nuevas; espejar `src/views/profile/TwoFactorSheet.tsx`)
- `src/i18n/translations.ts`
- Backend de referencia: `backend/internal/{escrow,b2b}/handler.go`,
  `backend/docs/openapi.yaml`

**Enfoque.** 1) Generar tipos desde openapi (`npm run gen:api`) y/o tipar a
mano. 2) Repos + adapters (HTTP-only, sin mock para keys por seguridad, igual
que auth/mfa). 3) Vistas + estado (Zustand store si hace falta). 4) i18n. 5)
Tests de adapter (espejar `mfa.http.test.ts`).

**Pruebas / aceptación.** `npm run typecheck/lint/test:run/build` verde; flujo
manual escrow create→fund→release visible en historial (ya emite filas de
`transactions`); key creada se muestra una vez; webhook registrado aparece en
lista.

**Bloqueos.** Para verlo en prod hace falta **deploy de migraciones 028–031**
(`RUN_MIGRATIONS=true` en Render una vez). En local con `VITE_API_URL` apuntando
al backend, funciona sin deploy.

**Esfuerzo.** M (1 sesión por feature; escrow y B2B pueden ir en PRs separados).

---

## 2. `PayoutRail` — interfaz de rieles de pago + adapter mock ✅ HECHO

> **Implementado** (dominio `backend/internal/payout`). Quedó: interfaz `Rail`
> (`Send`/`Status`/`Name`) + `Registry` + `MockRail` determinista; payouts
> ledger-backed (débito user / crédito `SYSTEM:EXTERNAL:<RAIL>:<CUR>`) con el
> patrón claim→post→compensación de escrow; idempotencia por
> `(user, idempotency_key)` y claves de ledger `payout:{debit,refund}:<id>`;
> manejo **seguro ante doble-pago** (error de transporte ambiguo NO reembolsa,
> lo resuelve el poller; rechazo definitivo sí reembolsa, reclamando `failed`
> antes de postear); gates MFA ≥100K + reporte UIF + audit por transición +
> eventos `payout.*` a webhooks + historial en `transactions`. Endpoints
> `/api/v1/payouts*` (+ `GET /payouts/rails`) y B2B `/api/b2b/v1/payouts` con
> scopes nuevos `payout:read|write`. Poller de liquidación en background
> (reconcilia/auto-sana procesando). Migración **032** (cuentas MOCK + tabla
> `payouts`). Tests unit + integración + openapi documentado. Sumar un riel real
> = registrar el adapter + sembrar sus cuentas `SYSTEM:EXTERNAL:<RAIL>:<CUR>`.

**Objetivo.** Dejar lista la **interoperabilidad de transferencias** (ver
`ESTRATEGIA_PRODUCTO_MARCA.md` §2): una abstracción de "riel de pago" para que
sumar SINPE/dLocal/Circle/USDC sea agregar un adapter, sin tocar el resto.

**Estado actual.** Existen el dominio `country` (cross-border CR/PA/GT) y el
`ledger`, pero no hay una interfaz de salida unificada. SINPE externo hoy
contabiliza contra `SYSTEM:EXTERNAL:CRC`.

**Alcance.**
- Paquete `backend/internal/payout` con:
  - `type Rail interface { Send(ctx, PayoutRequest) (PayoutResult, error); Status(ctx, id) (Status, error); Name() string }`.
  - `PayoutRequest` (monto minor, moneda, destino tipado por riel, idempotency
    key), `PayoutResult` (id externo, estado).
  - `MockRail` (determinista, para tests y dev) + un `registry` por nombre.
- Contabilidad por ledger: débito wallet del usuario / crédito cuenta de sistema
  del riel (`SYSTEM:EXTERNAL:<RAIL>:<CUR>`), con idempotency.
- Endpoint `POST /api/v1/payouts` (y/o exponer en el API B2B con scope nuevo
  `payout:write`).

**Archivos clave.** `backend/internal/payout/*` (nuevo); referencia de patrón:
`internal/sinpe/service.go`, `internal/escrow/service.go` (claim+post+
compensación, idempotency), `internal/ledger/ledger.go` (cuentas de sistema).
Migración nueva para las cuentas `SYSTEM:EXTERNAL:<RAIL>` y, si se gatea por
scope, ampliar `b2b` scopes.

**Pruebas / aceptación.** Unit del registry/mock; integration: payout vía
`MockRail` debita la wallet y acredita la cuenta de sistema, idempotente; saldos
verificados contra el journal.

**Bloqueos.** Ninguno para el mock. Los adapters reales (dLocal, Circle, SINPE
participante) requieren **contratos/licencias** — fuera de código.

**Esfuerzo.** S–M (1 sesión para interfaz + mock + ledger + tests).

---

## 3. Chatbot conversacional (Gemini) — Fases 3a + 3b ✅ HECHO

> **Fase 3b implementada** (acciones con confirmación). Tools `propose_sinpe_transfer`
> / `propose_bill_payment` / `propose_recharge` (+ `list_saved_services` read-only):
> el LLM **prepara** una intención validada y la devuelve como *proposal*; **nunca
> ejecuta ni confirma**. `Tools.Invoke` devuelve un `*Proposal` opcional que el
> orquestador acumula en `ChatResponse.Proposals` sin tocar ningún servicio de
> dinero. El frontend (`AssistantView`) muestra una **tarjeta de confirmación** por
> propuesta; al confirmar, llama al endpoint real existente (`sinpe.send` /
> `services.payBill` / `services.recharge`) con todos sus gates (MFA/límites/
> fraude). System prompt reforzado (no ejecuta, no auto-confirma, no adivina
> montos/destinatarios; rehúsa inyección). Verde: backend tests (incl. "el dinero
> nunca se mueve") + gosec 0; frontend 347 tests.

> **Fase 3a implementada** (read-only). Backend `internal/assistant`: interfaz
> `LLM` neutral + cliente Gemini `generateContent` con function-calling, **gated
> por `GEMINI_API_KEY`** (interfaz nil real si falta → el servicio se reporta no
> disponible, como telemetría). **Tools SOLO lectura** (balance, transacciones,
> resumen de gasto, presupuestos) → sin tools de escritura, la inyección no puede
> mover dinero. Loop de tool-calling acotado + system prompt anti-inyección que
> rehúsa asesoría/mover dinero + audit + límites de tamaño/historial. Endpoints
> `GET /assistant/status` + `POST /assistant/chat`; config `GEMINI_API_KEY` +
> `GEMINI_MODEL`. Frontend: repo/adapter HTTP-only + `AssistantView` (chat overlay
> desde tarjeta en Home, input gated por status) + i18n (10 claves ×5) + tests.
> Verde: backend build/vet/lint/10 unit (fake LLM); frontend typecheck/lint/build/
> 345 tests. **Pendiente Fase 3b**: tools de escritura que devuelven una
> *intención* que el usuario confirma de forma determinista (pasando MFA/límites/
> fraude); el LLM nunca autoriza. **Activación**: setear `GEMINI_API_KEY` en el
> backend (sin la var el asistente queda no disponible, sin romper nada).

**Objetivo.** Asistente que vende servicios basado en el usuario (ver
`ESTRATEGIA_PRODUCTO_MARCA.md` §1): comercio conversacional + cross-sell
contextual sobre el historial.

**Estado actual.** Solo `GEMINI_API_KEY` cableado en `vite.config.ts`. No hay
código de chatbot. Existen todos los dominios que el bot operaría
(transaction, sinpe, payment, crypto, qrpayment, splitpay, budget, recurring,
loyalty).

**Decisión de arquitectura (recomendada).** **Proxy por backend**, NO llamar a
Gemini desde el cliente: (a) no exponer la API key, (b) aplicar los gates de
dinero del lado servidor. El LLM hace *tool-calling* sobre funciones acotadas
que mapean a los servicios existentes; **toda función que mueve dinero devuelve
una propuesta que el usuario confirma de forma determinista** y pasa por
MFA(≥100K)/fraude/límites ya existentes. El LLM nunca autoriza.

**Alcance (MVP recomendado, iterativo).**
- Fase 3a (read-only, bajo riesgo): `internal/assistant` con un endpoint
  `POST /api/v1/assistant/chat` que responde consultas ("¿cuánto gasté en
  comida?", "¿cuál es mi saldo?", "explicá este cobro") usando tools de solo
  lectura sobre transaction/budget/audit. Sin mover dinero.
- Fase 3b (acciones con confirmación): tools de escritura que **devuelven una
  intención** (no ejecutan); el frontend muestra una tarjeta de confirmación;
  al confirmar, se llama al endpoint real existente (con sus gates).
- Frontend: vista de chat + repo `assistant` HTTP-only.

**Archivos clave.** `backend/internal/assistant/*` (nuevo: cliente Gemini, tool
definitions, orquestación); cablear en `main.go`. Frontend: repo/adapter +
vista de chat + i18n. Config: `GEMINI_API_KEY` al backend
(`internal/config/config.go`).

**Pruebas / aceptación.** Unit de la capa de tools (intención → operación
correcta, montos, moneda); que ninguna tool de escritura ejecute sin
confirmación; e2e read-only con respuestas deterministas mockeando Gemini.

**Bloqueos / riesgos.** Cumplimiento (no "asesoría financiera"); costo de
tokens; prompt-injection (sanitizar, límites de scope de tools). Decidir alcance
3a vs 3a+3b antes de arrancar.

**Esfuerzo.** L (3a en 1 sesión; 3b otra; frontend otra).

---

## 4. Dashboards Grafana + alerting + SLOs (Fase D) ✅ HECHO (código versionado)

> **Implementado el código versionable.** `SLO.md` (SLIs/SLOs/error budgets +
> política de alertas + burn-rate). `k8s/monitoring/alert-rules.yaml` (ConfigMap
> `prometheus-rules`: 7 alertas en 3 grupos — disponibilidad con burn-rate
> multi-ventana, latencia, saturación; reglas de negocio drift/webhooks
> comentadas hasta exponerlas como métrica) + `rule_files` cableado en
> `prometheus-config.yaml`. Dashboard `dashboard-red-slo.yaml` (ConfigMap, 8
> paneles RED **computados**: disponibilidad vs SLO 99.5%, rate, error %, latencia
> avg, saturación). `deploy-monitoring.sh` aplica ambos. Todo validado (YAML/JSON
> parseables; reglas y dashboard bien formados). Construido sobre las métricas
> **fiables** del `/metrics` manual (`kiramopay_*`) → funciona scrapeando el
> endpoint, **sin colector**. **Pendiente (infra/ops, no código)**: levantar
> Prometheus/Grafana/Alertmanager (o Grafana Cloud), montar los ConfigMaps
> (`prometheus-rules` en `/etc/prometheus/rules`, dashboards en
> `/var/lib/grafana/dashboards`), `promtool check rules`, y exportar drift/webhooks
> como métricas para activar esas alertas. Percentiles p95/p99 por ruta requieren
> el colector OTLP (`http.server.*`).

**Objetivo.** Cerrar la pata de **operación** de observabilidad: visualizar las
métricas RED ya exportadas, alertar sobre síntomas y declarar SLOs.

**Estado actual.** Tracing + métricas OTel ya emitidas (PRs #8, #9, #11):
histogramas `http.server.*` dimensionados por ruta (RED) + runtime de Go.
Endpoint `/metrics` Prometheus manual. `k8s/monitoring/` tiene base de
Prometheus + Grafana (`grafana-config.yaml`, `prometheus-config.yaml`) pero
**sin dashboards ni reglas de alerta versionados**.

**Alcance.**
- Dashboard Grafana (JSON versionado) con: rate/errors/duration por ruta
  (p50/p95/p99), error-rate 5xx, throughput, saturación (goroutines, heap, GC),
  y panel de negocio (drift de reconcile, entregas de webhook).
- Reglas de alerta (PrometheusRule o Grafana alerting): error-rate alto,
  latencia p99 sobre umbral, drift de reconcile > 0, fallos de webhook
  acumulados, target caído.
- `SLO.md`: definir SLIs/SLOs (p.ej. disponibilidad 99.5%, p99 < 500ms en
  endpoints de dinero) y error budgets.

**Archivos clave.** `k8s/monitoring/` (dashboard JSON + PrometheusRule nuevos),
`k8s/monitoring/deploy-monitoring.sh` (cablear), `SLO.md` (nuevo). Métricas de
referencia: las de `internal/observability` + el `/metrics` manual.

**Pruebas / aceptación.** Validar que el dashboard JSON importa sin error y los
queries matchean nombres de métricas reales; reglas con `promtool check rules`.
La validación end-to-end real requiere datos → necesita colector/infra.

**Bloqueos.** Para datos reales hace falta **levantar un colector OTLP +
Prometheus/Tempo/Grafana** (o Grafana Cloud free) — infra/ops, no código. El
código (dashboards + reglas + SLO) se puede versionar igual.

**Esfuerzo.** M.

---

# Segunda tanda

Mejoras de código posteriores a los 4 ítems de arriba. Estado actual:

| # | Mejora | Esfuerzo | Estado |
|---|---|---|---|
| 5 | Frontend de Payouts | M | ✅ HECHO |
| 6 | Logging del error del LLM en el asistente | S | ✅ HECHO |
| 7 | Métricas de negocio (drift + webhooks) + reglas | S–M | ✅ HECHO |
| 8 | Tests E2E (escrow/payouts/asistente) | M | ✅ HECHO |
| 9 | Adapter real de `PayoutRail` | M | ⛔ BLOQUEADO (contrato/credenciales de partner) |

## 5. Frontend de Payouts ✅ HECHO

UI de usuario para el backend `PayoutRail` (no existía). Espeja el patrón de
escrow: repo + adapter **HTTP-only** (`payout.repository.ts` / `payout.http.ts`,
mueven dinero → sin mock), cableado en el `ApiLayer` (http + mock). `PayoutView`
(overlay desde **Perfil › Herramientas de comercio**): lista, crea sobre un riel
elegido de `GET /payouts/rails`, y refresca un payout `processing` contra el
riel; idempotency key generada en el cliente. i18n 24 claves ×5. Tests de
adapter (espejan `escrow.http.test.ts`). MFA ≥100K se resuelve con el challenge
inline (ver «Mejoras de seguimiento › C»). typecheck/lint(0)/build verdes.

## 6. Logging del error del LLM ✅ HECHO

`assistant.Service` se tragaba la causa del fallo del proveedor (el handler
mapea a un 502 opaco). Se inyecta un `*slog.Logger` y se loguea la causa con
`WarnContext` en los 2 sitios de `llm.Generate`. El 502 al cliente no cambia.
Test que verifica que la causa se loguea.

## 7. Métricas de negocio + reglas ✅ HECHO

Se exponen en `/metrics`: `kiramopay_ledger_drift_crc` (gauge; el worker
`reconcile` publica el drift residual tras auto-fix) y
`kiramopay_webhook_deliveries_failed` (counter; el dispatcher de webhooks lo
incrementa por intento fallido). Se habilitan las reglas `LedgerDrift` y
`WebhookDeliveryBacklog` (grupo `kiramopay-business` en
`k8s/monitoring/alert-rules.yaml`; el backlog usa `increase(...[15m]) > 50` para
ser auto-clearing). `SLO.md` actualizado.

## 8. Tests E2E ✅ HECHO

Specs Playwright para escrow, payouts y asistente (`e2e/{escrow,payout,assistant}.spec.ts`),
espejando `stubBackend` (red stubeada en el browser, sin backend). 19 E2E verdes
(14 previos + 5 nuevos).

## 9. Adapter real de `PayoutRail` ⛔ BLOQUEADO

Implementar un `Rail` real (SINPE participante / dLocal / Circle) + sembrar sus
cuentas `SYSTEM:EXTERNAL:<RAIL>:<CUR>` en una migración. **Bloqueado**: requiere
contrato/credenciales del partner, no es solo código.

---

# Mejoras de seguimiento ✅ HECHO

Set posterior a la segunda tanda (mismo PR), todo verificado en verde.

## A. Paneles de dashboard de negocio

`k8s/monitoring/dashboard-red-slo.yaml`: paneles para `kiramopay_ledger_drift_crc`
(stat, rojo ante cualquier drift residual) y `kiramopay_webhook_deliveries_failed`
(timeseries, `increase(...[15m])`). Cierra el loop del #7 (las métricas pasan de
solo-alertables a visibles).

## B. Proveedor Claude (Anthropic) para el asistente

`internal/assistant/claude.go`: cliente de la Messages API (`/v1/messages`, HTTP
crudo como `gemini.go`, vía el cliente HTTP con tracing) detrás de la interfaz
`LLM` neutral. Mapea la historia neutral a Anthropic (turno de tool-calls →
`assistant` con bloques `tool_use` de ids `toolu_N`; resultados → `user` con
`tool_result` casados **posicionalmente**); tools con `input_schema`; sin sampling
params (Opus 4.7+ los rechaza); refusal (200 + `stop_reason`) → texto neutral.
Config `AnthropicConfig` (`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`, default
`claude-opus-4-8`). `main.go`: **precedencia Claude > Gemini**; sin ninguna key el
asistente queda no disponible. `.env.example` documenta ambos proveedores. 5 tests.

## C. MFA inline para acciones de dinero de alto monto

Antes, una acción de alto monto (≥100K CRC) que el backend gateaba con
`MFA_REQUIRED` **moría en el error** — no había forma de completarla desde la UI.
Ahora:

- `src/components/MfaChallengeSheet.tsx` (compartido): pide el código TOTP y llama
  a `mfa.totpVerify(code, 'high_value_tx')`; al verificar, el caller **reintenta**
  la acción original (que ahora pasa el gate del backend).
- Los adapters HTTP que aplanaban el código de error (`escrow`, `payout`, `sinpe`,
  `services` payBill/recharge) ahora **preservan** `MFA_REQUIRED`; se exporta la
  constante `MFA_REQUIRED` desde `@/api`.
- Cableado en `EscrowView` (fund), `PayoutView` (create), `AssistantView`
  (`confirmProposal` → SINPE / recarga / pago de servicios de las propuestas
  confirmadas) y **`SinpeView`** (envío directo).

> **Nota sobre SINPE**: antes `SinpeView.handleSendMoney` NO llamaba al backend
> (simulación local con `setTimeout` + reducer). Ahora invoca
> `getApiLayer().sinpe.send(...)`: el adapter **mock** lo registra localmente y el
> adapter **HTTP** mueve dinero en el backend (y puede pedir MFA). En MFA_REQUIRED
> abre el challenge y reintenta; mantiene la UX de éxito (dispatch local +
> success sheet). El saldo global sigue refrescándose por el sync existente
> (igual que escrow/payout).

## D. Tests de componente

`PayoutView`, `EscrowView` y `AssistantView`: tests de React (render + interacción
+ flujo MFA completo: acción → `MFA_REQUIRED` → challenge → verify → reintento).
Antes solo había tests de adapter. Frontend total **358** tests.

---

## Notas de estado (para arrancar en frío)

- **Deploy pendiente** (manual, una vez): migraciones **028 (TOTP), 029
  (escrow), 030 (B2B), 031 (scopes/secret TEXT), 032 (payouts)** →
  `RUN_MIGRATIONS=true` en Render y quitar. Afecta a la Fase C (verla en prod) y
  a cualquier prueba en prod de escrow/B2B/payouts.
- **DR pendiente de activación** (manual, sin costo): bucket + 6 secrets +
  `BACKUPS_ENABLED=true` (ver `DR_RUNBOOK.md`).
- **Entorno backend local**: Go portable 1.23.4 con `GOTOOLCHAIN=go1.25.11`;
  golangci-lint v2 en `$HOME/go/bin`; tests de integración necesitan
  Postgres+Redis (`make docker-up`, correr con `-p 1`).
