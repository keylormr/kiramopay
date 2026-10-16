# Ficha de Google Play: textos, límites y recursos gráficos

Revisión de la ficha de la tienda en español (`es-419`) antes de la primera
publicación. Los archivos viven en `android/fastlane/metadata/android/es-419/`.
Este documento explica qué cambió, por qué, y deja marcado lo que tiene que
decidir el titular de la cuenta y su abogado antes de publicar. El orden completo
de la publicación está en [PUBLICAR_PLAY_CHECKLIST.md](PUBLICAR_PLAY_CHECKLIST.md).

## 1. Límites oficiales

Verificados en la ayuda de Play Console (no de memoria):

| Campo | Límite | Antes | Ahora | Archivo |
|-------|--------|-------|-------|---------|
| Nombre de la app | 30 caracteres | 32 (excedía) | 30 | `title.txt` |
| Descripción corta | 80 caracteres | 77 | 68 | `short_description.txt` |
| Descripción completa | 4000 caracteres | 888 | 1054 | `full_description.txt` |
| Notas de la versión | 500 caracteres Unicode por idioma | n/d | 37 | `changelogs/default.txt` |

Los límites cuentan igual los caracteres de ancho completo y de medio ancho. Fuentes:
[Crear y configurar la app](https://support.google.com/googleplay/android-developer/answer/9859152)
(30 / 80 / 4000),
[Política de metadatos](https://support.google.com/googleplay/android-developer/answer/9898842)
(título de 30 caracteres o menos; sin emojis ni MAYÚSCULAS ajenas a la marca; sin
afirmaciones de posición como "#1" o "el mejor"; sin precios ni promociones; el título
y la descripción deben describir con exactitud lo que la app hace) y
[Crear y lanzar una versión](https://support.google.com/googleplay/android-developer/answer/9859348)
(500 caracteres por idioma en las notas).

`es-419` es el código de español de América Latina. La página de idiomas de Play
Console solo lista `es-419` y `es-ES` para español; no hay un código específico de
Costa Rica
([idiomas admitidos](https://support.google.com/googleplay/android-developer/table/4419860)).

## 2. Qué cambió en los textos y por qué

Cada afirmación se contrastó con lo que el código hace hoy. La columna "Revisa"
indica quién tiene que confirmar el cambio.

| Afirmación anterior | Lo que hace la app hoy | Cambio | Revisa |
|---------------------|------------------------|--------|--------|
| "SINPE Móvil: envía y recibe dinero al instante con tu número de teléfono" (y "SINPE" en la descripción corta) | El envío solo llega a otra persona con cuenta KiramoPay (`backend/internal/sinpe/service.go`). A un número ajeno se rechaza porque falta el riel interbancario ("a licence we do not hold"). KiramoPay no es participante de SINPE (`ESTRATEGIA_PRODUCTO_MARCA.md`, `ROADMAP_JPC.md`). | "Transferencias: envía dinero a otra persona de KiramoPay usando su número de teléfono". Se quitó el nombre SINPE de la ficha. | Usuario y abogado: uso del nombre de un servicio del BCCR y alcance de la afirmación. |
| "Crypto: compra, vende e intercambia Bitcoin, Ethereum y más" | La compra, venta y conversión existen dentro de la app contra el saldo de la billetera. Los depósitos directos y la compra con tarjeta o banco no están disponibles (`crypto_deposit_unavailable_desc`, `crypto_onramp_soon_desc`); el rendimiento de staking no se acredita (`crypto_claim_unavailable`). | Se conserva la función, acotada: "consulta precios, configura alertas y compra, vende o convierte ... dentro de la app". | Usuario y abogado: ver sección 3. |
| "Mercado: pide comida, solicita viajes y más" | No hay convenio con transporte ni restaurantes: el repartidor y el seguimiento son simulados y cobrar un viaje o pedido se rechaza (`help_marketplace_body`, `ride_no_integration`, `ErrSinIntegracion`). | Pasó a "próximamente, conforme firmemos convenio con cada empresa", igual que Pagos de servicios, que ya estaba así. | Usuario: decidir si el módulo debe verse en la versión que se publique en Play (ver pendientes). |
| "Cifrado de extremo a extremo" | No hay cifrado de extremo a extremo. Sí hay TLS con HSTS (`middleware/security.go`) y los datos personales (cédula, teléfono, correo) se guardan cifrados (`user/repository.go`, `fn_pii_encrypt`). | "Conexión cifrada y datos personales cifrados en nuestros servidores". | Usuario: confirmar que `PII_ENCRYPTION_KEY` está activa en producción. |
| "Detección de fraude en tiempo real" | El motor de riesgo se consulta en la salida de dinero del servicio de transacciones (`cmd/api/main.go`, `Risk: fraudService`). "Tiempo real" no se verificó. | "Detección de fraude en tus movimientos". | Usuario: confirmar la afirmación técnica. |
| "Autenticación biométrica (huella digital / Face ID)" | Face ID es de iOS. | "huella digital o reconocimiento facial del dispositivo". | - |
| "la super app financiera de Costa Rica" | - | "una super app financiera para Costa Rica": el artículo definido suena a posición de mercado y la política de metadatos no admite afirmaciones de ranking. | - |
| "Pagos con QR: paga en comercios" | Los cobros QR son a comercios registrados en KiramoPay (`qrpayment`). | "paga a comercios de KiramoPay". | - |
| Título "KiramoPay - Super App Financiera" (32) | - | "KiramoPay Super App Financiera" (30, justo en el límite). Alternativa más corta si se prefiere margen: "KiramoPay - Billetera digital" (29). | Usuario: decide el nombre. |

Sin cambio de fondo (verificado en el código): multi-moneda CRC, USD, PAB y GTQ
(`backend/internal/country`), dividir cuenta, PIN de 4 dígitos, y las líneas de
tarjetas ("vista previa") y pagos de servicios ("próximamente"), que ya habían sido
corregidas a su estado real.

También se pusieron los acentos que faltaban: la ficha es pública y los archivos
se leen como UTF-8, así que no hay motivo para dejarla sin tildes.

### Notas de la versión

`changelogs/1.txt` era el texto de un `versionCode` 1 que nunca se subió, y Fastlane
busca `<versionCode>.txt`, así que no se habría usado nunca (la versión actual es la
16). Se reemplazó por `default.txt`, que Fastlane usa cuando no hay archivo para esa
versión, con un texto neutro. Para una versión con novedades, agregar
`changelogs/<versionCode>.txt`.

Para la primera subida, que se hace a mano, las notas se escriben en la consola.
Propuesta (cabe en los 500 caracteres):

```
Primera versión de KiramoPay en Google Play:
- Transferencias entre usuarios de KiramoPay
- Pagos con código QR
- Crypto: precios, alertas, compra, venta y conversión
- Dividir cuenta con amigos
- Autenticación biométrica y PIN
- Idiomas: español, inglés, francés, portugués, chino, japonés e hindi
```

## 3. Afirmaciones regulatorias: para revisión del usuario y su abogado

Nada de lo de abajo se resolvió con una decisión propia; se deja por escrito para
que se decida con asesoría legal antes de publicar.

1. **Declaración de funciones financieras.** Play exige a todas las apps completar
   la declaración en Contenido de la app, y la ficha, la declaración y el
   comportamiento real tienen que coincidir
   ([ayuda](https://support.google.com/googleplay/android-developer/answer/13849271)).
   Las categorías de esa declaración que encajan con lo que hace la app y que hay
   que evaluar con el abogado: "Mobile payments and digital wallets", "Money
   transfer and wire services", y las de cripto ("Cryptocurrency wallet" y/o
   "Cryptocurrency exchange"). La página de Google que explica las categorías no
   detalla cada una; cuál corresponde es una decisión que depende de cómo se
   custodian los fondos.
2. **Cripto custodial.** La política de Google para exchanges y billeteras de
   software excluye las billeteras no custodiales y lista los países donde pide
   licencia o registro. Costa Rica no está en esa lista, y para países no listados
   dice que se espera obtener la licencia que exija la ley local y que Google puede
   pedir información de cumplimiento
   ([política](https://support.google.com/googleplay/android-developer/answer/16329703)).
   Si la app se publica en países que sí están listados (Estados Unidos, la Unión
   Europea, el Reino Unido, etc.), hay que dejar de seleccionarlos como países de
   distribución o tener la licencia de cada uno. Los países de distribución se
   eligen en Play Console: conviene empezar solo con Costa Rica.
3. **Servicios financieros sin licencia.** El estudio interno (`ROADMAP_JPC.md`,
   `ESTUDIO_MERCADO_JPC_2026-06.md`) deja claro que la empresa no es participante de
   SINPE ni tiene licencia PSP. La ficha ya no sugiere lo contrario, pero ninguna
   frase del texto debe leerse como "entidad supervisada", "banco" ni "SINPE".
   Si se quiere agregar una aclaración expresa ("KiramoPay no es un banco"), la
   redacta el abogado.
4. **Cuenta de organización.** Google dice que una cuenta de organización es la
   que corresponde a una empresa y que es obligatoria para apps que ofrecen
   servicios financieros
   ([tipos de cuenta](https://support.google.com/googleplay/android-developer/answer/13634885)).

## 4. Recursos gráficos

Medidas oficiales de
[Agregar recursos de vista previa](https://support.google.com/googleplay/android-developer/answer/9866151)
y de las
[especificaciones del icono](https://developer.android.com/distribute/google-play/resources/icon-design-specifications).
La columna "Carpeta" es la que lee Fastlane (`metadata/android/es-419/images/`).

| Recurso | Medidas y formato oficiales | Cantidad | Carpeta | Estado |
|---------|-----------------------------|----------|---------|--------|
| Icono | 512 x 512 px, PNG de 32 bits, sRGB, hasta 1024 KB. Cuadrado completo: Google aplica las esquinas (30 % del lado) y la sombra, así que no se redondea ni se sombrea | 1 | `icon.png` | Hecho. Se generó desde `public/icon.svg` sin el recorte de esquinas redondeadas (el PNG de `public/icons/icon-512.png` trae las esquinas transparentes y redondeadas, y la especificación pide que no se redondeen). |
| Gráfico de funciones | 1024 x 500 px, JPEG o PNG de 24 bits, sin alfa | 1 | `featureGraphic.png` | Falta. Es una pieza de diseño. |
| Capturas de teléfono | JPEG o PNG de 24 bits, sin alfa. Lado mínimo 320 px y máximo 3840 px, y el lado mayor no puede superar el doble del menor | Mínimo 2 en total entre todos los tipos de dispositivo; hasta 8 por tipo | `phoneScreenshots/` | Faltan. Sugerencia: 1080 x 1920 (9:16), que cumple lo anterior. |
| Capturas de tablet de 7" y 10" | Mismas reglas de formato. Para ser elegible a recomendaciones en pantallas grandes: al menos 4, de 1080 a 7680 px, en 16:9 horizontal o 9:16 vertical | Opcional | `sevenInchScreenshots/`, `tenInchScreenshots/` | Opcional. Subirlas solo si la app se prueba y se ve bien en una tablet. |
| Video de vista previa | URL de YouTube pública o no listada, sin restricción de edad, sin monetización, incrustable | Opcional | `video.txt` (URL) | Opcional. |

Reglas que aplican a las capturas: tienen que reflejar la experiencia real de la
app (política de metadatos), no pueden mostrar datos reales de personas, y no deben
mostrar módulos que no funcionan como si funcionaran (Mercado, tarjetas, pago de
servicios). Se toman en un dispositivo o emulador con una cuenta de prueba. Quedan
pendientes a propósito: una captura sacada del navegador con datos de ejemplo no
es la experiencia de la app instalada.

Además, Play Console pide en la ficha un correo de contacto (obligatorio) y,
opcionalmente, un sitio web y un teléfono, y la URL de la política de privacidad.

## 5. Pendientes de esta ficha

- Decisión del usuario sobre el título (sección 2).
- Revisión legal de las afirmaciones de la sección 3 antes de pegar los textos en Play Console.
- Gráfico de funciones y capturas (sección 4).
- Decidir si el módulo Mercado queda visible en la versión de Play: la ficha ya lo
  presenta como "próximamente", pero la app lo muestra en la pantalla de inicio.
- Una ficha en inglés (`en-US`) es opcional: la app tiene siete idiomas, pero la
  ficha se publica solo en español hasta que se decida lo contrario.
