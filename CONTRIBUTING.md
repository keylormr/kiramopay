# Contribuir a KiramoPay

Guia para contribuir al proyecto. Sigue estas convenciones para mantener el codigo consistente y la colaboracion fluida.

## Contratos API (importante)

El frontend tiene una **sola fuente de verdad** para los shapes de respuesta del backend:
`backend/docs/openapi.yaml`. A partir de ese archivo se genera `src/api/generated/openapi.d.ts`
con tipos TypeScript que los adapters HTTP deben usar.

Cuando cambies un handler del backend (campo nuevo, rename, tipo nuevo):

1. Actualiza `backend/docs/openapi.yaml` con el nuevo shape.
2. Corre `npm run gen:api` — regenera los tipos. `prebuild` lo corre automaticamente.
3. `npx tsc --noEmit` — el compilador te muestra cada adapter que necesita actualizarse.
4. (Opcional) `npm run check:contracts` — script bash que pega contra los endpoints
   reales y muestra el shape vivo. Util para diagnosticar "no me aparecen datos".

Patron en un adapter (referencia: `src/api/adapters/http/account.http.ts`):

```ts
import type { ApiData } from '../../generated/helpers';

type BalancePayload = ApiData<'/api/v1/wallets/me/balance', 'get'>;

const res = await this.client.get<BalancePayload>('/api/v1/wallets/me/balance');
```

Si despues el backend renombra `crc` a `balance_crc`, la linea de tipo sigue siendo
correcta y el `res.data.crc` deja de compilar — el bug se descubre en `npm run build`,
no en produccion.

## Configuracion Inicial

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd kiramopay

# 2. Instalar dependencias frontend
npm install

# 3. Copiar variables de entorno
cp .env.example .env.local

# 4. Verificar que todo funciona
npm run dev          # Frontend en http://localhost:9999
npm run test:run     # 88+ tests pasan
npm run lint         # Sin errores
```

Para el backend:
```bash
cd backend
cp .env.example .env
make docker-up       # PostgreSQL + Redis + API
curl http://localhost:8080/health
```

## Estructura de Branches

| Branch | Proposito |
|--------|-----------|
| `main` | Produccion — siempre estable |
| `develop` | Integracion — base para features |
| `feature/<nombre>` | Nueva funcionalidad |
| `fix/<nombre>` | Correccion de bug |
| `refactor/<nombre>` | Mejora de codigo sin cambio funcional |
| `docs/<nombre>` | Solo documentacion |

**Ejemplo:** `feature/sinpe-real-integration`, `fix/wallet-balance-race-condition`

## Commits

Usar [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<alcance>): <descripcion corta>

[cuerpo opcional]
```

### Tipos

| Tipo | Cuando usar |
|------|-------------|
| `feat` | Nueva funcionalidad |
| `fix` | Correccion de bug |
| `refactor` | Reestructuracion sin cambio funcional |
| `test` | Agregar o modificar tests |
| `docs` | Solo documentacion |
| `style` | Formato (no afecta logica) |
| `perf` | Mejora de rendimiento |
| `ci` | Cambios en CI/CD |
| `chore` | Tareas de mantenimiento |

### Alcances comunes

`auth`, `wallet`, `sinpe`, `crypto`, `cards`, `fraud`, `loyalty`, `marketplace`, `qr`, `split`, `country`, `api`, `ui`, `pwa`, `k8s`, `ci`

### Ejemplos

```
feat(sinpe): agregar validacion de limite diario
fix(wallet): corregir race condition en optimistic locking
test(crypto): agregar tests de integracion para staking
docs(k8s): actualizar guia de troubleshooting
refactor(api): extraer mock adapters a archivos separados
```

## Pull Requests

### Antes de crear un PR

1. **Tests pasan:**
   ```bash
   npm run test:run         # Frontend unit tests
   npm run lint             # Linting
   npm run build            # Build de produccion
   ```

2. **Si tocaste el backend:**
   ```bash
   cd backend
   make test                # Unit tests
   make test-integration    # Integration tests (necesita Docker)
   make lint                # Go linting
   ```

3. **Si tocaste E2E flows:**
   ```bash
   npm run e2e              # Playwright E2E tests
   ```

### Formato del PR

```markdown
## Que hace este PR

Descripcion breve de los cambios.

## Como probarlo

1. Paso 1
2. Paso 2
3. Resultado esperado

## Checklist

- [ ] Tests unitarios agregados/actualizados
- [ ] Tests de integracion si aplica
- [ ] Linting pasa sin errores
- [ ] Build de produccion funciona
- [ ] Documentacion actualizada si es necesario
```

## Convenciones de Codigo

### Frontend (TypeScript/React)

- **Framework:** React 19 con hooks, TypeScript strict mode
- **State:** Zustand stores por dominio (no Context para estado nuevo)
- **Estilos:** Tailwind CSS clases utilitarias
- **Idioma:** Todos los textos visibles al usuario via `useLanguage().t('key')` — nunca hardcodear strings
- **Iconos:** Importar de `@/components/Icons.tsx` (re-exports de Lucide)
- **API:** Usar el repository pattern via `getApiLayer()` de `@/api`
- **Tipos:** Definir en `src/types/<dominio>.types.ts`, re-exportar en `src/types/index.ts`

```typescript
// Correcto: usar el API layer
import { getApiLayer } from '@/api';
const api = getApiLayer();
const result = await api.sinpe.send(request);

// Incorrecto: fetch directo
const res = await fetch('/api/v1/sinpe/send', { ... });
```

```typescript
// Correcto: texto traducido
const { t } = useLanguage();
return <h1>{t('welcome')}</h1>;

// Incorrecto: texto hardcodeado
return <h1>Bienvenido</h1>;
```

### Backend (Go)

- **Patron:** Repository → Service → Handler por cada dominio
- **Router:** chi (`github.com/go-chi/chi/v5`)
- **DB:** pgx pool con SQL directo (no ORM)
- **Montos:** BIGINT en centimos (250000000 = 2,500,000 CRC)
- **IDs:** UUID v4 como strings
- **Errores:** Usar `response.Error()` y `response.JSON()` del paquete `pkg/response`
- **Logging:** `slog` con JSON handler, no `fmt.Println` ni `log.Printf`
- **Tests:** Tag `//go:build integration` para tests que necesitan DB

```go
// Correcto: logging estructurado
slog.Info("transaction created",
    "user_id", userID,
    "amount", amount,
    "currency", currency,
)

// Incorrecto
fmt.Printf("Transaction created for user %s\n", userID)
```

### Lazy Loading de Vistas

**Todas las vistas nuevas deben usar lazy loading.** En `src/App.tsx`, importar con `React.lazy()`:

```typescript
// Correcto: lazy import
const MiVistaView = React.lazy(() =>
  import('./views/mivista/MiVistaView').then(m => ({ default: m.MiVistaView }))
);

// Incorrecto: import estatico (solo permitido para LoginView)
import { MiVistaView } from './views/mivista/MiVistaView';
```

Las vistas lazy se renderizan dentro de `<Suspense fallback={<LoadingSkeleton />}>` automaticamente.

### Archivos nuevos

Al agregar un nuevo dominio de negocio:

**Frontend:**
```
src/types/<dominio>.types.ts          # Tipos
src/api/repositories/<dominio>.repository.ts  # Interface
src/api/adapters/mock/<dominio>.mock.ts       # Mock adapter
src/api/adapters/http/<dominio>.http.ts       # HTTP adapter
src/stores/<dominio>.store.ts                 # Zustand store
src/views/<dominio>/                          # Views (lazy loaded)
src/api/repositories/__tests__/<dominio>.repository.test.ts  # Tests
```

**Backend:**
```
backend/internal/<dominio>/model.go       # Structs y tipos
backend/internal/<dominio>/repository.go  # Acceso a DB
backend/internal/<dominio>/service.go     # Logica de negocio
backend/internal/<dominio>/handler.go     # HTTP handlers
backend/internal/<dominio>/<dominio>_integration_test.go  # Tests
backend/migrations/0XX_<dominio>.sql      # Migracion SQL
```

## Testing

### Enfoque TDD

1. Escribir el test primero (que falle)
2. Implementar la funcionalidad minima para que pase
3. Refactorizar manteniendo los tests verdes

### Frontend

```bash
npm run test              # Watch mode (desarrollo)
npm run test:run          # Una vez (CI)
npm run test:coverage     # Con reporte de cobertura

# Test especifico
npx vitest run src/stores/__tests__/auth.store.test.ts
```

Ubicacion de tests:
- Unit tests: `src/**/__tests__/*.test.ts(x)`
- E2E tests: `e2e/*.spec.ts`
- Test setup: `src/test/setup.ts`

### Backend

```bash
cd backend
make test                 # Unit tests (pkg/)
make test-integration     # Integration tests (internal/)
make test-coverage        # Con cobertura HTML

# Test especifico
go test -v ./internal/auth/ -tags integration -run TestRegister
```

### E2E (Playwright)

```bash
npm run e2e               # Headless (CI)
npm run e2e:headed        # Con browser visible (debug)
npm run e2e:ui            # UI interactivo de Playwright
```

## Variables de Entorno

### Frontend (`.env.local`)

Ver `.env.example` para la lista completa. Variables clave:

| Variable | Efecto |
|----------|--------|
| `VITE_API_URL` | Sin definir = modo mock; definida = modo HTTP real |
| `VITE_VAPID_PUBLIC_KEY` | Habilita push notifications |
| `GEMINI_API_KEY` | Habilita AI assistant |

### Backend (`.env`)

Ver `backend/.env.example` para la lista completa.

## CI/CD

El pipeline de GitHub Actions (`.github/workflows/ci.yml`) ejecuta automaticamente:

1. **Frontend:** lint → test → build → E2E (Playwright)
2. **Backend:** lint → unit tests → integration tests (con PostgreSQL + Redis) → build
3. **Docker:** build de imagen

Todos los checks deben pasar antes de merge a `develop` o `main`.

## Kubernetes (Desarrollo Local)

Para probar despliegues:

```bash
# Despliegue completo con un comando
bash k8s/deploy-minikube.sh

# Monitoreo
bash k8s/monitoring/deploy-monitoring.sh

# Limpieza
helm uninstall kiramopay -n kiramopay
minikube stop
```

Ver `k8s/README.md` para la guia completa.
