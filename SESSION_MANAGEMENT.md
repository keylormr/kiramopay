# KiramoPay — Gestión de sesión y almacenamiento de tokens (diseño)

> **Estado: PROPUESTA / DISEÑO — para aprobación antes de implementar.**
> Define cómo debe guardarse la sesión para que **sobreviva a un refresh de
> página sin exponer los tokens a JavaScript** (a prueba de XSS), alineado con
> OWASP e IETF. No cambia el modelo criptográfico de auth del backend (JWT de
> acceso + refresh con rotación/revocación), solo **dónde y cómo** se guardan
> los tokens en el cliente.

---

## 1. Estado actual (verificado en el código)

- **Los tokens viven solo en memoria.** `src/stores/auth.store.ts` guarda
  `accessToken`/`refreshToken` en el store pero `partialize` **no los persiste**
  (comentario explícito: localStorage es exfiltrable por XSS). Solo se persiste
  `isAuthenticated`, `isOnboarded` y `user`.
- **Consecuencia (el bug que reportó el usuario):** al refrescar la página los
  tokens quedan en `null` pero `isAuthenticated` sigue `true` (persistido). La
  app arranca "logueada", `AppContainer` dispara `syncAllData()`
  (`src/App.tsx`), todas las llamadas dan **401**, el `HttpClient` intenta un
  refresh que falla (no hay refresh token) y fuerza `forceLogout` → login. El
  `dedupedRefresh` ya evita la ráfaga de refresh, así que **no** es un problema
  de "muchas llamadas".
- **El backend no usa cookies hoy.** `/api/v1/auth/login`, `/auth/refresh`,
  `/auth/logout` devuelven los tokens en el **cuerpo JSON**.
- **Front y API están en orígenes distintos (cross-origin).** El front (Vercel)
  llama al backend (Render) por `VITE_API_URL` como URL absoluta; el `fetch` de
  `client.ts` **no** envía credenciales (`credentials` por defecto = `same-origin`).
- **La app es híbrida.** Hay target nativo Capacitor Android
  (`capacitor.config.ts`: `androidScheme: 'https'`, `hostname: 'app.kiramopay.com'`).
  Esto importa: el modelo de cookies es del navegador; en el WebView nativo el
  almacenamiento seguro del SO es la vía correcta (ver §4.2).

## 2. Objetivo y no-objetivos

**Objetivo:** que la sesión sobreviva a un refresh **sin** que el token de larga
vida sea legible por JavaScript (requisito explícito: "no quiero información
expuesta").

**No-objetivos (se mantienen como están):**
- El esquema JWT del backend (access corto + refresh, con rotación y revocación).
- La pantalla de bloqueo por PIN / biométrico local (`lockKdf`).
- Guardar el access token de corta vida en memoria (eso está bien y se mantiene).

## 3. Principios (fundamento, no opinión)

- **OWASP — Session Management Cheat Sheet:** *no* guardar tokens/JWT/refresh en
  `localStorage` ni `sessionStorage` (los lee cualquier JS del origen → un XSS
  expone toda la sesión). Usar cookie **`HttpOnly; Secure; SameSite`**, con
  prefijo **`__Host-`**, o el patrón **BFF**. Además: timeouts de inactividad y
  absoluto, regenerar la sesión al autenticar, `Cache-Control: no-store`, y
  `Clear-Site-Data` al cerrar sesión.
- **IETF — "OAuth 2.0 for Browser-Based Apps" (draft-26, dic 2025):** ordena los
  patrones de mayor a menor seguridad; el **BFF** (el backend retiene los tokens
  y al navegador solo le llega una cookie de sesión httpOnly) está **"fuertemente
  recomendado para aplicaciones de negocio, sensibles y que manejan datos
  personales"** — el caso de KiramoPay.
- **IETF RFC 8252 — "OAuth 2.0 for Native Apps":** en apps nativas, los tokens
  van en el almacenamiento seguro del sistema (Keystore/Keychain), no en web
  storage. Aplica a la rama Capacitor.

## 4. Arquitectura objetivo

### 4.1 Web (SPA en navegador) — cookie httpOnly first-party

```
Navegador (SPA)                      Mismo origen (Vercel)            Render (API)
  access token en memoria  ──fetch /api/* (credentials:include)──►  proxy ──► API
  cookie __Host-refresh (httpOnly, no legible por JS)  ◄── Set-Cookie en login/refresh
```

- **Access token:** corto (p.ej. 15 min), **en memoria** (como hoy). Si un XSS
  lo roba, sirve poco tiempo y no permite renovar.
- **Refresh token:** en cookie **`__Host-kp_refresh`** con
  `HttpOnly; Secure; SameSite=Strict; Path=/`. **JavaScript no puede leerla** →
  un XSS no puede robar el refresh ni mantener la sesión. Esto es lo que cumple
  el requisito de "no exponer información".
- **Prerrequisito crítico — mismo origen:** hoy front (Vercel) y API (Render)
  son orígenes distintos, así que una cookie puesta por Render sería de
  **tercero** y los navegadores modernos la bloquean (Safari ITP, fin de
  cookies de terceros en Chrome). **Solución:** servir el API bajo el mismo
  origen del front con un *rewrite* de Vercel (`/api/*` → Render). Así la cookie
  es de primera parte y se puede usar `SameSite=Strict` + `__Host-`.
- **Arranque:** la SPA intenta un **refresh silencioso** contra `/auth/refresh`
  (la cookie viaja sola) → si responde, guarda el nuevo access token en memoria
  y **la sesión sobrevive al refresh**; si no, muestra login. `isAuthenticated`
  deja de ser "verdad persistida" y pasa a derivarse de ese refresh de arranque
  → desaparece el rebote fantasma.

### 4.2 Nativo (Capacitor Android, y iOS a futuro) — secure storage

En el WebView nativo el origen es `https://app.kiramopay.com` y el API está en
otro host → las cookies serían de tercero también. Patrón correcto (RFC 8252):

- Guardar el refresh token en **almacenamiento seguro del SO** (Android Keystore
  vía un plugin de secure storage; Keychain en iOS). Cifrado por el sistema, no
  accesible al JS de un sitio de terceros embebido.
- Detectar el entorno (`Capacitor.isNativePlatform()`) y elegir la rama de
  almacenamiento: cookie en web, secure storage en nativo. La interfaz del
  `auth.store` se mantiene; cambia solo el backend de persistencia del token.

## 5. Diseño detallado por componente

### 5.1 Backend (Go)
- **Login / Register:** además (o en vez) del token en el body, `Set-Cookie` del
  refresh token: `__Host-kp_refresh=<token>; HttpOnly; Secure; SameSite=Strict;
  Path=/; Max-Age=<vida del refresh>`. El access token sigue yendo en el body.
- **`/auth/refresh`:** leer el refresh **de la cookie** (no del body); rotar
  (ya existe rotación+revocación); emitir cookie nueva; devolver access en body.
- **`/auth/logout`:** invalidar el refresh server-side + `Set-Cookie` con
  `Max-Age=0` + cabecera `Clear-Site-Data: "cookies", "storage"`.
- **CSRF:** con `SameSite=Strict` y mismo origen, el grueso del CSRF queda
  cubierto; como defensa en profundidad, *double-submit token* para las
  mutaciones autenticadas por cookie (`/auth/refresh`, `/auth/logout`).
- **Cabeceras:** `Cache-Control: no-store` en respuestas de auth.

### 5.2 Frontend (React/TS)
- `HttpClient`: `fetch(..., { credentials: 'include' })`.
- `AppContainer` (arranque): intentar `/auth/refresh`; si ok, set access token
  en memoria; si no, login. Quitar `isAuthenticated` como fuente de verdad
  persistida (a lo sumo como *hint* de UI para evitar parpadeo).
- `auth.store`: el `refresh()` deja de depender de un refresh token en memoria
  (la cookie lo lleva en web; el secure storage en nativo).

### 5.3 Deploy / routing (web)
- `vercel.json` con rewrite: `/api/(.*)` → `https://<host-de-render>/api/$1`,
  para que el SPA llame a su **propio** dominio y la cookie sea first-party.
- Alternativa de mayor aislamiento: un **BFF** dedicado (el patrón que IETF marca
  como más seguro), aunque el rewrite same-origin ya logra el objetivo de no
  exponer tokens a JS con menos infraestructura.

## 6. Migración sin romper

- El backend acepta el refresh **por cookie o por body** durante la transición
  (compatibilidad hacia atrás), de modo que un front viejo siga funcionando.
- Orden de despliegue: (1) backend compatible → (2) routing same-origin →
  (3) frontend nuevo → (4) rama nativa → (5) hardening (timeouts, `__Host-`,
  `Clear-Site-Data`).
- Nota: como hoy los tokens ya son en memoria, **no hay sesiones persistidas que
  romper** — un deploy actual ya desloguea a todos; la migración no empeora eso.

## 7. Fases (un PR por fase, todas verificadas)

| Fase | Área | Entregable |
|------|------|------------|
| A | backend | Emitir/leer/limpiar la cookie de refresh + CSRF, compatible hacia atrás. Tests. |
| B | infra | Rewrite same-origin en Vercel (`/api/*` → Render). |
| C | frontend | `credentials: 'include'` + refresh silencioso de arranque + derivar `isAuthenticated`. Tests + E2E "refresh mantiene sesión". |
| D | nativo | Secure storage para Capacitor (rama por plataforma). |
| E | hardening | Timeouts idle/absoluto, `Clear-Site-Data` en logout, `__Host-` y `Cache-Control: no-store`. |

## 8. Pruebas

- **Backend:** la cookie se setea con los flags correctos; el refresh rota leyendo
  la cookie; el logout la limpia; una petición sin token CSRF a una mutación es
  rechazada.
- **Frontend:** el arranque restaura la sesión vía refresh; **aserción de que NO
  hay token en `localStorage`/`sessionStorage`**; el logout limpia todo.
- **E2E:** refrescar la página **mantiene** la sesión (el síntoma original).

## 9. Riesgos y decisiones abiertas

- **Cookies de tercero:** si NO se hace el paso same-origin (§5.3), el modelo de
  cookie **no funciona** en navegadores modernos. El same-origin es prerrequisito.
- **Nativo:** requiere su propia rama (secure storage); las cookies no son la vía
  en Capacitor.
- **Dominio:** `capacitor.config.ts` ya apunta a `app.kiramopay.com`. Conviene
  alinear el API a `api.kiramopay.com` (mismo sitio, `Domain=.kiramopay.com`) o
  exponerlo como `/api` proxied bajo el mismo host.
- **CSRF:** definir double-submit token vs confiar solo en `SameSite=Strict`
  (recomendado: double-submit como defensa en profundidad para una fintech).

## Fuentes

- OWASP — Session Management Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- IETF — OAuth 2.0 for Browser-Based Apps (draft-ietf-oauth-browser-based-apps):
  https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/
- IETF — RFC 8252, OAuth 2.0 for Native Apps:
  https://datatracker.ietf.org/doc/html/rfc8252
