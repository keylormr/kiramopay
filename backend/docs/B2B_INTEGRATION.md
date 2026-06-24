# Guía de integración B2B — KiramoPay

Cómo integrar tu comercio con el API de KiramoPay: crear depósitos en
garantía (escrow) programáticamente y recibir notificaciones firmadas por
webhook. Referencia completa de endpoints en `openapi.yaml` (Swagger UI en
`/api/docs`).

## 1. Credenciales

Las API keys se gestionan desde tu cuenta (sesión JWT normal):

```bash
curl -X POST $BASE/api/v1/b2b/keys \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "backend de checkout", "scopes": "escrow:read,escrow:write"}'
```

La respuesta incluye `full` — **la key completa (`kp_live_…`) se muestra una
única vez**; guardala en tu gestor de secretos. Después solo verás el
`prefix`. En la base solo se almacena un hash SHA-256.

**Scopes** (principio de mínimo privilegio):

| Scope | Permite |
|---|---|
| `escrow:read` | listar y consultar acuerdos |
| `escrow:write` | crear, fondear, liberar, reembolsar, disputar, cancelar |

Vacío = ambos. Una key sin el scope necesario recibe `403 INSUFFICIENT_SCOPE`.
Revocá keys con `DELETE /api/v1/b2b/keys/{id}` (efecto inmediato).

## 2. Autenticación del API de comercios

Todas las rutas viven bajo `/api/b2b/v1/*`. Presentá la key en cualquiera de
los dos headers:

```
X-API-Key: kp_live_…
# o bien
Authorization: Bearer kp_live_…
```

Verificá conectividad: `GET /api/b2b/v1/ping` → `{ "status": "ok",
"merchant_id": "…" }`. Rate limit: **300 requests/min** por comercio.

## 3. Flujo de escrow

El dinero se mueve por libro contable de doble partida contra la cuenta
`SYSTEM:ESCROW` — los fondos retenidos son auditables y entran al
proof-of-reserves público.

```
pending ──fund──▶ funded ──release──▶ released   (comprador → escrow → vendedor)
   │                │ ├────refund───▶ refunded   (escrow → comprador)
   └─cancel─▶ cancelled └──dispute──▶ disputed ──(admin)──▶ released|refunded
```

```bash
# 1. Crear el acuerdo (vos = comprador; montos en centimos: 250000 = ₡2,500.00)
curl -X POST $BASE/api/b2b/v1/escrow \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"seller_id": "<uuid>", "amount_minor": 250000, "currency": "CRC",
       "description": "Pedido #1042"}'

# 2. Fondear (debita tu wallet → SYSTEM:ESCROW). MFA requerido ≥ ₡100,000.
curl -X POST $BASE/api/b2b/v1/escrow/$ID/fund -H "X-API-Key: $KEY"

# 3a. Liberar al vendedor cuando recibís el bien/servicio (solo comprador)
curl -X POST $BASE/api/b2b/v1/escrow/$ID/release -H "X-API-Key: $KEY"

# 3b. … o el vendedor renuncia y reembolsa (solo vendedor)
curl -X POST $BASE/api/b2b/v1/escrow/$ID/refund -H "X-API-Key: $KEY"

# 3c. … o cualquiera de las partes disputa (resuelve un admin)
curl -X POST $BASE/api/b2b/v1/escrow/$ID/dispute \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"reason": "no recibí el artículo"}'
```

Errores relevantes: `409 ESCROW_INVALID_STATE` (transición no permitida —
p.ej. doble fund), `422 INSUFFICIENT_BALANCE`, `403 MFA_REQUIRED` /
`ESCROW_BUYER_ONLY` / `ESCROW_SELLER_ONLY` / `INSUFFICIENT_SCOPE`.

Las operaciones de dinero son **idempotentes** del lado del servidor
(claves deterministas por acuerdo): reintentar un `fund`/`release`/`refund`
que ya ocurrió nunca duplica el movimiento.

## 4. Webhooks

Registrá un endpoint HTTPS y los eventos que te interesan:

```bash
curl -X POST $BASE/api/v1/b2b/webhooks \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"url": "https://tutienda.cr/hooks/kiramopay",
       "events": "escrow.funded,escrow.released,escrow.disputed"}'
```

La respuesta trae el `secret` (`whsec_…`) para verificar firmas — guardalo;
en reposo solo existe cifrado. `events: "*"` (default) suscribe a todo.

**Eventos**: `escrow.created`, `escrow.funded`, `escrow.released`,
`escrow.refunded`, `escrow.disputed`, `escrow.cancelled`. Ambas partes del
acuerdo reciben el evento en sus propios endpoints.

**Entrega**: POST JSON con headers:

```
X-Kiramopay-Event:     escrow.funded
X-Kiramopay-Delivery:  <uuid único de esta entrega>
X-Kiramopay-Timestamp: <unix seconds del envío>
X-Kiramopay-Signature: sha256=<hex(HMAC-SHA256(secret, "<timestamp>.<body>"))>
```

La firma cubre `"<timestamp>.<body>"` (estilo Stripe), no solo el body, para que
puedas rechazar entregas viejas (replay). Respondé `2xx` en <10s. Si no, se
reintenta con backoff exponencial (30s → 1h, máximo 8 intentos) y podés
inspeccionar el estado en `GET /api/v1/b2b/webhooks/{id}/deliveries`.

**Verificación de firma** (Node.js):

```js
const crypto = require("node:crypto");

function verify(secret, rawBody, timestamp, signatureHeader) {
  // Rechazá entregas fuera de una tolerancia (p. ej. 5 min) para evitar replay.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = "sha256=" +
    crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

(Go):

```go
func verify(secret string, body []byte, timestamp, header string) bool {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(timestamp))
    mac.Write([]byte("."))
    mac.Write(body)
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(expected), []byte(header))
}
```

**Recomendaciones**: verificá la firma sobre el body CRUDO (antes de parsear
JSON); rechazá entregas con `X-Kiramopay-Timestamp` fuera de una ventana de
tolerancia (anti-replay) y compará la firma en tiempo constante (`hmac.Equal` /
`timingSafeEqual`); deduplicá por `X-Kiramopay-Delivery` (los reintentos
reutilizan el mismo id); tratá los webhooks como señal y confirmá el estado con
`GET /api/b2b/v1/escrow/{id}` antes de despachar mercadería.

> **Nota**: la URL del endpoint debe apuntar a un host público. Se rechazan
> destinos privados/loopback/link-local/metadata de nube (protección SSRF), y no
> se siguen redirects.

## 5. Sandbox / pruebas

No hay ambiente sandbox separado todavía: probá contra tu propio deploy
(docker-compose local o staging) con los usuarios de prueba del seeder. Las
keys siempre llevan prefijo `kp_live_`.
