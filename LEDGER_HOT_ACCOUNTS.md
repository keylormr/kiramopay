# KiramoPay — Contención del ledger en cuentas calientes (plan)

> **Estado: DISEÑO. No implementado.** El modelo actual es correcto y suficiente
> al volumen de hoy. Este documento fija el **umbral** a partir del cual la
> contención por cuenta se vuelve un problema y **diseña** las mitigaciones, para
> implementarlas solo cuando el volumen lo exija (§4, §5).
>
> Audiencia: ingeniería + due-diligence. Código de referencia:
> `backend/internal/ledger/ledger.go`, `backend/migrations/020_journal_ledger.sql`.
> Relacionado: [SLO.md](SLO.md) (latencia de endpoints de dinero), `internal/reconcile`.

---

## 1. Modelo actual — cómo se serializa una posting

El ledger es de **doble partida append-only** (migración 020). Cada movimiento
de dinero es una `Posting` con ≥ 2 `Entry` que balancean por moneda; se escribe
en `journal_postings` + `journal_entries`, ambas **inmutables** por trigger.

Ruta de escritura (`Engine.Post` → `postOnce` en `ledger.go`):

1. **Aislamiento `READ COMMITTED`** con reintentos (8x, backoff con jitter) ante
   `40001` (serialization_failure) / `40P01` (deadlock_detected).
2. **Pre-lock determinista**: `SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE`
   **solo de las filas de wallets de los usuarios afectados**, en orden ordenado
   por `user_id` (descarta deadlocks). Las cuentas de sistema **no** se bloquean.
3. INSERT del posting + entries (append-only).
4. **Cache de saldo**: `applyWalletDelta` hace
   `UPDATE wallets SET balance_crc = balance_crc + $delta ... WHERE user_id` — un
   `+= delta` conmutativo sobre la **fila ya bloqueada** en el paso 2.
5. COMMIT: un constraint trigger `DEFERRED` valida que el posting balancee.

Decisión de diseño clave (ver el comentario en `postOnce`): se eligió
`READ COMMITTED` + `FOR UPDATE` en vez de `SERIALIZABLE` precisamente para que
las transferencias que tocan la **misma** cuenta **encolen** en el lock de fila y
se apliquen en secuencia, en lugar de **abortar** con fallo de serialización bajo
contención fuerte de una sola cuenta.

### Qué serializa y qué no

`ledger_account_balances` **es una VISTA** (`SUM` de `journal_entries` por
cuenta), no una tabla materializada. Por eso:

| Tipo de cuenta | Lock en **escritura** | Cache de saldo | Costo de **leer** el saldo |
|---|---|---|---|
| `user_wallet` (incluye comercios) | **Sí** — `FOR UPDATE` + `UPDATE wallets`, lock por fila | `wallets.balance_*` | O(1) — lee el cache |
| `system_*` (`ESCROW`, `EXTERNAL`, `RESERVE`, `FEES`, `SUSPENSE`) | **No** — solo INSERT append-only | Ninguno | O(n) — `SUM` sobre todo su historial |

Las inserciones concurrentes que referencian la **misma** cuenta de sistema no
se serializan entre sí: la verificación de FK toma un `FOR KEY SHARE` sobre la
fila de `ledger_accounts`, y varios `KEY SHARE` son compatibles entre sí (solo
chocan con un `UPDATE`/`DELETE` de esa cuenta, que nunca ocurre — el catálogo es
estable).

---

## 2. Dónde está el cuello de botella — y dónde NO

**NO en las cuentas de sistema de alto volumen.** `SYSTEM:ESCROW`,
`SYSTEM:EXTERNAL:<RAIL>`, `SYSTEM:RESERVE` reciben muchísimas postings, pero son
**append-only sin lock por cuenta** → escalan bien en escritura. Su único costo
creciente es **leer** el balance (la vista agrega todo el historial de la
cuenta). Ese costo está **fuera** de la ruta caliente de escritura (la ruta de
posting nunca lee el saldo del sistema), así que no frena las transferencias.

**SÍ en una sola fila de wallet "caliente".** En este esquema **no existe un tipo
"merchant"**: un comercio es un `user_wallet` (`USER:<id>:CRC`). Todas las
postings que **acreditan** a ese comercio toman su lock de fila (`FOR UPDATE` +
`UPDATE wallets`) y se aplican **en serie**. Para un usuario normal esto es
irrelevante (es su propio throughput). Para un comercio o agregador de alto
volumen, esa **única fila** es el punto de serialización.

```
Techo de throughput por wallet caliente ≈ 1 / T
  T = tiempo que se mantiene el lock de esa fila por posting
      (espera del lock + UPDATE + COMMIT, incluido el fsync del WAL)
```

---

## 3. Umbral — cuándo deja de ser suficiente

- **Estimación del techo.** Con `T ≈ 5–15 ms` por posting bajo contención sobre
  la fila caliente, el techo por wallet caliente ronda **~70–200 postings/s**.
  Por encima, las postings entrantes a esa cuenta encolan: sube la latencia p99 y
  aumentan los reintentos `40001/40P01`. (Es una estimación de orden de magnitud;
  el valor real depende de la latencia de `fsync` del Postgres gestionado — hoy
  Neon — y debe **medirse**, no asumirse.)

- **Señal temprana que YA existe.** El `WARN "ledger.post retrying"` que emite
  `Engine.Post`. Si **una sola** cuenta dispara reintentos sostenidos, está cerca
  de su techo. Es el primer indicador a vigilar sin escribir código nuevo.

- **Disparador de implementación (definición operativa).** Actuar cuando se
  cumpla cualquiera de:
  1. la tasa entrante **sostenida** a un mismo wallet supere `~X/s` (fijar `X`
     tras instrumentar, ver abajo), o
  2. la latencia **p99 de endpoints de dinero** hacia un comercio cruce el SLO
     (`< 500 ms`, ver [SLO.md](SLO.md)) **por contención de su wallet**, o
  3. el `WARN "ledger.post retrying"` se vuelva recurrente concentrado en una
     cuenta.

- **Prerrequisito barato (instrumentar primero).** Antes de mitigar hay que
  **saber** cuándo se cruza el umbral. Paso recomendado como primer trabajo de
  implementación: promover `ledger.post retrying` a un counter Prometheus
  (p.ej. `kiramopay_ledger_post_retries_total{reason}`) y, opcionalmente, medir
  el tiempo de espera del lock. Sin esta señal, `X/s` es adivinanza. Es un cambio
  pequeño y aislado; pertenece a la fase de implementación, no a este diseño.

---

## 4. Mitigaciones (diseñadas; implementar cuando el volumen lo exija)

> **Invariante.** Todas operan sobre la **capa de cache / enrutamiento**. El
> `journal` permanece append-only y **fuente de verdad**; `reconcile` y la
> prueba de reservas siguen funcionando sin cambios.

### 4.1 Sub-cuentas particionadas (sharding del wallet caliente)

Partir el wallet caliente en `N` sub-cuentas hijas y enrutar cada posting
entrante a un shard por `hash(posting_id) mod N` o round-robin.

- **Efecto.** `N` postings concurrentes a shards distintos no comparten lock de
  fila → contención por fila ~`N×` menor.
- **Saldo mostrado** = `SUM` de los `N` shards (lectura O(N), barata).
- **Trade-offs.** Los **débitos/retiros** del comercio deben juntar fondos entre
  shards (o un *sweep* de liquidación a un shard principal); idempotencia por
  shard; `reconcile` suma shards contra el journal. **Aplicar por-cuenta
  (opt-in)** al comercio caliente, **no** de forma global.
- **Forma posible.** `wallet_shards(user_id, shard, balance_crc, balance_usd, …)`
  + columna/ruteo en la capa de servicio; la lógica de balance del comercio lee
  la suma. El journal no cambia (las entries siguen apuntando a la cuenta lógica
  o a cuentas-shard, según se decida; preferible mantener la cuenta lógica en el
  journal y shardear **solo** el cache).

### 4.2 Agregación por lote (liquidación diferida del cache)

En vez de un `UPDATE` del cache por evento, escribir la posting en el journal
(append-only, sin tomar el lock del wallet) y aplicar el **delta neto** al cache
del wallet en **lotes** periódicos (un único `UPDATE` con la suma de `K` eventos
por ventana).

- **Efecto.** El lock de la fila caliente se toma **1 vez por ventana** en vez de
  `K` veces.
- **Trade-off.** El cache es **eventualmente consistente** dentro de la ventana.
  Para mostrar saldo al segundo, leer la vista (journal) de esa cuenta o exponer
  "pendiente + confirmado". Encaja bien con cuentas de **settlement** de comercio
  (no requieren saldo exacto al segundo).

### 4.3 Snapshot/rollup de balance para cuentas de sistema (problema de LECTURA)

Tabla `ledger_account_snapshots(account_id, as_of, balance_minor)`; el saldo vivo
de una cuenta de sistema = `snapshot + SUM(entries posteriores a as_of)`. Un
worker periódico avanza el snapshot.

- **Efecto.** Acota el costo de **leer** el balance de `SYSTEM:ESCROW` /
  `SYSTEM:EXTERNAL` (que de otro modo escanea todo el historial). **No** toca la
  escritura ni reintroduce lock por cuenta.

### 4.4 Lo que NO se debe hacer

- **No** volver a `SERIALIZABLE` global: el diseño actual eligió
  `READ COMMITTED` + `FOR UPDATE` para que las cuentas calientes **encolen** en
  vez de abortar.
- **No** materializar el balance de cuentas de sistema con un `UPDATE` por
  posting: reintroduciría el lock por cuenta que hoy **no existe** y volvería
  `SYSTEM:ESCROW`/`EXTERNAL` un cuello de botella de escritura.
- **No** tocar el `journal`: las mitigaciones son de cache/enrutamiento.

---

## 5. Recomendación

1. **Hoy:** no implementar nada. El modelo (lock por wallet + journal append-only
   + cuentas de sistema sin lock) es correcto y suficiente al volumen actual.
2. **Primer paso cuando se decida actuar:** instrumentar (counter de reintentos +
   tiempo de espera del lock) y fijar `X/s` con datos reales.
3. **Implementar §4.1 (sharding)** solo para el comercio que se acerque al techo,
   **opt-in por cuenta**. Usar §4.2 si el patrón del comercio es settlement
   diferido. Usar §4.3 si la **lectura** de saldos de cuentas de sistema se
   vuelve cara.

---

## 6. Referencias de código

| Tema | Ubicación |
|---|---|
| Locking de posting | `backend/internal/ledger/ledger.go` — `Engine.Post`, `postOnce`, `applyWalletDelta` |
| Esquema + vista de balances | `backend/migrations/020_journal_ledger.sql` — vista `ledger_account_balances`, vista `wallet_journal_drift` |
| Reconcile (consume la vista) | `backend/internal/reconcile/reconcile.go` |
| SLO de latencia de dinero | [SLO.md](SLO.md) |
