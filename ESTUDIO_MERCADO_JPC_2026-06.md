# Estudio de mercado: KiramoPay vs JPC

**Fecha:** 2026-06-05
**Competidor analizado:** JPC App / JPC Solutions S.R.L. (`app.jpc.fi.cr`)
**Fuentes:** sitio oficial `jpc.fi.cr`, Circle Alliance Directory, Google Play / App Store, Wise SWIFT registry, prensa CR.
**Nota de método:** el flujo de registro real de JPC vive detrás de login (SPA), no fue accesible en vivo; el análisis de onboarding se basa en información pública y debe validarse con un recorrido manual de la app.

---

## 1. Resumen ejecutivo

JPC es el **competidor de referencia más relevante** para KiramoPay: ofrece casi el mismo set de features (SINPE, multi-país, billetera, presupuesto por sobres, crypto, tarjetas) pero **ya está en producción, regulado y operando**. La diferencia clave no es de funcionalidad sino de **decisiones estratégicas**:

> **JPC es, en esencia, "KiramoPay si hubiera tomado las decisiones correctas":** se posiciona como **proveedor de servicios de pago regulado (PSP), no como banco**; hace **crypto vía partners** (Coinpay.cr + Circle/USDC), no in-house; emite **tarjetas vía programa Mastercard**, no almacenando PAN propio; y entrega **cuentas IBAN reales** apoyado en rieles bancarios.

Cada una de esas decisiones corresponde exactamente a un **bloqueante P0/P1 de la auditoría de KiramoPay** (crypto roto, tarjetas con PAN en claro, ausencia de licencia). JPC demuestra que el camino viable existe y ya fue recorrido por un actor local.

### Veredicto competitivo

- **Tesis validada:** el mercado para una super-app de pagos CR multi-país con presupuesto + crypto + tarjetas **existe y es atendible** — JPC lo prueba con +10 años y apps en ambas tiendas.
- **KiramoPay no puede ganar copiando a JPC.** JPC ya tiene regulación, IBAN, Mastercard y +10 años de marca. KiramoPay necesita un **moat diferenciado** (ver §7) o un nicho.
- **Brecha más urgente:** regulación (SUGEF/SINPE PSP) y compliance (KYC/AML), no features.

---

## 2. Perfil de JPC

| Atributo | Detalle |
|---|---|
| Razón social | JPC Solutions Sociedad de Responsabilidad Limitada (San José, CR) |
| Antigüedad | +10 años en el mercado |
| SWIFT/BIC | `JSSRCRS2` (tiene código SWIFT propio → conectividad bancaria internacional) |
| Estatus regulatorio | **Registrada en SUGEF**, afiliada al BCCR como **Proveedor de Servicios de Pago (SINPE PSP, código de entidad 354)** |
| Posicionamiento | *"No somos un banco. Somos una plataforma de servicios de pago"* |
| Países | Costa Rica, México, + pago de servicios en Nicaragua y Guatemala |
| Apps | iOS + Android (también plataforma web) |

### Features de JPC

- **Cuentas IBAN** en colones y dólares (multi-cuenta).
- **Transferencias**: SINPE, SINPE Móvil (CR), **SPEI (México)**, entre cuentas propias gratis, internacionales.
- **Pago de servicios**: CR, Nicaragua, Guatemala, México.
- **Presupuesto por "sobres"** (envelopes) + reportes inteligentes de ingresos/gastos + descarga de comprobantes.
- **Crypto**: vía partner **Coinpay.cr** + integración **Circle** (USDC y EURC, Wallets, Smart Contracts, **CCTP** cross-chain; Ethereum, Polygon, Solana; on/off-ramp).
- **Tarjetas Mastercard** virtuales y físicas (programa de emisión, no PAN propio).
- **Escrow** para transacciones inmobiliarias.
- **API SaaS** para empresas (B2B).
- **Seguridad**: biometría + 2FA múltiple (One Tap, Google Authenticator, Authy, PIN JPC), cifrado, antifraude.
- **Clientes corporativos verificados** con cumplimiento AML/KYC.

---

## 3. Comparación feature a feature

| Capacidad | JPC | KiramoPay | Comentario |
|---|---|---|---|
| SINPE / SINPE Móvil | ✅ Producción, PSP regulado | ✅ Implementado (núcleo serio) | KiramoPay sin código PSP SINPE |
| Cuentas IBAN CRC/USD | ✅ Reales | ❌ No tiene IBAN | Requiere relación con banco patrocinador |
| Cross-border | ✅ CR↔MX (SPEI), internacional | ⚠️ CR↔PA↔GT (esqueleto, sin AML) | JPC ya liquida real vía Circle/CCTP |
| Pago de servicios | ✅ CR/NI/GT/MX | ✅ Implementado | Paridad |
| Presupuesto por sobres | ✅ + reportes | ✅ Budgeting + recurring | Paridad funcional |
| Crypto | ✅ **Vía partner** (Coinpay + Circle) | ❌ **In-house y roto** (regala dinero, floats, salta ledger) | Decisión arquitectónica opuesta — JPC acertó |
| Tarjetas | ✅ **Mastercard** virtual + física | ⚠️ **In-house, PAN/CVV en claro** (riesgo PCI) | JPC delega a programa certificado |
| Escrow | ✅ Inmobiliario | ❌ No | Línea de negocio adicional de JPC |
| API B2B / SaaS | ✅ | ❌ No | Fuente de ingresos B2B de JPC |
| QR pago comercio | ⚠️ No destacado | ✅ Implementado | **Posible ventaja KiramoPay** |
| Split de cuentas | ❌ No | ⚠️ Implementado (mock) | **Posible diferenciador** |
| Loyalty / cashback | ❌ No | ⚠️ Esqueleto | **Posible diferenciador** |
| Marketplace (rides/comida) | ❌ No | ⚠️ Mock | **Posible diferenciador** (estilo super-app) |
| 2FA | ✅ One Tap, Google Auth, Authy, PIN | ⚠️ PIN local + biometría | JPC más completo en MFA |
| Regulación | ✅ **SUGEF + SINPE PSP** | ❌ **Sin licencia** | Brecha crítica |
| KYC/AML | ✅ Operativo | ❌ Inexistente | Brecha crítica |
| Estado | **En producción, +10 años** | Demo / MVP no-custodial | — |

---

## 4. Las cuatro decisiones donde JPC acertó y KiramoPay debe corregir

Esto es lo más valioso del estudio: JPC ya validó el camino correcto en los 4 puntos donde la auditoría de KiramoPay marcó bloqueantes.

| # | Decisión | JPC | KiramoPay (hoy) | Lección |
|---|----------|-----|-----------------|---------|
| 1 | **Regulación** | PSP regulado SUGEF/SINPE — *"no somos un banco"* | Ambición de "banco propio con el BCCR" (USD 27M, 18-24 meses, y el BCCR no da licencias bancarias — es SUGEF) | Ir por la vía **PSP / EDE con sponsor bank**, no banco propio. JPC lo confirma como viable. |
| 2 | **Crypto** | Vía partner (Coinpay.cr + Circle USDC/EURC, CCTP) | In-house, regala dinero, floats, salta el ledger (P0-1/P0-2 de la auditoría) | **No construir custodia/exchange propio.** Integrar partner VASP. Elimina el bloqueante de un plumazo. |
| 3 | **Tarjetas** | Programa **Mastercard** (virtual + física) | In-house con **PAN/CVV en texto plano** (violación PCI directa) | Delegar emisión a programa Mastercard/Marqeta/Pomelo. Saca el scope PCI de encima. |
| 4 | **IBAN / rieles** | Cuentas IBAN reales + SWIFT propio | Sin IBAN, sin conectividad bancaria | El IBAN exige relación bancaria; va de la mano con la decisión #1. |

---

## 5. Onboarding / registro (comparado)

**JPC** (inferido de su estatus regulado y descripción pública): KYC obligatorio con verificación de identidad, cumplimiento AML, distinción cliente personal vs corporativo verificado. Como PSP regulado, **el KYC no es opcional** — es condición de operación.

**KiramoPay** (verificado en código): registro con cédula, teléfono, nombre, password — **sin KYC real, sin OCR de documento, sin sanction screening, sin verificación de identidad**. El flujo de registro es funcional para demo pero **no cumpliría el estándar que JPC ya satisface**.

> **Brecha de onboarding:** para competir con JPC en el mismo mercado regulado, KiramoPay necesita incorporar KYC (OCR + listas OFAC/UN + CDD por umbrales) como parte del registro — hoy inexistente. Es el mismo P1-4 de la auditoría.

*(Pendiente: recorrer el registro real de JPC en la app para comparar campos exactos y fricción de onboarding. Si quieres, lo hago con un recorrido en vivo.)*

---

## 6. Dónde KiramoPay está por detrás de JPC

1. **Regulación y confianza**: JPC es SUGEF/SINPE PSP con +10 años; KiramoPay no tiene licencia. En fintech, la confianza regulada es el producto.
2. **Crypto funcional vs roto**: JPC mueve USDC real vía Circle; KiramoPay regala cripto y descuadra.
3. **Tarjetas reales vs riesgo PCI**: JPC emite Mastercard; KiramoPay guarda PAN en claro.
4. **IBAN y conectividad internacional**: JPC tiene IBAN + SWIFT; KiramoPay no.
5. **MFA**: JPC ofrece Authy/Google Auth/One Tap además de PIN; KiramoPay solo PIN local + biometría.
6. **Líneas B2B**: JPC monetiza con API SaaS y escrow; KiramoPay no tiene modelo de negocio definido.

---

## 7. Dónde KiramoPay puede diferenciarse (moat potencial)

JPC es fuerte en pagos/rieles pero **débil en la capa de "super-app de consumo"**. Ahí está el espacio de KiramoPay:

1. **QR de comercio + P2P QR**: JPC no lo destaca; KiramoPay ya lo implementa. Puerta de entrada a comercios pequeños.
2. **Split de cuentas**: feature social que JPC no tiene.
3. **Loyalty / cashback**: programa de recompensas — retención que JPC no ofrece.
4. **Marketplace (rides/comida)**: el ángulo "super-app estilo Alipay" que JPC no persigue (JPC es plataforma de pagos pura).
5. **Transparencia operacional**: proof-of-reserves público + fees ex-ante + audit log exportable por el usuario — un diferenciador de marca defendible.
6. **UX de consumidor**: JPC tiene perfil más corporativo/escrow/B2B; KiramoPay puede ganar en experiencia retail si ejecuta bien.

> **Estrategia recomendada:** no competir de frente con JPC en rieles e IBAN (donde llevan 10 años). Posicionar KiramoPay como **la capa de experiencia y comercio sobre el pago** (QR, loyalty, split, marketplace, transparencia), apoyándose en un **partner PSP/sponsor bank para los rieles** — exactamente el modelo que JPC validó pero aplicado al segmento consumo/comercio.

---

## 8. Recomendaciones estratégicas (qué copiar de JPC)

| Prioridad | Acción | Inspirada en JPC |
|---|---|---|
| P0 | Reemplazar crypto in-house por **partner VASP** (Coinpay.cr o similar) | JPC usa Coinpay + Circle |
| P0 | Sacar tarjetas a **programa Mastercard/Marqeta** | JPC emite Mastercard |
| P0 | Definir vía **PSP/EDE con sponsor bank**, abandonar "banco propio" como v1 | JPC es PSP, *"no somos un banco"* |
| P1 | Incorporar **KYC/AML** en el registro | JPC es AML/KYC-compliant |
| P1 | Explorar **Circle/USDC + CCTP** para cross-border en vez de cripto custodia propia | JPC integra Circle |
| P1 | Añadir **MFA robusto** (TOTP/Authy/Google Auth) | JPC ofrece 4 métodos 2FA |
| P2 | Evaluar líneas **B2B (API SaaS)** y **escrow** como ingresos | JPC monetiza ambas |

---

## 9. Conclusión

JPC **valida el mercado y desmiente la estrategia actual de KiramoPay en cuatro puntos**: la vía regulatoria correcta es PSP/sponsor-bank (no banco propio), el crypto y las tarjetas se hacen con partners (no in-house), y el KYC es obligatorio (no opcional). Cada uno de esos puntos coincide con un bloqueante de la auditoría — JPC es la prueba viviente de que la corrección recomendada es la que ya funciona en el mercado.

KiramoPay **no debería intentar ser un JPC mejor** en rieles e IBAN: perdería contra 10 años de ventaja y regulación. Su oportunidad real es la **capa de super-app de consumo y comercio** (QR, loyalty, split, marketplace, transparencia) montada sobre rieles de un partner regulado — un posicionamiento que JPC, con su perfil de plataforma de pagos B2B/escrow, deja libre.

**En una frase:** adopta el *cómo* de JPC (partners + regulación PSP) y diferénciate en el *qué* (experiencia de consumo y comercio que JPC no ofrece).

---

### Fuentes

- [JPC Solutions — sitio oficial](https://jpc.fi.cr/)
- [JPC App — Google Play](https://play.google.com/store/apps/details?id=cr.fi.jpc.app)
- [JPC App — App Store](https://apps.apple.com/cr/app/jpc-app/id6444543498)
- [JPC Solutions — Circle Alliance Directory](https://partners.circle.com/partner/jpc-solutions)
- [JPC Solutions — SWIFT JSSRCRS2 (Wise)](https://wise.com/us/swift-codes/JSSRCRS2XXX)
- [Fintech Impesa / billetera CR cripto — El Financiero](https://www.elfinancierocr.com/tecnologia/fintech-impesa-presenta-billetera-costarricense/G4PH6A5BYBCMXDMPSVC6FT4AN4/story/)
