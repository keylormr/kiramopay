# KiramoPay Backend

Backend API en Go (Golang) para KiramoPay. Incluye 17 dominios de negocio, autenticacion JWT, WebSocket para precios crypto en tiempo real, y metricas Prometheus.

## Inicio Rapido

### Con Docker (recomendado)

```bash
# Levantar PostgreSQL + Redis + API
docker compose up -d

# Verificar que todo esta corriendo
docker compose ps

# Ver logs de la API
docker compose logs -f api
```

La API estara disponible en **http://localhost:8080**.

Verificar con:
```bash
curl http://localhost:8080/health
# {"status":"ok","version":"1.0.0","environment":"development","services":{"database":"ok","redis":"ok"},"websocket_clients":0}
```

### Sin Docker (requiere Go 1.22+)

```bash
# 1. Copiar archivo de entorno
cp .env.example .env

# 2. Asegurate de tener PostgreSQL y Redis corriendo localmente

# 3. Compilar y ejecutar
make build
./bin/api

# O directamente:
make run
```

## Comandos del Makefile

| Comando | Descripcion |
|---------|-------------|
| `make build` | Compilar binario en `bin/api` |
| `make run` | Ejecutar sin compilar (`go run`) |
| `make test` | Tests unitarios (no necesitan DB) |
| `make test-integration` | Tests de integracion (necesitan PostgreSQL + Redis) |
| `make test-all` | Todos los tests |
| `make test-coverage` | Tests con reporte de cobertura HTML |
| `make test-db-create` | Crear base de datos de test en Docker |
| `make lint` | Ejecutar golangci-lint |
| `make clean` | Limpiar binarios y reportes |
| `make docker-up` | Levantar Docker Compose |
| `make docker-down` | Detener Docker Compose |
| `make docker-rebuild` | Reconstruir imagen y levantar |
| `make docker-logs` | Ver logs de la API |

## Variables de Entorno

Ver `.env.example` para todas las variables. Las mas importantes:

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `ENVIRONMENT` | `development` | Entorno (`development`, `staging`, `production`) |
| `SERVER_PORT` | `8080` | Puerto del servidor |
| `DB_HOST` | `localhost` | Host de PostgreSQL |
| `DB_PORT` | `5432` | Puerto de PostgreSQL |
| `DB_USER` | `kiramopay` | Usuario de PostgreSQL |
| `DB_PASSWORD` | `kiramopay_dev` | Password de PostgreSQL |
| `DB_NAME` | `kiramopay` | Nombre de la base de datos |
| `DB_SSL_MODE` | `disable` | Modo SSL (`disable`, `require`, `verify-full`) |
| `DB_MAX_CONNS` | `25` | Conexiones maximas al pool |
| `REDIS_HOST` | `localhost` | Host de Redis |
| `REDIS_PORT` | `6379` | Puerto de Redis |
| `REDIS_PASSWORD` | `kiramopay_redis_dev` | Password de Redis |
| `CORS_ORIGINS` | `http://localhost:*` | Origenes CORS permitidos (comma-separated) |
| `DB_SSL_ROOT_CERT` | *(vacio)* | Ruta al certificado CA raiz (produccion) |
| `DB_SSL_CERT` | *(vacio)* | Ruta al certificado cliente (produccion) |
| `DB_SSL_KEY` | *(vacio)* | Ruta a la llave privada del cliente (produccion) |
| `VAPID_PUBLIC_KEY` | *(vacio)* | Clave publica VAPID para push notifications |
| `VAPID_PRIVATE_KEY` | *(vacio)* | Clave privada VAPID para push notifications |
| `EXCHANGE_RATE_API_KEY` | *(vacio)* | API key de exchangerate-api.com |
| `EXCHANGE_RATE_INTERVAL` | `15m` | Intervalo de actualizacion de tasas |
| `COINGECKO_API_KEY` | *(vacio)* | API key Pro de CoinGecko (opcional) |
| `JWT_SECRET` | `dev-secret-...` | Secreto para firmar JWT (cambiar en produccion) |
| `JWT_ACCESS_MINUTES` | `15` | Duracion del access token en minutos |
| `JWT_REFRESH_DAYS` | `7` | Duracion del refresh token en dias |

## Estructura del Proyecto

```
backend/
├── cmd/api/
│   └── main.go              # Entry point: wiring de todos los servicios y rutas
│
├── internal/                 # Paquetes privados (por dominio)
│   ├── auth/                 # Autenticacion
│   │   ├── model.go          #   Tipos: LoginRequest, RegisterRequest, etc.
│   │   ├── repository.go     #   Acceso a DB (sesiones)
│   │   ├── service.go        #   Logica: login, registro, cambio PIN
│   │   ├── handler.go        #   HTTP handlers
│   │   └── auth_integration_test.go  # Tests de integracion
│   │
│   ├── user/                 # Usuarios
│   ├── wallet/               # Wallets (balance, optimistic locking)
│   ├── transaction/          # Transacciones (CRUD, paginacion)
│   ├── sinpe/                # SINPE Movil (contactos, envios, limite diario)
│   ├── payment/              # Pago de servicios (ICE, AyA, recargas)
│   ├── crypto/               # Crypto (compra/venta, staking, precios)
│   ├── marketplace/          # Marketplace (12 partners, rides, food)
│   ├── loyalty/              # Puntos (4 tiers, cashback, recompensas)
│   ├── qrpayment/            # QR (merchant, P2P, scan-and-pay)
│   ├── splitpay/             # Split (equal/custom/percentage)
│   ├── cards/                # Tarjetas virtuales (VISA, Luhn, limites)
│   ├── fraud/                # Fraude (scoring 0-100, 5 reglas, alertas)
│   ├── country/              # Multi-pais (CR/PA/GT, cambio, cross-border)
│   ├── websocket/            # WebSocket hub + price broadcaster
│   ├── docs/                 # Swagger UI handler
│   ├── config/               # Configuracion desde env vars
│   ├── database/             # Pool PostgreSQL, cliente Redis, seeder
│   ├── audit/                 # Audit logging asincrono (buffered channel)
│   ├── notification/          # Push notifications (VAPID, web-push)
│   ├── exchange/              # Exchange rates en vivo (goroutine fetcher)
│   ├── middleware/            # Auth, rate limiting, CSRF, security headers, lockout, body limit
│   └── testutil/             # Helpers para tests de integracion
│
├── pkg/                      # Paquetes publicos/reutilizables
│   ├── hash/                 #   Argon2id para PINs
│   ├── jwt/                  #   Generacion/validacion JWT
│   ├── response/             #   Formato estandar de respuesta API
│   └── validator/            #   Validacion (cedula, telefono, email, PIN)
│
├── docs/
│   └── openapi.yaml          # Especificacion OpenAPI 3.0 completa
│
├── migrations/               # SQL migrations (001-014)
├── scripts/                  # Backup y restore de base de datos
├── docker-compose.yml        # PostgreSQL + Redis + API
├── Dockerfile                # Multi-stage build (builder + alpine runtime)
├── Makefile                  # Comandos de desarrollo
├── go.mod                    # Dependencias Go
└── .env.example              # Template de variables de entorno
```

## Patron de Cada Dominio

Cada paquete en `internal/` sigue el patron **Repository → Service → Handler**:

```
dominio/
├── model.go         # Structs, constantes, tipos de request/response
├── repository.go    # Acceso a base de datos (SQL directo con pgx)
├── service.go       # Logica de negocio (validaciones, reglas)
├── handler.go       # HTTP handlers (parseo JSON, respuestas)
└── *_test.go        # Tests de integracion (opcional)
```

**Flujo de un request:**
1. **Handler** recibe HTTP request, parsea JSON, extrae `userID` del contexto
2. **Service** ejecuta logica de negocio (validaciones, reglas)
3. **Repository** ejecuta queries SQL y retorna datos
4. **Handler** formatea la respuesta con `response.JSON()` o `response.Error()`

## Endpoints

### Publicos (sin autenticacion)

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/health` | Estado del sistema (DB, Redis, WebSocket) |
| GET | `/metrics` | Metricas Prometheus |
| GET | `/ws/prices` | WebSocket precios crypto (5s interval) |
| GET | `/api/docs` | Swagger UI |
| GET | `/api/docs/openapi.yaml` | Especificacion OpenAPI |
| POST | `/api/v1/auth/login` | Login con cedula + PIN |
| POST | `/api/v1/auth/register` | Registrar usuario |
| POST | `/api/v1/auth/refresh` | Refrescar JWT |
| GET | `/api/v1/crypto/prices` | Precios crypto actuales |
| GET | `/api/v1/countries` | Paises soportados |
| GET | `/api/v1/exchange-rates` | Tasas de cambio |

### Protegidos (requieren `Authorization: Bearer <token>`)

80+ endpoints organizados por dominio. Ver la especificacion completa en `/api/docs` o en `docs/openapi.yaml`.

## Base de Datos

### Migraciones

Las 14 migraciones se aplican automaticamente al iniciar PostgreSQL con Docker Compose (montadas en `docker-entrypoint-initdb.d`).

Para aplicar manualmente:
```bash
# Dentro del contenedor de PostgreSQL
docker compose exec postgres psql -U kiramopay -d kiramopay -f /docker-entrypoint-initdb.d/001_initial_schema.sql
```

### Resetear datos

```bash
# Opcion 1: Eliminar volumenes y recrear
docker compose down -v
docker compose up -d

# Opcion 2: Borrar schema y re-aplicar migraciones
make migrate-reset
```

### Convenciones de datos

- **Montos:** BIGINT en centimos (2,500,000 CRC = `250000000`)
- **IDs:** UUID v4 como strings
- **Timestamps:** `TIMESTAMPTZ` (UTC)
- **Optimistic locking:** Columna `version` en wallets
- **Soft delete:** Columna `deleted_at` en users

## Tests

### Tests unitarios

```bash
make test
# Ejecuta tests en pkg/ (hash, jwt, validator)
# No necesitan base de datos
```

### Tests de integracion

Requieren PostgreSQL y Redis corriendo:

```bash
# Con Docker Compose activo:
make test-db-create        # Crear DB de test (solo primera vez)
make test-integration      # Ejecutar tests

# Con variables de entorno personalizadas:
TEST_DB_DSN="postgres://user:pass@host:5432/db?sslmode=disable" \
TEST_REDIS_ADDR="host:6379" \
make test-integration
```

Dominios con tests de integracion:
- **auth** — Registro, login valido/invalido, cambio PIN, refresh token
- **wallet** — Balance, debit, optimistic locking
- **transaction** — Crear, buscar, paginacion, filtros
- **sinpe** — Contactos, envios, balance insuficiente, historial
- **crypto** — Compra, venta, staking, alertas, portafolio
- **fraud** — Evaluacion de riesgo, restriccion de usuarios, alertas

## Reglas de Negocio Importantes

| Dominio | Regla |
|---------|-------|
| SINPE | Limite diario: 500,000 CRC. Fee por transaccion: 150 CRC |
| Wallet | Balance por defecto: 2,500,000 CRC + 500 USD |
| Cards | Maximo 5 tarjetas por usuario. Limites: 500K diario, 2M mensual |
| Loyalty | 4 tiers: bronze → silver (5K pts) → gold (25K pts) → platinum (100K pts) |
| Fraud | Score 0-100. Acciones: allow (<25), review (25-74), block (75+) |
| Country | Cross-border fee: 1.5% (minimo $1.50 USD). Paises: CR, PA, GT |
| QR | Formato: `KP:{type}:{creatorID}:{amount}:{currency}:{token}` |
| Split | 3 modos: equal, custom, percentage. Auto-settle al completar |

## Security

### Headers de Seguridad

Todas las respuestas incluyen los siguientes headers (middleware `SecurityHeaders`):

| Header | Valor |
|--------|-------|
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera=(), microphone=(), geolocation=() |
| Strict-Transport-Security | max-age=63072000; includeSubDomains; preload |
| Content-Security-Policy | default-src 'self'; connect-src 'self' wss: https://api.coingecko.com; ... |

### CSRF Protection

El middleware `CSRFProtection` verifica el header `Origin` o `Referer` en metodos POST/PUT/DELETE/PATCH. Los origenes permitidos se configuran via `CORS_ORIGINS`.

### Account Lockout

Despues de **5 intentos fallidos** de login, la cuenta se bloquea por **15 minutos**. Respuesta: `423 Locked`. El contador se resetea tras un login exitoso. Implementado con Redis (`lockout:{cedula}`).

### Session Revocation

El middleware `AuthWithSessionCheck` verifica si la sesion JWT ha sido revocada (via `/auth/logout`). Tokens revocados retornan `401 Unauthorized` aunque el JWT sea valido.

### Audit Logging

Eventos criticos se registran en la tabla `audit_logs` de forma asincrona (buffered channel + background writer):
- Login/registro/cambio de PIN
- Transferencias
- Creacion de tarjetas
- Campos: user_id, action, resource_type, ip_address, user_agent, details (JSONB), risk_level

### Body Limits

Todas las requests tienen un limite de **1 MB** en el body. Exceder retorna `413 Request Entity Too Large`.

### Production Config Validation

Al iniciar en `ENVIRONMENT=production`, se valida:
- `JWT_SECRET` no sea el default
- `DB_SSL_MODE` no sea `disable`
- `REDIS_PASSWORD` este configurado

Si falla la validacion, la API no inicia.

## WebSocket Notifications (Real-time)

Endpoint: `GET /ws/notifications` — canal autenticado por usuario.

Flujo:
1. Cliente conecta al WebSocket
2. Envia mensaje de autenticacion: `{"type":"auth","token":"<jwt>"}`
3. Servidor asigna `UserID` al cliente
4. Notificaciones se entregan via `SendToUser(userID, msg)` solo al usuario correcto
5. Multiples conexiones del mismo usuario reciben la notificacion

Integrado con: `sinpe/service.go` (transferencias), `crypto/service.go` (alertas de precio), `fraud/service.go` (transacciones bloqueadas).

En el frontend, el hook `useNotificationsWs` (`src/hooks/useNotificationsWs.ts`) maneja conexion, autenticacion y despacho al store de Zustand automaticamente.

## Push Notifications

Endpoints protegidos para gestion de push notifications via VAPID/web-push:

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/api/v1/push/subscribe` | Registrar subscription |
| DELETE | `/api/v1/push/unsubscribe` | Eliminar subscription |
| GET | `/api/v1/notifications` | Listar notificaciones (paginado: `?limit=20&offset=0`) |
| PATCH | `/api/v1/notifications/{id}/read` | Marcar notificacion como leida |

Generar claves VAPID:
```bash
npx web-push generate-vapid-keys
```

## Exchange Rates

Tasas de cambio se actualizan en vivo via goroutine (cada `EXCHANGE_RATE_INTERVAL`):
- Monedas soportadas: CRC, USD, PAB, GTQ
- Provider: exchangerate-api.com (free tier)
- Fallback: ultimas tasas conocidas si la API falla

## Crypto Price Service

- Cache TTL: 60s (compatible con free tier de CoinGecko)
- Circuit breaker: 3 fallos consecutivos → pausa de 5 min
- Con API key Pro (`COINGECKO_API_KEY`): intervalo de 5s, URL Pro
- Sin API key: intervalo de 15s, URL publica

## Production Database

### SSL

Configurar para produccion:
```env
DB_SSL_MODE=verify-full
DB_SSL_ROOT_CERT=/etc/ssl/certs/rds-ca.pem
# Opcionales:
DB_SSL_CERT=/path/to/client-cert.pem
DB_SSL_KEY=/path/to/client-key.pem
```

### Backups

Scripts en `scripts/`:
```bash
# Backup comprimido con rotacion de 30 dias
bash scripts/backup.sh

# Restaurar desde backup
bash scripts/restore.sh /path/to/backup.sql.gz
```

En Kubernetes: CronJob diario a las 2 AM (`k8s/base/backup-cronjob.yaml`).

### Particiones

La tabla `transactions` usa particionamiento por mes. La funcion `create_future_partitions()` (migration 014) crea particiones 6 meses adelante. En Kubernetes: CronJob mensual (`k8s/base/partition-cronjob.yaml`)
