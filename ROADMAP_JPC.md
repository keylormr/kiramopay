# Roadmap KiramoPay → paridad/competencia con JPC

**Fecha:** 2026-06-08
**Contexto:** ver `ESTUDIO_MERCADO_JPC_2026-06.md` (competidor de referencia) y `AUDITORIA_2026-06.md` / `CORRECCIONES_P0_2026-06.md` (estado técnico).

## Idea central
El cuello de botella para alcanzar a JPC **no son semanas de ingeniería** — es el
**lead-time legal/regulatorio y el onboarding de partners (meses)**. Integrar
cada partner son ~semanas; lo que tarda es la licencia y los acuerdos comerciales.

No se "alcanza" a JPC en rieles programando: eso se **integra** (PSP + 4 partners)
y se **licencia**. La ventaja propia es la **capa de consumo/comercio**
(QR, loyalty, split, marketplace, transparencia) sobre rieles de un partner.
Adoptar el *cómo* de JPC (partners + regulación PSP), diferenciarse en el *qué*.

## Ya cerrado en esta sesión (jun 2026)
- KYC/AML mecánico: screening de sanciones, niveles KYC→límites de wallet, gate
  de registro, reportes UIF (Ley 8204) con detección de estructuración.
- Seguridad/correctitud: crypto debita fiat por el ledger, PAN no se persiste,
  revocación atómica de sesiones, RBAC admin, ledger READ COMMITTED + FOR UPDATE,
  decimal en cripto, auto-refresh de token en frontend.
- Desplegado y verificado en prod (Render + Vercel + Neon + Upstash), CI verde.

## Ruta crítica vs paralelo
```
CRÍTICO:   [A] Regulación/sponsor bank ──► [E] IBAN + rieles reales ──► dinero real
PARALELO:  [B] KYC provider · [C] Cripto VASP · [D] Tarjetas emisor · [F] Moat + infra
```
A es la más lenta y desbloquea casi todo → arrancar primero. B/C/D/F se integran
sin esperar a A.

## Fases

| # | Qué | Partner sugerido (CR/LATAM) | Esfuerzo eng. | Lead-time real | Desbloquea |
|---|-----|------------------------------|---------------|----------------|------------|
| **A** | Figura legal + vía PSP (EDE o convenio con PSP/banco patrocinador). Registro SUGEF / código SINPE. | Abogado fintech CR + banco patrocinador | — (legal) | **4–8+ meses** | SINPE real, IBAN, custodia |
| **B** | KYC productivo: OCR cédula + liveness; screening con proveedor; envío real a UIF/ICD | **Truora** (CR-native) / Onfido / ComplyAdvantage | ~3–5 sem (hooks ya existen) | semanas | Onboarding compliant (req. de go-live) |
| **C** | Cripto vía VASP — reemplazar el in-house; nosotros refs/saldos, ellos custodia | **Coinpay.cr** (el de JPC) + **Circle** (USDC/CCTP) | ~3–4 sem | semanas–1 mes | Cripto legal + cross-border stablecoin |
| **D** | Tarjetas vía emisor — programa Mastercard, saca PCI | **Pomelo** (LATAM) / Marqeta / Stripe Issuing | ~4–6 sem | 1–3 meses (due diligence) | Tarjetas reales sin carga PCI (depende de A) |
| **E** | IBAN CRC/USD + cross-border (SPEI/Circle) | Banco patrocinador + Circle | ~4–6 sem | depende de A | Paridad de rieles con JPC |
| **F** | Moat + producción: QR/loyalty/split/marketplace pulidos, TOTP, modelo de monetización, observabilidad, salir del free-tier | — | continuo | continuo | Diferenciación + operación real |

## Secuencia recomendada (si arrancás el lunes)
1. **Asesoría regulatoria** (A) — el reloj más largo, empieza primero.
2. En paralelo: **Truora (KYC, B)** — quick win, ya tenemos la maquinaria.
3. **Coinpay (cripto VASP, C)** — elimina el mayor riesgo in-house.
4. **Pomelo (tarjetas, D)** cuando la figura legal esté clara (necesita BIN sponsor).
5. **IBAN/sponsor bank (E)** una vez locked la vía EDE/PSP.
6. **Moat + monetización + infra (F)** de fondo todo el tiempo.

## Brechas vs JPC, resumidas
- Regulación/licencia (PSP SUGEF/SINPE) — la #1.
- Proveedores reales: KYC (OCR/liveness + sanciones), VASP cripto, emisor Mastercard, UIF submission.
- Rieles: IBAN + SWIFT, cross-border real, custodia de dinero.
- Producto/negocio: escrow + API SaaS B2B (que JPC tiene), MFA TOTP, **modelo de monetización** (sin definir).
- Operación: salir del stack free, observabilidad (tracing/alerting/SLOs), DR real.

## Pendientes técnicos menores (de la auditoría, no bloqueantes)
- Burn-down de deuda de lint (golangci-lint `latest` en report-only en CI; pin versión + `.golangci.yml`).
- Triage de vulns de deps (govulncheck / npm audit / Trivy en report-only).
- Estabilizar E2E (Playwright) y volver a gatear.
- Reconcile que corrija drift (hoy solo detecta).
