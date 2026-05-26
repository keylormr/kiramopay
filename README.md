# KiramoPay

Super app financiera para Costa Rica, inspirada en Alipay. Permite pagos SINPE, crypto, servicios, marketplace, tarjetas virtuales y mucho mas.

## Tabla de Contenidos

- [Requisitos Previos](#requisitos-previos)
- [Inicio Rapido](#inicio-rapido)
- [Modos de Desarrollo](#modos-de-desarrollo)
- [Arquitectura del Proyecto](#arquitectura-del-proyecto)
- [Frontend](#frontend)
- [Backend](#backend)
- [Despliegue con Kubernetes](#despliegue-con-kubernetes)
- [Monitoreo](#monitoreo)
- [Testing](#testing)
- [CI/CD](#cicd)
- [PWA y Modo Offline](#pwa-y-modo-offline)
- [Documentacion de API](#documentacion-de-api)
- [Usuarios de Prueba](#usuarios-de-prueba)
- [Estructura de Archivos](#estructura-de-archivos)

---

## Requisitos Previos

### Para desarrollo frontend unicamente (modo mock)
- **Node.js 20+** ([descargar](https://nodejs.org/))
- **npm** (incluido con Node.js)

### Para desarrollo full-stack (frontend + backend)
- Todo lo anterior, mas:
- **Docker Desktop** ([descargar](https://www.docker.com/products/docker-desktop/))
- **Docker Compose** (incluido con Docker Desktop)

### Para despliegue en Kubernetes local
- Todo lo anterior, mas:
- **minikube** ([instalar](https://minikube.sigs.k8s.io/docs/start/))
- **kubectl** ([instalar](https://kubernetes.io/docs/tasks/tools/))
- **Helm 3** ([instalar](https://helm.sh/docs/intro/install/))

### Opcional
- **Go 1.22+** si quieres compilar el backend sin Docker
- **Playwright** se instala automaticamente con `npm install`

---

## Inicio Rapido

### Opcion 1: Solo Frontend (sin backend, datos mock)

Este modo usa datos simulados en localStorage. No necesitas Docker ni base de datos.

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd kiramopay

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor de desarrollo
npm run dev
```

Abre **http://localhost:9999** en tu navegador. **Nota:** En modo mock, la autenticación NO funciona (requiere backend). Usa la Opción 2 o 4 para login real.

### Opcion 2: Full-Stack (frontend + backend con Docker)

```bash
# 1. Instalar dependencias del frontend
npm install

# 2. Levantar el backend (PostgreSQL + Redis + API)
cd backend
docker compose up -d

# Esperar a que los servicios esten listos (~15 segundos)
# Verificar con:
docker compose ps
# Todos deben mostrar "healthy" o "running"

# 3. Volver a la raiz y crear archivo de entorno
cd ..
cp .env.example .env.local

# 4. Iniciar el frontend apuntando al backend
npm run dev
```

El frontend detecta automaticamente si `VITE_API_URL` esta configurado. Si lo esta, usa el backend real; si no, usa datos mock.

### Opcion 3: Kubernetes local (minikube)

```bash
# 1. Asegurate de tener minikube, kubectl y helm instalados

# 2. Ejecutar el script de despliegue
bash k8s/deploy-minikube.sh

# 3. Agregar entrada a /etc/hosts (o C:\Windows\System32\drivers\etc\hosts)
# El script te mostrara la IP de minikube, por ejemplo:
# 192.168.49.2  kiramopay.local

# 4. Acceder
# Frontend: http://kiramopay.local
# API:      http://kiramopay.local/health
# Swagger:  http://kiramopay.local/api/docs
```

Ver [k8s/README.md](k8s/README.md) para detalles completos.

### Opcion 4: Todo con Docker Compose (recomendado)

La forma mas rapida de levantar frontend + backend + base de datos en un solo comando:

```bash
# Windows
start.bat

# Linux/Mac
bash start.sh
```

Esto levanta PostgreSQL + Redis + API Go + Frontend (nginx), todo containerizado.
Solo el puerto **9999** se expone al host. nginx hace proxy reverso de `/api/*` y `/ws/*` al backend.

Acceder a: **http://localhost:9999**

Login: cedula `702650930`, contraseña `Kiramopay2024!`

---

## Modos de Desarrollo

| Modo | Que necesitas | Como funciona |
|------|---------------|---------------|
| **Mock** | Solo Node.js | Datos simulados en localStorage, sin backend |
| **Full-Stack** | Node.js + Docker | Backend real con PostgreSQL, Redis, API en Go |
| **Kubernetes** | Node.js + Docker + minikube | Todo desplegado en cluster local de K8s |

### Cambiar entre modos

El frontend se adapta automaticamente segun las variables de entorno:

```bash
# Modo mock (sin .env.local o sin VITE_API_URL)
npm run dev

# Modo full-stack (con VITE_API_URL apuntando al backend)
# En .env.local:
VITE_API_URL=http://localhost:8080
npm run dev
```

---

## Arquitectura del Proyecto

```
kiramopay/
├── src/                        # Frontend React
├── backend/                    # Backend Go
├── k8s/                        # Kubernetes manifests + Helm
├── e2e/                        # Tests E2E (Playwright)
├── public/                     # Assets estaticos + PWA
├── .github/workflows/          # CI/CD (GitHub Actions)
├── Dockerfile                  # Docker imagen del frontend (nginx)
├── docker-compose.yml          # Full-stack Docker Compose (PostgreSQL + Redis + API + nginx)
├── Dockerfile.frontend         # Docker imagen del frontend (multi-stage: build + nginx)
├── start.bat                   # Script Windows para levantar todo con Docker
├── start.sh                    # Script Linux/Mac para levantar todo con Docker
├── nginx/default.conf          # Configuracion nginx (reverse proxy + static files)
├── nginx.conf                  # Configuracion nginx para produccion
├── playwright.config.ts        # Configuracion Playwright
├── vitest.config.ts            # Configuracion Vitest
└── package.json                # Dependencias y scripts del frontend
```

### Patron de Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                   │
│  Views → Stores (Zustand) → API Layer → Adapters     │
│                                    ├── Mock (localStorage)
│                                    └── HTTP (fetch → backend)
└──────────────────────┬──────────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────▼──────────────────────────────┐
│                  Backend (Go + chi)                    │
│  Handler → Service → Repository → PostgreSQL/Redis    │
└─────────────────────────────────────────────────────┘
```

---

## Frontend

### Comandos disponibles

| Comando | Que hace |
|---------|----------|
| `npm run dev` | Inicia servidor de desarrollo en http://localhost:9999 |
| `npm run build` | Build de produccion (salida en `dist/`) |
| `npm run preview` | Previsualizar build de produccion |
| `npm run test` | Tests unitarios con Vitest (modo watch) |
| `npm run test:run` | Tests unitarios (una sola vez) |
| `npm run test:coverage` | Tests con reporte de cobertura |
| `npm run lint` | Verificar codigo con ESLint |
| `npm run lint:fix` | Corregir errores de linting automaticamente |
| `npm run format` | Formatear codigo con Prettier |
| `npm run e2e` | Tests E2E con Playwright |
| `npm run e2e:headed` | Tests E2E con navegador visible |
| `npm run e2e:ui` | Playwright en modo interactivo (UI) |
| `npm run build:android` | Build APK para Android via Capacitor |

### Variables de entorno del frontend

Crear archivo `.env.local` en la raiz del proyecto:

```bash
# Conexion al backend (dejar vacio para modo mock)
VITE_API_URL=http://localhost:8080

# Push notifications (opcional, necesitas generar claves VAPID)
VITE_VAPID_PUBLIC_KEY=

# API key de Gemini (para chatbot IA, opcional)
GEMINI_API_KEY=
```

### Estructura del frontend

```
src/
├── api/                     # Capa de abstraccion API
│   ├── repositories/        # 14 interfaces (auth, wallet, crypto, etc.)
│   ├── adapters/
│   │   ├── mock/            # Implementaciones con localStorage
│   │   └── http/            # Implementaciones con fetch al backend
│   ├── types.ts             # ApiResponse<T>, ApiError
│   └── index.ts             # Factory: detecta mock vs http automaticamente
├── stores/                  # Zustand stores (auth, account, crypto, etc.)
├── types/                   # Tipos TypeScript por dominio
├── views/                   # Pantallas (cada vista es un componente)
│   ├── auth/                # Login, Register, Onboarding
│   ├── HomeView.tsx         # Pantalla principal con balance
│   ├── SinpeView.tsx        # Transferencias SINPE
│   ├── CryptoView.tsx       # Crypto exchange
│   ├── ServicesView.tsx     # Pago de servicios
│   └── ...                  # Marketplace, Cards, Profile, etc.
├── components/              # Componentes reutilizables (BottomSheet, OfflineBanner, etc.)
├── hooks/                   # Hooks personalizados
│   ├── useServiceWorker.ts  # Registro SW, deteccion de actualizaciones
│   ├── usePushNotifications.ts # Permisos y suscripcion push
│   ├── useOfflineQueue.ts   # Cola de acciones offline
│   ├── useCryptoPricesWs.ts # WebSocket para precios crypto en tiempo real
│   ├── useNotificationsWs.ts # WebSocket notificaciones en tiempo real (autenticado)
│   └── useDeepLinks.ts      # Deep linking (kiramopay:// y https://)
├── i18n/                    # Traducciones (es, en, zh-tw, ja, hi)
├── services/                # Servicios (biometrico, crypto simulado, storage)
└── test/                    # Setup de Vitest + tests smoke
```

### Tecnologias del frontend

| Tecnologia | Version | Uso |
|-----------|---------|-----|
| React | 19 | UI framework |
| TypeScript | 5.8 | Tipado estatico |
| Vite | 6 | Bundler y dev server |
| Zustand | 5 | State management |
| Tailwind CSS | 4 | Estilos (local build via `@tailwindcss/vite`) |
| Vitest | 4 | Tests unitarios |
| Playwright | 1.58 | Tests E2E |
| Capacitor | 6 | Bridge nativo Android |

---

## Backend

### Levantar el backend con Docker

```bash
cd backend

# Levantar todos los servicios
docker compose up -d

# Ver logs del API
docker compose logs -f api

# Ver estado de los servicios
docker compose ps

# Detener todo
docker compose down

# Reconstruir despues de cambios en el codigo Go
docker compose up -d --build
```

### Servicios del Docker Compose

| Servicio | Puerto | Descripcion |
|----------|--------|-------------|
| `api` | 8080 | Backend Go (chi router) |
| `postgres` | 5432 | PostgreSQL 16 Alpine |
| `redis` | 6379 | Redis 7 Alpine |

### Endpoints principales

| Endpoint | Metodo | Descripcion | Auth |
|----------|--------|-------------|------|
| `/health` | GET | Estado del sistema (DB, Redis, WS) | No |
| `/metrics` | GET | Metricas Prometheus | No |
| `/ws/prices` | GET | WebSocket precios crypto en tiempo real | No |
| `/ws/notifications` | GET | WebSocket notificaciones por usuario (autenticado post-conexion) | Si |
| `/api/docs` | GET | Swagger UI interactivo | No |
| `/api/docs/openapi.yaml` | GET | Especificacion OpenAPI 3.0 | No |
| `/api/v1/auth/register` | POST | Registrar usuario | No |
| `/api/v1/auth/login` | POST | Login (cedula + contraseña) | No |
| `/api/v1/auth/refresh` | POST | Refrescar token JWT | No |
| `/api/v1/auth/logout` | POST | Cerrar sesion | Si |
| `/api/v1/auth/change-password` | POST | Cambiar contraseña | Si |
| `/api/v1/users/me` | GET | Perfil del usuario | Si |
| `/api/v1/wallets/me` | GET | Wallet del usuario | Si |
| `/api/v1/wallets/me/balance` | GET | Balance (CRC + USD) | Si |
| `/api/v1/transactions` | GET/POST | Listar/crear transacciones | Si |
| `/api/v1/sinpe/send` | POST | Enviar SINPE | Si |
| `/api/v1/sinpe/contacts` | GET/POST | Contactos SINPE | Si |
| `/api/v1/crypto/prices` | GET | Precios crypto actuales | No |
| `/api/v1/crypto/buy` | POST | Comprar crypto | Si |
| `/api/v1/crypto/sell` | POST | Vender crypto | Si |
| `/api/v1/services/pay-bill` | POST | Pagar recibo | Si |
| `/api/v1/services/recharge` | POST | Recarga telefonica | Si |
| `/api/v1/marketplace/partners` | GET | Partners disponibles | Si |
| `/api/v1/loyalty/account` | GET | Cuenta de puntos | Si |
| `/api/v1/qr/pay` | POST | Pagar con QR | Si |
| `/api/v1/splits` | GET/POST | Split payments | Si |
| `/api/v1/cards` | GET/POST | Tarjetas virtuales | Si |
| `/api/v1/fraud/assess` | POST | Evaluar riesgo | Si |
| `/api/v1/country/transfer` | POST | Transferencia cross-border | Si |
| `/api/v1/push/subscribe` | POST | Registrar push subscription | Si |
| `/api/v1/push/unsubscribe` | DELETE | Eliminar push subscription | Si |
| `/api/v1/notifications` | GET | Historial de notificaciones (paginado) | Si |
| `/api/v1/notifications/{id}/read` | PATCH | Marcar notificacion como leida | Si |

Para la lista completa de 80+ endpoints, ver `/api/docs` (Swagger UI) o `backend/docs/openapi.yaml`.

### Autenticacion

El backend usa JWT. Todos los endpoints marcados "Si" requieren el header:

```
Authorization: Bearer <access_token>
```

Flujo de autenticacion:
1. `POST /api/v1/auth/login` con `{ "cedula": "702650930", "password": "Kiramopay2024!" }`
2. Recibir `{ "access_token": "...", "refresh_token": "..." }`
3. Usar `access_token` en el header `Authorization: Bearer ...`
4. Cuando expire (15 min), usar `POST /api/v1/auth/refresh` con `{ "refresh_token": "..." }`

### Migraciones de base de datos

Las migraciones SQL estan en `backend/migrations/` y se aplican automaticamente al iniciar PostgreSQL con Docker (se montan como `docker-entrypoint-initdb.d`).

| Archivo | Contenido |
|---------|-----------|
| `001_initial_schema.sql` | Usuarios, wallets, sesiones |
| `002_transactions.sql` | Transacciones con particionamiento |
| `003_sinpe_tables.sql` | Contactos y historial SINPE |
| `004_crypto_tables.sql` | Assets, staking, alertas de precio |
| `005_marketplace_tables.sql` | Partners, rides, food orders |
| `006_loyalty_tables.sql` | Puntos, cashback, recompensas |
| `007_qr_payment_tables.sql` | Merchants, codigos QR |
| `008_split_payment_tables.sql` | Grupos y shares de split |
| `009_virtual_cards_tables.sql` | Tarjetas virtuales con limites |
| `010_fraud_tables.sql` | Reglas de fraude, evaluaciones |
| `011_multi_country.sql` | Paises, tasas de cambio, wallets regionales |
| `012_audit_log.sql` | Registro de auditoria (acciones criticas) |
| `013_notifications.sql` | Push subscriptions e historial de notificaciones |
| `014_partition_management.sql` | Funcion para crear particiones futuras automaticamente |
| `015_password_migration.sql` | Renombrar pin_hash a password_hash |

Para resetear la base de datos:
```bash
cd backend
docker compose down -v    # Elimina volumenes (borra datos)
docker compose up -d      # Re-crea todo desde cero
```

Ver [backend/README.md](backend/README.md) para documentacion completa del backend.

---

## Despliegue con Kubernetes

### Despliegue rapido con minikube

```bash
# 1. Iniciar minikube (4 CPUs, 4GB RAM)
minikube start --cpus=4 --memory=4096 --driver=docker

# 2. Ejecutar script de despliegue automatico
bash k8s/deploy-minikube.sh
```

El script automaticamente:
- Habilita ingress y metrics-server en minikube
- Construye las imagenes Docker dentro de minikube
- Despliega con Helm en namespace `kiramopay`
- Espera a que todos los pods esten listos

### Acceder a los servicios

Despues del despliegue, agregar a tu archivo hosts:
```
<minikube-ip>  kiramopay.local
```

| URL | Servicio |
|-----|----------|
| http://kiramopay.local | Frontend |
| http://kiramopay.local/api/v1 | API Backend |
| http://kiramopay.local/health | Health check |
| http://kiramopay.local/metrics | Metricas Prometheus |
| http://kiramopay.local/api/docs | Swagger UI |
| http://kiramopay.local/ws/prices | WebSocket crypto |

### Comandos utiles de Kubernetes

```bash
# Ver pods
kubectl get pods -n kiramopay

# Ver logs del API
kubectl logs -f deployment/kiramopay-api -n kiramopay

# Escalar el API
kubectl scale deployment kiramopay-api --replicas=3 -n kiramopay

# Port-forward para acceso directo
kubectl port-forward svc/kiramopay-api 8080:8080 -n kiramopay

# Eliminar todo
helm uninstall kiramopay -n kiramopay
```

Ver [k8s/README.md](k8s/README.md) para la guia completa de Kubernetes.

---

## Monitoreo

### Desplegar Prometheus + Grafana

```bash
# Requiere que el despliegue de K8s ya este activo
bash k8s/monitoring/deploy-monitoring.sh
```

### Acceder a los dashboards

```bash
# Prometheus (metricas raw)
kubectl port-forward svc/prometheus 9090:9090 -n kiramopay
# Abrir: http://localhost:9090

# Grafana (dashboards visuales)
kubectl port-forward svc/grafana 3000:3000 -n kiramopay
# Abrir: http://localhost:3000
# Login: admin / kiramopay
```

### Dashboard pre-configurado

Grafana viene con un dashboard "KiramoPay Dashboard" que muestra:
- Total de requests HTTP
- Errores 5xx
- Uptime del servidor
- Goroutines activos
- Memoria heap (alloc vs sys)
- Ciclos de GC
- Duracion promedio de requests por ruta

### Metricas disponibles

El endpoint `/metrics` expone metricas en formato Prometheus:

```
kiramopay_uptime_seconds          # Tiempo activo del servidor
kiramopay_http_requests_total     # Total de requests HTTP
kiramopay_http_errors_total       # Total de errores 5xx
kiramopay_http_request_count      # Requests por metodo/ruta/status
kiramopay_http_request_duration_ms_avg  # Duracion promedio por ruta
kiramopay_go_goroutines           # Goroutines activos
kiramopay_go_heap_alloc_bytes     # Memoria heap asignada
kiramopay_go_heap_sys_bytes       # Memoria heap del sistema
kiramopay_go_gc_total             # Ciclos de GC
```

---

## Testing

### Tests unitarios del frontend (Vitest)

```bash
# Modo watch (re-ejecuta al cambiar archivos)
npm run test

# Ejecutar una vez
npm run test:run

# Con cobertura
npm run test:coverage

# Ejecutar un test especifico
npx vitest run src/stores/__tests__/auth.store.test.ts
```

Actualmente: **30 archivos de test, 303 tests pasando**.

### Tests E2E del frontend (Playwright)

```bash
# Instalar navegadores (solo la primera vez)
npx playwright install chromium

# Ejecutar tests E2E (inicia dev server automaticamente)
npm run e2e

# Con navegador visible
npm run e2e:headed

# Modo interactivo con UI de Playwright
npm run e2e:ui
```

Los tests E2E cubren:
- Flujo de login completo (cedula + contraseña)
- Navegacion entre tabs
- Vista de home (balance, transacciones)
- Dark mode

### Tests del backend (Go)

```bash
cd backend

# Tests unitarios (no necesitan DB)
make test

# Tests de integracion (necesitan PostgreSQL + Redis corriendo)
# Primero crear la base de datos de test:
make test-db-create

# Luego ejecutar:
make test-integration

# Todos los tests juntos
make test-all

# Con cobertura
make test-coverage
```

Tests de integracion disponibles:
- `auth/` - Registro, login, cambio de contraseña, refresh token
- `wallet/` - Balance, debit, optimistic locking
- `transaction/` - CRUD, paginacion, filtros por tipo
- `sinpe/` - Contactos, envios, balance insuficiente
- `crypto/` - Compra/venta, staking, alertas de precio
- `fraud/` - Evaluacion de riesgo, restriccion de usuarios

---

## CI/CD

El archivo `.github/workflows/ci.yml` define un pipeline completo que se ejecuta en cada push a `main` o `develop` y en cada pull request.

### Jobs del pipeline

| Job | Que hace | Dependencias |
|-----|----------|-------------|
| `frontend-lint` | ESLint en el frontend | - |
| `frontend-test` | Tests unitarios Vitest | - |
| `frontend-build` | Build de produccion | lint + test |
| `frontend-e2e` | Tests Playwright | build |
| `backend-lint` | golangci-lint en Go | - |
| `backend-test-unit` | Tests unitarios Go | - |
| `backend-test-integration` | Tests con PostgreSQL + Redis | unit tests |
| `backend-build` | Compilar binario Go | lint + unit |
| `docker-build` | Construir imagenes Docker | frontend + backend builds |

Los tests de integracion del backend usan servicios de GitHub Actions (PostgreSQL 16 + Redis 7).

---

## PWA y Modo Offline

KiramoPay funciona como Progressive Web App (PWA).

### Instalar como app

En Chrome/Edge, al visitar la app aparecera la opcion "Instalar" en la barra de direcciones. Esto crea un acceso directo que abre la app en modo standalone (sin barra del navegador).

### Funcionalidades offline

| Funcionalidad | Comportamiento offline |
|--------------|----------------------|
| Navegacion | Funciona completamente (SPA cacheada) |
| Ver balance | Muestra ultimo balance cacheado |
| Precios crypto | Muestra ultimos precios cacheados |
| Hacer transacciones | Se encolan y se envian al volver online |
| Notificaciones push | Se reciben si el SW esta activo |

### Banner offline

Cuando se pierde la conexion, aparece un banner amarillo en la parte superior:
- Muestra "Sin conexion"
- Indica cuantas acciones estan pendientes de sincronizar

### Actualizaciones

Cuando hay una nueva version disponible, aparece un banner azul con boton "Actualizar".

### Service Worker

El archivo `public/sw.js` maneja:
- **Cache-first** para assets estaticos (JS, CSS, imagenes)
- **Network-first** para llamadas API (con fallback a cache)
- **Background Sync** para transacciones offline
- **Push notifications** para notificaciones del servidor

---

## Documentacion de API

### Swagger UI

Con el backend corriendo, visitar:
- **Local:** http://localhost:8080/api/docs
- **K8s:** http://kiramopay.local/api/docs

### OpenAPI Spec

El archivo `backend/docs/openapi.yaml` contiene la especificacion completa OpenAPI 3.0 con:
- 80+ endpoints documentados
- Schemas de request/response
- Parametros de autenticacion
- Codigos de error

### WebSocket (Precios Crypto)

Conectar a `ws://localhost:8080/ws/prices` para recibir actualizaciones cada 5 segundos:

```json
{
  "type": "price_update",
  "timestamp": "2026-02-15T12:00:00Z",
  "prices": {
    "BTC": { "symbol": "BTC", "price": 95432.50, "change_24h": 2.3, "volume_24h": 28000000000, "market_cap": 1870000000000 },
    "ETH": { "symbol": "ETH", "price": 3245.80, "change_24h": -0.5, "volume_24h": 15000000000, "market_cap": 390000000000 }
  }
}
```

Simbolos soportados: BTC, ETH, SOL, ADA, DOT, AVAX, LINK, MATIC, UNI, ATOM.

### WebSocket (Notificaciones por Usuario)

Conectar a `ws://localhost:8080/ws/notifications` y autenticar enviando un mensaje:

```json
{"type": "auth", "token": "<jwt_access_token>"}
```

Despues de autenticar, el servidor envia notificaciones en tiempo real:

```json
{
  "type": "notification",
  "notification": {
    "id": "uuid",
    "title": "Transferencia recibida",
    "message": "Recibiste 5,000 CRC de Juan",
    "type": "transaction",
    "date": "2026-02-16",
    "read": false
  }
}
```

En el frontend, el hook `useNotificationsWs` maneja la conexion, autenticacion y despacho al store de notificaciones automaticamente.

---

## Usuarios de Prueba

| Nombre | Cedula | Contraseña | Rol |
|--------|--------|------------|-----|
| Keilor Martinez | `702650930` | `Kiramopay2024!` | Usuario normal |
| Administrador | `700000000` | `Admin2024!` | Administrador |

Balance inicial: 2,500,000 CRC + 500 USD.

---

## Estructura de Archivos

```
kiramopay/
├── src/                          # Codigo fuente del frontend
│   ├── api/                      #   Capa de abstraccion (14 repos, mock + http)
│   ├── stores/                   #   Zustand stores por dominio
│   ├── types/                    #   Tipos TypeScript
│   ├── views/                    #   Pantallas de la app
│   ├── components/               #   Componentes compartidos
│   ├── hooks/                    #   Hooks (SW, push, offline, WS prices, WS notifications, deep links)
│   ├── i18n/                     #   5 idiomas
│   ├── services/                 #   Biometrico, crypto simulado
│   └── test/                     #   Setup de Vitest
│
├── backend/                      # Codigo fuente del backend
│   ├── cmd/api/main.go           #   Entry point
│   ├── internal/                 #   23+ paquetes de dominio
│   │   ├── auth/                 #     Login, JWT, contraseña (Argon2id)
│   │   ├── wallet/               #     Balance, optimistic locking
│   │   ├── transaction/          #     Transacciones, paginacion
│   │   ├── sinpe/                #     SINPE Movil
│   │   ├── crypto/               #     Exchange, staking, alertas
│   │   ├── marketplace/          #     Uber, DiDi, Rappi, etc.
│   │   ├── loyalty/              #     Puntos, cashback, recompensas
│   │   ├── qrpayment/            #     QR merchant y P2P
│   │   ├── splitpay/             #     Dividir cuentas
│   │   ├── cards/                #     Tarjetas virtuales VISA
│   │   ├── fraud/                #     Deteccion de fraude (scoring)
│   │   ├── country/              #     Multi-pais (CR/PA/GT)
│   │   ├── websocket/            #     Precios crypto en tiempo real
│   │   ├── notification/       #     Push notifications (VAPID, web-push)
│   │   ├── audit/              #     Audit logging asincrono
│   │   ├── exchange/           #     Tasas de cambio en vivo
│   │   ├── middleware/           #     Auth, rate limit, logging, metrics
│   │   └── ...                   #     config, database, docs, testutil
│   ├── pkg/                      #   Paquetes compartidos (hash, jwt, validator)
│   ├── docs/openapi.yaml         #   Especificacion OpenAPI
│   ├── migrations/               #   15 archivos SQL
│   ├── docker-compose.yml        #   PostgreSQL + Redis + API
│   ├── Dockerfile                #   Imagen Docker del backend
│   └── Makefile                  #   Comandos de desarrollo
│
├── k8s/                          # Kubernetes
│   ├── base/                     #   Manifests raw (YAML)
│   ├── helm/kiramopay/           #   Helm chart con templates
│   ├── monitoring/               #   Prometheus + Grafana
│   └── deploy-minikube.sh        #   Script de despliegue
│
├── e2e/                          # Tests E2E (Playwright)
│   ├── auth.spec.ts              #   Login flow
│   ├── navigation.spec.ts        #   Navegacion entre tabs
│   └── home.spec.ts              #   Home view, dark mode
│
├── public/                       # Assets PWA
│   ├── sw.js                     #   Service Worker
│   ├── manifest.json             #   PWA manifest
│   └── icons/                    #   Iconos de la app
│
├── .github/workflows/ci.yml     # Pipeline CI/CD
├── Dockerfile                    # Docker imagen frontend (nginx)
├── nginx.conf                    # Config nginx produccion
├── playwright.config.ts          # Config Playwright
├── vitest.config.ts              # Config Vitest
├── eslint.config.js              # Config ESLint
├── .prettierrc                   # Config Prettier
├── .env.example                  # Variables de entorno (template)
└── package.json                  # Dependencias frontend
```

---

## Soporte

Para reportar bugs o sugerir funcionalidades, abrir un issue en el repositorio.
