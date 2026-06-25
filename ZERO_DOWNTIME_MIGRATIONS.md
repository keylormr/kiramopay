# KiramoPay — Migraciones de esquema sin downtime (plan)

> **Estado: GUÍA / DISEÑO.** Define el patrón expand-contract, las recetas
> online por tipo de cambio, y los cambios que faltan en el *runner* para
> soportarlas. Hoy las migraciones son **forward-only** y suficientes al volumen
> actual; esta guía es el estándar a seguir cuando el volumen haga inaceptable
> un lock de tabla.
>
> Audiencia: ingeniería. Código de referencia:
> `backend/internal/database/migrate.go`, `backend/migrations/`.
> Relacionado: [DR_RUNBOOK.md](DR_RUNBOOK.md) (red de seguridad de rollback).

---

## 1. Modelo actual — cómo se aplican las migraciones hoy

`RunMigrations` (`migrate.go`):

- Aplica `*.sql` en **orden lexical** (`001_*`, `002_*`, …) y traquea
  `filename + checksum` en la tabla `schema_migrations`.
- Corre en el **boot del contenedor del API** cuando `RUN_MIGRATIONS=true`
  (Postgres gestionado — Neon — donde no se puede montar `initdb.d`).
- **Cada archivo se aplica en UNA transacción** (`BEGIN` → cuerpo del `.sql` →
  `INSERT` en `schema_migrations` → `COMMIT`). Un fallo deja la base en la última
  migración buena.
- **Checksum-locked**: editar una migración ya aplicada aborta el arranque
  (fuerza a crear una migración NUEVA). Buena propiedad — mantenerla.
- **Forward-only**: existe `migrations/down/` pero el runner lo **omite**. No hay
  rollback automático.

Estado de las migraciones existentes (referencia):

- **018** ya usa el patrón online `ADD CONSTRAINT … NOT VALID` + `VALIDATE
  CONSTRAINT` — buena práctica.
- **019** hace `ALTER COLUMN … TYPE NUMERIC(…)` = **reescritura de tabla con lock
  `AccessExclusive`** (bloquea todo mientras dura). Aceptable a bajo volumen,
  peligroso a escala.
- Ninguna migración usa `CREATE INDEX CONCURRENTLY` — consistente con el runner
  transaccional (no puede correr dentro de una tx).

---

## 2. Por qué el modelo actual no es zero-downtime por defecto

1. **Deploy rolling ⇒ código viejo y nuevo comparten el MISMO esquema** durante
   la ventana de despliegue. Un cambio destructivo en un solo paso (DROP / RENAME
   de columna, cambio de TYPE, `NOT NULL` sin default) **rompe el código viejo
   que todavía corre** → errores 5xx / caída.
2. **El wrap de 1 tx por archivo impide `CREATE INDEX CONCURRENTLY`** (no puede
   ejecutarse dentro de una transacción) → hoy no se pueden construir índices sin
   bloquear escrituras.
3. **DDL bloqueante toma `AccessExclusive`**: `ALTER COLUMN … TYPE` reescribe la
   tabla y bloquea lecturas y escrituras mientras dura → en una tabla grande, es
   downtime directo.
4. **Sin `lock_timeout`**: una DDL que espera un lock se **encola detrás** de una
   query larga y, mientras espera, bloquea todo el tráfico nuevo sobre esa tabla
   (lock queue). El runner no setea timeouts.
5. **Corre en el boot de cada instancia**: en un deploy rolling el orden
   migración↔código no está coordinado, y varias instancias podrían intentar
   migrar a la vez (la PK de `schema_migrations` + la tx por archivo dan algo de
   safety, pero pueden producir carrera/error).

---

## 3. Patrón base: expand-contract (parallel change)

Partir un cambio incompatible en pasos **backward-compatible** repartidos en N
releases. En ningún momento el esquema es incompatible con el código que está
corriendo.

1. **Expand** — agregar lo nuevo (columna nullable, tabla, índice). Compatible
   hacia atrás: el código viejo lo ignora.
2. **Migrate** — *dual-write* (el código nuevo escribe en lo viejo Y lo nuevo) +
   *backfill* por lotes de las filas existentes.
3. **Contract** — cuando TODO el código usa lo nuevo y nadie lee lo viejo,
   eliminar lo viejo, en un release **posterior**.

> Regla de oro: **nunca** renombrar, cambiar de tipo o eliminar una estructura en
> el mismo release que cambia el código que la usa.

---

## 4. Recetas online por tipo de cambio (PostgreSQL)

| Cambio | Riesgo directo | Receta zero-downtime |
|---|---|---|
| Agregar columna **nullable** | Ninguno (metadata-only) | Directo. |
| Agregar columna con **DEFAULT** | Default *volátil* reescribe la tabla | PG11+: un default **constante** es instantáneo. Default volátil → columna nullable + backfill. |
| Agregar **NOT NULL** | Scan + `AccessExclusive` | nullable → backfill → `ADD CONSTRAINT … CHECK (col IS NOT NULL) NOT VALID` → `VALIDATE CONSTRAINT` (lock débil) → opcional `SET NOT NULL`. *(El repo ya usa NOT VALID/VALIDATE en 018.)* |
| Agregar **índice** | `CREATE INDEX` bloquea escrituras | `CREATE INDEX CONCURRENTLY` **fuera de transacción** (requiere cambio de runner, §5). |
| Agregar **CHECK / FK** | Validación inmediata escanea bajo lock | `ADD CONSTRAINT … NOT VALID` y luego `VALIDATE CONSTRAINT` en una migración **separada**. |
| Cambiar **tipo** de columna | `ALTER COLUMN … TYPE` reescribe (`AccessExclusive`) | expand-contract: columna nueva + dual-write + backfill + switch de lecturas + drop de la vieja. *(019 hizo el ALTER directo — ok a bajo volumen, no a escala.)* |
| **Renombrar** columna/tabla | Rompe el código viejo al instante | Nunca in-place. expand-contract: nueva + dual-write + backfill + switch + drop. |
| **Drop** de columna | Rompe el código viejo que aún la lee | Dejar de usarla en código (deploy) → drop en una migración **posterior**. |

`VALIDATE CONSTRAINT` toma `ShareUpdateExclusive` (no bloquea lecturas ni
escrituras), por eso separar `NOT VALID` de `VALIDATE` es lo que evita el lock.

---

## 5. Cambios necesarios en el runner (`migrate.go`)

Para habilitar las recetas de §4:

1. **Migraciones no-transaccionales** (para `CONCURRENTLY`): una convención
   —p. ej. sufijo `NNN_name.notx.sql` o una directiva de cabecera
   `-- migrate:no-transaction`— que le indique al runner **no** envolver ese
   archivo en una transacción. Es el cambio clave. Riesgo: una migración no-tx
   que falla a la mitad deja estado parcial, así que debe ser **idempotente /
   reanudable** (`CREATE INDEX CONCURRENTLY IF NOT EXISTS`; limpiar un índice
   `INVALID` si una corrida previa abortó).
2. **Guards de timeout**: el runner debería `SET lock_timeout` y
   `SET statement_timeout` antes de aplicar cada migración, para que una DDL
   bloqueante **falle rápido** en vez de encolarse y tumbar el tráfico. Reintentar
   con backoff.
3. **Single-runner gate**: garantizar que **un solo** proceso corra las
   migraciones (un job/paso de release dedicado, o el advisory-lock de
   `internal/cluster`). No correrlas en el boot de cada instancia.
4. **Separar `NOT VALID` de `VALIDATE`**: como hoy cada archivo es una sola tx,
   ambas quedan juntas. Para tablas grandes, ponerlas en migraciones (archivos)
   separadas para que `VALIDATE` corra en su propia tx con lock débil.

---

## 6. Rollback

- **Forward-fix por defecto**: con expand-contract los pasos de *expand* son
  backward-compatible, así que el rollback seguro suele ser **desplegar el CÓDIGO
  anterior** — sigue funcionando contra el esquema expandido. No hace falta una
  *down migration*.
- **Down migrations**: el repo tiene `migrations/down/`, pero el runner las
  omite. Mantenerlas como documentación / uso manual de emergencia. Para un paso
  de *contract* (destructivo) una *down* puede ser imposible sin pérdida de datos
  → la red de seguridad real es el **backup/DR** (ver [DR_RUNBOOK.md](DR_RUNBOOK.md))
  más el propio orden expand-contract.

---

## 7. Coreografía de deploy

- Migración de **expand** → **antes** (o como paso de release independiente) del
  nuevo código; al ser backward-compatible, el código viejo sigue funcionando.
- Migración de **contract** → **después** de que el nuevo código (que ya no usa
  lo viejo) esté 100% desplegado en todas las instancias.
- Recomendado: mover las migraciones del **boot del API** a un **job/paso de
  release dedicado** (un solo runner), en vez de `RUN_MIGRATIONS=true` en cada
  instancia.

---

## 8. Checklist de PR de migración (gate de revisión)

- [ ] ¿El cambio es compatible con el código **actualmente en producción** (no
      solo con el código nuevo del mismo PR)?
- [ ] ¿Operación bloqueante (`TYPE` / `NOT NULL` / `UNIQUE` / rename / drop)? →
      partir en pasos expand-contract.
- [ ] ¿Índice nuevo? → `CONCURRENTLY` en un archivo no-tx.
- [ ] ¿`CHECK` / `FK`? → `NOT VALID` + `VALIDATE` en migración separada.
- [ ] ¿`lock_timeout` seteado / DDL acotada en duración?
- [ ] ¿Backfill por **lotes** (no un `UPDATE` masivo en una sola transacción)?
- [ ] ¿La cadena pasa `TestRunAllMigrations` en CI y es idempotente?

---

## 9. Referencias de código

| Tema | Ubicación |
|---|---|
| Runner de migraciones | `backend/internal/database/migrate.go` |
| Migraciones | `backend/migrations/` (018 `NOT VALID`/`VALIDATE`; 019 `ALTER … TYPE`) |
| Test de cadena (CI) | `backend/internal/database/migrate_chain_test.go` |
| Single-runner (advisory lock) | `backend/internal/cluster/` |
| Rollback / backups | [DR_RUNBOOK.md](DR_RUNBOOK.md) |
