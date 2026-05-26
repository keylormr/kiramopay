# PLAN DE DESARROLLO KIRAMOPAY — Estado Actual

A super app financiera para Costa Rica (modelo Alipay). El proyecto ha completado 18 fases de desarrollo (0-17) y está listo para integración con servicios externos.

---

## RESUMEN EJECUTIVO

| Métrica | Valor |
|---------|-------|
| Fases completadas | 18 (0-17) |
| Frontend | React 19 + TypeScript + Vite 6 |
| Backend | Go (Golang) + chi router |
| Base de datos | PostgreSQL 16 + Redis 7 |
| Tests frontend | 303 tests en 30 archivos |
| Endpoints API | 80+ documentados (OpenAPI 3.0) |
| Migraciones SQL | 15 archivos |
| Dominios backend | 23+ paquetes |
| Idiomas | 5 (es, en, zh-tw, ja, hi) |
| Infraestructura | Docker Compose + K8s/Helm + CI/CD |
| Monitoreo | Prometheus + Grafana |
| Seguridad | JWT + Argon2id + CSRF + audit logs + account lockout |

---

## FASES COMPLETADAS

### Phase 0 — Reestructuración Frontend
- Migración de Context API a Zustand (8 stores por dominio)
- Patrón repositorio con auto-detección: mock (localStorage) vs HTTP (backend real)
- 14 repositorios de API con interfaces tipadas

### Phase 1-6 — Backend Completo
- **Go backend** con chi router (NO Node.js — cambiado de la propuesta original)
- **PostgreSQL 16** con 15 migraciones SQL (particionamiento, índices, audit)
- **Redis 7** para rate limiting, sesiones, lockout
- **JWT (HS256)** para autenticación, **Argon2id** para hashing de contraseñas
- **WebSocket** para precios crypto en tiempo real y notificaciones por usuario
- **Kubernetes** manifests + Helm chart para minikube
- **Prometheus + Grafana** con dashboard pre-configurado
- **PWA** con Service Worker, cola offline, push notifications
- **CI/CD** con GitHub Actions (lint, test, build, E2E, Docker)
- **Playwright E2E** tests

### Phase 7 — Security Hardening
- Security headers (CSP, X-Frame-Options, HSTS)
- Protección CSRF
- Revocación de sesiones (middleware verifica en cada request)
- Account lockout (5 intentos fallidos → 15 min bloqueo via Redis)
- Audit logging asíncrono (canal bufferizado → tabla audit_logs)
- Body limits (1MB)
- Validación de configuración en producción (JWT secret, DB SSL, Redis password)

### Phase 8 — Performance
- React.lazy() code splitting (todas las vistas excepto LoginView)
- Vite manual chunks (vendor-react, vendor-zustand, vendor-icons, vendor-qr, i18n, mock-adapters, app-stores)
- Tailwind CSS v4 local build (eliminado CDN)
- CI bundle size check

### Phase 9 — Integraciones
- Push notifications (VAPID, web-push, historial)
- Tasas de cambio en vivo (goroutine con intervalo configurable, fallback a cache)
- Crypto circuit breaker (3 fallos → 5 min cooldown, 60s cache TTL)
- WebSocket user targeting (SendToUser para notificaciones por usuario)
- Hook useNotificationsWs

### Phase 10 — Mobile (Android)
- Deep linking (kiramopay:// + https://app.kiramopay.com)
- AndroidManifest intent-filters
- SplashScreen + Capacitor config
- Fastlane para CI/CD mobile
- Biometric enhancement (umbral >= 100,000 CRC)
- App store metadata
- build.gradle signing config

### Phase 11 — Production DB & Infra
- DB SSL (certificados root, client cert/key)
- Backup scripts + CronJob (diario 2 AM, retención 30 días)
- PgBouncer (transaction pool mode)
- Redis security (requirepass, appendonly, maxmemory 256mb)
- Auto-management de particiones (función + CronJob mensual)

### Phase 12 — PIN→Password Migration
- Migración de PIN de 6 dígitos a contraseña segura
- Input type="password" en LoginView y LockScreen
- Migration SQL 015 (pin_hash → password_hash)
- Eliminación completa de mock auth (auth SIEMPRE va al backend real)
- SHA-256 hash para verificación offline en lock screen

### Phase 13 — Lint Cleanup
- 0 errores, 0 warnings en ESLint
- Dead code removal (OnboardingView eliminado, imports no usados)

### Phase 14 — Internacionalización
- 35+ nuevas keys de traducción en 5 idiomas
- Todas las vistas usan t() calls

### Phase 15 — Test Coverage
- De 127 tests en 19 archivos a **303 tests en 30 archivos**
- Todos los Zustand stores con tests completos

### Phase 16 — Accesibilidad
- aria-labels en todos los controles interactivos
- role="dialog" en BottomSheet
- Landmarks de navegación (nav, main)
- aria-live regions para notificaciones dinámicas

### Phase 17 — Polish Final
- 0 lint warnings
- Todos los builds pasan
- Bundle optimizado (chunks < 200KB)

---

## ARQUITECTURA ACTUAL

```
┌─────────────────────────────────────────────────────────────┐
│               Frontend (React 19 + TypeScript)               │
│  Views → Stores (Zustand) → API Layer → Adapters            │
│                                    ├── Mock (localStorage)   │
│                                    └── HTTP (fetch → backend)│
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                Backend (Go + chi router)                      │
│  Middleware → Handler → Service → Repository                 │
│                                      ↓                       │
│                    PostgreSQL 16 + Redis 7                    │
└─────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              Infraestructura                                  │
│  Docker Compose │ K8s + Helm │ Prometheus + Grafana          │
│  PgBouncer │ nginx │ GitHub Actions CI/CD                    │
└─────────────────────────────────────────────────────────────┘
```

### Dominios Backend (23+)

| Dominio | Descripción |
|---------|-------------|
| auth | Login, registro, JWT, cambio de contraseña |
| user | Perfil, KYC, actualización |
| wallet | Balance, optimistic locking, multi-moneda |
| transaction | CRUD, paginación, idempotencia, particionamiento |
| sinpe | SINPE Móvil, límite diario 500K |
| payment | Pago de servicios, recargas telefónicas |
| crypto | Compra/venta, staking, precios CoinGecko |
| marketplace | Partners, rides, food orders |
| loyalty | Puntos, cashback, catálogo de recompensas |
| qrpayment | QR merchant, pagos P2P |
| splitpay | Dividir cuentas (igual/custom/porcentaje) |
| cards | Tarjetas virtuales VISA, límites, números Luhn-valid |
| fraud | Risk scoring, velocity checks, alertas |
| country | Multi-país (CR/PA/GT), tasas de cambio, cross-border |
| websocket | Hub, client, price broadcaster, user notifications |
| notification | Push (VAPID, web-push), historial |
| audit | Logging asíncrono (canal bufferizado) |
| exchange | Tasas de cambio en vivo (goroutine fetcher) |
| middleware | Auth JWT, rate limit, CSRF, security headers, lockout |
| config | Configuración basada en environment |
| database | Pool PostgreSQL, cliente Redis, seeder |
| docs | Swagger UI handler |
| testutil | Helpers para tests de integración |

---

## LO QUE FUNCIONA HOY (sin inversión)

Todo lo siguiente está **completamente construido y funcional**:

- ✅ Autenticación segura (contraseña + JWT + Argon2id + refresh tokens)
- ✅ Autenticación biométrica (Capacitor)
- ✅ Lock screen con verificación offline (SHA-256)
- ✅ Account lockout (5 intentos → 15 min)
- ✅ Wallet multi-moneda (CRC + USD)
- ✅ Transferencias SINPE (simuladas, listas para conectar a BCCR real)
- ✅ Pagos QR (merchant y P2P)
- ✅ Tarjetas virtuales VISA con controles
- ✅ Crypto exchange con precios en tiempo real (WebSocket)
- ✅ Pago de servicios (electricidad, agua, internet)
- ✅ Recargas telefónicas (Kolbi, Claro, Movistar)
- ✅ Marketplace (Uber, DiDi, PedidosYa, Rappi)
- ✅ Programa de lealtad (puntos, cashback, recompensas)
- ✅ Split payments (dividir cuentas)
- ✅ Detección de fraude (risk scoring)
- ✅ Multi-país (CR/PA/GT) con tasas de cambio
- ✅ Push notifications (VAPID)
- ✅ PWA con modo offline
- ✅ 5 idiomas (es, en, zh-tw, ja, hi)
- ✅ Dark mode
- ✅ Deep linking (Android)
- ✅ Docker Compose one-command startup
- ✅ Kubernetes deployment
- ✅ Monitoreo (Prometheus + Grafana)
- ✅ CI/CD completo
- ✅ 303 tests automatizados

---

## ROADMAP — Pendiente de Inversión

Las siguientes funcionalidades requieren contratos, licencias, o APIs de pago:

### Prioridad Alta (necesario para lanzamiento)

| Feature | Dependencia | Costo Estimado |
|---------|-------------|----------------|
| SINPE Móvil real | Convenio BCCR | Proceso institucional |
| Validación cédula TSE | API TSE | Por convenio |
| OTP por SMS (Twilio/similar) | Cuenta Twilio | ~$500/mes (10K usuarios) |
| SSL certificates | Let's Encrypt o CA comercial | $0-100/año |
| Google Play Store | Cuenta desarrollador | $25 una vez |
| Apple App Store | Apple Developer Program | $99/año |
| Hosting producción | DigitalOcean/AWS/GCP | ~$100-300/mes |
| Registro SUGEF | Asesoría legal + trámites | Variable |
| Registro PRODHAB | Protección de datos personales | Variable |

### Prioridad Media

| Feature | Dependencia | Costo Estimado |
|---------|-------------|----------------|
| CoinGecko Pro API | API key de pago | $129/mes |
| Precios crypto reales | CoinGecko o CoinMarketCap Pro | $129-300/mes |
| iOS build (Xcode) | Mac + Apple Developer | $99/año + hardware |
| Analytics (Mixpanel/Amplitude) | Cuenta analytics | $0-500/mes |
| CDN (CloudFlare) | Cuenta CloudFlare | $0-20/mes |
| Error tracking (Sentry) | Cuenta Sentry | $0-26/mes |

### Prioridad Baja (expansión futura)

| Feature | Descripción |
|---------|-------------|
| NFC payments | Requiere hardware NFC + certificación EMV |
| Microcréditos | Requiere licencia SUGEF |
| Seguros | Convenios con INS, Lafise, ASSA |
| Inversiones | Integración con SAFIs costarricenses |
| Remesas internacionales | Licencia de remesas + partner bancario |
| Open Banking | Pendiente de regulación en Costa Rica |
| Payroll / Planilla | Integración con CCSS y sistemas de nómina |
| AI Chatbot (Gemini) | API key Gemini | ~$50-200/mes según volumen |

### Requisitos Legales Costa Rica

1. **SUGEF** — Superintendencia General de Entidades Financieras
   - Requerido para: Wallet con saldo, créditos
   - Alternativa: Alianza con banco autorizado

2. **BCCR** — Banco Central de Costa Rica
   - Requerido para: Conexión SINPE real
   - Proceso: Convenio institucional

3. **PRODHAB** — Protección de Datos
   - Ley 8968 — Registro obligatorio

4. **Ley 8204** — Prevención de Lavado
   - KYC/AML obligatorio
   - Reportes a SUGEF

---

## CÓMO EJECUTAR EL PROYECTO

### Opción 1: Todo con Docker (recomendado)

```bash
# Windows
start.bat

# Linux/Mac
bash start.sh
```

Esto levanta PostgreSQL + Redis + API Go + Frontend nginx, todo en un solo comando.
Acceder a: http://localhost:9999

### Opción 2: Solo Frontend (modo mock)

```bash
npm install
npm run dev
```

Acceder a: http://localhost:9999
Nota: Auth no funciona en modo mock (requiere backend).

### Opción 3: Backend por separado

```bash
cd backend
docker compose up -d
cd ..
cp .env.example .env.local
npm run dev
```

### Usuarios de prueba

| Nombre | Cédula | Contraseña |
|--------|--------|------------|
| Keilor Martinez | 702650930 | Kiramopay2024! |
| Administrador | 700000000 | Admin2024! |

---

## ESTIMACIÓN DE INVERSIÓN PARA LANZAMIENTO

### Costos mínimos para MVP en producción

| Concepto | Costo mensual | Costo inicial |
|----------|--------------|---------------|
| Hosting (DigitalOcean) | $100-200 | — |
| SMS/OTP (Twilio) | $200-500 | — |
| SSL | $0 (Let's Encrypt) | — |
| Google Play | — | $25 |
| Apple Developer | $8.25/mes | $99/año |
| CoinGecko Pro | $129 | — |
| **Total mensual** | **~$440-840** | **~$125** |

### Costos regulatorios (estimados)

| Concepto | Costo |
|----------|-------|
| Asesoría legal SUGEF | $3,000-10,000 |
| Registro PRODHAB | $100-500 |
| Auditoría de seguridad | $2,000-5,000 |
| Convenio BCCR (SINPE) | Por definir |

---

*Documento actualizado: 2026-02-17*
*Todas las 18 fases de desarrollo completadas.*
