# iOS IPA — build, firma y distribucion

Equivalente de `docs/ANDROID_APK.md` para iPhone. El build lo hace GitHub
Actions en un runner macOS; no hace falta Xcode local.

## Lo primero: iOS no permite lo que hace el APK

El flujo de Android es "bajo un `.apk` firmado de un GitHub Release y el
telefono lo instala". **Eso no existe en iOS.** No es una limitacion del
codigo: Apple no permite instalar un `.ipa` fuera de sus canales. Las opciones
reales, de menor a mayor alcance:

| Via | Requiere | Alcance | Vencimiento |
|---|---|---|---|
| Apple ID gratis (free provisioning) | Un Mac con Xcode y el iPhone a mano | 1 dispositivo | La app deja de abrir a los **7 dias** |
| Ad Hoc (`release-testing`) | Programa de Desarrollador, USD 99/ano | 100 dispositivos por familia y por ano, cada UDID registrado a mano | El perfil vence al ano |
| TestFlight (`app-store-connect`) | Programa de Desarrollador | 100 testers internos / 10.000 externos | Cada build vive **90 dias** |
| App Store | Programa de Desarrollador + review | Publico | — |

TestFlight es lo mas parecido al boton de descarga actual: el tester instala la
app TestFlight y desde ahi la app. El primer build que se manda a un grupo
externo pasa por Beta App Review; los siguientes normalmente no.

Nota para una app financiera: la guia 3.2.1 de App Review exige que quien
ofrezca servicios financieros regulados este autorizado para hacerlo. Eso
condiciona el App Store, no TestFlight interno ni Ad Hoc.

## Estado actual del repositorio

El proyecto iOS ya esta armado y versionado (`ios/`), con el mismo bundle id que
Android (`com.kiramopay.app`), version `2.3.1` y build `7`. El workflow corre
hoy en modo **`unsigned`**: produce un `.ipa` sin firmar, util para re-firmarlo
con AltStore/Sideloadly o para que alguien con cuenta lo firme. En cuanto haya
cuenta de Apple Developer, se cargan los secretos y el mismo workflow pasa a
`release-testing` o `app-store-connect` sin tocar codigo.

## Los tres modos del workflow

`.github/workflows/ios-ipa.yml` se dispara con un tag `v*` o a mano desde la
pestana Actions. El modo sale de, en orden: el input del disparo manual, la
variable de repo `IOS_EXPORT_METHOD`, o `unsigned`.

| Modo | Que produce | Secretos que pide |
|---|---|---|
| `unsigned` | `KiramoPay-unsigned.ipa` | ninguno |
| `release-testing` | `KiramoPay.ipa` firmado Ad Hoc | los 4 de firma |
| `app-store-connect` | `KiramoPay.ipa` de distribucion; con `upload_testflight` lo sube a TestFlight | los 4 de firma + los 3 de App Store Connect |

**Importante:** desde Xcode 15.4 los nombres `ad-hoc` y `app-store` estan
deprecados y **Xcode 26 los rechaza**. Los validos son `release-testing` y
`app-store-connect`. El workflow falla con un mensaje claro si recibe los
viejos.

## Probar hoy, sin cuenta

### Opcion A — el .ipa sin firmar

1. Actions → **iOS IPA** → Run workflow → `export_method: unsigned`.
2. Bajar el artefacto `kiramopay-ipa`.
3. Re-firmarlo con [Sideloadly](https://sideloadly.io) o AltStore usando un
   Apple ID gratis. La app corre **7 dias** y despues hay que repetir.

### Opcion B — directo desde Xcode (mas comodo si tenes el iPhone a mano)

Requiere Xcode 26 instalado (esta Mac solo tiene Command Line Tools):

```bash
npm ci && npm run build && npm run sync:ios
```

Eso abre Xcode. Ahi: seleccionar el target **App** → Signing & Capabilities →
Team = tu Apple ID personal → conectar el iPhone → Run. Misma caducidad de
7 dias.

## Cuando exista la cuenta: configuracion por unica vez

### 1. Certificado de distribucion

En el portal de Apple Developer, Certificates → **Apple Distribution**.
Descargar el `.cer`, importarlo en Llavero, y exportar desde ahi un `.p12` con
contrasena (el `.p12` lleva la llave privada; el `.cer` solo, no sirve).

```bash
base64 -i KiramoPay-dist.p12 -o cert.b64
```

### 2. Perfil de aprovisionamiento

Profiles → nuevo perfil:

- Para Ad Hoc: tipo **Ad Hoc**, y registrar antes el UDID de cada iPhone que lo
  vaya a instalar (Devices → +). Tope: 100 por familia y por ano de membresia,
  y los deshabilitados siguen contando.
- Para TestFlight/App Store: tipo **App Store**.

```bash
base64 -i KiramoPay.mobileprovision -o perfil.b64
```

### 3. Secretos del repositorio

Settings → Secrets and variables → Actions → New repository secret:

| Secreto | Valor |
|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` | contenido de `cert.b64` |
| `APPLE_CERTIFICATE_PASSWORD` | la contrasena del `.p12` |
| `APPLE_PROVISIONING_PROFILE_BASE64` | contenido de `perfil.b64` |
| `APPLE_TEAM_ID` | el Team ID (10 caracteres, sale de Membership) |

Para TestFlight, ademas, una llave de App Store Connect (Users and Access →
Integrations → App Store Connect API → nueva llave con rol App Manager):

| Secreto | Valor |
|---|---|
| `APP_STORE_CONNECT_KEY_ID` | el Key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | el Issuer ID |
| `APP_STORE_CONNECT_API_KEY_BASE64` | el `.p8` en base64 (`base64 -i AuthKey_XXX.p8 -o key.b64`) |

El `.p8` **se descarga una sola vez**: guardarlo en el gestor de contrasenas
antes de cerrar la pagina.

Borrar de la maquina el `.p12`, el `.p8`, el perfil y los `.b64` una vez
cargados: fuera del gestor de secretos no deben quedar copias.

### 4. Backend: CORS (obligatorio, sin esto la app no habla con la API)

En iOS el WebView **no** corre bajo `https://app.kiramopay.com` como en
Android. El esquema es `capacitor` y Capacitor prohibe cambiarlo a `https`
(WKWebView ya maneja ese esquema). Ademas el hostname en iOS es `localhost` a
proposito: `capacitor://app.kiramopay.com` no es un contexto seguro y ahi
`navigator.mediaDevices` no existe, o sea que el escaner QR no arrancaria.

El origen de la app iOS es entonces **`capacitor://localhost`**, y hay que
agregarlo a `CORS_ORIGINS` del servicio `kiramopay` en Render:

```
CORS_ORIGINS=https://kiramopay.com,https://www.kiramopay.com,https://app.kiramopay.com,capacitor://localhost
```

### 5. API URL

La app carga sus assets en local, asi que necesita la URL **absoluta** del
backend. Se toma de la misma variable de repo que usa el APK: `APK_API_URL`
(por defecto `https://api.kiramopay.com`).

## Sacar una version

1. Subir `MARKETING_VERSION` y `CURRENT_PROJECT_VERSION` en
   `ios/App/App.xcodeproj/project.pbxproj` —el equivalente de `versionName` y
   `versionCode`— **en el mismo commit** que suben los de Android, para que las
   dos plataformas no se desincronicen.
2. Tag y push:
   ```bash
   git tag v2.3.2
   git push origin v2.3.2
   ```
3. El workflow compila y adjunta el `.ipa` al release. Con
   `IOS_EXPORT_METHOD=app-store-connect` y la subida a TestFlight activada, el
   build ademas queda disponible para los testers.

## Deep links

| Esquema | Como se declara | Estado |
|---|---|---|
| `kiramopay://` | `CFBundleURLTypes` en `Info.plist` | listo |
| `https://app.kiramopay.com` (Universal Links) | entitlement Associated Domains + archivo `apple-app-site-association` servido en el dominio | **pendiente**: el entitlement necesita cuenta paga |

`AppDelegate.swift` ya reenvia `open url` y `continue userActivity` al bridge de
Capacitor, asi que del lado nativo no falta nada.

## Limitaciones conocidas

- **Sin notificaciones push.** El proyecto no incluye el plugin de push ni el
  entitlement de APNs. Android tampoco (no hay `google-services.json`).
- **`capacitor-native-biometric` es de la epoca de Capacitor 3.** Declara
  `@capacitor/core@^3.4.3` y su podspec apunta a iOS 13. Trae fuente Swift y el
  Podfile lo resuelve bien, pero es el componente con mas chance de dar
  problemas en el primer build real contra Xcode 26. Si aparece, el reemplazo
  mantenido es `@aparajita/capacitor-biometric-auth`.
- **El boton "Descargar app" del login sigue siendo solo Android.** No se le
  agrego una variante iOS porque hasta que exista un canal (TestFlight o Ad Hoc)
  no hay a donde apuntar.
