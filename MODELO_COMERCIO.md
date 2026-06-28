# Modelo de comercio — cobro por QR, comisión y verificación

> Documento de referencia del riel de comercio de KiramoPay: qué construimos, en
> qué nos inspiramos, qué hacemos diferente y cómo funciona por dentro. Pensado
> para tres lecturas: una de negocio/estratégica (secciones 1–3), una técnica y de
> due-diligence (secciones 4–6) y una guía para el comerciante (sección 7).
>
> Estrategia de marca y producto más amplia: ver `ESTRATEGIA_PRODUCTO_MARCA.md`.
> Arquitectura de datos: `ARQUITECTURA_BASE_DATOS.md`. Estado técnico:
> `ESTADO_TECNICO.md`.

---

## 1. Resumen ejecutivo

KiramoPay incorpora el patrón de pago que volvió masivos a los mercados con mayor
adopción digital del mundo: **cobrar con un código QR, sin datáfono, con una
comisión baja, moviendo el dinero de cuenta a cuenta**. Cualquier persona puede
registrar uno o varios comercios, y —una vez verificado— mostrar un QR para que el
cliente pague desde su teléfono. El comercio recibe el dinero al instante; la
plataforma cobra una comisión pequeña (por defecto 0,50 %) que el comercio asume,
igual que el modelo de tarjetas, pero a una fracción del costo.

Lo construimos como un riel **abierto, multi-mercado y con cumplimiento desde el
diseño**: la verificación del comercio (KYC) es parte del alta, y la lógica de
dinero corre sobre un libro mayor de doble entrada, auditable al céntimo. No es una
demo: el movimiento de dinero, la comisión y la idempotencia están cubiertos por
pruebas de integración reales contra la base de datos.

---

## 2. En qué nos inspiramos

El modelo de referencia es el de los mercados que saltaron del efectivo al pago
móvil sin pasar masivamente por la tarjeta:

- **Alipay y WeChat Pay.** Popularizaron el **QR del comercio**: el negocio no
  necesita un datáfono ni un contrato con una red de tarjetas; basta con mostrar un
  código. El pago es **cuenta a cuenta (A2A)** y la comisión al comercio es baja
  (del orden de medio punto porcentual), frente al 2–3 % típico de las tarjetas. El
  comercio absorbe esa comisión, como ocurre con el MDR de las tarjetas.
- **Pix (Brasil).** El sucesor *abierto* del modelo: nació interoperable entre
  todas las instituciones desde el primer día, con P2P gratuito y el comercio
  pagando una tarifa baja. Demostró que el QR A2A no tiene por qué vivir en un
  jardín cerrado.

Lo que copiamos, en una línea: **QR sin datáfono, comisión baja, dinero A2A**.

El análisis estratégico completo (qué copiar y en qué diferir) está en
`ESTRATEGIA_PRODUCTO_MARCA.md`, sección "El modelo de referencia: China
(Alipay/WeChat) — y su sucesor abierto, Pix".

---

## 3. Qué hacemos diferente

Copiar el QR de comercio es la parte fácil; la ventaja está en cómo lo montamos:

1. **Abierto e interoperable, no un jardín cerrado.** Las super-apps chinas
   nacieron cerradas y solo tuvieron que abrir la interoperabilidad años después,
   por regulación. Nosotros partimos del modelo Pix: abierto desde el día uno.
2. **Sobre el riel del Estado, no en su contra.** El objetivo es montarse sobre la
   infraestructura de pago pública/instantánea de cada mercado (tipo SINPE o Pix),
   no reemplazarla. Eso baja el costo y el riesgo regulatorio.
3. **Multi-mercado por software.** El modelo no está atado a un país: la misma base
   de código sirve a varios mercados. En materiales de cara a inversor el encuadre
   es **global**, no de un solo país.
4. **La comisión la absorbe el comercio, con transparencia total.** El pagador paga
   exactamente el monto que ve en el QR; el comercio recibe ese monto menos la
   comisión. No hay sorpresas para quien paga. Es el estándar de la industria
   (tarjetas, Alipay, Pix), pero explícito y auditable.
5. **Cumplimiento desde el diseño.** El alta de comercio captura datos de identidad
   (KYC ligero) y deja al comercio "pendiente de verificación" hasta que un
   administrador lo aprueba. El riel queda listo para enchufar un proveedor de KYC
   automático cuando se contrate, sin rediseñar nada.
6. **Privacidad como marca.** El rol de administrador y los controles sensibles no
   se exponen al cliente; el servidor es la única fuente de verdad de los permisos.

---

## 4. Cómo funciona el modelo de comercio (técnico)

### 4.1 Multi-comercio y verificación

Una misma cuenta puede registrar **varios comercios** (por ejemplo, una persona con
dos negocios). Cada comercio guarda:

- Nombre, categoría (restaurante, retail, servicios, food truck, mercado) y
  descripción.
- **KYC ligero**: cédula (física o jurídica) y razón social.
- **Estado de verificación**: `pending` → `verified` o `rejected`. Un comercio
  arranca pendiente; un administrador lo aprueba o rechaza (con motivo).
- **Comisión** en puntos básicos (`commission_bps`, por defecto 50 = 0,50 %),
  configurable por comercio por el administrador.

Solo un comercio **verificado** puede emitir QR de cobro y cobrar. Esto hace que la
verificación sea un control real, no decorativo.

### 4.2 La comisión, por el libro mayor (doble entrada)

El núcleo del modelo es cómo se mueve el dinero. KiramoPay no "resta un número":
cada pago es un asiento de **doble entrada** en el libro mayor (`ledger`), que un
disparador de base de datos valida como balanceado antes de confirmar.

En un pago a comercio de monto `A` con comisión `f`:

| Cuenta | Débito | Crédito |
|---|---|---|
| Pagador | `A` | |
| Comercio (recibe neto) | | `A − f` |
| `SYSTEM:FEES` (plataforma) | | `f` |

Débitos = `A`; créditos = `(A − f) + f` = `A`. El asiento balancea. El pagador paga
exactamente `A`; el comercio recibe `A − f`; la plataforma se queda con `f`. La
comisión se calcula en céntimos con aritmética entera (`f = A × bps / 10000`,
truncada al céntimo) para que no haya errores de redondeo con decimales.

Esto se implementó como una variante del primitivo de transferencia interna
(`CreateTransfer`) con un indicador nuevo, **`FeeFromReceiver`**, que selecciona
quién absorbe la comisión:

- **Comercio absorbe** (este modelo): el pagador paga `A`, el comercio recibe
  `A − f`.
- **Pagador absorbe** (el modelo clásico, intacto): el pagador paga `A + f`, el
  receptor recibe `A`.

Los pagos entre personas (P2P) no llevan comisión: siguen siendo 1:1, como Pix.

### 4.3 Idempotencia (no cobrar dos veces)

Un cobro por QR es idempotente de extremo a extremo: si el cliente reintenta por un
fallo de red, el sistema reconoce el reintento por la clave de idempotencia
`qr:{código}:{pagador}` y devuelve el mismo pago, sin mover dinero de nuevo ni
duplicar el registro histórico. La idempotencia del libro mayor garantiza que el
dinero se mueve una sola vez.

### 4.4 Administración

Endpoints de administrador (protegidos por rol en el servidor):

- `GET /admin/merchants/pending` — comercios por revisar.
- `POST /admin/merchants/{id}/approve` — aprobar.
- `POST /admin/merchants/{id}/reject` — rechazar (con motivo).
- `PATCH /admin/merchants/{id}/commission` — ajustar la comisión del comercio.

La pantalla de administración en la app aparece **solo** para administradores. El
rol no viaja al cliente: la app pregunta al servidor si el endpoint de
administración responde, y solo entonces muestra la opción. El servidor es la única
fuente de verdad de los permisos.

---

## 5. Mejoras y procesos de esta entrega

El riel de comercio se construyó y endureció en una secuencia de cambios revisados
y verificados:

- **Cobrar con QR** y **Pago por QR con cámara**: generar un QR de cobro real y
  pagarlo escaneándolo, moviendo el dinero por el libro mayor.
- **Panel de comercio + comisión + verificación**: alta multi-comercio con KYC
  ligero, comisión 0,50 % absorbida por el comercio y verificación por
  administrador. Vistas de comerciante y de administración.
- **Pulido**: el administrador ajusta la comisión por comercio; el panel lista los
  QR de cada comercio.
- **Pruebas de contrato** de los endpoints de dinero (SINPE y servicios), para que
  la respuesta real del backend no se desvíe del contrato publicado.

### Hallazgos de la revisión (dos errores reales de producción, corregidos)

Una revisión adversarial y las nuevas pruebas de integración —que por primera vez
ejercitaron el cobro por QR contra una base de datos real— destaparon dos defectos
que estaban latentes:

1. Los registros de QR pasaban el identificador del comercio como texto a una
   columna de tipo `uuid`; el cobro de comercio habría fallado en producción.
2. **Más serio**: la clave de idempotencia del receptor superaba por un carácter el
   largo de la columna que la almacena. Esto rompía **todo** pago por QR (no solo el
   de comercio), incluido el flujo ya desplegado. En la práctica, el pago por QR
   nunca había funcionado de extremo a extremo contra la base real, porque nunca se
   había probado así. Se corrigió ampliando la columna.

La lección quedó registrada: **el camino de dinero de cada dominio necesita una
prueba de integración real contra la base de datos, no solo simulaciones.**

### Cómo se verifica

Todo cambio pasa por la misma compuerta antes de integrarse: compilación, análisis
estático y de seguridad (sin hallazgos), validación de la cadena de migraciones, y
pruebas de integración que comprueban el movimiento de dinero al céntimo (el
comercio recibe el neto, la comisión llega a la cuenta de plataforma, y un reintento
no duplica nada). En el frontend: verificación de tipos, linting, suite de pruebas y
build de producción.

---

## 6. Qué falta (no es código)

El núcleo del modelo —cobrar y pagar de billetera a billetera por el libro mayor—
está construido. Lo que falta para llevarlo a producción plena **no es programación,
es licencia y alianzas**:

- **Liquidación sobre el riel instantáneo del Estado** (tipo SINPE/Pix): requiere
  ser participante regulado y/o un banco patrocinador.
- **KYC automático** (verificación de identidad contra registros): requiere
  contratar un proveedor. El riel ya está preparado para enchufarlo.
- **Transfronterizo con stablecoins**: requiere custodia/figura VASP.

Ver `ROADMAP_JPC.md` para el detalle regulatorio.

---

## 7. Guía para el comerciante

Cómo cobrar con KiramoPay, en pasos simples:

1. **Registrá tu comercio.** En el perfil, entrá a "Panel de comercio" y registrá
   tu negocio: nombre, categoría, cédula (física o jurídica) y razón social. Podés
   tener más de un comercio.
2. **Esperá la verificación.** Tu comercio queda "pendiente de verificación"
   mientras un administrador lo revisa. Es un paso de seguridad y cumplimiento.
3. **Generá tu QR de cobro.** Una vez verificado, creás un código QR: con **monto
   fijo** (para un precio concreto) o **monto abierto** (para que el cliente
   ingrese cuánto paga).
4. **Cobrá.** El cliente escanea tu QR desde su teléfono y paga. Recibís el dinero
   al instante.
5. **Revisá tus cobros.** En el panel ves cada cobro con el monto bruto, la comisión
   (0,50 % por defecto) y el **neto recibido**.

La comisión la asumís vos, el comercio: tu cliente paga exactamente el monto que ve.
Es el mismo modelo de las tarjetas, a una fracción del costo.
