# Checklist: publicar KiramoPay en Google Play

Orden de los pasos para llevar la app Android a Google Play con una cuenta de
organización, qué hace cada parte y qué bloquea hoy. Cada paso cita la página
oficial de ayuda que lo respalda; las páginas cambian, así que ante una diferencia
manda la consola. Lo que no se pudo comprobar está marcado como no verificado.

Los nombres de menú van como los escribe la ayuda oficial en inglés; la consola en
español los traduce.

Etiquetas de responsable:

- **[Usuario]**: lo hace el titular de la cuenta: pagos, identidad, aceptar
  acuerdos, crear la cuenta de servicio, enviar a revisión.
- **[Repo]**: ya está hecho en el repositorio o se hace con un cambio de código.
- **[Legal]**: lo decide el titular con su abogado.

Documentos relacionados: [FICHA_PLAY.md](FICHA_PLAY.md) (textos, límites e imágenes de
la ficha), [ANDROID_APK.md](ANDROID_APK.md) (cómo se compila y firma),
[android/README.md](../android/README.md) (Fastlane y verificación de enlaces).

## 1. Estado de partida

### Lo que ya está en el repositorio

| Elemento | Dónde | Estado |
|----------|-------|--------|
| AAB firmado con el keystore de subida | `.github/workflows/android-apk.yml`, artefacto `kiramopay-aab` (90 días de retención) | Listo. Corre con una etiqueta `v*` o a mano desde Actions. |
| Lane de subida a la pista interna | `android/fastlane/Fastfile`, lane `internal` | Corregido y documentado. Para versiones posteriores a la primera. |
| Textos de la ficha en `es-419` | `android/fastlane/metadata/android/es-419/` | Dentro de los límites; pendiente de revisión legal ([FICHA_PLAY.md](FICHA_PLAY.md)). |
| Icono de 512 x 512 | `.../es-419/images/icon.png` | Listo. |
| Plantilla de `assetlinks.json` | `android/assetlinks.template.json` | Plantilla sin huella; se completa después de crear la app. |
| Identificador de la app | `com.kiramopay.app`; `versionCode` 16, `versionName` 2.6.0 | Definido. |

### Lo que falta fuera del código

Gráfico de funciones y capturas de pantalla, política de privacidad en una URL
pública, el flujo de eliminación de cuenta, la cuenta de organización, las
declaraciones de la consola, la huella de firma de Play y la revisión legal de los
textos.

### Bloqueos que hay que resolver antes de subir

1. **Nivel de API objetivo.** Play exige que las apps nuevas y las actualizaciones
   apunten a Android 16 (API 36) desde el 31 de agosto de 2026
   ([ayuda](https://support.google.com/googleplay/android-developer/answer/11926878));
   la página menciona una prórroga hasta el 1 de noviembre de 2026 cuyo formulario
   aún no estaba disponible. `android/variables.gradle` tiene `targetSdkVersion = 34`.
   La actualización a Capacitor 8 y API 36 va en otra tarea; este checklist no se
   puede completar hasta que se integre. [Repo]
2. **Actualización por fuera de Play.** `src/hooks/useActualizacion.ts` consulta la
   última versión en GitHub y, en Android, ofrece bajar el `.apk` de los releases
   de GitHub (`backend/internal/appversion/appversion.go`). La política de Play dice
   que una app distribuida en Play "may not modify, replace, or update itself using
   any method other than Google Play's update mechanism"
   ([política](https://support.google.com/googleplay/android-developer/answer/9888379)).
   Además, el APK de GitHub va firmado con la clave de subida y la app instalada
   desde Play con la clave de firma de Google: Android no instala uno encima del
   otro. La versión que se suba a Play no debe ofrecer esa actualización. Es un
   cambio de código que no está hecho. [Repo]
3. **Eliminación de cuenta y política de privacidad.** Play exige una ruta dentro de
   la app para eliminar la cuenta y los datos, y un enlace web para pedirlo
   ([ayuda](https://support.google.com/googleplay/android-developer/answer/13327111)).
   Va en otra tarea; su URL se usa en el paso 5. [Repo]
4. **Cuenta de revisión que funcione sin OTP ni MFA.** Play exige credenciales de
   prueba reutilizables y válidas desde cualquier ubicación, y que se pueda saltar
   la verificación en dos pasos o la contraseña de un solo uso
   ([requisitos](https://support.google.com/googleplay/android-developer/answer/15748846)).
   El registro de KiramoPay usa OTP y el envío de dinero MFA por encima de un
   umbral, así que hace falta una cuenta de revisión dedicada, nunca una de
   producción, y definir cómo se salta el OTP. Decisión técnica pendiente. [Repo]
5. **Afirmaciones regulatorias de la ficha y declaración financiera.** Ver
   [FICHA_PLAY.md, sección 3](FICHA_PLAY.md#3-afirmaciones-regulatorias-para-revisión-del-usuario-y-su-abogado). [Legal]

## 2. Pasos en orden

### Paso 1. Cuenta de desarrollador de organización [Usuario]

Google indica que una empresa debe usar una cuenta de organización y que esa
cuenta es obligatoria para apps con servicios financieros
([tipos de cuenta](https://support.google.com/googleplay/android-developer/answer/13634885)).

- [ ] Tener (o solicitar, gratis, en Dun & Bradstreet) el número D-U-N-S. Sin él no se
      puede crear una cuenta de organización, y el trámite puede tardar hasta 30 días.
- [ ] El nombre legal y la dirección del perfil de pagos de Google deben coincidir con
      los del perfil de Dun & Bradstreet.
- [ ] Verificar con contraseña de un solo uso el correo y el teléfono de contacto; deben
      seguir operativos mientras exista la cuenta.
- [ ] Sitio web de la organización (la página lo lista como requerido).
- [ ] Hacer el pago de registro que muestre el alta y verificar el método de pago (la
      página dice que la verificación puede tardar hasta 5 días). La página de
      requisitos no indica el monto: lo muestra el alta de la cuenta.
- [ ] Aceptar los acuerdos y términos que pida el alta de la cuenta.

Fuentes: [información requerida](https://support.google.com/googleplay/android-developer/answer/13628312).

### Paso 2. Compilar el AAB firmado [Repo + Usuario]

- [ ] [Usuario] Generar el keystore de subida y cargar los cuatro secretos del
      repositorio (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
      `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), según [ANDROID_APK.md](ANDROID_APK.md).
      Guardar el keystore en un respaldo seguro fuera del repositorio.
- [ ] [Repo] Con la API 36 integrada (bloqueo 1) y la actualización por fuera de Play
      desactivada (bloqueo 2), subir `versionCode`, etiquetar `vX.Y.Z` y empujar la
      etiqueta, o correr el workflow a mano desde Actions.
- [ ] [Usuario] Bajar el artefacto `kiramopay-aab` de esa corrida:

```bash
gh run download <id-de-la-corrida> --repo keylormr/kiramopay --name kiramopay-aab
```

Las apps creadas desde agosto de 2021 solo pueden subir AAB; APK queda para las
apps antiguas
([crear una versión](https://support.google.com/googleplay/android-developer/answer/9859348)).
`versionCode` tiene que ser mayor que cualquier versión ya subida.

### Paso 3. Crear la app en Play Console [Usuario]

Home > Create app. Pide: idioma predeterminado, nombre, si es app o juego, si es
gratis o de pago, un correo de contacto, y en Declaraciones aceptar las políticas del
programa para desarrolladores, las leyes de exportación de EE. UU. y los términos de
Play App Signing
([ayuda](https://support.google.com/googleplay/android-developer/answer/9859152)).

- [ ] Idioma predeterminado: español de Latinoamérica (`es-419`).
- [ ] Nombre: el de `title.txt` (máximo 30 caracteres).
- [ ] App, gratuita.
- [ ] Aceptar las declaraciones y los términos de Play App Signing.

### Paso 4. Ficha principal de la tienda [Usuario, con [FICHA_PLAY.md](FICHA_PLAY.md)]

- [ ] Pegar título, descripción corta y completa, ya revisados por el abogado.
- [ ] Subir icono, gráfico de funciones y mínimo 2 capturas (medidas en la sección 4 de
      [FICHA_PLAY.md](FICHA_PLAY.md)).
- [ ] Correo de contacto (obligatorio); sitio web (muy recomendado) y teléfono (opcionales).
- [ ] Categoría y etiquetas de la app (decisión del titular; no se fijó una en el repo).

Fuentes: [recursos de vista previa](https://support.google.com/googleplay/android-developer/answer/9866151),
[crear y configurar la app](https://support.google.com/googleplay/android-developer/answer/9859152).

### Paso 5. Contenido de la app [Usuario, con datos del repo]

Policy and programs > App content. La lista que da Google de lo que se
declara ahí: política de privacidad, anuncios, detalles de inicio de sesión, público
objetivo y contenido, formulario de permisos (si se piden permisos de alto riesgo),
clasificación de contenido, y las declaraciones que apliquen según el tipo de app
([preparar la app para revisión](https://support.google.com/googleplay/android-developer/answer/9859455)).
El panel de control de la consola muestra las tareas que le toquen a esta app.

- [ ] **Política de privacidad.** URL pública y activa que aplique a la app. [Repo: tarea de privacidad]
- [ ] **Anuncios.** Declarar si la app contiene anuncios.
- [ ] **Detalles de inicio de sesión.** La app exige cuenta: cargar las credenciales de la
      cuenta de revisión (hasta cinco juegos de instrucciones), en inglés, reutilizables y
      sin OTP (bloqueo 4). Nunca credenciales de un usuario real.
- [ ] **Público objetivo y contenido.** Declarar el grupo de edad.
- [ ] **Clasificación de contenido.** Cuestionario IARC en la página de Contenido de la
      app; sin cuestionario la app queda sin clasificar
      ([ayuda](https://support.google.com/googleplay/android-developer/answer/9859655)).
- [ ] **Seguridad de los datos.** Obligatoria para toda app publicada, también si no
      recolecta datos; exige el enlace a la política de privacidad y declarar lo que
      recolectan o comparten los SDK incluidos (por ejemplo Firebase si el build lleva
      `google-services.json`). Las apps que solo están en prueba interna están exentas
      ([ayuda](https://support.google.com/googleplay/android-developer/answer/10787469)).
      Partida para el inventario: datos personales (cédula, teléfono y correo, que el
      backend guarda cifrados), datos financieros (movimientos y saldos), identificadores
      del dispositivo (token de avisos, si se activan) y permisos del manifiesto
      (`INTERNET`, `CAMERA` para el escáner QR, `POST_NOTIFICATIONS`). Es un borrador:
      lo confirma quien conozca el flujo de datos completo.
- [ ] **Eliminación de cuenta.** Responder las preguntas de eliminación de datos y poner
      el enlace web del pedido de eliminación (bloqueo 3).
- [ ] **Funciones financieras.** Declaración obligatoria para toda app publicada; elegir
      las categorías que correspondan y, si Play lo pide, subir la documentación o
      licencias del país
      ([ayuda](https://support.google.com/googleplay/android-developer/answer/13849271)).
      Para cripto custodial, ver la política de exchanges y billeteras
      ([política](https://support.google.com/googleplay/android-developer/answer/16329703)).
      [Legal]: las categorías y la documentación las decide el titular con su abogado.
- [ ] Cualquier otra declaración que el panel marque como pendiente para esta app.

### Paso 6. Países y precio [Usuario]

- [ ] Gratis.
- [ ] Países de distribución: empezar solo con Costa Rica. La política de cripto de
      Google pide licencia en una lista de países (entre ellos EE. UU., Reino Unido y
      la Unión Europea); no seleccionar ninguno sin tener la licencia correspondiente
      ([FICHA_PLAY.md](FICHA_PLAY.md#3-afirmaciones-regulatorias-para-revisión-del-usuario-y-su-abogado)). [Legal]

### Paso 7. Primera versión en prueba interna, a mano [Usuario]

La primera subida de una app nueva se hace en la consola. La documentación de
Fastlane dice textualmente que hay que configurar la app a mano subiendo al menos un
build, y la documentación de la API de Play no aclara si la primera subida es posible
por API, así que no se intenta
([Fastlane](https://docs.fastlane.tools/actions/upload_to_play_store/),
[API de Play](https://developers.google.com/android-publisher/getting_started)).

Test and release > Testing > Internal testing
([ayuda](https://support.google.com/googleplay/android-developer/answer/9845334)):

- [ ] Crear una lista de testers por correo (hasta 100 testers por app en prueba interna).
- [ ] Elegir la lista y poner una URL o correo de comentarios.
- [ ] Crear una versión nueva. Es la primera: configurar Play App Signing cuando la
      consola lo pida. Las apps nuevas con AAB quedan inscritas con una clave generada por
      Google, y cambiar la clave de firma es opcional y solo antes de pasar a prueba
      abierta o producción
      ([ayuda](https://support.google.com/googleplay/android-developer/answer/9842756)).
      La clave del keystore del repositorio queda como clave de **subida**.
- [ ] Subir `kiramopay.aab` del paso 2.
- [ ] Nombre de la versión y notas (propuesta en [FICHA_PLAY.md](FICHA_PLAY.md#notas-de-la-versión); 500 caracteres por idioma).
- [ ] Guardar, revisar en Vista previa y confirmar, y iniciar el lanzamiento
      ([crear una versión](https://support.google.com/googleplay/android-developer/answer/9859348)).
- [ ] Compartir el enlace de adhesión con los testers. El enlace solo aparece cuando la
      app tiene estado Publicada, y las apps de prueba no se encuentran buscando en Play.

### Paso 8. Cosas que solo existen después de crear la app [Usuario + Repo]

- [ ] **Huella de la clave de firma.** En la configuración de firma de la app de Play
      Console, copiar la huella SHA-256 de la clave de firma de la app (la ayuda de
      Play y la de Android nombran dos rutas de menú distintas para esa página; buscar
      "Play app signing" o "App signing"). Si lista más de una, copiar todas.
      [Usuario]
- [ ] **`assetlinks.json`.** Completar la plantilla y publicarla en
      `public/.well-known/assetlinks.json`, siguiendo
      [android/README.md](../android/README.md#verificacion-de-los-enlaces-httpsappkiramopaycom).
      Confirmar antes que `app.kiramopay.com` resuelve y sirve el mismo despliegue; el
      repositorio no lo documenta. Requisitos de Android: HTTPS, `application/json`, sin
      redirecciones
      ([ayuda](https://developer.android.com/training/app-links/configure-assetlinks)). [Repo]
- [ ] **Verificación en un dispositivo** con la app instalada desde la prueba interna:
      `adb shell pm get-app-links com.kiramopay.app` debe decir `verified`; en Android 15 o
      superior, un cambio del archivo puede tardar hasta siete días en reflejarse
      ([ayuda](https://developer.android.com/training/app-links/verify-android-applinks)).
- [ ] **Cuenta de servicio para Fastlane.** En Google Cloud, crear una cuenta de servicio y
      habilitar la API de Google Play Developer; en Play Console (Users and permissions),
      invitar el correo de la cuenta de servicio con los permisos que necesite el lane
      (para lanzamientos, el permiso de publicar en pistas de prueba). Guardar el JSON
      fuera del repositorio y apuntar `PLAY_STORE_JSON_KEY` a él
      ([API de Play](https://developers.google.com/android-publisher/getting_started)).
      [Usuario]
- [ ] Probar `bundle exec fastlane internal` con una versión nueva (`versionCode` mayor).
      Si Play responde que solo se permiten versiones en borrador, usar `estado:draft`
      (ver [android/README.md](../android/README.md)). [Repo]

### Paso 9. Prueba antes de producción [Usuario]

- [ ] Instalar desde el enlace de prueba interna en dos o más dispositivos reales: registro,
      inicio de sesión, escáner QR (permiso de cámara), avisos, enlace `https://app.kiramopay.com`.
- [ ] Revisar los avisos de la consola y la página de estado de las políticas.
- [ ] Requisito de prueba cerrada: Google exige 12 testers durante 14 días continuos a las
      **cuentas personales creadas después del 13 de noviembre de 2023**
      ([ayuda](https://support.google.com/googleplay/android-developer/answer/14151465)).
      La página no dice si las cuentas de organización están exentas: no verificado. El
      panel de control de la consola muestra si aplica a esta cuenta.

### Paso 10. Producción [Usuario]

Test and release > Production > Create new release, con el mismo AAB o uno posterior,
y "Start rollout to production" (en la primera versión no hay porcentaje de
despliegue)
([crear una versión](https://support.google.com/googleplay/android-developer/answer/9859348)).
Antes de enviar:

- [ ] Todas las tareas del panel de control completas y la ficha revisada.
- [ ] Declaración de funciones financieras y seguridad de los datos coherentes con la app y
      con la ficha.
- [ ] Tener presente que, una vez publicada la app en una pista abierta, la clave de firma queda fija.
- [ ] Enviar los cambios a revisión desde la página de resumen de publicación (Publishing overview). La página de Google no indica cuánto
      tarda: no se promete un plazo.

## 3. Reparto de responsabilidades

| Tarea | Usuario | Repo | Legal |
|-------|:-------:|:----:|:-----:|
| Cuenta de organización, D-U-N-S, cuota y verificación de pago | x | | |
| Aceptar acuerdos y términos de Play | x | | |
| Crear la cuenta de servicio y entregar el JSON | x | | |
| Keystore de subida y secretos de GitHub | x | | |
| Enviar la app a revisión y los lanzamientos | x | | |
| Compilar el AAB firmado | | x | |
| Lane `internal`, README y Gemfile | | x | |
| Textos e icono de la ficha | | x | |
| Gráfico de funciones y capturas | x | | |
| API 36 y desactivar la actualización por fuera de Play | | x | |
| Eliminación de cuenta y política de privacidad (URL) | | x | |
| Cuenta de revisión sin OTP | | x | |
| `assetlinks.json` con la huella real | x (huella) | x (archivo) | |
| Declaración de funciones financieras y categorías cripto | x | | x |
| Afirmaciones regulatorias de la ficha y países de distribución | x | | x |
| Seguridad de los datos | x | x (inventario) | |

## 4. Fuentes oficiales

- [Crear y configurar la app](https://support.google.com/googleplay/android-developer/answer/9859152)
- [Recursos de vista previa de la ficha](https://support.google.com/googleplay/android-developer/answer/9866151)
- [Política de metadatos](https://support.google.com/googleplay/android-developer/answer/9898842)
- [Preparar la app para revisión](https://support.google.com/googleplay/android-developer/answer/9859455)
- [Requisitos para los datos de inicio de sesión](https://support.google.com/googleplay/android-developer/answer/15748846)
- [Clasificación de contenido](https://support.google.com/googleplay/android-developer/answer/9859655)
- [Seguridad de los datos](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Eliminación de cuentas](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Declaración de funciones financieras](https://support.google.com/googleplay/android-developer/answer/13849271)
- [Política de exchanges y billeteras de cripto](https://support.google.com/googleplay/android-developer/answer/16329703)
- [Política de servicios financieros](https://support.google.com/googleplay/android-developer/answer/9876821)
- [Nivel de API objetivo](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Abuso de dispositivo y red (actualización fuera de Play)](https://support.google.com/googleplay/android-developer/answer/9888379)
- [Crear y lanzar una versión](https://support.google.com/googleplay/android-developer/answer/9859348)
- [Pruebas internas](https://support.google.com/googleplay/android-developer/answer/9845334)
- [Requisitos de prueba para cuentas personales nuevas](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756)
- [Información para crear la cuenta](https://support.google.com/googleplay/android-developer/answer/13628312) y [tipos de cuenta](https://support.google.com/googleplay/android-developer/answer/13634885)
- [Digital Asset Links para Android](https://developer.android.com/training/app-links/configure-assetlinks) y [verificación](https://developer.android.com/training/app-links/verify-android-applinks)
- [API de Google Play Developer: primeros pasos](https://developers.google.com/android-publisher/getting_started)
- [Fastlane: upload_to_play_store](https://docs.fastlane.tools/actions/upload_to_play_store/)

## 5. Lo que no se verificó

- Si la API de Play permite la primera subida de una app nueva. Se asume que no.
- El error `Only releases with status draft may be created on draft app` lo reportan
  usuarios de Fastlane y de otras herramientas; Google no lo documenta. El lane admite
  `estado:draft` por si aparece.
- Si el requisito de prueba cerrada de 12 testers y 14 días aplica a cuentas de
  organización.
- Los nombres exactos de los menús de Play Console: la ayuda de Google usa nombres
  distintos en páginas distintas y la consola cambia. Se escribieron los de la ayuda.
- Que `app.kiramopay.com` resuelva al mismo despliegue que sirve el sitio.
- Un build real del AAB desde este equipo (no hay JDK instalado); el CI es el que
  compila.
- Las incongruencias de la documentación existente que no se tocaron:
  `docs/ANDROID_APK.md` dice que la URL de la API del APK por defecto es
  `https://kiramopay.com`, y el workflow usa `https://api.kiramopay.com`.
