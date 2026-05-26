# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KiramoPay is a fintech super app for Costa Rica (similar to Alipay). It has a React frontend packaged for Android via Capacitor and a Go (Golang) backend with PostgreSQL and Redis. The frontend uses a repository pattern with auto-detection: mock adapters (localStorage) for development without backend, HTTP adapters for production. The app is PWA-enabled with offline support.

## Development Commands

### Frontend
```bash
npm run dev            # Start dev server on port 9999
npm run build          # Production build (output: dist/)
npm run test           # Run Vitest tests in watch mode
npm run test:run       # Run all tests once
npm run test:coverage  # Run tests with coverage report
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
npm run format         # Prettier format
npm run e2e            # Playwright E2E tests
npm run e2e:headed     # E2E tests with browser visible
npm run e2e:ui         # Playwright interactive UI
npm run preview        # Preview production build on port 9999
npm run build:android  # Build Android APK
```

### Backend
```bash
cd backend
make docker-up             # Start PostgreSQL + Redis + API via Docker Compose
make docker-down           # Stop all containers
make build                 # Build Go binary
make run                   # Run locally (requires Go + PostgreSQL + Redis)
make test                  # Run unit tests (no DB needed)
make test-integration      # Run integration tests (needs PostgreSQL + Redis)
make test-all              # Run all tests
make test-coverage         # Tests with coverage report
make test-db-create        # Create test database in Docker
```

### Kubernetes (Local)
```bash
bash k8s/deploy-minikube.sh                   # Full deploy to minikube
bash k8s/monitoring/deploy-monitoring.sh       # Deploy Prometheus + Grafana
kubectl port-forward svc/grafana 3000:3000 -n kiramopay   # Access Grafana
kubectl port-forward svc/prometheus 9090:9090 -n kiramopay # Access Prometheus
```

## Tech Stack

### Frontend
- **React 19** with TypeScript (strict mode), **Vite 6**, **Vitest** for testing
- **Zustand** for state management (stores per domain)
- **Tailwind CSS v4** local build (via `@tailwindcss/vite` plugin, no CDN)
- **Capacitor 6** for Android native bridge
- **Playwright** for E2E tests
- **PWA** with Service Worker, offline queue, push notifications
- Path alias: `@/` maps to `./src/`

### Backend
- **Go (Golang)** with **chi router**, **gorilla/websocket**
- **PostgreSQL 16** with 14 migration files (incl. audit_logs, notifications, partitions)
- **Redis 7** for rate limiting, session caching, and lockout (password-protected)
- **JWT (HS256)** for auth, **Argon2id** for password hashing
- **Docker Compose** for local development
- **slog** structured JSON logging
- Prometheus-compatible `/metrics` endpoint

### Infrastructure
- **Kubernetes** manifests + **Helm** chart for local minikube
- **Prometheus** + **Grafana** monitoring with pre-built dashboard
- **GitHub Actions** CI/CD (lint, test, build, E2E, Docker)
- **nginx** for frontend serving and API proxy (with security headers)
- **PgBouncer** for connection pooling in Kubernetes

## Architecture

### Frontend Structure (`src/`)
```
src/
├── api/                    # Repository pattern API layer
│   ├── repositories/       # Interface definitions (14 repos)
│   ├── adapters/
│   │   ├── mock/           # localStorage-based mock implementations
│   │   └── http/           # Real backend HTTP implementations
│   ├── types.ts            # ApiResponse<T>, ApiError
│   └── index.ts            # ApiLayer interface + factory
├── stores/                 # Zustand stores by domain
├── types/                  # TypeScript types split by domain
├── views/                  # Screen components by domain
├── components/             # Shared UI components (incl. OfflineBanner)
├── hooks/                  # Custom hooks (SW, push, offline queue, WS prices, WS notifications)
├── context/                # Legacy AppContext (being migrated to Zustand)
├── i18n/                   # 5-language translations
├── services/               # Biometric, crypto prices, storage
└── test/                   # Test setup + smoke tests
```

### Backend Structure (`backend/`)
```
backend/
├── cmd/api/main.go         # Entry point, wires all services + routes
├── internal/
│   ├── auth/               # Login, register, JWT, PIN hashing
│   ├── user/               # User profile, KYC
│   ├── wallet/             # Balance, optimistic locking
│   ├── transaction/        # Transactions, pagination, idempotency
│   ├── sinpe/              # SINPE Móvil, 500K daily limit
│   ├── payment/            # Bill payments, recharges
│   ├── crypto/             # Crypto buy/sell, staking, CoinGecko prices
│   ├── marketplace/        # Partner connections, rides, food orders
│   ├── loyalty/            # Points, cashback, rewards catalog, redemptions
│   ├── qrpayment/          # Merchant QR, P2P QR payments
│   ├── splitpay/           # Split bills (equal/custom/percentage)
│   ├── cards/              # Virtual cards, limits, Luhn-valid numbers
│   ├── fraud/              # Risk scoring, velocity checks, alerts
│   ├── country/            # Multi-country (CR/PA/GT), exchange rates, cross-border
│   ├── websocket/          # WebSocket hub, client, price broadcaster
│   ├── docs/               # Swagger UI handler
│   ├── config/             # Environment-based configuration
│   ├── database/           # PostgreSQL pool, Redis client, seeder
│   ├── notification/       # Push notifications (VAPID, web-push, history)
│   ├── audit/              # Async audit logging (buffered channel)
│   ├── exchange/           # Live exchange rates (goroutine fetcher)
│   ├── middleware/          # Auth JWT, rate limiting, CSRF, security headers, lockout
│   └── testutil/           # Integration test helpers
├── pkg/
│   ├── hash/               # Argon2id hashing
│   ├── jwt/                # JWT token management
│   ├── response/           # Standardized API response format
│   └── validator/          # Input validation
├── docs/openapi.yaml       # OpenAPI 3.0 spec (80+ endpoints)
├── migrations/             # 001-014 SQL migrations
└── docker-compose.yml      # PostgreSQL + Redis + API
```

Each backend domain follows Repository → Service → Handler pattern. Amounts are stored as BIGINT centimos in the DB; HTTP adapters convert to/from decimal.

### Key Endpoints
- `GET /health` — Detailed health check (DB, Redis, WS clients)
- `GET /metrics` — Prometheus-compatible metrics
- `GET /ws/prices` — WebSocket real-time crypto price feed
- `GET /ws/notifications` — WebSocket per-user notifications (auth via token message)
- `GET /api/docs` — Swagger UI
- `GET /api/docs/openapi.yaml` — OpenAPI spec
- `POST /api/v1/push/subscribe` — Register push notification subscription
- `GET /api/v1/notifications` — List notification history (paginated)

### Navigation
`App.tsx` renders views based on `activeTab` string state. Auth flow: `LoginView` → `LockScreen` → `Layout`.

### Internationalization
`src/i18n/LanguageContext.tsx` provides `t(key)` — five languages: es (default), en, zh-tw, ja, hi.

## Environment Variables

### Frontend (`.env.local`, from `.env.example`)
- `VITE_API_URL` — Backend URL (default `http://localhost:8080`). **Auth always goes through the backend** (real DB). Unset = mock mode for non-auth repos only (accounts, transactions, etc. use localStorage)
- `VITE_VAPID_PUBLIC_KEY` — VAPID public key for push notifications (optional)
- `GEMINI_API_KEY` — Google Gemini API key for AI features (optional, exposed as `process.env.GEMINI_API_KEY`)

### Backend (`backend/.env`, from `backend/.env.example`)
- DB: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL_MODE`, `DB_MAX_CONNS`
- DB SSL (production): `DB_SSL_ROOT_CERT`, `DB_SSL_CERT`, `DB_SSL_KEY`
- Redis: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`
- JWT: `JWT_SECRET`, `JWT_ACCESS_MINUTES`, `JWT_REFRESH_DAYS`
- Server: `ENVIRONMENT`, `SERVER_PORT`, `SERVER_READ_TIMEOUT`, `SERVER_WRITE_TIMEOUT`
- CORS: `CORS_ORIGINS` (comma-separated)
- Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- Rates: `EXCHANGE_RATE_API_KEY`, `EXCHANGE_RATE_INTERVAL`, `COINGECKO_API_KEY`

## Key Conventions

- Currency amounts: CRC (primary), USD, PAB, GTQ — stored as BIGINT centimos in backend
- Spanish is default language; use `useLanguage().t('key')` for user-facing strings
- Dark mode: class-based, toggled via settings store
- Icons: Lucide React via `components/Icons.tsx`
- Backend responses: `{ success: bool, data?: T, error?: { code, message } }`
- New domains: follow Repository → Service → Handler pattern (see `CONTRIBUTING.md`)
- Frontend API calls: always through `getApiLayer()`, never raw `fetch()`
- Backend logging: always `slog`, never `fmt.Println` or `log.Printf`
- Security: audit log all sensitive operations (login, transfer, password change, card creation)
- Auth: ALWAYS goes through real backend (HttpAuthRepository), never mocked. No mock auth adapter exists.
- Session revocation: middleware checks `IsSessionRevoked` on every authenticated request
- Account lockout: 5 failed login attempts → 15 min lockout (Redis key `lockout:{cedula}`)
- Production config: validated on startup — JWT secret, DB SSL, Redis password required
- New views: must use `React.lazy()` for code splitting (only LoginView is eager-loaded)
- Tailwind: local build via `@tailwindcss/vite`, custom theme in `src/index.css` using `@theme`
- Deep linking: `kiramopay://` scheme + `https://app.kiramopay.com` universal links
- Biometric threshold: transactions >= 100,000 CRC require biometric auth
- WebSocket: authenticated channel via `SendToUser()` for per-user notifications
- Exchange rates: live via goroutine with configurable interval, fallback to cached
- Crypto prices: circuit breaker (3 failures → 5 min cooldown), 60s cache TTL
- DB backups: daily at 2 AM via CronJob, 30-day retention
- PgBouncer: transaction pool mode, route `DB_HOST` through pgbouncer service in K8s

## Test Users

| Name | Cédula | Password |
|------|--------|----------|
| Keilor Martinez | 702650930 | Kiramopay2024! |
| Administrador | 700000000 | Admin2024! |
