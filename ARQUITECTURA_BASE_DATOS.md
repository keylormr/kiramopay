# Arquitectura de Base de Datos - KiramoPay
## Diseño para Alta Concurrencia y Escalabilidad

---

## RESUMEN EJECUTIVO

Esta arquitectura está diseñada para soportar:
- **10+ millones de usuarios**
- **100,000+ transacciones concurrentes por segundo**
- **99.99% uptime**
- **Latencia < 100ms** para operaciones críticas
- **Compliance** con regulaciones financieras (SUGEF, PCI-DSS)

---

## ARQUITECTURA MULTI-DATABASE

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           APLICACIÓN                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY                                      │
│                    (Rate Limiting, Auth)                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│   WRITE CLUSTER   │   │   READ REPLICAS   │   │    CACHE LAYER    │
│   (PostgreSQL)    │   │   (PostgreSQL)    │   │     (Redis)       │
│                   │   │                   │   │                   │
│  - Transacciones  │   │  - Consultas      │   │  - Sesiones       │
│  - Wallets        │   │  - Reportes       │   │  - Balances       │
│  - Usuarios       │   │  - Analytics      │   │  - Rate limits    │
└───────────────────┘   └───────────────────┘   └───────────────────┘
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      MESSAGE QUEUE (RabbitMQ/Kafka)                      │
│              - Transacciones asíncronas                                  │
│              - Notificaciones                                            │
│              - Event sourcing                                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    ANALYTICS & AUDIT (ClickHouse)                        │
│              - Logs de transacciones                                     │
│              - Reportes regulatorios                                     │
│              - Machine Learning / Fraud detection                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## BASE DE DATOS PRINCIPAL: PostgreSQL

### ¿Por qué PostgreSQL?

| Característica | Beneficio para KiramoPay |
|----------------|--------------------------|
| ACID Compliance | Transacciones financieras seguras |
| Extensiones | PostGIS (ubicación), pgcrypto (encriptación) |
| Particionamiento | Escalar horizontalmente |
| MVCC | Alta concurrencia sin bloqueos |
| JSON/JSONB | Flexibilidad para metadata |
| Replicación | Read replicas para escalar lecturas |
| Madurez | 30+ años, batalla-probado en fintech |

### Alternativas Consideradas

| DB | Pros | Contras | Decisión |
|----|------|---------|----------|
| MySQL | Popular | Menos features, ACID débil | ❌ |
| MongoDB | Flexible | No ACID nativo, costoso a escala | ❌ |
| CockroachDB | Distribuido | Costoso, complejidad | ⚠️ Futuro |
| TiDB | MySQL compatible + escala | Menos maduro | ⚠️ Futuro |
| **PostgreSQL** | ACID, maduro, extensible | Escala vertical | ✅ Elegido |

---

## ESQUEMA DE BASE DE DATOS

### 1. USUARIOS Y AUTENTICACIÓN

```sql
-- Tabla principal de usuarios
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identificación Costa Rica
    cedula VARCHAR(12) UNIQUE, -- Formato: X-XXXX-XXXX
    cedula_type VARCHAR(20), -- 'nacional', 'residente', 'dimex', 'passport'

    -- Contacto
    phone VARCHAR(15) NOT NULL UNIQUE, -- +506XXXXXXXX
    phone_verified BOOLEAN DEFAULT FALSE,
    email VARCHAR(255) UNIQUE,
    email_verified BOOLEAN DEFAULT FALSE,

    -- Perfil
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    birth_date DATE,
    profile_picture_url TEXT,

    -- Seguridad
    pin_hash VARCHAR(255) NOT NULL, -- bcrypt hash
    biometric_enabled BOOLEAN DEFAULT FALSE,
    biometric_public_key TEXT,

    -- KYC (Know Your Customer)
    kyc_level INTEGER DEFAULT 0, -- 0: básico, 1: verificado, 2: completo
    kyc_status VARCHAR(20) DEFAULT 'pending',
    kyc_verified_at TIMESTAMP,

    -- Estado
    status VARCHAR(20) DEFAULT 'active', -- active, suspended, blocked

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP,

    -- Soft delete
    deleted_at TIMESTAMP
);

-- Índices para búsquedas frecuentes
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_cedula ON users(cedula);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- Dispositivos registrados
CREATE TABLE user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),

    device_id VARCHAR(255) NOT NULL, -- UUID del dispositivo
    device_name VARCHAR(100),
    device_type VARCHAR(50), -- 'ios', 'android', 'web'
    device_model VARCHAR(100),
    os_version VARCHAR(50),
    app_version VARCHAR(20),

    push_token TEXT, -- Firebase/APNs token

    is_trusted BOOLEAN DEFAULT FALSE,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, device_id)
);

-- Sesiones activas
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    device_id UUID REFERENCES user_devices(id),

    token_hash VARCHAR(255) NOT NULL, -- hash del JWT
    refresh_token_hash VARCHAR(255),

    ip_address INET,
    user_agent TEXT,

    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token_hash);

-- Verificaciones OTP
CREATE TABLE otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    phone VARCHAR(15) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL, -- hash del código
    purpose VARCHAR(50) NOT NULL, -- 'register', 'login', 'transaction'

    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,

    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_otp_phone ON otp_verifications(phone, purpose);
```

### 2. WALLETS Y CUENTAS

```sql
-- Wallet principal del usuario
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) UNIQUE,

    -- Balance principal (en céntimos para evitar decimales)
    balance_crc BIGINT DEFAULT 0, -- Colones
    balance_usd BIGINT DEFAULT 0, -- USD (céntimos)

    -- Límites dinámicos según KYC
    daily_limit BIGINT DEFAULT 50000000, -- 500,000 CRC default
    monthly_limit BIGINT DEFAULT 500000000, -- 5,000,000 CRC

    -- Contadores de uso
    daily_spent BIGINT DEFAULT 0,
    monthly_spent BIGINT DEFAULT 0,
    last_daily_reset DATE DEFAULT CURRENT_DATE,
    last_monthly_reset DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE),

    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Optimistic locking para concurrencia
ALTER TABLE wallets ADD COLUMN version INTEGER DEFAULT 1;

-- Cuentas bancarias vinculadas
CREATE TABLE linked_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),

    bank_code VARCHAR(10) NOT NULL, -- Código SINPE del banco
    bank_name VARCHAR(100) NOT NULL,

    account_type VARCHAR(20), -- 'checking', 'savings'
    account_number_encrypted BYTEA, -- Encriptado
    iban_encrypted BYTEA,

    -- Para SINPE Móvil
    sinpe_phone VARCHAR(15), -- Teléfono registrado en SINPE

    is_primary BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,

    nickname VARCHAR(50),

    created_at TIMESTAMP DEFAULT NOW(),
    verified_at TIMESTAMP
);

CREATE INDEX idx_bank_accounts_user ON linked_bank_accounts(user_id);
```

### 3. TRANSACCIONES (PARTICIONADA)

```sql
-- Tabla de transacciones particionada por fecha
CREATE TABLE transactions (
    id UUID DEFAULT gen_random_uuid(),

    -- Referencias
    wallet_id UUID NOT NULL,
    user_id UUID NOT NULL,

    -- Tipo de transacción
    type VARCHAR(30) NOT NULL,
    -- Tipos: 'sinpe_send', 'sinpe_receive', 'qr_payment', 'qr_receive',
    --        'bill_payment', 'recharge', 'deposit', 'withdrawal',
    --        'p2p_send', 'p2p_receive', 'marketplace', 'refund'

    -- Montos (en céntimos)
    amount BIGINT NOT NULL,
    currency VARCHAR(3) DEFAULT 'CRC',
    fee BIGINT DEFAULT 0,

    -- Detalles de la contraparte
    counterparty_type VARCHAR(20), -- 'user', 'merchant', 'service', 'bank'
    counterparty_id UUID,
    counterparty_name VARCHAR(100),
    counterparty_phone VARCHAR(15),
    counterparty_account VARCHAR(50),

    -- Estado
    status VARCHAR(20) DEFAULT 'pending',
    -- Estados: 'pending', 'processing', 'completed', 'failed', 'reversed'

    -- Referencias externas
    external_reference VARCHAR(100), -- ID de SINPE, comercio, etc.

    -- Metadata flexible
    metadata JSONB DEFAULT '{}',
    -- Ejemplos: {service_name, bill_number, merchant_name, etc.}

    -- Geolocalización (opcional)
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),

    -- Auditoría
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    completed_at TIMESTAMP,

    -- Partition key
    created_date DATE DEFAULT CURRENT_DATE,

    PRIMARY KEY (id, created_date)
) PARTITION BY RANGE (created_date);

-- Crear particiones automáticas (mensual)
CREATE TABLE transactions_2025_01 PARTITION OF transactions
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE transactions_2025_02 PARTITION OF transactions
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
-- ... continuar para cada mes

-- Índices en cada partición
CREATE INDEX idx_tx_wallet ON transactions(wallet_id, created_date);
CREATE INDEX idx_tx_user ON transactions(user_id, created_date);
CREATE INDEX idx_tx_status ON transactions(status, created_date);
CREATE INDEX idx_tx_type ON transactions(type, created_date);
CREATE INDEX idx_tx_external ON transactions(external_reference);

-- Función para balance en tiempo real
CREATE OR REPLACE FUNCTION update_wallet_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        UPDATE wallets
        SET balance_crc = balance_crc +
            CASE
                WHEN NEW.type IN ('sinpe_receive', 'qr_receive', 'p2p_receive', 'deposit')
                THEN NEW.amount
                ELSE -NEW.amount - NEW.fee
            END,
            daily_spent = daily_spent +
            CASE
                WHEN NEW.type IN ('sinpe_send', 'qr_payment', 'bill_payment', 'recharge')
                THEN NEW.amount
                ELSE 0
            END,
            updated_at = NOW(),
            version = version + 1
        WHERE id = NEW.wallet_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_balance
    AFTER UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_wallet_balance();
```

### 4. SERVICIOS Y PAGOS

```sql
-- Catálogo de servicios pagables
CREATE TABLE service_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(20) UNIQUE NOT NULL, -- 'ICE', 'CNFL', 'AYA', etc.
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'electricity', 'water', 'telecom', etc.

    logo_url TEXT,

    -- Configuración de integración
    api_endpoint TEXT,
    api_type VARCHAR(20), -- 'rest', 'soap', 'sinpe'

    -- Validación del número de cliente
    client_id_pattern VARCHAR(100), -- Regex pattern
    client_id_label VARCHAR(50), -- 'NIS', 'Contrato', 'Medidor'

    is_active BOOLEAN DEFAULT TRUE,

    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Servicios guardados por usuario
CREATE TABLE saved_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    provider_id UUID REFERENCES service_providers(id),

    client_id VARCHAR(50) NOT NULL, -- Número de cliente/NIS/etc.
    nickname VARCHAR(50),

    auto_pay_enabled BOOLEAN DEFAULT FALSE,
    auto_pay_max_amount BIGINT,

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, provider_id, client_id)
);

-- Historial de recibos consultados
CREATE TABLE bill_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    provider_id UUID REFERENCES service_providers(id),

    client_id VARCHAR(50) NOT NULL,

    -- Datos del recibo
    amount BIGINT,
    due_date DATE,
    period VARCHAR(20),

    -- Respuesta del proveedor
    raw_response JSONB,

    queried_at TIMESTAMP DEFAULT NOW()
);

-- Pagos de servicios
CREATE TABLE service_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL,
    user_id UUID REFERENCES users(id),
    provider_id UUID REFERENCES service_providers(id),

    client_id VARCHAR(50) NOT NULL,
    amount BIGINT NOT NULL,

    -- Comprobante
    receipt_number VARCHAR(50),

    status VARCHAR(20) DEFAULT 'pending',

    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

### 5. COMERCIOS Y QR

```sql
-- Comercios afiliados
CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Datos legales Costa Rica
    cedula_juridica VARCHAR(15) UNIQUE,
    business_name VARCHAR(200) NOT NULL,
    trade_name VARCHAR(100),

    -- Categoría
    mcc_code VARCHAR(4), -- Merchant Category Code
    category VARCHAR(50),

    -- Contacto
    phone VARCHAR(15),
    email VARCHAR(255),
    website TEXT,

    -- Ubicación
    address TEXT,
    province VARCHAR(50),
    canton VARCHAR(50),
    district VARCHAR(50),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),

    -- Configuración de pagos
    accepts_qr BOOLEAN DEFAULT TRUE,
    accepts_card BOOLEAN DEFAULT FALSE,

    -- Comisiones
    commission_rate DECIMAL(5, 4) DEFAULT 0.0150, -- 1.5% default

    -- Cuenta para depósitos
    settlement_bank_code VARCHAR(10),
    settlement_account_encrypted BYTEA,

    status VARCHAR(20) DEFAULT 'active',

    logo_url TEXT,

    created_at TIMESTAMP DEFAULT NOW(),
    verified_at TIMESTAMP
);

CREATE INDEX idx_merchants_location ON merchants
    USING GIST (point(longitude, latitude));

-- Puntos de venta (sucursales)
CREATE TABLE merchant_pos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES merchants(id),

    name VARCHAR(100),
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),

    -- QR estático de este punto
    qr_code VARCHAR(100) UNIQUE,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Códigos QR dinámicos (para pagos con monto)
CREATE TABLE qr_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(100) UNIQUE NOT NULL,

    -- Puede ser de usuario o comercio
    owner_type VARCHAR(20) NOT NULL, -- 'user', 'merchant'
    owner_id UUID NOT NULL,

    -- Si tiene monto fijo
    amount BIGINT,
    currency VARCHAR(3) DEFAULT 'CRC',

    -- Descripción/concepto
    description VARCHAR(200),

    -- Control de uso
    single_use BOOLEAN DEFAULT FALSE,
    used BOOLEAN DEFAULT FALSE,

    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_qr_code ON qr_codes(code);
```

### 6. MARKETPLACE

```sql
-- Servicios de terceros integrados
CREATE TABLE marketplace_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(30) UNIQUE NOT NULL, -- 'uber', 'didi', 'ubereats', etc.
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'transport', 'food', 'shopping'

    logo_url TEXT,

    -- Integración
    api_base_url TEXT,
    oauth_enabled BOOLEAN DEFAULT FALSE,

    commission_rate DECIMAL(5, 4),

    is_active BOOLEAN DEFAULT TRUE,

    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Conexiones de usuarios con servicios
CREATE TABLE user_partner_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    partner_id UUID REFERENCES marketplace_partners(id),

    -- OAuth tokens (encriptados)
    access_token_encrypted BYTEA,
    refresh_token_encrypted BYTEA,
    token_expires_at TIMESTAMP,

    external_user_id VARCHAR(100), -- ID del usuario en el servicio externo

    is_connected BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(user_id, partner_id)
);

-- Transacciones de marketplace
CREATE TABLE marketplace_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL, -- Referencia a transactions
    user_id UUID REFERENCES users(id),
    partner_id UUID REFERENCES marketplace_partners(id),

    -- Detalles del pedido/viaje
    external_order_id VARCHAR(100),
    order_type VARCHAR(50), -- 'ride', 'food_delivery', 'purchase'

    subtotal BIGINT NOT NULL,
    delivery_fee BIGINT DEFAULT 0,
    service_fee BIGINT DEFAULT 0,
    tip BIGINT DEFAULT 0,
    total BIGINT NOT NULL,

    -- Estado
    status VARCHAR(20) DEFAULT 'pending',

    -- Metadata del pedido
    order_details JSONB,

    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

### 7. TARJETAS VIRTUALES/FÍSICAS

```sql
-- Tarjetas emitidas
CREATE TABLE cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    wallet_id UUID REFERENCES wallets(id),

    -- Tipo
    card_type VARCHAR(20) NOT NULL, -- 'virtual', 'physical'
    brand VARCHAR(20) DEFAULT 'visa', -- 'visa', 'mastercard'

    -- Datos de la tarjeta (parcialmente encriptados)
    card_number_last4 VARCHAR(4) NOT NULL,
    card_number_encrypted BYTEA, -- Full number encriptado
    expiry_month INTEGER NOT NULL,
    expiry_year INTEGER NOT NULL,
    cvv_encrypted BYTEA,

    -- Para tarjetas físicas
    shipping_address TEXT,
    shipped_at TIMESTAMP,
    activated_at TIMESTAMP,

    -- Estado
    status VARCHAR(20) DEFAULT 'active',
    is_frozen BOOLEAN DEFAULT FALSE,

    -- Límites
    daily_limit BIGINT DEFAULT 100000000, -- 1,000,000 CRC
    monthly_limit BIGINT DEFAULT 500000000,
    atm_daily_limit BIGINT DEFAULT 50000000,

    -- Tokenización para Apple/Google Pay
    dpan_encrypted BYTEA, -- Device PAN

    created_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT cards_user_type_unique UNIQUE (user_id, card_type)
);

-- Transacciones con tarjeta
CREATE TABLE card_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID REFERENCES cards(id),
    transaction_id UUID, -- Referencia a transactions

    -- Datos de la transacción
    amount BIGINT NOT NULL,
    currency VARCHAR(3) DEFAULT 'CRC',

    merchant_name VARCHAR(100),
    merchant_mcc VARCHAR(4),
    merchant_city VARCHAR(50),
    merchant_country VARCHAR(2),

    -- Authorization
    authorization_code VARCHAR(20),

    -- Estado
    status VARCHAR(20) DEFAULT 'pending',
    -- 'authorized', 'captured', 'declined', 'reversed'

    decline_reason VARCHAR(50),

    created_at TIMESTAMP DEFAULT NOW(),
    settled_at TIMESTAMP
);
```

### 8. NOTIFICACIONES Y COMUNICACIÓN

```sql
-- Templates de notificación
CREATE TABLE notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(50) UNIQUE NOT NULL,
    -- 'sinpe_received', 'payment_completed', 'low_balance', etc.

    channel VARCHAR(20) NOT NULL, -- 'push', 'sms', 'email'

    title_template TEXT,
    body_template TEXT,

    -- Variables disponibles: {{amount}}, {{sender}}, etc.

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Notificaciones enviadas
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),

    template_code VARCHAR(50),
    channel VARCHAR(20) NOT NULL,

    title TEXT,
    body TEXT,

    -- Datos adicionales
    data JSONB DEFAULT '{}',

    -- Estado
    status VARCHAR(20) DEFAULT 'pending',
    -- 'pending', 'sent', 'delivered', 'failed', 'read'

    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    read_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW()
);

-- Particionado por fecha para limpieza
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

-- Preferencias de notificación
CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) UNIQUE,

    push_enabled BOOLEAN DEFAULT TRUE,
    sms_enabled BOOLEAN DEFAULT TRUE,
    email_enabled BOOLEAN DEFAULT TRUE,

    -- Preferencias específicas
    transaction_alerts BOOLEAN DEFAULT TRUE,
    marketing BOOLEAN DEFAULT FALSE,
    security_alerts BOOLEAN DEFAULT TRUE,

    quiet_hours_start TIME,
    quiet_hours_end TIME,

    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## CACHE LAYER: REDIS

### Estructura de Cache

```
# Sesiones de usuario
session:{user_id}:{device_id} -> {token, expires_at, ...}
TTL: 24 horas

# Balances en cache (actualizado con cada transacción)
balance:{wallet_id} -> {crc: 150000000, usd: 50000}
TTL: 5 minutos (refresh on transaction)

# Rate limiting
ratelimit:{user_id}:{action} -> count
TTL: variable por acción

# OTP temporal
otp:{phone}:{purpose} -> {hash, attempts, expires}
TTL: 5 minutos

# Locks para transacciones (prevenir doble-gasto)
txlock:{wallet_id} -> 1
TTL: 30 segundos

# Cache de tipos de cambio
exchange_rates -> {USD: 515.50, EUR: 560.25}
TTL: 15 minutos (actualizado desde BCCR)

# Información de comercios cercanos (geo)
merchants:geo:{geohash} -> [merchant_ids]
TTL: 1 hora

# Sesión de escaneo QR activo
qrscan:{session_id} -> {user_id, merchant_id, amount, status}
TTL: 5 minutos
```

### Pub/Sub para Tiempo Real

```
# Canales de notificación
channel: user:{user_id}:notifications
-> {type: 'transaction', data: {...}}

# Estado de transacciones
channel: transaction:{tx_id}
-> {status: 'completed', ...}

# Actualización de balance
channel: wallet:{wallet_id}:balance
-> {crc: 150000000, usd: 50000}
```

---

## MESSAGE QUEUE: KAFKA/RABBITMQ

### Topics/Queues

```
# Procesamiento de transacciones
queue: transactions.process
-> Alta prioridad, workers escalables

# Notificaciones
queue: notifications.push
queue: notifications.sms
queue: notifications.email

# Integraciones externas
queue: sinpe.outbound
queue: sinpe.inbound
queue: services.payment

# Analytics y logging
topic: events.transactions (Kafka)
topic: events.user_actions (Kafka)

# Dead letter queues
queue: transactions.dlq
queue: notifications.dlq
```

---

## ANALYTICS: CLICKHOUSE

### Tablas de Analytics

```sql
-- Eventos de usuario (append-only, masivo)
CREATE TABLE user_events (
    event_id UUID,
    user_id UUID,
    event_type String,
    event_data String, -- JSON

    device_type String,
    app_version String,
    os_version String,

    ip_address IPv4,
    country String,

    created_at DateTime
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (user_id, created_at);

-- Métricas de transacciones (agregadas)
CREATE TABLE transaction_metrics (
    date Date,
    hour UInt8,

    transaction_type String,
    currency String,

    count UInt64,
    total_amount UInt64,
    avg_amount Float64,

    success_count UInt64,
    failed_count UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, hour, transaction_type, currency);
```

---

## SEGURIDAD Y ENCRIPTACIÓN

### Niveles de Encriptación

```
┌─────────────────────────────────────────┐
│         APPLICATION LEVEL               │
│  - PIN hash (bcrypt, cost 12)           │
│  - Tokens hash (SHA-256)                │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│          FIELD LEVEL                    │
│  - Números de cuenta (AES-256-GCM)      │
│  - Números de tarjeta (AES-256-GCM)     │
│  - Datos sensibles (pgcrypto)           │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│         DATABASE LEVEL                  │
│  - TDE (Transparent Data Encryption)    │
│  - SSL/TLS en tránsito                  │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│          STORAGE LEVEL                  │
│  - Disco encriptado (LUKS/BitLocker)    │
│  - Backups encriptados                  │
└─────────────────────────────────────────┘
```

### Funciones de Encriptación

```sql
-- Extensión pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Función para encriptar datos sensibles
CREATE OR REPLACE FUNCTION encrypt_sensitive(data TEXT, key TEXT)
RETURNS BYTEA AS $$
BEGIN
    RETURN pgp_sym_encrypt(data, key);
END;
$$ LANGUAGE plpgsql;

-- Función para desencriptar
CREATE OR REPLACE FUNCTION decrypt_sensitive(data BYTEA, key TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN pgp_sym_decrypt(data, key);
END;
$$ LANGUAGE plpgsql;
```

---

## ESCALABILIDAD

### Estrategia de Sharding

```
┌─────────────────────────────────────────────────────────────┐
│                     SHARD ROUTER                             │
│              (Basado en user_id % num_shards)                │
└─────────────────────────────────────────────────────────────┘
            │               │               │
            ▼               ▼               ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   SHARD 0     │   │   SHARD 1     │   │   SHARD 2     │
│  users 0-33%  │   │ users 34-66%  │   │ users 67-100% │
│  + wallets    │   │  + wallets    │   │  + wallets    │
│  + tx         │   │  + tx         │   │  + tx         │
└───────────────┘   └───────────────┘   └───────────────┘
```

### Read Replicas

```
┌─────────────────┐
│  PRIMARY (RW)   │
│   PostgreSQL    │
└────────┬────────┘
         │ Streaming Replication
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌───────┐ ┌───────┐ ┌───────────┐
│REPLICA│ │REPLICA│ │  REPLICA  │
│   1   │ │   2   │ │ (Analytics)│
│  (R)  │ │  (R)  │ │    (R)    │
└───────┘ └───────┘ └───────────┘
```

---

## BACKUP Y DISASTER RECOVERY

### Estrategia 3-2-1

```
3 copias de datos:
  - Producción (Primary)
  - Replica en otra AZ
  - Backup offsite

2 tipos de storage:
  - SSD (hot)
  - S3/Object Storage (cold)

1 copia offsite:
  - Región diferente (DR)
```

### RPO y RTO

| Escenario | RPO | RTO |
|-----------|-----|-----|
| Falla de nodo | 0 | < 30s |
| Falla de AZ | < 1 min | < 5 min |
| Falla de región | < 5 min | < 1 hora |
| Corrupción de datos | < 1 hora | < 4 horas |

---

## MONITOREO

### Métricas Clave

```
# Database
- Queries por segundo
- Latencia p50, p95, p99
- Conexiones activas
- Replication lag
- Disk I/O
- Buffer hit ratio

# Cache
- Hit rate
- Memory usage
- Keys count
- Evictions

# Queue
- Queue depth
- Processing rate
- Error rate

# Application
- Transacciones por segundo
- Error rate
- Response time
```

### Alertas Críticas

```yaml
alerts:
  - name: HighTransactionLatency
    condition: p99_latency > 500ms
    severity: critical

  - name: ReplicationLag
    condition: lag > 10s
    severity: critical

  - name: LowCacheHitRate
    condition: hit_rate < 80%
    severity: warning

  - name: QueueBacklog
    condition: queue_depth > 10000
    severity: critical
```

---

## COSTO ESTIMADO (AWS)

### Producción Inicial

| Servicio | Especificación | Costo/mes |
|----------|----------------|-----------|
| RDS PostgreSQL | db.r6g.xlarge (primary) | $400 |
| RDS PostgreSQL | db.r6g.large x2 (replicas) | $400 |
| ElastiCache Redis | cache.r6g.large | $200 |
| MSK Kafka | kafka.m5.large x3 | $450 |
| EC2 (API) | c6g.xlarge x3 | $300 |
| Load Balancer | ALB | $50 |
| S3 + Backups | 500GB | $50 |
| **Total** | | **~$1,850/mes** |

### Escalado (100K+ usuarios)

| Servicio | Especificación | Costo/mes |
|----------|----------------|-----------|
| RDS PostgreSQL | db.r6g.2xlarge (primary) | $800 |
| RDS PostgreSQL | db.r6g.xlarge x3 (replicas) | $1,200 |
| ElastiCache Redis | cache.r6g.xlarge cluster | $600 |
| MSK Kafka | kafka.m5.xlarge x3 | $900 |
| EC2 (API) | c6g.2xlarge x6 + ASG | $1,200 |
| CloudFront + WAF | | $200 |
| **Total** | | **~$5,000/mes** |

---

## PRÓXIMOS PASOS

1. **Fase 1:** Implementar esquema básico (users, wallets, transactions)
2. **Fase 2:** Agregar servicios y comercios
3. **Fase 3:** Implementar sharding cuando supere 1M usuarios
4. **Fase 4:** Migrar a arquitectura multi-región para expansión

---

Esta arquitectura está diseñada para **superar a la competencia** en:
- **Velocidad:** Transacciones < 100ms
- **Confiabilidad:** 99.99% uptime
- **Seguridad:** Encriptación end-to-end
- **Escalabilidad:** De 10K a 10M usuarios sin rediseño
