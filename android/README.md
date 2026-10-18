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

Fastlane corre con la version fijada en `Gemfile.lock` (necesita Ruby y Bundler; se probo
con Ruby 4.0 y fastlane 2.241.1):

```bash
cd android
bundle install                       # una vez

bundle exec fastlane debug           # APK de debug
bundle exec fastlane release         # APK de release firmado
bundle exec fastlane aab             # AAB de release firmado (el formato que pide Play)
bundle exec fastlane internal        # compila el AAB y lo sube a la pista interna de Play
bundle exec fastlane internal aab:/ruta/absoluta/kiramopay.aab   # sube un AAB ya compilado
```

Los lanes `release`, `aab` e `internal` leen la firma de las mismas cuatro
variables de entorno que `app/build.gradle` y que `android-apk.yml` (ver arriba:
`KIRAMOPAY_KEYSTORE_FILE`, `KIRAMOPAY_KEYSTORE_PASSWORD`, `KIRAMOPAY_KEY_ALIAS`,
`KIRAMOPAY_KEY_PASSWORD`). Si falta alguna, o la ruta del keystore no es absoluta
o no existe, el lane se detiene antes de compilar y dice cual: sin firma, Gradle
produce un release sin firmar y Play lo rechaza despues de la subida.

`internal` ademas necesita:

| Variable | Valor |
|----------|-------|
| `PLAY_STORE_JSON_KEY` | Ruta absoluta al JSON de la cuenta de servicio de Play. Se guarda fuera del repo. |

Notas:

- **La primera subida de una app nueva se hace a mano** en Play Console. La
  documentacion de Fastlane indica que hay que "set up your app manually first by
  uploading at least one build"; la documentacion de la API de Play no dice nada
  al respecto, asi que no se probo si la API la permite. `internal` sirve para las
  versiones siguientes.
- Si Play responde `Only releases with status draft may be created on draft app`
  (error reportado por la comunidad, no documentado por Google), correr
  `bundle exec fastlane internal estado:draft` y completar el lanzamiento en la
  consola.
- `internal` sube el bundle y las notas de la version
  (`metadata/android/es-419/changelogs/`), no la ficha de la tienda. Las notas
  salen de `<versionCode>.txt` y, si no existe, de `default.txt`.
- Los lanes compilan con `bundleRelease` y la firma por variables de entorno, igual
  que el CI, pero no lo reemplazan: el AAB de rutina es el artefacto `kiramopay-aab`
  de `android-apk.yml`.

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

### Verificacion de los enlaces `https://app.kiramopay.com`

El manifiesto declara `autoVerify` para ese host, pero Android solo lo da por
verificado si el dominio sirve `https://app.kiramopay.com/.well-known/assetlinks.json`
con la huella del certificado que firma la app instalada. **Ese archivo todavia no
existe**: sin el, los enlaces https abren el navegador (o preguntan) en vez de la app.

Con Play App Signing, la app que llega a los telefonos desde Play va firmada con la
clave de firma de Google, no con la del keystore de este repo (la de subida), asi que
la huella correcta solo existe despues de crear la app en Play Console. Para
completarlo:

1. En Play Console, abrir la configuracion de firma de la app (Play app signing) y
   copiar la huella SHA-256 del certificado de la **clave de firma de la app**. Si
   la pagina lista mas de una, copiar todas.
2. Copiar `android/assetlinks.template.json` a `public/.well-known/assetlinks.json` y
   reemplazar el marcador por la(s) huella(s), con el formato
   `AA:BB:CC:...` (32 pares hexadecimales separados por dos puntos).
3. Opcional: agregar tambien la huella del keystore de subida
   (`keytool -list -v -keystore kiramopay-release.jks -alias kiramopay`), para que
   el APK que se descarga de GitHub tambien verifique. Son huellas publicas.
4. Publicar el sitio y comprobar que `https://app.kiramopay.com/.well-known/assetlinks.json`
   responde 200, `application/json` y sin redirecciones (Android no las sigue).
5. En un dispositivo con la app instalada desde la pista interna:
   `adb shell pm get-app-links com.kiramopay.app` debe mostrar `verified` para el host.

No se versiona una huella inventada ni un `assetlinks.json` con marcador: un archivo
publicado con una huella que no corresponde solo hace fallar la verificacion.

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
| `Fastfile` | Lanes: `debug`, `release`, `aab`, `internal` |
| `Appfile` | Package name y credencial de la API de Play (`PLAY_STORE_JSON_KEY`) |
| `metadata/android/es-419/` | Ficha de la tienda: textos, imagenes y notas de la version |

## Ficha de la tienda

Ubicacion: `android/fastlane/metadata/android/es-419/`

| Archivo | Limite de Play | Notas |
|---------|----------------|-------|
| `title.txt` | 30 caracteres | Nombre de la app |
| `short_description.txt` | 80 caracteres | Descripcion corta |
| `full_description.txt` | 4000 caracteres | Descripcion completa |
| `changelogs/default.txt` | 500 caracteres | Notas de la version; `<versionCode>.txt` las reemplaza para esa version |
| `images/icon.png` | 512 x 512, PNG de 32 bits, hasta 1024 KB | Cuadrado completo, sin esquinas redondeadas ni sombra |

Faltan el grafico de funciones (1024 x 500) y las capturas de pantalla: la lista
con las medidas y la revision de los textos estan en `docs/FICHA_PLAY.md`. El
checklist de publicacion completo esta en `docs/PUBLICAR_PLAY_CHECKLIST.md`.

