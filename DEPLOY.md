# Deploy gratis (sin tarjeta)

Pila:

| Capa     | Proveedor | Plan       | Tarjeta |
|----------|-----------|------------|---------|
| Frontend | Vercel    | Hobby      | No      |
| Backend  | Render    | Free Web   | No      |
| Postgres | Neon      | Free       | No      |
| Redis    | Upstash   | Free       | No      |

> Nota: Koyeb dejó de tener free-tier sin tarjeta en 2026 (ahora pide $30/mes Pro). Render es el único reemplazo Docker gratis sin tarjeta — el contenedor duerme tras 15 min sin tráfico (primer request post-idle tarda ~30s en despertar).

Tiempo estimado: ~30–45 min la primera vez.

---

## 1. Generar el JWT secret

En cualquier terminal (PowerShell o Git Bash):

```bash
# Bash / Git Bash
openssl rand -base64 48

# PowerShell (si no tenés openssl)
[Convert]::ToBase64String([byte[]] (1..36 | ForEach-Object { Get-Random -Maximum 256 }))
```

Guardá la cadena resultante — la usás en el paso 4 como `JWT_SECRET`.

---

## 2. Neon (Postgres)

1. Andá a https://neon.tech → **Sign up with GitHub**. No pide tarjeta.
2. Create new project:
   - Name: `kiramopay`
   - Postgres version: 16
   - Region: cualquiera (mismo continente que Koyeb idealmente)
3. Tras crear, copiá la **Connection string** que muestra (formato `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`).
4. Reemplazá `neondb` por `kiramopay` en la URL. Si querés, podés crear primero una DB nueva desde el dashboard (Settings → Databases) o dejar `neondb` como nombre — da igual.

> **Anotá**: la `DATABASE_URL` completa.

---

## 3. Upstash (Redis)

1. Andá a https://upstash.com → **Sign up with GitHub**. No pide tarjeta.
2. Console → **Create Database**:
   - Name: `kiramopay-redis`
   - Type: Regional (más barato/free)
   - Region: cercana a Koyeb
   - Eviction: `allkeys-lru`
   - TLS: **Enabled** (Upstash lo enciende solo)
3. Una vez creada → tab **Details** → copiar **Endpoint** y **Password**.
4. La URL completa que necesitás es:

   ```
   rediss://default:<PASSWORD>@<ENDPOINT>:6379
   ```

   (notá las dos `s` en `rediss://` — eso enciende TLS automáticamente.)

> **Anotá**: la `REDIS_URL` completa.

---

## 4. Render (backend Go)

1. https://render.com → **Sign up with GitHub**. No pide tarjeta para el Free tier.
2. **New +** (esquina superior derecha) → **Web Service**.
3. Connect repository → autorizar Render para acceder a `kryrmz/kiramopay`.
4. Configuración:
   - **Name**: `kiramopay-backend`
   - **Region**: cualquiera cercana (Ohio o Virginia van bien con Neon us-east-1).
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `Dockerfile` (relativo a root dir `backend`)
   - **Instance Type**: `Free`
5. **Environment Variables** (Add Environment Variable por cada una):

   | Variable             | Valor                                                  |
   |----------------------|--------------------------------------------------------|
   | `ENVIRONMENT`        | `staging`                                              |
   | `SERVER_PORT`        | `8080`                                                 |
   | `DATABASE_URL`       | `postgresql://neondb_owner:...@ep-crimson-...neon.tech/neondb?sslmode=require` |
   | `DB_SSL_MODE`        | `require`                                              |
   | `REDIS_URL`          | `rediss://default:...@credible-mayfly-136814.upstash.io:6379` |
   | `REDIS_PASSWORD`     | el password de Upstash (para `ValidateForProduction`)  |
   | `JWT_SECRET`         | el del paso 1 (mínimo 32 chars)                        |
   | `JWT_ACCESS_MINUTES` | `15`                                                   |
   | `JWT_REFRESH_DAYS`   | `7`                                                    |
   | `CORS_ORIGINS`       | `https://<tu-app>.vercel.app,https://*.vercel.app`     |
   | `RUN_MIGRATIONS`     | `true`  *(solo el primer deploy, después borrar)*       |
   | `SEED_DEMO`          | `true`  *(solo el primer deploy)*                      |

6. **Create Web Service**. La primera build tarda ~5–8 min (Docker build + push + arranque). Mirá los logs:
   - `Running migrations from ./migrations ...` seguido de `migration applied` ×24
   - `Seed: created user 702650930 (Keilor Martinez) with wallet`
   - `Listening on :8080`
7. Cuando esté **Live**, abrí `https://kiramopay-backend.onrender.com/health` — debe devolver `{ "db": "ok", "redis": "ok", ... }`.

> **Anotá**: la URL pública de Render (algo como `https://kiramopay-backend.onrender.com`).
> **Importante**: Render free **duerme tras 15 min sin tráfico**. El primer request post-idle tarda ~30s. Para mantenerlo despierto en una demo, podés usar https://cron-job.org (free) con un GET a `/health` cada 10 min.

---

## 5. Vercel (frontend)

1. https://vercel.com → **Sign up with GitHub**. No pide tarjeta.
2. **Add New → Project** → importar el mismo repo.
3. Framework preset: **Vite** (lo detecta solo gracias a `vercel.json`).
4. Root directory: **dejar en `/`** (el frontend está en la raíz).
5. **Environment variables** (Production + Preview + Development):

   | Variable        | Valor                                                |
   |-----------------|------------------------------------------------------|
   | `VITE_API_URL`  | `https://kiramopay-backend.onrender.com`  (sin slash final) |

6. Deploy. Primera build ~2 min.
7. Cuando termine, abrí la URL de Vercel. Login con:
   - Cédula: `702650930`
   - Password: `Kiramopay2024!`

---

## 6. Después del primer deploy

- Volvé a Render → **Environment** y **borrá** `RUN_MIGRATIONS` y `SEED_DEMO`. Redeploy. Esto evita correr migraciones / seed cada vez que el contenedor reinicia (no rompen nada, solo gastan boot time).
- Si agregás una migración nueva, volvé a poner `RUN_MIGRATIONS=true` para ese deploy.
- Para mantener despierto el backend (evitar cold starts): https://cron-job.org → crear job que haga `GET https://kiramopay-backend.onrender.com/health` cada 10–14 min.

---

## Troubleshooting rápido

- **`Migrations failed: ... was modified after being applied`**: editaste un `.sql` ya aplicado. Solución: agregá una migración nueva (`025_*.sql`) en vez de tocar la anterior.
- **CORS bloquea desde Vercel**: revisar que `CORS_ORIGINS` en Koyeb incluya exactamente el dominio de Vercel (con `https://`, sin slash final).
- **401 en todas las llamadas tras login**: el frontend perdió el token. Hard refresh (Ctrl+F5) + chequear DevTools console para el log `[auth.store] token provider registered`.
- **Backend tarda en arrancar**: Render Free duerme tras 15 min sin tráfico. Primer request despierta el contenedor (~30s).
- **Neon "compute hours exceeded"**: el free incluye 191 horas/mes. Suficiente para uso normal; si lo pasás, el endpoint se suspende hasta el reset mensual.
