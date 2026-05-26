# KiramoPay - Arquitectura de Produccion

## Documento Tecnico v1.0

---

## 1. VISION GENERAL

KiramoPay es una plataforma fintech diseñada para escalar a millones de usuarios con seguridad de nivel bancario. Este documento establece la arquitectura tecnica, requisitos de compliance, y estrategia de expansion internacional.

**Mercado Inicial:** Costa Rica
**Expansion Objetivo:** Latinoamerica y mercados emergentes

---

## 2. STACK TECNOLOGICO

### 2.1 Arquitectura de Servicios
```
┌─────────────────────────────────────────────────────────────────┐
│                    ARQUITECTURA DE MICROSERVICIOS               │
├─────────────────────────────────────────────────────────────────┤
│  API Gateway (Kong / AWS API Gateway)                           │
│       │                                                          │
│       ├── Auth Service (Golang)         - Autenticacion JWT     │
│       ├── User Service (Golang)         - Perfiles, KYC         │
│       ├── Transaction Service (Golang)  - Core bancario         │
│       ├── Payment Service (Golang)      - SINPE, Cards          │
│       ├── Crypto Service (Golang)       - Exchange, Wallets     │
│       ├── Notification Service (Node)   - Push, SMS, Email      │
│       ├── Integration Service (Node)    - Uber, DiDi, etc.      │
│       └── Analytics Service (Python)    - ML, Fraude            │
│                                                                  │
│  Message Queue: Apache Kafka / RabbitMQ                         │
│  Cache: Redis Cluster                                            │
│  Search: Elasticsearch                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Justificacion de Golang para Core Bancario
- **Performance:** Rendimiento superior para operaciones criticas
- **Concurrencia:** Manejo eficiente de millones de conexiones simultaneas
- **Type Safety:** Reduccion de errores en produccion
- **Despliegue:** Binarios livianos, optimos para contenedores

### 2.3 Estrategia Multi-Base de Datos
```
┌─────────────────────────────────────────────────────────────────┐
│                    ESTRATEGIA DE DATOS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PostgreSQL (Primary)                                            │
│  ├── Usuarios, Cuentas, Transacciones                           │
│  ├── Replicacion Master-Slave (3 replicas minimo)               │
│  ├── Particionamiento por fecha (transacciones)                 │
│  └── Connection Pooling: PgBouncer                              │
│                                                                  │
│  Redis Cluster                                                   │
│  ├── Sesiones de usuario                                         │
│  ├── Rate limiting                                               │
│  ├── Cache de consultas frecuentes                              │
│  └── Pub/Sub para eventos en tiempo real                        │
│                                                                  │
│  MongoDB (Secondary)                                             │
│  ├── Logs de auditoria                                          │
│  ├── Documentos KYC                                             │
│  └── Configuraciones dinamicas                                  │
│                                                                  │
│  TimescaleDB                                                     │
│  └── Metricas, Analytics, Time-series data                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. SEGURIDAD BANCARIA

### 3.1 Capas de Encriptacion
```
┌─────────────────────────────────────────────────────────────────┐
│                    CAPAS DE SEGURIDAD                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  EN TRANSITO:                                                    │
│  ├── TLS 1.3 obligatorio                                        │
│  ├── Certificate Pinning en apps moviles                        │
│  ├── mTLS entre microservicios                                  │
│  └── HSTS, CSP headers                                          │
│                                                                  │
│  EN REPOSO:                                                      │
│  ├── AES-256-GCM para datos sensibles                           │
│  ├── Envelope Encryption (AWS KMS / HashiCorp Vault)            │
│  ├── Column-level encryption en PostgreSQL                      │
│  └── Hashing: Argon2id para passwords                           │
│                                                                  │
│  CLAVES:                                                         │
│  ├── HSM (Hardware Security Module) para claves maestras        │
│  ├── Rotacion automatica cada 90 dias                           │
│  └── Key derivation: HKDF                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Modelo de Datos con Encriptacion
```sql
-- Ejemplo de tabla con encriptacion por columna
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255),                    -- Hashed para busqueda
    email_encrypted BYTEA,                 -- AES-256 para mostrar
    phone_encrypted BYTEA,                 -- AES-256
    cedula_hash VARCHAR(64),               -- SHA-256 para validacion
    cedula_encrypted BYTEA,                -- AES-256 para mostrar
    pin_hash VARCHAR(128),                 -- Argon2id
    biometric_template_encrypted BYTEA,    -- AES-256
    created_at TIMESTAMP
);
```

### 3.3 Autenticacion Multi-Factor
```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUJO DE AUTENTICACION                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  NIVEL 1: Credenciales                                          │
│  └── Cedula/ID + PIN (4-6 digitos)                              │
│                                                                  │
│  NIVEL 2: Dispositivo                                           │
│  ├── Device Fingerprinting                                      │
│  ├── Biometria (Face ID / Huella)                               │
│  └── Push notification de confirmacion                          │
│                                                                  │
│  NIVEL 3: Transaccional (montos altos)                          │
│  ├── OTP por SMS/Email                                          │
│  ├── TOTP (Google Authenticator)                                │
│  └── Confirmacion en segundo dispositivo                        │
│                                                                  │
│  TOKENS:                                                         │
│  ├── Access Token: JWT, 15 min expiry                           │
│  ├── Refresh Token: Opaque, 7 dias, rotacion                    │
│  └── Device Token: Vinculado a dispositivo                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 Deteccion de Fraude (ML)
```python
# Modelo de deteccion de fraude en tiempo real
SIGNALS_TO_ANALYZE = {
    'device': [
        'device_fingerprint_changed',
        'new_device',
        'rooted_jailbroken',
        'emulator_detected',
        'vpn_proxy_detected',
    ],
    'behavior': [
        'unusual_transaction_time',
        'unusual_amount',
        'unusual_recipient',
        'rapid_succession_transactions',
        'location_impossible_travel',
    ],
    'account': [
        'recent_password_change',
        'recent_phone_change',
        'multiple_failed_logins',
        'dormant_account_activity',
    ]
}

# Acciones automaticas segun score de riesgo
RISK_ACTIONS = {
    '0-30': 'ALLOW',           # Transaccion normal
    '31-60': 'STEP_UP_AUTH',   # Pedir OTP adicional
    '61-80': 'MANUAL_REVIEW',  # Cola para revision
    '81-100': 'BLOCK',         # Bloquear y notificar
}
```

---

## 4. COMPLIANCE Y REGULACIONES

### 4.1 Requisitos Costa Rica (Mercado Inicial)
```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPLIANCE COSTA RICA                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SUGEF (Superintendencia General de Entidades Financieras)      │
│  ├── Licencia de operacion como entidad financiera              │
│  ├── Capital minimo requerido                                   │
│  ├── Reportes periodicos obligatorios                           │
│  └── Auditorias anuales                                         │
│                                                                  │
│  BCCR (Banco Central)                                           │
│  ├── Autorizacion para operar con SINPE                         │
│  ├── Integracion via API certificada                            │
│  └── Reportes de transacciones                                  │
│                                                                  │
│  AML/KYC (Anti-Money Laundering)                                │
│  ├── Verificacion de identidad (cedula + selfie)                │
│  ├── Listas negras (OFAC, ONU, local)                           │
│  ├── Monitoreo de transacciones sospechosas                     │
│  └── SAR (Suspicious Activity Reports)                          │
│                                                                  │
│  PCI-DSS (para manejo de tarjetas)                              │
│  ├── Nivel segun volumen de transacciones                       │
│  ├── Tokenizacion obligatoria                                   │
│  └── Auditorias QSA anuales                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Adaptabilidad Internacional

La arquitectura esta diseñada para expansion geografica con modulos configurables por pais:

```
┌─────────────────────────────────────────────────────────────────┐
│                    MODULO DE LOCALIZACION                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  country_config/                                                 │
│  ├── costa_rica/                                                │
│  │   ├── payment_methods.json    # SINPE Movil                  │
│  │   ├── kyc_requirements.json   # Cedula CR                    │
│  │   ├── tax_rules.json          # IVA 13%                      │
│  │   └── compliance.json         # SUGEF, BCCR                  │
│  │                                                               │
│  ├── mexico/                                                     │
│  │   ├── payment_methods.json    # SPEI, CoDi                   │
│  │   ├── kyc_requirements.json   # INE, CURP                    │
│  │   ├── tax_rules.json          # IVA 16%                      │
│  │   └── compliance.json         # CNBV, Banxico                │
│  │                                                               │
│  ├── colombia/                                                   │
│  │   ├── payment_methods.json    # PSE, Transfiya               │
│  │   ├── kyc_requirements.json   # Cedula CO                    │
│  │   ├── tax_rules.json          # IVA 19%                      │
│  │   └── compliance.json         # SFC                          │
│  │                                                               │
│  └── [pais]/                                                     │
│      └── ... configuracion especifica                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Estrategia de Expansion por Pais:**

| Pais | Sistema de Pagos | Regulador | Requisitos KYC | Complejidad |
|------|-----------------|-----------|----------------|-------------|
| Costa Rica | SINPE Movil | SUGEF/BCCR | Cedula | Media |
| Panama | ACH Panama | SBP | Cedula/Pasaporte | Baja |
| Mexico | SPEI/CoDi | CNBV | INE/CURP | Alta |
| Colombia | PSE/Transfiya | SFC | Cedula CO | Alta |
| Peru | Yape/Plin compatible | SBS | DNI | Media |
| Chile | CuentaRUT compatible | CMF | RUT | Media |

---

## 5. INTEGRACION SINPE (Costa Rica)

### 5.1 Arquitectura de Integracion
```
┌─────────────────────────────────────────────────────────────────┐
│                    INTEGRACION SINPE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  KiramoPay ──► Banco Sponsor ──► SINPE (BCCR)                   │
│                                                                  │
│  FASE 1: Banco Sponsor (Inicio)                                 │
│  ├── Asociacion con entidad bancaria (BAC, BCR, Promerica)      │
│  ├── El banco provee conexion SINPE                             │
│  ├── Revenue share: 0.1-0.5% por transaccion                    │
│  └── Tiempo estimado: 3-6 meses                                 │
│                                                                  │
│  FASE 2: Conexion Directa (Largo plazo)                         │
│  ├── Licencia SUGEF propia                                      │
│  ├── Conexion directa al BCCR                                   │
│  └── Tiempo estimado: 12-24 meses                               │
│                                                                  │
│  API SINPE Movil:                                                │
│  POST /sinpe/transfer                                            │
│  {                                                               │
│    "source_phone": "70260930",                                  │
│    "dest_phone": "88888888",                                    │
│    "amount": 50000,                                             │
│    "currency": "CRC",                                           │
│    "description": "Pago",                                       │
│    "idempotency_key": "uuid-v4"                                 │
│  }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. INTEGRACIONES TERCEROS

### 6.1 Servicios de Transporte y Delivery
```
┌─────────────────────────────────────────────────────────────────┐
│                    INTEGRACIONES EXTERNAS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  UBER EATS / UBER:                                               │
│  ├── Uber for Business API                                      │
│  ├── Requiere: Cuenta empresarial + contrato                    │
│  ├── Integracion: OAuth2 + Webhooks                             │
│  └── Pago: Tokenized card o direct debit                        │
│                                                                  │
│  DiDi:                                                           │
│  ├── DiDi Partner API (Latinoamerica)                           │
│  ├── OAuth2 similar a Uber                                      │
│  └── Contacto: partnerships-latam@didiglobal.com                │
│                                                                  │
│  Rappi:                                                          │
│  ├── Rappi Pay API                                              │
│  └── Integracion via wallet linking                             │
│                                                                  │
│  MODELO DE NEGOCIO:                                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Usuario paga en Uber con KiramoPay                        │ │
│  │       ▼                                                     │ │
│  │  KiramoPay debita cuenta usuario                           │ │
│  │       ▼                                                     │ │
│  │  KiramoPay paga a Uber (menos comision 1-2%)               │ │
│  │       ▼                                                     │ │
│  │  Usuario recibe cashback 0.5% en KiramoPay                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Servicios Publicos
```
┌─────────────────────────────────────────────────────────────────┐
│                    SERVICIOS PUBLICOS                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ICE (Electricidad/Telefono):                                    │
│  ├── API de consulta de recibos                                 │
│  ├── Pago via SINPE o transferencia                             │
│  └── Webhook de confirmacion                                    │
│                                                                  │
│  AyA (Agua):                                                     │
│  ├── API de consulta                                            │
│  └── Pago integrado                                             │
│                                                                  │
│  CCSS (Seguro Social):                                           │
│  ├── Consulta de estado                                         │
│  └── Pago de cuotas                                             │
│                                                                  │
│  Recargas Telefonicas:                                           │
│  ├── Kolbi, Movistar, Claro                                     │
│  └── Comision: 3-5% por recarga                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. INFRAESTRUCTURA CLOUD

### 7.1 Arquitectura AWS
```
┌─────────────────────────────────────────────────────────────────┐
│                    AWS ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Region: us-east-1 (Principal) + sa-east-1 (DR)                 │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  CloudFront (CDN)                                        │   │
│  │       ▼                                                   │   │
│  │  WAF + Shield (DDoS Protection)                          │   │
│  │       ▼                                                   │   │
│  │  API Gateway                                              │   │
│  │       ▼                                                   │   │
│  │  ALB (Application Load Balancer)                         │   │
│  │       ▼                                                   │   │
│  │  EKS (Kubernetes)                                         │   │
│  │  ├── Auth Service (3 pods min)                           │   │
│  │  ├── Transaction Service (5 pods min)                    │   │
│  │  ├── Payment Service (3 pods min)                        │   │
│  │  └── Notification Service (3 pods min)                   │   │
│  │       ▼                                                   │   │
│  │  Aurora PostgreSQL (Multi-AZ)                            │   │
│  │  ├── Writer: db.r6g.2xlarge                              │   │
│  │  └── Readers: 2x db.r6g.xlarge                           │   │
│  │       ▼                                                   │   │
│  │  ElastiCache Redis (Cluster Mode)                        │   │
│  │  └── 3 shards, 2 replicas cada uno                       │   │
│  │                                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  COSTOS ESTIMADOS (por volumen de usuarios):                    │
│  ├── 10K usuarios: ~$500-1,000/mes                              │
│  ├── 100K usuarios: ~$3,000-5,000/mes                           │
│  ├── 500K usuarios: ~$8,000-12,000/mes                          │
│  └── 1M+ usuarios: ~$15,000-25,000/mes                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Multi-Region para Expansion Internacional
```
┌─────────────────────────────────────────────────────────────────┐
│                    ESTRATEGIA MULTI-REGION                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Centroamerica + Caribe:                                         │
│  └── us-east-1 (N. Virginia) - Principal                        │
│                                                                  │
│  Mexico:                                                         │
│  └── us-west-2 (Oregon) o us-east-1                             │
│                                                                  │
│  Sudamerica:                                                     │
│  └── sa-east-1 (Sao Paulo)                                      │
│                                                                  │
│  Data Residency:                                                 │
│  ├── Algunos paises requieren datos locales                     │
│  ├── Colombia: Datos deben estar en region Andina              │
│  └── Brasil: LGPD requiere consideraciones especiales          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Auto-Scaling
```yaml
# Kubernetes HPA para Transaction Service
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: transaction-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: transaction-service
  minReplicas: 5
  maxReplicas: 50
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

---

## 8. MONITOREO Y OBSERVABILIDAD

### 8.1 Stack de Monitoreo
```
┌─────────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY STACK                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  METRICAS:                                                       │
│  ├── Prometheus + Grafana                                       │
│  ├── AWS CloudWatch                                             │
│  └── Custom dashboards por servicio                             │
│                                                                  │
│  LOGS:                                                           │
│  ├── ELK Stack (Elasticsearch, Logstash, Kibana)                │
│  ├── Retencion: 90 dias hot, 2 anos cold                        │
│  └── Alertas automaticas por patrones                           │
│                                                                  │
│  TRACING:                                                        │
│  ├── Jaeger / AWS X-Ray                                         │
│  └── Distributed tracing end-to-end                             │
│                                                                  │
│  ALERTAS CRITICAS:                                               │
│  ├── Transaccion fallida > 1%                                   │
│  ├── Latencia p99 > 500ms                                       │
│  ├── Error rate > 0.1%                                          │
│  ├── CPU/Memory > 80%                                           │
│  └── Intentos de fraude detectados                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. ROADMAP DE DESARROLLO

### 9.1 Vision: Crypto como Diferenciador Central

**Propuesta de Valor Unica:** KiramoPay permite a los usuarios intercambiar criptomonedas por la moneda local de su pais (o cualquier moneda de preferencia) y utilizar ese saldo para pagos cotidianos. Esta capacidad de convertir crypto a fiat de forma instantanea y usarlo en el ecosistema financiero local es el diferenciador principal de la plataforma.

### 9.2 Fases de Implementacion con Track Crypto Paralelo
```
┌─────────────────────────────────────────────────────────────────┐
│                    ROADMAP                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ══════════════════════════════════════════════════════════════ │
│  TRACK PARALELO: CRYPTO (Ejecuta junto a todas las fases)       │
│  ══════════════════════════════════════════════════════════════ │
│                                                                  │
│  CRYPTO FASE 1 (Meses 1-3):                                     │
│  ├── Integracion API exchange (Binance/Coinbase)                │
│  ├── Wallet crypto custodial basico                             │
│  ├── Soporte BTC, ETH, USDT, USDC                               │
│  └── Arquitectura de conversion crypto-fiat                     │
│                                                                  │
│  CRYPTO FASE 2 (Meses 4-6):                                     │
│  ├── Motor de conversion crypto → moneda local                  │
│  ├── Deposito/retiro de crypto                                  │
│  ├── Integracion con balance SINPE                              │
│  └── Conversion automatica para pagos                           │
│                                                                  │
│  CRYPTO FASE 3 (Meses 7-9):                                     │
│  ├── Multi-moneda destino (USD, EUR, MXN, etc.)                 │
│  ├── Alertas de precio y ordenes limitadas                      │
│  ├── Historial completo de conversiones                         │
│  └── Reporte fiscal automatico                                  │
│                                                                  │
│  CRYPTO FASE 4 (Meses 10-12):                                   │
│  ├── Staking basico (ETH, stablecoins)                          │
│  ├── DeFi yields integrados                                     │
│  ├── Pagos directos en crypto (donde se acepte)                 │
│  └── Expansion de tokens soportados                             │
│                                                                  │
│  ══════════════════════════════════════════════════════════════ │
│  TRACK PRINCIPAL: FINTECH TRADICIONAL                           │
│  ══════════════════════════════════════════════════════════════ │
│                                                                  │
│  FASE 1 (Meses 1-3): FUNDACION                                  │
│  ├── Setup infraestructura AWS                                  │
│  ├── CI/CD pipelines                                            │
│  ├── Auth service con MFA                                       │
│  ├── User service con KYC basico                                │
│  ├── Base de datos encriptada                                   │
│  └── App movil conectada a backend real                         │
│                                                                  │
│  FASE 2 (Meses 4-6): CORE BANCARIO                              │
│  ├── Transaction service                                        │
│  ├── Integracion banco sponsor (SINPE)                          │
│  ├── Sistema de notificaciones                                  │
│  ├── KYC completo (verificacion identidad)                      │
│  ├── Deteccion fraude v1                                        │
│  └── Beta cerrada (100 usuarios)                                │
│                                                                  │
│  FASE 3 (Meses 7-9): SERVICIOS                                  │
│  ├── Pagos de servicios (ICE, AyA)                              │
│  ├── Recargas telefonicas                                       │
│  ├── Referral program                                           │
│  ├── Beta abierta (1,000 usuarios)                              │
│  └── Auditorias de seguridad                                    │
│                                                                  │
│  FASE 4 (Meses 10-12): EXPANSION                                │
│  ├── Integracion Uber/DiDi                                      │
│  ├── Tarjetas virtuales                                         │
│  ├── Cashback program                                           │
│  ├── Lanzamiento publico Costa Rica                             │
│  └── Preparacion expansion regional                             │
│                                                                  │
│  AÑO 2+:                                                         │
│  ├── Inversiones tradicionales                                  │
│  ├── Expansion Panama/Mexico                                    │
│  ├── Tokens adicionales y NFTs                                  │
│  └── Meta: 100,000+ usuarios                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.3 Flujo de Conversion Crypto-Fiat
```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUJO CRYPTO → FIAT                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEPOSITO:                                                       │
│  Usuario deposita BTC/ETH/USDT                                  │
│       ▼                                                          │
│  Wallet custodial KiramoPay recibe crypto                       │
│       ▼                                                          │
│  Se refleja balance crypto en la app                            │
│                                                                  │
│  CONVERSION:                                                     │
│  Usuario selecciona "Convertir a CRC/USD/EUR"                   │
│       ▼                                                          │
│  Motor de conversion ejecuta swap via exchange                  │
│       ▼                                                          │
│  Balance fiat disponible instantaneamente                       │
│                                                                  │
│  USO:                                                            │
│  Balance fiat se usa como cualquier saldo:                      │
│  ├── SINPE Movil                                                │
│  ├── Pago de servicios                                          │
│  ├── Tarjeta virtual                                            │
│  ├── Uber/DiDi                                                  │
│  └── Retiro ATM                                                 │
│                                                                  │
│  CONVERSION AUTOMATICA (opcional):                              │
│  Usuario configura "Pagar siempre en CRC"                       │
│       ▼                                                          │
│  Al hacer pago, si solo tiene crypto:                           │
│       ▼                                                          │
│  Conversion automatica crypto → fiat → pago                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.4 Integraciones Crypto Requeridas
```
┌─────────────────────────────────────────────────────────────────┐
│                    STACK CRYPTO                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  EXCHANGES (Liquidity Providers):                               │
│  ├── Binance API (preferido para LATAM)                         │
│  ├── Coinbase Pro API (backup)                                  │
│  └── Kraken API (EUR pairs)                                     │
│                                                                  │
│  BLOCKCHAIN INFRASTRUCTURE:                                     │
│  ├── Bitcoin: BlockCypher o Blockchain.com API                  │
│  ├── Ethereum: Infura / Alchemy                                 │
│  └── Stablecoins: Circle (USDC), Tether (USDT)                  │
│                                                                  │
│  CUSTODY:                                                        │
│  ├── Fireblocks (enterprise custody)                            │
│  ├── BitGo (alternativa)                                        │
│  └── Hot wallet propio (small amounts)                          │
│                                                                  │
│  COMPLIANCE CRYPTO:                                              │
│  ├── Chainalysis (transaction monitoring)                       │
│  ├── Elliptic (AML screening)                                   │
│  └── KYC reforzado para crypto (SUGEF guidelines)               │
│                                                                  │
│  MONEDAS SOPORTADAS (Fase Inicial):                             │
│  ├── BTC  - Bitcoin                                             │
│  ├── ETH  - Ethereum                                            │
│  ├── USDT - Tether (TRC20, ERC20)                               │
│  └── USDC - USD Coin                                            │
│                                                                  │
│  EXPANSION POSTERIOR:                                           │
│  ├── SOL, MATIC, BNB                                            │
│  ├── Stablecoins regionales                                     │
│  └── Tokens de utilidad seleccionados                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. EXPANSION INTERNACIONAL

### 10.1 Proceso de Entrada a Nuevo Mercado

```
┌─────────────────────────────────────────────────────────────────┐
│                    PLAYBOOK DE EXPANSION                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. INVESTIGACION (1-2 meses)                                   │
│     ├── Identificar regulador financiero local                  │
│     ├── Requisitos de licencia                                  │
│     ├── Sistema de pagos local (equivalente a SINPE)            │
│     ├── Competencia existente                                   │
│     └── Requisitos KYC locales                                  │
│                                                                  │
│  2. LEGAL & COMPLIANCE (2-4 meses)                              │
│     ├── Constituir entidad legal local                          │
│     ├── Aplicar a licencias requeridas                          │
│     ├── Establecer AML/KYC local                                │
│     └── Contratar abogado local                                 │
│                                                                  │
│  3. DESARROLLO (2-3 meses)                                      │
│     ├── Configurar modulo pais (country_config/)                │
│     ├── Integrar sistema de pagos local                         │
│     ├── Adaptar flujo KYC                                       │
│     ├── Traducir app al idioma local                            │
│     └── Configurar moneda y formatos                            │
│                                                                  │
│  4. PARTNERSHIPS (paralelo)                                     │
│     ├── Banco sponsor local                                     │
│     ├── Proveedores KYC                                         │
│     └── Servicios locales (utilities, recargas)                 │
│                                                                  │
│  5. LANZAMIENTO                                                  │
│     ├── Beta cerrada con usuarios locales                       │
│     ├── Iteracion basada en feedback                            │
│     └── Lanzamiento publico                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 Arquitectura Modular para Multi-Pais

```typescript
// Ejemplo de configuracion por pais
interface CountryConfig {
  code: string;              // 'CR', 'MX', 'CO'
  currency: string;          // 'CRC', 'MXN', 'COP'
  paymentMethods: string[];  // ['SINPE', 'CARD']
  kycRequirements: {
    documents: string[];     // ['cedula', 'selfie']
    verificationLevel: number;
  };
  taxRules: {
    vat: number;            // 0.13, 0.16, 0.19
    withholding: number;
  };
  compliance: {
    regulator: string;      // 'SUGEF', 'CNBV', 'SFC'
    reportingFrequency: string;
    transactionLimits: Record<string, number>;
  };
  localization: {
    language: string;       // 'es-CR', 'es-MX'
    dateFormat: string;
    phoneFormat: string;
  };
}
```

---

## 11. MODELO DE INGRESOS

### 11.1 Revenue Streams
```
┌─────────────────────────────────────────────────────────────────┐
│                    MODELO DE NEGOCIO                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TRANSACCIONALES:                                                │
│  ├── SINPE: Gratis (adquisicion de usuarios)                    │
│  ├── Pago servicios: 1-2% comision                              │
│  ├── Recargas: 3-5% comision                                    │
│  └── Retiros ATM: $1-2 por retiro                               │
│                                                                  │
│  TARJETAS:                                                       │
│  ├── Emision virtual: Gratis                                    │
│  ├── Tarjeta fisica: $5-10                                      │
│  └── Interchange fee: 0.5-1.5%                                  │
│                                                                  │
│  FINANCIEROS:                                                    │
│  ├── Float income (dinero en cuentas)                           │
│  ├── Prestamos: 15-25% APR                                      │
│  └── Inversiones: 0.5-1% AUM                                    │
│                                                                  │
│  B2B:                                                            │
│  ├── API para comercios: $0.10-0.30/tx                          │
│  └── Payroll services: $2-5/empleado                            │
│                                                                  │
│  PROYECCION:                                                     │
│  ├── 10K usuarios: $5,000/mes                                   │
│  ├── 50K usuarios: $35,000/mes                                  │
│  ├── 100K usuarios: $80,000/mes                                 │
│  └── 500K usuarios: $500,000/mes                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 12. PRESUPUESTO ESTIMADO

### 12.1 Costos por Fase
```
┌─────────────────────────────────────────────────────────────────┐
│                    PRESUPUESTO                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INFRAESTRUCTURA (Primer Año):                                  │
│  ├── AWS (crecimiento progresivo): $15,000-60,000               │
│  ├── Servicios terceros (Twilio, etc.): $5,000-20,000           │
│  └── Herramientas desarrollo: $3,000-10,000                     │
│                                                                  │
│  LEGAL/COMPLIANCE:                                               │
│  ├── Abogados fintech: $15,000-30,000                           │
│  ├── Licencias SUGEF: $10,000-20,000                            │
│  └── Auditorias seguridad: $10,000-25,000                       │
│                                                                  │
│  OPERACIONES:                                                    │
│  ├── Hardware/Software: $3,000-10,000                           │
│  └── Seguros: $5,000-10,000                                     │
│                                                                  │
│  MARKETING:                                                      │
│  ├── Branding: $5,000-10,000                                    │
│  └── Adquisicion usuarios: $10,000-40,000                       │
│                                                                  │
│  ═══════════════════════════════════════════════════════════    │
│  RANGO TOTAL AÑO 1: $80,000 - $250,000                          │
│  (Dependiendo de velocidad de escalamiento)                     │
│  ═══════════════════════════════════════════════════════════    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 13. RECURSOS TECNICOS

### 13.1 Documentacion de Referencia
- **SINPE:** https://www.bccr.fi.cr/sistema-de-pagos/sinpe
- **SUGEF Regulaciones:** https://www.sugef.fi.cr/
- **AWS Well-Architected Framework:** https://aws.amazon.com/architecture/well-architected/
- **PCI-DSS Standards:** https://www.pcisecuritystandards.org/

### 13.2 APIs de Integracion
- Uber for Business: https://developer.uber.com/
- DiDi Partner API: partnerships-latam@didiglobal.com
- Stripe (Tarjetas): https://stripe.com/docs
- Twilio (SMS/Voice): https://www.twilio.com/docs

---

## 14. CONSIDERACIONES FINALES

Este documento establece la base tecnica para el desarrollo de KiramoPay como una plataforma fintech escalable. Los puntos clave son:

1. **Crypto como diferenciador central** - La conversion crypto-fiat instantanea y su uso en pagos cotidianos es la propuesta de valor unica
2. **Seguridad desde el inicio** - Arquitectura diseñada con seguridad bancaria para fiat y crypto
3. **Compliance obligatorio** - SUGEF, BCCR y regulaciones crypto son requisitos no negociables
4. **Escalabilidad** - Diseño para millones de usuarios desde la arquitectura base
5. **Expansion internacional** - Modulos configurables por pais con soporte multi-moneda
6. **Desarrollo paralelo** - Track crypto ejecuta simultaneamente con track fintech tradicional

**Proximos pasos inmediatos:**
1. Establecer contacto con potencial banco sponsor para integracion SINPE
2. Evaluar y seleccionar exchange API para integracion crypto (Binance/Coinbase)
3. Definir estrategia de custody para activos digitales

---

*Documento generado para uso interno de desarrollo*
*Version: 1.0*
*Ultima actualizacion: Enero 2026*
