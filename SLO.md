# KiramoPay — SLIs, SLOs y error budgets

Objetivos de nivel de servicio para la API de KiramoPay. Complementa los
dashboards y reglas de alerta versionados en `k8s/monitoring/`. Las métricas
referenciadas son las que expone el endpoint Prometheus manual
(`/metrics`, prefijo `kiramopay_*`) más, cuando hay un colector OTLP levantado,
los histogramas `http.server.*` por ruta (RED dimensionado).

> **Filosofía.** Alertamos sobre **síntomas** que el usuario percibe
> (disponibilidad y latencia), no sobre causas. Las reglas de causa
> (saturación) son *warning* para diagnóstico, no *page*.

## SLIs (indicadores)

| SLI | Definición | Fuente |
|---|---|---|
| **Disponibilidad** | `1 − (5xx / total)` de respuestas HTTP | `kiramopay_http_errors_total`, `kiramopay_http_requests_total` |
| **Latencia (síntoma)** | duración de request por debajo de umbral | `kiramopay_http_request_duration_ms_avg` (proxy avg); `http_server_request_duration_*` p95/p99 con colector OTLP |
| **Correctitud del ledger** | drift cache↔journal = 0 | worker `reconcile` (audit `reconcile_*`) + `/api/v1/transparency/proof-of-reserves` |
| **Entrega de webhooks** | entregas exitosas / intentadas | tabla `webhook_deliveries` (estado) |

## SLOs (objetivos) y error budgets

Ventana de medición: **30 días móviles**.

| Servicio | SLO | Error budget (30 d) |
|---|---|---|
| **Disponibilidad API** | **99.5 %** de requests sin error 5xx | 0.5 % ≈ **3 h 39 min** de "presupuesto" de fallo |
| **Latencia endpoints de dinero** (`/sinpe/*`, `/escrow/*`, `/payouts/*`, `/transactions`) | **p99 < 500 ms** | 1 % de requests pueden exceder 500 ms |
| **Latencia lectura** (`GET` de saldos/historial) | **p95 < 300 ms** | 5 % pueden exceder 300 ms |
| **Integridad del ledger** | **drift = 0** (cualquier drift > 0 es incidente) | **0** — no hay presupuesto; el reconcile auto-corrige drift menor y alerta el mayor |
| **Entrega de webhooks** | **≥ 99 %** entregados dentro de 8 reintentos | 1 % |

### Cálculo del error budget (disponibilidad)

```
availability      = 1 − sum(rate(kiramopay_http_errors_total[30d]))
                        / sum(rate(kiramopay_http_requests_total[30d]))
error_budget      = 1 − 0.995            # 0.5 %
budget_consumed   = (1 − availability) / error_budget
```

- `budget_consumed ≥ 1.0` → SLO incumplido en la ventana: congelar features de
  riesgo y priorizar fiabilidad.
- **Burn-rate alerting** (recomendado): alertar *page* si se quema el budget de
  30 días a una tasa que lo agotaría en pocas horas (regla de 2 ventanas: rápida
  5 m + lenta 1 h). Ver `k8s/monitoring/alert-rules.yaml`.

## Política de alertas

| Alerta | Severidad | Acción |
|---|---|---|
| `HighErrorRate` (5xx > 5 % durante 5 m) | **page** | incidente — revisar despliegue/dependencias |
| `ErrorBudgetFastBurn` (quema rápida del budget) | **page** | incidente |
| `HighRequestLatency` (avg > 500 ms durante 10 m) | **page** | degradación percibida |
| `LedgerDrift` (drift de reconcile > 0) | **page** | invariante de doble partida roto — congelar movimientos sospechosos |
| `TargetDown` (target caído > 2 m) | **page** | API no responde al scrape |
| `HighGoroutines` / `HighHeap` / `HighGCRate` | **warning** | saturación — diagnóstico, posible escalado |
| `WebhookDeliveryBacklog` (entregas fallidas acumuladas) | **warning** | revisar endpoints de comercios |

## Notas de implementación

- Las alertas de **drift** y **webhooks** requieren exponer esas señales como
  métricas Prometheus (hoy viven en audit/DB). Pendiente: un exportador que
  publique `kiramopay_ledger_drift_crc` y `kiramopay_webhook_deliveries_failed`
  en `/metrics`. Las reglas correspondientes quedan documentadas y comentadas en
  `alert-rules.yaml` hasta que la métrica exista.
- Los percentiles p95/p99 por ruta requieren el **colector OTLP** (métricas
  `http.server.*`). Sin colector, se usa el proxy `*_duration_ms_avg`.
- Revisar SLOs trimestralmente con datos reales una vez haya 30 días de serie.
