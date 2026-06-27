# Estrategia de producto y marca — KiramoPay

Análisis estratégico sobre cuatro decisiones: chatbot de IA, interoperabilidad
de transferencias, diferenciación de marca y posicionamiento vs. competencia.
Anclado en lo que **KiramoPay ya tiene construido** y en la realidad
regulatoria de Costa Rica — varias de estas decisiones chocan con licencias,
no con código.

> **Premisa transversal.** El producto técnico está avanzado (ledger de doble
> partida, escrow, API B2B, cripto, SINPE, MFA, observabilidad). La brecha real
> frente a un incumbente regulado como JPC **no es código — es regulación**
> (licencia PSP / banco patrocinador, KYC real, VASP cripto). El marketing no
> puede correr más rápido que la licencia.

---

## 1. Chatbot de IA "vendedor" basado en el usuario

KiramoPay ya tiene `GEMINI_API_KEY` cableado y, más importante, **todos los
dominios** que un asistente necesitaría operar (SINPE, pagos, cripto, QR,
split, presupuestos, recurrentes, lealtad). Eso lo vuelve un caso ideal, no un
add-on cosmético.

### Beneficios concretos

- **Comercio conversacional → menos fricción.** "Pasale ₡20 mil a mi mamá",
  "comprá $50 en bitcoin", "pagá la luz" ejecutados en lenguaje natural en vez
  de navegar menús. En una región de bancarización media, bajar la barrera de
  uso **sube transacciones por usuario** directamente.
- **Cross-sell contextual** (el "vender servicios basado en el user"). Como
  existe el **ledger + historial de transacciones**, el bot ve patrones reales:
  *"Gastaste ₡180k en comida este mes — ¿activo un presupuesto?"* (dominio
  budget), *"Tenés ₡500k quietos — ¿los pongo a generar con staking?"* (cripto
  staking). Sube el **ARPU** ofreciendo lo de mayor margen en el momento de
  intención.
- **Asistente proactivo → engagement/retención.** Recordatorios de pagos
  recurrentes, alertas de flujo de caja, nudges de ahorro. Es lo que convierte
  una app de pagos en una **super-app pegajosa** (métrica clave:
  aperturas/semana).
- **Deflección de soporte → costo.** "¿Por qué me cobraron esto?" se responde
  leyendo el audit log + la transacción, sin agente humano.
- **Lado B2B.** Un bot que ayuda a comercios a configurar escrow/webhooks/keys
  baja el costo de onboarding de merchants.

### Guardrail no negociable

En fintech el LLM **nunca decide mover dinero**. Patrón correcto:

1. El bot interpreta intención y arma la operación.
2. El usuario **confirma de forma determinista**.
3. La operación pasa por los gates que ya existen (MFA ≥100K CRC, fraud
   scoring, límites diarios).

El LLM es la capa de conversación, no la de autorización. Y cuidado con dar
"asesoría financiera" (regulada): el bot **sugiere, no aconseja** productos de
inversión.

---

## 2. Interoperabilidad de transferencias (JPC, Revolut y demás)

No existe un botón mágico "enviar a Revolut". Hay que separar dos mundos.

### Dentro de Costa Rica (JPC, bancos, otras wallets)

El riel universal es **SINPE**, operado por el BCCR. JPC, los bancos y cualquier
PSP regulado **liquidan todos por SINPE**. Es decir: transferir a un usuario de
JPC = transferir a su número/IBAN SINPE — **no se integra con JPC; ambos tocan
SINPE**. KiramoPay ya tiene SINPE Móvil en código.

El bloqueo **no es técnico, es ser participante SINPE**: exige ser entidad
regulada o ir vía un **banco patrocinador (sponsor bank)**. Es la ruta crítica
que marca la auditoría del proyecto.

### Internacional (Revolut, etc.)

Revolut no es un riel, es otra wallet. "Mandar a Revolut" = pagar a una
cuenta/IBAN del destino. Opciones reales:

| Vía | Qué es | Realismo |
|---|---|---|
| **Partners de remesas/FX** (dLocal, Wise Platform, Thunes, Nium) | APIs de *pay-out* a cuentas/wallets de otros países. **dLocal** es LatAm-fuerte y opera en CR. | Lo estándar. Requiere contrato + licencia. |
| **Stablecoins como puente** (USDC/USDT) | CR → USDC on-chain → off-ramp en destino. **KiramoPay ya tiene cripto.** | Lo más *único* y técnicamente factible ya, pero con fricción VASP. |
| SWIFT directo | Riel bancario tradicional | Caro, lento, no para esta etapa. |

### La buena noticia arquitectónica

El código ya está listo: **repository pattern**, dominio `country` (multi-moneda
CR/PA/GT, cross-border) y el **ledger** que da la contabilidad. Sumar
interoperabilidad = un **adapter por riel** (`SINPEPayout`, `dLocalPayout`,
`CirclePayout`) detrás de una interfaz `PayoutRail`; el escrow/ledger
contabilizan igual. **Lo que falta no es código — son licencias y contratos con
cada partner.**

---

## 3. Qué hace única a la marca

Ninguna *feature* sola da unicidad (todas son copiables). Lo defendible es **la
combinación** y el enfoque geográfico:

- **Super-app real para Centroamérica, no solo pagos.** JPC es básicamente
  PSP/cobros. KiramoPay tiene pagos **+ cripto + tarjetas + lealtad +
  marketplace + multi-país (CR/PA/GT)** en una sola app. Ángulo "Alipay/Nubank
  de Centroamérica", categoría que JPC **no ocupa**.
- **Fiat y cripto en el mismo libro de doble partida.** Casi nadie en la región
  une SINPE + cripto con contabilidad real. Habilita el puente **fiat ↔ cripto
  ↔ remesas**.
- **Plataforma B2B con escrow + API + webhooks.** Diferenciador B2B genuino:
  marketplaces locales, freelancers, compraventa P2P segura. **JPC no lo ataca
  con la misma profundidad** y es el *wedge* más defendible.
- **Transparencia / proof-of-reserves público.** En una región con desconfianza
  a las fintech, *"podés verificar nuestras reservas"* es un diferenciador de
  **confianza**, no de feature.
- **Hecho en Costa Rica + multi-idioma (5, incl. zh-tw, ja, hi).** Orgullo local
  como sello de confianza; abre turismo e inversión asiática.

**En una frase:** *la super-app financiera de Centroamérica que unifica tu
plata, tus cripto, tus pagos y tu negocio — con reservas verificables.* Eso,
más los efectos de red (comercios + usuarios), es el moat real a largo plazo.

---

## 4. Posicionamiento, marca y publicidad vs. competencia

**Error a evitar:** competir como "otro JPC" (pelea de pagos contra un
incumbente regulado). **Posicionarse una categoría arriba**: super-app
(referentes: Nubank, Mercado Pago, Alipay — no JPC).

### El wedge de entrada = B2B, no B2C

Contraintuitivo pero es el lado más fuerte y **menos bloqueado por regulación**:
escrow entre usuarios y **cobros QR de comercios usan los rieles SINPE
existentes**. Replica el playbook de Mercado Pago: **cada comercio que cobra con
KiramoPay trae a sus clientes**. El producto B2B ya construido (escrow + API +
webhooks) es el gancho.

### Segmentos y mensaje

| Segmento | Gancho | Mensaje |
|---|---|---|
| PYMEs / comercios | Escrow + QR + API de cobros | "Cobrá seguro, sin chargebacks, con API para tu sistema" |
| Jóvenes digitales | Cripto + UX conversacional | "Tu primera cuenta de cripto y colones, en una app" |
| Familias con migrantes | Remesas vía stablecoin | "Recibí del exterior más barato" *(depende del partner FX)* |
| No bancarizados | Chatbot en lenguaje natural | "Hablale a la app, ella se encarga" |

### Canales

- **B2B-led growth** (el principal): PYMEs/comercios como puerta de entrada
  masiva de usuarios.
- **Referidos + cashback** — el dominio `loyalty` ya está; usarlo como motor de
  crecimiento, no como adorno.
- **Educación financiera + cripto** como contenido (confianza + SEO).
- **Partnerships locales**: turismo, universidades, gremios de PYMEs.

### Comparación de marca

| Eje | KiramoPay | JPC | Bancos CR | PayPal/Wise |
|---|---|---|---|---|
| Super-app (todo-en-uno) | ✅ | Parcial | ❌ | ❌ |
| Cripto + fiat unificado | ✅ | ❌ | ❌ | ❌ |
| API B2B + escrow | ✅ | Parcial | ❌ | ❌ |
| Transparencia / reservas | ✅ | ❌ | ❌ | ❌ |
| Multi-país CA | ✅ (CR/PA/GT) | CR | CR | Global |
| **Respaldo regulatorio** | **⚠️ pendiente** | ✅ | ✅ | ✅ |

### La verdad incómoda de marketing

Ese ⚠️ de la última fila es el techo. Hasta ser PSP licenciado/patrocinado con
KYC real, **no posicionarse como "banco"** — posicionarse como
**plataforma/wallet** y crecer por el lado B2B donde el producto ya es fuerte.
Prometer de más en fintech es como llega la clausura.

---

## El modelo de referencia: China (Alipay/WeChat) — y su sucesor abierto, Pix

La inspiración correcta es el modelo de pagos chino, pero leído con cuidado y con
una corrección importante.

**Qué demostró China.** Alipay (~54%) y WeChat Pay (~42%) concentran ~90% de los
pagos móviles **por QR — no por datafono** — con comisión al comercio de
~0.5-0.6% (vs 2-3% de Visa/MC, que históricamente casi no se usaron adentro). El
QR sin hardware es lo que desbloqueó la adopción masiva y el costo bajo.

**Dos matices para no equivocarse en una mesa:**

- **UnionPay NO es solo nacional.** Se acepta en ~183 países, tiene 230M+
  tarjetas emitidas fuera de China y es el 2º esquema del mundo por volumen
  (detrás de Visa). Adentro domina; afuera su aceptación es menor que Visa/MC. Un
  esquema "nacional" sí puede globalizarse — pero le tomó ~20 años y como red de
  tarjetas (cara y lenta).
- **El gran error de China fueron los silos cerrados.** Alipay y WeChat no se
  pagaban entre sí; el regulador tuvo que **forzar la interoperabilidad de sus QR
  en 2021**. El modelo cerrado fue su límite, no su fortaleza.

**El sucesor ya existe en LatAm y está mejor diseñado: Pix (Brasil).** Banco
central, **gratis para personas / 0.33% al comercio** (vs 2.34% crédito), QR,
150M+ usuarios, y ya procesa **más transacciones que Visa+MC juntas en Brasil** —
pero **nació abierto e interoperable**, evitando el error chino. Pix prueba que el
modelo funciona en un mercado parecido al nuestro, sobre un **riel del banco
central** (el equivalente a SINPE en CR).

### Qué copiar

1. **QR, no datafono** — alta del comercio con una calcomanía, cero hardware.
2. **Comisión baja como cuña** (~0.5-1% vs 2-3% de tarjetas).
3. **Cuenta-a-cuenta (A2A)** sobre el riel instantáneo local, salteando a Visa/MC.
4. **Super-app** — el pago es el gancho; arriba, los servicios (ya el ADN del producto).

### En qué diferir (la ventaja, no la copia)

1. **Abierto e interoperable desde el día uno** — lo que China corrige a la fuerza
   y Pix hizo de entrada. Es exactamente el posicionamiento de **rieles
   intercambiables**: ser la capa, no el silo.
2. **Montarse sobre el riel del Estado, no reemplazarlo** — en CR, SINPE; en BR,
   Pix. La super-app encima del riel del banco central alinea con el regulador
   (clave para la licencia) en vez de competir contra él.
3. **Multi-mercado por software** — enchufar el sistema instantáneo de cada país
   (SINPE, Pix, SPEI...) con "registrar un adaptador, no rehacer", en vez de
   construir una red de tarjetas global como UnionPay.
4. **Cross-border vía stablecoins** — donde China usa e-CNY adentro y Alipay+ para
   viajeros, el diferencial global es el riel de stablecoins para lo transfronterizo
   (lo que tarjetas/UnionPay hacen caro y lento).
5. **Privacidad + trazabilidad como marca** — el modelo chino es vigilancia +
   duopolio de datos; una super-app de LatAm puede diferenciarse en privacidad y
   en el libro contable auditable (confianza sin vigilancia).

> Conclusión operativa, la misma de todo el documento: **el destino (QR-first,
> A2A, comisión baja, super-app abierta) es alcanzable; el cuello de botella no es
> el código, es el riel regulado** (SINPE/PSP — ver `ROADMAP_JPC.md`). Pix prueba
> que cuando el riel está, el modelo escala.

> Fuentes: UnionPay International (alcance ~183 países); Visual Capitalist
> (volúmenes Visa/Mastercard/UnionPay, 2023); Banco Central do Brasil (Pix) y
> reporte de Pix superando a Visa+MC en Brasil. Comisiones: Alipay/WeChat ~0.6%;
> Pix 0.33% comercio / gratis personas; Visa/MC ~2-3%.

---

## Secuencia recomendada

1. **Lanzar el wedge B2B** (escrow + cobros QR para PYMEs) — ya construido y
   poco bloqueado.
2. **Sumar el chatbot conversacional** como diferenciador de marca visible.
3. **En paralelo**: conseguir **sponsor bank + KYC real** (Truora) — la ruta
   crítica regulatoria.
4. **Recién ahí**: abrir remesas/interoperabilidad internacional con un partner
   FX (dLocal/Wise) o stablecoins.

## Próximos pasos accionables en código (cuando se decida)

- Interfaz `PayoutRail` + adapter mock — deja lista la interoperabilidad para
  cuando exista el partner.
- Capa de chatbot (Gemini) sobre los repositorios existentes, con confirmación
  determinista y los gates de MFA/fraude.
- Frontend de escrow / gestión de API keys (pendiente del bloque B2B).

> Documentos relacionados: `ROADMAP_JPC.md`, `ESTUDIO_MERCADO_JPC_2026-06.md`,
> `backend/docs/B2B_INTEGRATION.md`.
