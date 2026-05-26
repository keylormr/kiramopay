# KiramoPay — Despliegue en Kubernetes

Guia para desplegar KiramoPay en un cluster local de Kubernetes usando minikube.

## Requisitos

| Herramienta | Version minima | Instalacion |
|-------------|---------------|-------------|
| Docker Desktop | 4.x | https://www.docker.com/products/docker-desktop/ |
| minikube | 1.32+ | https://minikube.sigs.k8s.io/docs/start/ |
| kubectl | 1.28+ | https://kubernetes.io/docs/tasks/tools/ |
| Helm | 3.x | https://helm.sh/docs/intro/install/ |

## Despliegue Rapido (Un Solo Comando)

```bash
bash k8s/deploy-minikube.sh
```

Este script hace todo automaticamente:
1. Inicia minikube con 4 CPUs y 4GB RAM
2. Habilita addons: ingress y metrics-server
3. Apunta Docker al daemon de minikube
4. Construye imagenes del backend y frontend
5. Despliega con Helm en namespace `kiramopay`
6. Espera a que los pods esten ready

## Despliegue Manual (Paso a Paso)

### 1. Iniciar minikube

```bash
minikube start --cpus=4 --memory=4096 --driver=docker
minikube addons enable ingress
minikube addons enable metrics-server
```

### 2. Construir imagenes Docker

```bash
# Apuntar Docker al daemon de minikube
eval $(minikube docker-env)

# Construir imagenes
docker build -t kiramopay-api:latest ./backend
docker build -t kiramopay-web:latest .
```

### 3. Desplegar con Helm

```bash
helm upgrade --install kiramopay k8s/helm/kiramopay \
    --namespace kiramopay \
    --create-namespace \
    --wait \
    --timeout 120s
```

### 4. Configurar acceso

```bash
# Obtener IP de minikube
minikube ip

# Agregar a /etc/hosts (Linux/Mac) o C:\Windows\System32\drivers\etc\hosts (Windows)
# Ejemplo:
# 192.168.49.2  kiramopay.local
```

## Acceder a los Servicios

| Servicio | URL | Descripcion |
|----------|-----|-------------|
| Frontend | http://kiramopay.local | App web React |
| API | http://kiramopay.local/api/v1 | API REST |
| Health | http://kiramopay.local/health | Estado del sistema |
| Metrics | http://kiramopay.local/metrics | Metricas Prometheus |
| Swagger | http://kiramopay.local/api/docs | Documentacion API |
| WebSocket | ws://kiramopay.local/ws/prices | Precios crypto |

### Alternativa: Port-Forward

Si no quieres modificar el archivo hosts:

```bash
# API directa
kubectl port-forward svc/kiramopay-api 8080:8080 -n kiramopay
# Acceder: http://localhost:8080

# Frontend directo
kubectl port-forward svc/kiramopay-web 9999:80 -n kiramopay
# Acceder: http://localhost:9999
```

## Arquitectura del Cluster

```
┌─────────────────────────────── Namespace: kiramopay ──────────────────────────┐
│                                                                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │  kiramopay   │    │  kiramopay   │    │   postgres   │    │    redis     │ │
│  │    -web      │    │    -api      │    │   (1 pod)    │    │   (1 pod)    │ │
│  │  (2 pods)    │    │  (2 pods)    │    │              │    │              │ │
│  │  nginx:80    │    │  go:8080     │    │  pg:5432     │    │  redis:6379  │ │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘    └──────────────┘ │
│         │                   │                                                  │
│  ┌──────┴───────────────────┴───────────────────┐                             │
│  │              Ingress (nginx)                   │                             │
│  │  /         → kiramopay-web:80                  │                             │
│  │  /api/*    → kiramopay-api:8080                │                             │
│  │  /ws/*     → kiramopay-api:8080 (WebSocket)    │                             │
│  │  /health   → kiramopay-api:8080                │                             │
│  │  /metrics  → kiramopay-api:8080                │                             │
│  └────────────────────────────────────────────────┘                             │
│                                                                                │
│  Monitoring (opcional):                                                         │
│  ┌──────────────┐    ┌──────────────┐                                          │
│  │  prometheus   │    │   grafana    │                                          │
│  │   :9090      │    │   :3000      │                                          │
│  └──────────────┘    └──────────────┘                                          │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Componentes Desplegados

| Componente | Replicas | Imagen | Recursos |
|-----------|----------|--------|----------|
| API | 2 (auto-scale hasta 5) | kiramopay-api:latest | 100m-500m CPU, 128-256Mi RAM |
| Web | 2 | kiramopay-web:latest | 50m-200m CPU, 64-128Mi RAM |
| PostgreSQL | 1 | postgres:16-alpine | 250m-500m CPU, 256-512Mi RAM |
| PgBouncer | 1 | edoburu/pgbouncer:1.22.0 | 50m-200m CPU, 64-128Mi RAM |
| Redis | 1 | redis:7-alpine | 100m-250m CPU, 64-256Mi RAM |

### Auto-scaling

El API tiene un HorizontalPodAutoscaler configurado:
- Minimo: 2 replicas
- Maximo: 5 replicas
- Target: 70% CPU utilization

## Monitoreo con Prometheus + Grafana

### Desplegar

```bash
bash k8s/monitoring/deploy-monitoring.sh
```

### Acceder

```bash
# Prometheus
kubectl port-forward svc/prometheus 9090:9090 -n kiramopay
# Abrir: http://localhost:9090

# Grafana
kubectl port-forward svc/grafana 3000:3000 -n kiramopay
# Abrir: http://localhost:3000
# Login: admin / kiramopay
```

### Dashboard incluido

Grafana viene con el dashboard "KiramoPay Dashboard" pre-configurado:

| Panel | Tipo | Que muestra |
|-------|------|------------|
| Total HTTP Requests | Stat | Contador total de requests |
| HTTP Errors (5xx) | Stat | Errores del servidor |
| Uptime | Stat | Tiempo activo |
| Goroutines | Stat | Goroutines activos |
| Go Heap Memory | Time series | Memoria heap (alloc vs sys) |
| Goroutines | Time series | Goroutines en el tiempo |
| GC Cycles | Time series | Ciclos de garbage collection |
| Request Duration | Table | Duracion promedio por ruta |

## Helm Chart

### Estructura

```
k8s/helm/kiramopay/
├── Chart.yaml             # Metadata del chart
├── values.yaml            # Valores por defecto
└── templates/
    ├── api.yaml           # Deployment + Service del API
    ├── web.yaml           # Deployment + Service del frontend
    ├── postgres.yaml      # Deployment + Service + PVC de PostgreSQL
    ├── redis.yaml         # Deployment + Service de Redis
    ├── secrets.yaml       # Secretos (DB password, JWT secret)
    └── ingress.yaml       # Ingress con reglas de ruteo
```

### Personalizar valores

```bash
# Ejemplo: cambiar replicas del API y el host del ingress
helm upgrade --install kiramopay k8s/helm/kiramopay \
    --namespace kiramopay \
    --set api.replicaCount=3 \
    --set ingress.host=mi-app.local \
    --set secrets.jwtSecret=mi-secreto-super-seguro
```

### Valores configurables

| Valor | Default | Descripcion |
|-------|---------|-------------|
| `api.replicaCount` | 2 | Replicas del API |
| `api.image.repository` | kiramopay-api | Imagen Docker del API |
| `api.image.tag` | latest | Tag de la imagen |
| `web.replicaCount` | 2 | Replicas del frontend |
| `postgres.enabled` | true | Desplegar PostgreSQL (false para usar externo) |
| `postgres.storage` | 5Gi | Almacenamiento para PostgreSQL |
| `postgres.auth.password` | kiramopay_dev | Password de PostgreSQL |
| `redis.enabled` | true | Desplegar Redis |
| `redis.maxmemory` | 128mb | Memoria maxima de Redis |
| `ingress.enabled` | true | Crear Ingress |
| `ingress.host` | kiramopay.local | Hostname del Ingress |
| `secrets.jwtSecret` | dev-secret-... | Secreto JWT |
| `monitoring.enabled` | true | Habilitar anotaciones Prometheus |

## PgBouncer (Connection Pooling)

El API se conecta a PostgreSQL a traves de PgBouncer para connection pooling:

- **Pool mode:** transaction (libera conexion al terminar cada transaccion SQL)
- **Default pool size:** 20 conexiones
- **Max client connections:** 200
- **Max DB connections:** 50

El ConfigMap ya apunta `DB_HOST` a `pgbouncer` (no a `postgres` directo). Esto permite que multiples pods del API compartan un pool de conexiones.

```
API Pod 1 ─┐
API Pod 2 ─┤── PgBouncer (pool) ── PostgreSQL
API Pod 3 ─┘
```

Manifest: `k8s/base/pgbouncer.yaml`

## Backups

CronJob diario a las 2 AM que ejecuta `pg_dump` comprimido:

```bash
# Verificar que el CronJob existe
kubectl get cronjob -n kiramopay

# Ver ultimos jobs ejecutados
kubectl get jobs -n kiramopay -l app=kiramopay-backup

# Ver logs del ultimo backup
kubectl logs job/<job-name> -n kiramopay
```

Configuracion en Helm `values.yaml`:
```yaml
backup:
  enabled: true
  schedule: "0 2 * * *"
  retentionDays: 30
```

Manifest: `k8s/base/backup-cronjob.yaml`

## Particiones de Transacciones

La tabla `transactions` usa particionamiento por mes. Un CronJob mensual (dia 1 a medianoche) ejecuta `create_future_partitions()` para crear particiones 6 meses adelante:

```bash
# Verificar CronJob de particiones
kubectl get cronjob kiramopay-partition-mgmt -n kiramopay

# Ejecutar manualmente
kubectl create job --from=cronjob/kiramopay-partition-mgmt manual-partition -n kiramopay
```

Manifest: `k8s/base/partition-cronjob.yaml`

## Redis Security

Redis esta configurado con:
- **Password:** desde Secret `kiramopay-secrets`
- **Append-only:** habilitado (persistencia)
- **Max memory:** 256MB con politica `allkeys-lru`

## Manifests Base (sin Helm)

Si prefieres aplicar YAML directamente sin Helm:

```bash
kubectl apply -f k8s/base/namespace.yaml
kubectl apply -f k8s/base/configmap.yaml
kubectl apply -f k8s/base/secret.yaml
kubectl apply -f k8s/base/postgres.yaml
kubectl apply -f k8s/base/redis.yaml
kubectl apply -f k8s/base/pgbouncer.yaml
kubectl apply -f k8s/base/api.yaml
kubectl apply -f k8s/base/web.yaml
kubectl apply -f k8s/base/ingress.yaml
```

## Comandos Utiles

```bash
# Ver todos los recursos
kubectl get all -n kiramopay

# Ver logs del API
kubectl logs -f deployment/kiramopay-api -n kiramopay

# Entrar al pod del API
kubectl exec -it deployment/kiramopay-api -n kiramopay -- sh

# Entrar a PostgreSQL
kubectl exec -it deployment/postgres -n kiramopay -- psql -U kiramopay

# Entrar a Redis
kubectl exec -it deployment/redis -n kiramopay -- redis-cli

# Ver eventos
kubectl get events -n kiramopay --sort-by='.lastTimestamp'

# Escalar manualmente
kubectl scale deployment kiramopay-api --replicas=3 -n kiramopay

# Ver HPA (auto-scaling)
kubectl get hpa -n kiramopay
```

## Troubleshooting

### Pod no inicia (CrashLoopBackOff)

```bash
# Ver logs del pod
kubectl logs <pod-name> -n kiramopay

# Comun: PostgreSQL no esta listo aun
# Solucion: esperar unos segundos y verificar
kubectl get pods -n kiramopay -w
```

### No puedo acceder al Ingress

```bash
# Verificar que el addon de ingress esta habilitado
minikube addons list | grep ingress

# Verificar la IP de minikube
minikube ip

# Verificar que la entrada en /etc/hosts es correcta
# En Windows: C:\Windows\System32\drivers\etc\hosts

# Alternativa: usar minikube tunnel
minikube tunnel
# Luego acceder por http://localhost (sin modificar hosts)
```

### Imagenes no encontradas (ErrImagePull)

```bash
# Asegurate de construir las imagenes dentro del contexto de minikube
eval $(minikube docker-env)
docker build -t kiramopay-api:latest ./backend
docker build -t kiramopay-web:latest .
```

### Limpiar todo

```bash
# Desinstalar Helm release
helm uninstall kiramopay -n kiramopay

# Eliminar namespace
kubectl delete namespace kiramopay

# Detener minikube
minikube stop

# Eliminar minikube completamente
minikube delete
```
