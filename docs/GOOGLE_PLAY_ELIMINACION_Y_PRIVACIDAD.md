# Google Play: eliminacion de cuenta y politica de privacidad

Lo que hay que pegar en Play Console y lo que falta antes de enviar la ficha.
Requisitos de Google: [eliminacion de cuenta](https://support.google.com/googleplay/android-developer/answer/13327111)
y [politica de privacidad](https://support.google.com/googleplay/android-developer/answer/9859455).

## URL para pegar en Play Console

El dominio del sitio publico esta por confirmar. Hoy las paginas viven en el mismo sitio
que la aplicacion web (Vercel); si el dominio definitivo es otro, cambian solo la base.

| Donde en Play Console | URL |
|---|---|
| Contenido de la app, Politica de privacidad | `https://kiramopay.vercel.app/privacidad/` |
| Seguridad de los datos, enlace para pedir la eliminacion de cuenta y datos | `https://kiramopay.vercel.app/eliminar-cuenta/` |

Si el dominio cambia, hay que ajustar tambien la variable de construccion `VITE_PUBLIC_SITE_URL`
(el valor por defecto es `https://kiramopay.vercel.app`), porque es la direccion que abren
las aplicaciones Android e iOS desde el perfil, el login y el registro.

Las dos URL cargan sin la aplicacion y sin cuenta (HTML estatico en `public/`). Verificar
despues de desplegar que responden, con y sin barra final, antes de pegarlas.

## Como cumple cada requisito

**Via dentro de la app:** Perfil, Seguridad, *Eliminar mi cuenta*. Pide palabra de
confirmacion, contrasena y, si esta activo, el codigo del autenticador.

**Enlace web que no necesita la app:** `/eliminar-cuenta/` nombra a KiramoPay, muestra el
formulario arriba y no manda a reinstalar nada. Comprueba que el correo o telefono es de la
persona con un codigo; una persona del equipo atiende la solicitud desde
Admin, Cuentas, pestana *Eliminaciones*. Si hay saldo o algo pendiente, se le escribe al
correo de la cuenta que debe resolver.

**Politica de privacidad:** `/privacidad/`, con enlace en Perfil (Soporte y Acerca de), en el
login y en el registro. Esta marcada **BORRADOR** y no se debe enviar a Play como definitiva.

**Que cuenta como eliminar:** la fila de usuario no se borra (el libro del dinero no se
puede alterar); queda como tumba anonimizada. Se borran credenciales, sesiones, dispositivos,
contactos, cuentas vinculadas, presupuestos, pagos recurrentes y conversaciones del asistente;
las tarjetas se cancelan. El resto, por obligacion legal, seguridad o fraude, se conserva y
la politica debe decirlo (seccion *Cuanto tiempo los conservamos*). Detalle completo por
tabla en `backend/internal/accountdeletion/clasificacion.go`.

## Antes de enviar la ficha

1. **Revision legal de la politica.** Todo lo marcado `[DEFINIR]` y `[CONFIRMAR]` en
   `public/privacidad/index.html` lo completa el responsable con su abogado: razon social,
   plazos de conservacion, base legal, derechos y plazo de respuesta, edad minima, contacto
   de privacidad, lista final de proveedores. Al publicar la version final, quitar el aviso
   de borrador y la etiqueta `noindex`.
2. **Plazos de retencion (decision del abogado).** Mientras no esten definidos, el sistema
   conserva sin tocar: contrapartes dentro de transacciones y SINPE, pagos y retiros, KYC,
   reportes UIF, fraude, auditoria con IP y la identidad legal de los comercios.
3. **Nombre del desarrollador** tal como aparece en la ficha de Play, si difiere de
   "KiramoPay": agregarlo a `public/eliminar-cuenta/index.html` (hay un comentario donde).
4. **Correo de soporte o de privacidad**: no esta confirmado que exista; la politica y la
   alternativa sin JavaScript de la pagina de eliminacion lo piden.
5. **Formulario de Seguridad de los datos.** Declarar que se recolectan los datos de
   identidad, contacto, financieros, de dispositivo y de uso que lista la politica, y
   responder segun la pregunta vigente del formulario sobre eliminacion de datos: hay via
   dentro de la app, hay enlace web, y parte de los datos se conserva por motivos legales y
   de seguridad (debe constar en la politica). El asistente envia texto del usuario a un
   proveedor externo de modelos de lenguaje: declararlo como dato compartido.
6. **Preguntas para el abogado** (el sistema ya soporta cualquier respuesta; aplicarla es
   cambiar `clasificacion.go` y escribir un trabajo de purga, no redisenar):
   - L1. Plazo de conservacion de los registros financieros y de transacciones. En el repo,
     `AUDITORIA_INTEGRAL_2026-05-20.md` dice 5 anos citando Ley 8204 y SUGEF, sin cita de
     articulo; no esta verificado en una fuente oficial. Tampoco el articulo de la Ley 8968
     sobre supresion ni el procedimiento ante PRODHAB.
   - L2. Si se conserva la identificacion de las contrapartes en transacciones, SINPE,
     cripto y retiros, o se borra.
   - L3. KYC, verificaciones de identidad, listas de sanciones y reportes UIF: conservar y
     por cuanto.
   - L4. Fraude y perfil de riesgo; y si se conserva un hash de la cedula para impedir que
     una cuenta bloqueada por fraude vuelva a registrarse (hoy se descarta).
   - L5. Auditoria con IP y agente de usuario: conservar o anonimizar pasado un plazo.
   - L6. Identidad legal de los comercios (cedula, razon social) cuando su dueno elimina la cuenta.
   - L7. Texto sobre copias de seguridad y lista de proveedores encargados (SMS, correo,
     verificacion, notificaciones, asistente) con sus contratos, para pedirles el borrado.
   - L8. El plazo que se promete en la pagina web y el texto de derechos.

## Despliegue

- La migracion `077_eliminacion_de_cuenta.sql` es solo aditiva. Se aplica con
  `RUN_MIGRATIONS=true` como las anteriores; el binario viejo la ignora.
- Backend y frontend se pueden desplegar en cualquier orden: la app nueva consulta rutas que
  el backend viejo no tiene (el boton mostraria "no pudimos revisar tu cuenta" y reintentar).
  Conviene desplegar el backend primero.
- No hay variables de entorno nuevas obligatorias. Para que lleguen los codigos y avisos
  hacen falta el proveedor de correo (y, si se quiere, el de SMS), igual que el registro.

## Hallazgos que quedan abiertos

- `sanction_screenings` guarda el nombre revisado al registrarse **sin `user_id`**; al eliminar
  una cuenta esa fila no se puede enlazar con la persona. Es un registro de cumplimiento
  (decision del abogado), pero para poder purgarlo despues hay que enlazarlo a la cuenta.
- `kyc_documents` guarda solo una referencia (`file_ref`). Si hay un almacen de objetos con
  las imagenes de cedula o selfie, borrarlas ahi no esta cubierto por este cambio.
- Las copias de seguridad conservan los datos borrados hasta que roten (el procedimiento
  actual indica 30 dias); la politica lo debe decir.
- Las pruebas de integracion del backend corren contra el esquema que declara
  `internal/testutil` a mano. Esta funcion ademas se prueba contra el esquema de las
  migraciones reales (paso nuevo en CI) y exige que toda tabla nueva con datos de una
  persona quede clasificada.
