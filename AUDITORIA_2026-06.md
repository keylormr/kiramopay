# Auditoría KiramoPay — Junio 2026

**Fecha:** 2026-06-05
**Versión auditada:** post Fase 20 + rediseño UI "Unified Vision" (commit `61e0724`)
**Método:** lectura directa del código fuente (no solo documentación). Cada hallazgo crítico fue verificado abriendo el archivo citado.
**Auditoría previa de referencia:** `AUDITORIA_INTEGRAL_2026-05-20.md`

---

## 1. Resumen ejecutivo

KiramoPay evolucionó de forma significativa desde la auditoría de mayo. **El núcleo de pagos fiat (transaction + sinpe + payment) y la capa de autenticación pasaron de "maqueta con bugs que pierden dinero" a "diseño técnicamente serio".** Sin embargo, persisten **bloqueantes críticos**: el dominio crypto regala dinero, la mayoría de dominios siguen sin pasar por el ledger, y hay errores ignorados en operaciones de seguridad.

### Veredicto global

**Apto para demo / MVP no-custodial. NO apto para custodiar dinero real** sin cerrar los P0. El sistema tiene fundamentos de nivel internacional en su núcleo, pero la cobertura es desigual: dominios de primera (transaction, auth) conviven con dominios peligrosos (crypto, cards).

### Top riesgos críticos (verificados)

| # | Riesgo | Impacto | Ubicación |
|---|--------|---------|-----------|
| 1 | **Crypto imprime dinero**: `Buy()` acredita el activo cripto pero nunca debita la wallet fiat | Pérdida directa: usuario obtiene BTC gratis | `crypto/service.go:28-59` |
| 2 | **Crypto usa floats para montos/fees** (`req.FromAmount * 0.005`) | Imprecisión monetaria, descuadre en custodia | `crypto/service.go:51,86` |
| 3 | **9 de ~16 dominios saltan el ledger** (crypto, splitpay, qr, cards, loyalty, marketplace, recurring, budget) | Saldos no derivables → auditoría imposible | múltiples |
| 4 | **Revocación de sesiones con error ignorado** en `ChangePassword`/`ResetPassword` | Sesión vieja sobrevive a cambio de password → account takeover | `auth/service.go:226-231, 357-362` |
| 5 | **Límite diario SINPE no atómico** (check y débito en queries separadas) | Dos transfers concurrentes superan el tope de 500K | `sinpe/service.go:72-79` |
| 6 | **PAN/CVV en texto plano** (si tarjetas siguen en scope) | Violación PCI-DSS directa | `cards/repository.go` |

---

## 2. Cambios desde la auditoría de mayo

### ✅ Arreglado (verificado)

| Hallazgo de mayo | Estado actual | Evidencia |
|---|---|---|
| JWT en localStorage → XSS roba sesión | **Tokens solo en memoria**; `partialize` los excluye; provider registrado a nivel módulo | `auth.store.ts:118-124`, `client.ts:3-11` |
| Idempotencia falsa (clave nunca persistida) | **UNIQUE en `journal_postings.idempotency_key`** + lookup antes de insertar | `ledger.go:136-147`, migración 018/020 |
| Sin atomicidad transaccional | **`pgx.Serializable` + retry exponencial** en el único write-path de dinero | `ledger.go:99-129` |
| SINPE no acreditaba al receptor | **Transferencia interna atómica** acredita al peer | `sinpe/service.go:116-127`, `transaction.CreateTransfer` |
| Refresh ≡ Access token | **Tipos separados, rotación con `jti` + denylist + detección de reúso** | `jwt.go`, `auth/service.go:239-273` |
| Lockout no montado | **Montado en `/auth/login`** + rate limit dedicado 10/min | `cmd/api/main.go` |
| Argon2id bajo (64MB/t3) | **Subido a m=128MiB, t=4, p=2** | `pkg/hash/argon2.go:24-30` |
| Sin ledger inmutable | **Journal append-only con trigger** que bloquea UPDATE/DELETE | migración 020 |
| Sin historia de tasas FX | **Tasas historizadas** | migración 021 |

### ❌ NO arreglado (verificado)

| Hallazgo de mayo | Estado actual | Evidencia |
|---|---|---|
| Crypto mueve activo sin debitar fiat | **Sigue igual** — `Buy/Sell/Convert` solo tocan `UpsertAsset` | `crypto/service.go:28-94` |
| 9 dominios saltan el ledger | **Sigue** — solo transaction/sinpe/payment/country lo usan | grep ledger usage |
| PAN/CVV en claro | Sin verificar tokenización PCI | `cards/repository.go` |
| Errores ignorados en operaciones de dinero/seguridad | **Persisten** en auth y sinpe | ver §3 |

---

## 3. Hallazgos por severidad

### 🔴 P0 — Bloqueantes (no mover dinero real sin esto)

**P0-1. Crypto regala dinero.**
`crypto/service.go:28-59` (`Buy`): tras validar `amount > 0`, llama únicamente a `s.repo.UpsertAsset(...)` (acredita el activo) y registra la transacción. **No hay débito de la wallet fiat, ni posting al ledger, ni tx serializable, ni idempotencia.** Lo mismo en `Sell` (61-94) y `Convert` (96+): mutan balances cripto sin contraparte fiat. Un usuario puede comprar BTC sin pagar colones.
*Fix:* enrutar todo movimiento cripto por `ledger.Post()` con doble asiento (debe fiat / haber cripto) dentro de la misma tx serializable.

**P0-2. Montos cripto en float.**
`crypto/service.go:51,86`: `Fee: req.FromAmount * 0.005`. Los montos cripto deben ser `NUMERIC(38,18)` y los cálculos en enteros/decimal exacto. Bitcoin a 8 decimales no es representable en `float64`.

**P0-3. Cobertura del ledger incompleta.**
Verificado por grep: solo `transaction`, `sinpe`, `payment` y `country` invocan el ledger / `CreateTransaction`. **crypto, splitpay, qrpayment, cards, loyalty, marketplace, recurring, budget** mutan estado de valor por fuera. Mientras eso siga, el ledger inmutable es decorativo y el proof-of-reserves no refleja la realidad.

**P0-4. Revocación de sesiones con error silenciado.**
`auth/service.go:226-231` (`ChangePassword`) y `357-362` (`ResetPassword`):
```go
_, _ = s.authRepo.db.Exec(ctx,
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE ...`, userID)
_, _ = s.authRepo.db.Exec(ctx,
    `UPDATE user_sessions SET revoked_at = NOW() WHERE ...`, userID)
```
Si estos UPDATE fallan, el password cambia pero **las sesiones/refresh-tokens viejos siguen vivos**, violando la promesa "force re-login from scratch". Ventana de account-takeover tras un reset.
*Fix:* envolver `UpdatePasswordHash` + ambas revocaciones en una sola tx; propagar el error (rollback si la revocación falla).

**P0-5. Límite diario SINPE no atómico.**
`sinpe/service.go:72-79`: el comentario dice "Atomic check + reservation" pero es un `GetDailySinpeSpent` (read) seguido de un check en memoria y luego un `CreateTransfer` separado. Dos envíos concurrentes de 300K pasan ambos contra el tope de 500K. **El comentario es engañoso.**
*Fix:* mover el cálculo del gastado-diario y el débito dentro del mismo posting serializable, o usar un `SELECT ... FOR UPDATE` sobre una fila de cuota diaria.

**P0-6. PAN/CVV en texto plano** (si tarjetas siguen en scope): delegar a emisor PCI Level-1 (Marqeta, Stripe Issuing, Pomelo) o sacar tarjetas del v1.

### 🟠 P1 — Importantes (antes de hablar con SUGEF / sponsor bank)

- **P1-1.** `Logout` revoca la familia de refresh best-effort: `auth/service.go:289-295` ignora el error de `QueryRow` y de `RevokeRefreshFamily`. Aceptable como defensa-en-profundidad (la revocación primaria del access-jti sí propaga error), pero conviene loguear el fallo.
- **P1-2.** SINPE `AddHistory` con error ignorado (`sinpe/service.go:149,164`): saldo movido pero historial perdido si falla. Y `service.go:167` tiene un placeholder `// real impl would use sender phone` — código incompleto en producción.
- **P1-3.** Sin validación de formato de teléfono CR en `sinpe.Send` antes de debitar (8 dígitos, prefijo 6/7/8). Un número mal tecleado cae en `SYSTEM:EXTERNAL` y depende de reconciliación.
- **P1-4.** KYC/AML inexistente: sin OCR de documentos, sin sanction screening (OFAC/UN), sin reportes UIF. Bloqueante regulatorio.
- **P1-5.** CI sin security scanning: ningún gosec, govulncheck, Trivy, gitleaks, npm audit, Dependabot, CodeQL.
- **P1-6.** Coverage instalado pero no medido ni con gate; sin tests de concurrencia de dinero (100 transfers paralelos, idempotencia simultánea, race del límite diario).
- **P1-7.** Persistencia inconsistente del estado de auth: `auth.store.ts` persiste `isAuthenticated: true` pero NO los tokens. Tras un refresh de página el usuario "parece logueado" pero todo request falla sin token → `dataSync` debe manejar 401 y forzar re-login.

### 🟡 P2 — Robustez y producto

- "Teatro" de features en web: biometría web simula éxito tras 500ms; Service Worker no implementado (cola offline sería código muerto); marketplace/loyalty/splitpay mayormente mock sin tests. Documentar qué es real vs demo.
- Reconcile detecta drift (`wallet_journal_drift`) pero no lo corrige automáticamente.
- `metadataToJSON` construye JSON a mano (`ledger.go:360-388`): usar `json.Marshal`.
- Observabilidad: falta OpenTelemetry tracing, logs centralizados (Loki/Datadog), Alertmanager, SLOs.
- Backups sin off-site cifrado ni restore probado.
- E2E Playwright frágiles (`if (await isVisible())` no fallan); faltan flujos de dinero.
- Secrets: confirmar que `k8s/base/secret.yaml` no tenga credenciales en claro; `GEMINI_API_KEY` no debe ir al bundle del cliente.
- Limpieza: log de debug `console.debug('[auth.store] token provider registered')` marcado "Remove once stable" (`auth.store.ts:144`).

---

## 4. Madurez vs estándar internacional

| Dimensión | KiramoPay (hoy) | Estándar internacional | Veredicto |
|---|---|---|---|
| Núcleo contable (fiat) | Ledger doble-entrada, serializable, idempotente | Stripe/Wise/Mercury: ledger inmutable doble-entrada | ✅ A la par en diseño |
| Cobertura del ledger | 4 de ~16 dominios | 100% del movimiento de valor | ❌ Desigual |
| Crypto | Sin debitar fiat, floats | Ledger + NUMERIC + partner VASP | ❌ Roto |
| Auth/seguridad | Argon2id 128MiB, refresh rotation, tokens en memoria, lockout | OWASP ASVS L2 | ✅ Por encima de muchas fintech LATAM |
| Compliance (KYC/AML) | Inexistente | Onfido/Persona + ComplyAdvantage obligatorio | ❌ Brecha mayor |
| PCI (tarjetas) | PAN/CVV en claro | Tokenización vía provider PCI-L1 | ❌ No conforme |
| Observabilidad | Prometheus + Grafana | + tracing + logs centralizados + SLOs | 🟡 Base buena |
| Testing de dinero | Unit/integración OK, sin concurrencia/carga | Property-based + chaos + k6 + Pact | 🟡 Inmaduro |
| Modelo de negocio | Ausente | FX spread, interchange, suscripción, float | ❌ Sin definir |
| Regulación | Sin licencia | EDE con sponsor bank / PISP | ⚠️ Decisión pendiente |

**Posicionamiento honesto:** la arquitectura del **núcleo fiat y de auth compite de verdad con fintech internacionales** (nivel Wise/Mercury *en diseño*). Las brechas frente al mercado global no son de arquitectura sino de **cobertura (crypto y 9 dominios fuera del ledger), compliance (KYC/AML/PCI), pruebas de robustez y licencia**.

---

## 5. Recomendaciones priorizadas

**P0 — antes de cualquier soft-launch con dinero:**
1. Enrutar crypto (`Buy/Sell/Convert/Stake`) por el ledger con doble asiento + débito fiat.
2. Migrar montos cripto a NUMERIC, eliminar floats.
3. Conectar los 9 dominios restantes al ledger (o congelarlos hasta hacerlo).
4. Arreglar revocación de sesiones en `ChangePassword`/`ResetPassword` (tx + propagar error).
5. Hacer atómico el límite diario SINPE.
6. Sacar PAN/CVV propios → emisor PCI (o quitar tarjetas del v1).

**P1 — antes de SUGEF/sponsor bank:**
7. KYC real + sanction screening + monitoreo AML.
8. Security scanning en CI con gate.
9. Tests de concurrencia/idempotencia de dinero + coverage con gate.
10. Validación de teléfono/cédula en services.
11. Manejo de 401 + auto-refresh en `dataSync`.
12. Definir modelo de monetización.
13. Decidir vía regulatoria (recomendado: **EDE con sponsor bank**, 4-8 meses, vs banco propio ~USD 27M y 18-24 meses ante SUGEF — no el BCCR).

**P2 — robustez/producto:** OpenTelemetry + alerting + SLOs; backups off-site cifrados con restore probado; Service Worker real o quitar la promesa PWA; terminar marketplace/loyalty/split con backend real; E2E robustos de flujos de dinero.

---

## 6. Conclusión

KiramoPay tiene un **núcleo bancario fiat técnicamente sólido** (ledger, idempotencia, atomicidad, auth de nivel internacional) rodeado de **dominios inmaduros que comprometen la integridad del sistema completo** — especialmente crypto, que literalmente regala dinero, y los 9 dominios que saltan el ledger. El diseño del dinero fiat y la seguridad ya juegan en la liga internacional; lo que separa al proyecto de producción real no es arquitectura sino **cobertura uniforme del ledger, compliance regulatorio, hardening de errores ignorados y pruebas de concurrencia**.

**Listo para demo/MVP no-custodial. No para custodiar dinero real sin cerrar los P0.**
