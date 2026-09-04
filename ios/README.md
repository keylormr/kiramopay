# KiramoPay iOS

Build iOS via Capacitor 6. La misma app web que el APK, empaquetada en un
WKWebView con acceso a Keychain, Face ID / Touch ID y camara.

El runbook de firma y distribucion esta en [`docs/IOS_IPA.md`](../docs/IOS_IPA.md).

## Requisitos

| Herramienta | Version |
|-------------|---------|
| Node.js | 18+ |
| Xcode | 26+ (obligatorio para subir a App Store Connect desde 2026-04-28) |
| CocoaPods | 1.12+ |
| Deployment target | iOS 13.0 |

## Build de desarrollo

```bash
npm ci
npm run build         # bundle web -> dist/
npm run sync:ios      # copia dist/ al proyecto iOS y corre pod install
npx cap open ios      # abre App.xcworkspace en Xcode
```

O de una: `npm run build:ios`.

**Usar siempre `npm run sync:ios`, nunca `npx cap sync` a secas.** El hostname
del WebView se resuelve por plataforma en `capacitor.config.ts` y un sync sin
plataforma le daria a iOS el hostname de Android, con lo que el escaner QR
dejaria de funcionar (ver abajo).

## Por que el hostname es distinto al de Android

En Android el esquema es `https`, asi que `https://app.kiramopay.com` es un
contexto seguro y `getUserMedia` funciona. En iOS el esquema es `capacitor` y
Capacitor prohibe cambiarlo a `https` porque WKWebView ya maneja ese esquema.
Con un hostname propio el origen seria `capacitor://app.kiramopay.com`, que **no
es contexto seguro**: `navigator.mediaDevices` no existe y el escaner QR muere.
Con `localhost` si lo es —la especificacion de Secure Contexts trata localhost
como confiable sea cual sea el esquema— y por eso la documentacion de Capacitor
recomienda dejarlo asi.

Consecuencia: el origen de la app iOS es `capacitor://localhost` y tiene que
estar en `CORS_ORIGINS` del backend.

## Estructura

| Ruta | Que es |
|---|---|
| `App/App.xcworkspace` | lo que se abre en Xcode (nunca el `.xcodeproj` suelto: los pods viven en el workspace) |
| `App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` | esquema **compartido**. Xcode lo genera en `xcuserdata/` (por usuario, gitignoreado); versionado aca porque en CI nadie abre Xcode y `xcodebuild -scheme App` fallaria |
| `App/App/Info.plist` | permisos, esquema `kiramopay://`, declaracion de cifrado |
| `App/Podfile` | generado por `cap sync`; lista los pods de los plugins |
| `App/fastlane/` | lanes locales (`unsigned`, `adhoc`, `beta`) |
| `App/App/public/` | assets web copiados por `cap sync`. Gitignoreado |

## Permisos declarados

| Clave | Para que |
|---|---|
| `NSCameraUsageDescription` | escaner QR (`getUserMedia` + jsQR) |
| `NSFaceIDUsageDescription` | Face ID. **Sin esta clave la app crashea** en dispositivos con Face ID al invocar el plugin |
| `ITSAppUsesNonExemptEncryption` = `false` | evita la pregunta de export compliance en cada subida a TestFlight. Declara que la app solo usa cifrado exento (HTTPS y Keychain del sistema). Confirmar antes de la primera subida real |

## Plugins nativos

| Plugin | Implementacion iOS |
|---|---|
| `@capacitor/app` | ciclo de vida y `appUrlOpen` |
| `@capacitor/splash-screen` | splash de `Assets.xcassets/Splash.imageset` |
| `@capacitor/status-bar` | barra de estado |
| `@aparajita/capacitor-secure-storage` | Keychain (refresh token) |
| `capacitor-native-biometric` | Face ID / Touch ID + Keychain de credenciales |

El boton fisico de atras no existe en iOS: el listener `backButton` de
`App.tsx` sencillamente nunca dispara ahi. No hay nada que ajustar.

## Assets

- **Icono:** `App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`,
  1024x1024, **sin canal alfa** (Apple rechaza iconos con transparencia) y sin
  esquinas redondeadas (iOS aplica su propia mascara). Se genera del mismo
  trazo que `public/icon.svg`.
- **Splash:** `App/App/Assets.xcassets/Splash.imageset/`, 2732x2732 sobre
  `#0A84FF`, el mismo `backgroundColor` que declara `capacitor.config.ts`. El
  storyboard lo muestra con `scaleAspectFill`, asi que el lienzo cuadrado se
  recorta al alto de la pantalla.

## Versionado

`MARKETING_VERSION` y `CURRENT_PROJECT_VERSION` en
`App/App.xcodeproj/project.pbxproj` son el equivalente de `versionName` y
`versionCode` de Android. Hoy: **2.3.1 / 7**. Subir ambos en el mismo commit que
los de Android.
