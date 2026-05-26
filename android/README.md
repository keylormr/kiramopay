# KiramoPay Android

Android build via Capacitor 6. La app web se empaqueta como un WebView nativo con acceso a APIs de dispositivo.

## Requisitos

| Herramienta | Version |
|-------------|---------|
| Node.js | 18+ |
| Android Studio | 2024+ |
| JDK | 17 |
| Android SDK | API 34+ |

## Build de Desarrollo

```bash
# Desde la raiz del proyecto
npm run build              # Build del frontend
npx cap sync android       # Sincronizar con proyecto Android
npx cap open android       # Abrir en Android Studio
```

O directamente:
```bash
npm run build:android      # Build + sync + APK
```

## Build de Release (Firmado)

### Configuracion de Keystore

```bash
# Generar keystore (solo primera vez)
keytool -genkey -v -keystore kiramopay-release.keystore \
  -alias kiramopay -keyalg RSA -keysize 2048 -validity 10000
```

Las variables de entorno para signing (usadas por `build.gradle`):
```env
KIRAMOPAY_KEYSTORE_FILE=/path/to/kiramopay-release.keystore
KIRAMOPAY_KEYSTORE_PASSWORD=<password>
KIRAMOPAY_KEY_ALIAS=kiramopay
KIRAMOPAY_KEY_PASSWORD=<password>
```

### Build con Fastlane

```bash
cd android

# Build de debug
bundle exec fastlane debug

# Build de release (firmado)
bundle exec fastlane release

# Subir a Google Play Internal Testing
bundle exec fastlane internal
```

## Capacitor Config

Archivo: `capacitor.config.ts` en la raiz del proyecto.

```typescript
{
  appId: 'com.kiramopay.app',
  appName: 'KiramoPay',
  server: {
    androidScheme: 'https',
    hostname: 'app.kiramopay.com'
  },
  plugins: {
    SplashScreen: { launchShowDuration: 2000, backgroundColor: '#0A84FF' },
    StatusBar: { style: 'dark', backgroundColor: '#FFFFFF' }
  }
}
```

## Deep Linking

La app soporta deep links con dos esquemas:

| Esquema | Ejemplo | Accion |
|---------|---------|--------|
| `kiramopay://` | `kiramopay://pay?amount=5000` | Abre vista de pago SINPE |
| `https://` | `https://app.kiramopay.com/transfer/123` | Abre transferencia |

### Rutas soportadas

| Ruta | Vista |
|------|-------|
| `/pay`, `/sinpe` | SINPE |
| `/transfer/{id}` | SINPE con referencia |
| `/crypto` | Crypto |
| `/services` | Servicios |
| `/profile` | Perfil |
| `/home` | Inicio |

Para probar deep links:
```bash
# Android emulator o dispositivo
adb shell am start -a android.intent.action.VIEW -d "kiramopay://pay?amount=5000"
```

## Splash Screen

La app usa `@capacitor/splash-screen` y `@capacitor/status-bar` para la experiencia nativa al abrir:

- **Duracion:** 2000ms (configurable en `capacitor.config.ts`)
- **Color de fondo:** #0A84FF (primary blue)
- **Drawable:** `android/app/src/main/res/drawable/splash.xml` — fondo azul con logo naranja
- **StatusBar:** Estilo oscuro, fondo blanco

El splash se oculta automaticamente desde `App.tsx` via `SplashScreen.hide()` despues del render inicial. Si la app no esta corriendo en Capacitor nativo (ej. navegador), el `.catch()` ignora el error silenciosamente.

## Biometric Authentication

Transacciones mayores a **100,000 CRC** requieren autenticacion biometrica. El servicio `biometric.ts` maneja:
- Fingerprint / Face recognition via Capacitor
- Fallback a web credential management
- Enrollment guiado (verificacion de PIN primero)

## Fastlane

Configuracion en `android/fastlane/`:

| Archivo | Proposito |
|---------|-----------|
| `Fastfile` | Lanes de build (debug, release, internal) |
| `Appfile` | Package name y Google Play config |
| `metadata/android/es-419/` | Metadata de la tienda (titulo, descripcion, changelogs) |

## App Store Metadata

Ubicacion: `android/fastlane/metadata/android/es-419/`

- `title.txt` — Nombre de la app
- `short_description.txt` — Descripcion corta (80 chars max)
- `full_description.txt` — Descripcion completa
- `changelogs/1.txt` — Changelog de la primera version
