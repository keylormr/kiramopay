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
confirmacion, contrasena y, si esta activo, el codigo del autenticador, y la persona acepta de
forma expresa el plazo de 30 dias.

**Enlace web que no necesita la app:** `/eliminar-cuenta/` nombra a KiramoPay, muestra el
formulario arriba y no manda a reinstalar nada. Tiene una casilla obligatoria donde la persona
acepta el plazo de 30 dias (sin marcarla no se envia nada, y el servidor tambien lo rechaza con
`TERMS_NOT_ACCEPTED`). Comprueba que el correo o telefono es de la persona con un codigo, y con
el codigo correcto empieza el plazo (el dia 0). La pagina responde lo mismo en todos los casos y
no revela el estado de la cuenta; lo que sigue le llega al correo registrado en la cuenta (sin
correo registrado no hay a donde escribirle, y la pagina misma explica lo que sigue):

- Cuenta sin pendientes: queda bloqueada y recibe la respuesta escrita (que se suprime el dia
  30, que se conserva por la Ley 7786 y hasta cuando, y su derecho a acudir a la PRODHAB).
- Cuenta con algo pendiente (saldo, un movimiento en curso, etc.): el plazo no empieza y recibe
  un correo con lo que tiene que resolver.
- Cuenta bajo revision (bloqueada por el equipo): la atiende una persona del equipo, desde
  Admin, Cuentas, pestana *Eliminaciones*, antes de que empiece el plazo.

**Politica de privacidad:** `/privacidad/`, con enlace en Perfil (Soporte y Acerca de), en el
login y en el registro. Esta marcada **BORRADOR** y no se debe enviar a Play como definitiva.

**Que cuenta como eliminar (decision del dueno, 2026-10-18).** La eliminacion no es inmediata;
tiene una linea de tiempo que la politica y la pagina web explican igual:

| Momento | Que pasa |
|---|---|
| Dia 0: la persona lo pide (app o web) y acepta el plazo | La cuenta queda bloqueada en el acto: no puede entrar, ni mover ni recibir dinero, ni recibe avisos. No se borra nada todavia. Recibe en el correo de la cuenta, si tiene uno, una respuesta escrita: que se suprime el dia 30, que se conserva por la Ley 7786 y hasta cuando, y su derecho a acudir a la PRODHAB (Ley 8968). |
| Dias 0 a 30 | Puede reactivarla entrando a la app con su contrasena (la app le ofrece reactivar). Reactivar cancela el proceso y la cuenta vuelve a funcionar; los avisos se vuelven a encender desde Perfil y las llaves de API se crean de nuevo. Durante el plazo nadie le puede mandar dinero (SINPE, QR, garantia) ni recibe webhooks. Si el dia 30 aparece algo pendiente que impide cerrarla, sigue bloqueada y reactivable hasta que se cierre. |
| Dia 30 | Se **suprime** de forma definitiva: datos de acceso (las credenciales quedan revocadas), preferencias, contactos, cuentas bancarias vinculadas, servicios guardados, presupuestos, pagos programados, alertas de precio, conversaciones con el asistente, historial de avisos, dispositivos y sesiones; las tarjetas virtuales se cancelan. Se **conserva**, identificado y aislado (fuera de la aplicacion, solo para cumplir la ley), lo que la Ley 7786 (art. 16) obliga: identificacion y verificacion (KYC), registro de operaciones y sus contrapartes, auditoria de seguridad, y registros de cumplimiento y prevencion de fraude. El comercio, si tenia, queda cerrado e inactivo (su identidad legal y sus cobros son parte de lo conservado). Las contrapartes conservan en su propio historial lo que ya veian (por ejemplo, el nombre en un envio). Desde aqui la persona puede volver a registrarse con la misma cedula, telefono y correo; seria una cuenta nueva. |
| Dia 30 mas 5 anos | Lo conservado se desasocia de la persona de forma irreversible: se vacian nombres, documentos, telefonos, direcciones, notas e IP; quedan solo montos y fechas como rastro contable. El plazo puede ser mayor solo si la ley o una autoridad competente lo exige. |

La fila de usuario no se borra nunca (el libro del dinero no se puede alterar); el dia 30 queda
sin datos personales y la identidad pasa a una copia aislada. Detalle completo por tabla en
`backend/internal/accountdeletion/clasificacion.go`.

**Respuestas para el formulario de Play "Eliminacion de datos":**

- Via para pedir la eliminacion: dentro de la app y por la web (las dos URL de arriba).
- Datos que se eliminan: los de la fila "Dia 30" de la tabla, mas las credenciales; la
  eliminacion se completa 30 dias despues de la solicitud, y hasta entonces la persona puede
  reactivar la cuenta.
- Datos que se conservan: los de la Ley 7786 (identificacion y verificacion, operaciones y
  contrapartes, auditoria de seguridad, cumplimiento y prevencion de fraude), identificados y
  aislados, por 5 anos desde el dia 30 (mas solo si la ley o una autoridad competente lo
  exige); despues se desasocian de forma irreversible. Debe constar igual en la politica.

## Antes de enviar la ficha

1. **Revision legal de la politica.** Todo lo marcado `[DEFINIR]` y `[CONFIRMAR]` en
   `public/privacidad/index.html` lo completa el responsable con su abogado: razon social,
   base legal, plazo de respuesta a las solicitudes de acceso y correccion, edad minima,
   contacto de privacidad, lista final de proveedores y rotacion de las copias de seguridad.
   Al publicar la version final, quitar el aviso de borrador y la etiqueta `noindex`.
2. **Plazos de retencion (decididos por el dueno el 2026-10-18; falta la validacion del
   abogado).** Lo que la Ley 7786 (art. 16) obliga se conserva identificado y aislado hasta el
   dia 30 mas 5 anos, y despues se desasocia. La pagina web y la politica ya dicen esto; si el
   abogado cambia el plazo, hay que cambiar el texto de ambas, el de la respuesta por correo y
   la fecha que el sistema fija como fin de la conservacion.
3. **Nombre del desarrollador** tal como aparece en la ficha de Play, si difiere de
   "KiramoPay": agregarlo a `public/eliminar-cuenta/index.html` (hay un comentario donde).
4. **Correo de soporte o de privacidad**: no esta confirmado que exista; la politica y la
   alternativa sin JavaScript de la pagina de eliminacion lo piden.
5. **Formulario de Seguridad de los datos.** Declarar que se recolectan los datos de
   identidad, contacto, financieros, de dispositivo y de uso que lista la politica, y
   responder segun la pregunta vigente del formulario sobre eliminacion de datos: hay via
   dentro de la app, hay enlace web, la eliminacion se completa a los 30 dias de la solicitud
   (con plazo de reactivacion), y parte de los datos se conserva 5 anos por obligacion legal
   (debe constar en la politica). El asistente envia texto del usuario a un proveedor externo
   de modelos de lenguaje: declararlo como dato compartido.
6. **Preguntas para el abogado** (el sistema ya soporta cualquier respuesta; aplicarla es
   cambiar `clasificacion.go` y los textos, no redisenar).
   Decididas por el dueno el 2026-10-18, para que el abogado las valide:
   - L1. Plazo de conservacion de los registros financieros y de transacciones: 5 anos desde el
     dia 30, por la Ley 7786 (art. 16); el codigo cita ademas el Decreto 36948 (art. 21).
     Ninguna cita esta verificada por el abogado. Tampoco el articulo de la Ley 8968 sobre
     supresion ni el procedimiento ante PRODHAB.
   - L2 y L3. Se conserva, identificada y aislada, la identificacion de las contrapartes y
     el KYC, las verificaciones de identidad y la revision contra listas de sanciones.
   - L5. La auditoria con IP y agente de usuario se conserva el mismo plazo y despues se
     vacia la IP.
   - L6. El comercio de quien elimina la cuenta queda cerrado e inactivo; su identidad legal
     (cedula, razon social) y sus cobros se conservan.
   - L8. El plazo que promete la pagina web es de 30 dias, con reactivacion hasta el dia 30.

   Siguen abiertas:
   - L4. Fraude y perfil de riesgo; y si se conserva un hash de la cedula para impedir que
     una cuenta bloqueada por fraude vuelva a registrarse (hoy se descarta).
   - L7. Texto sobre copias de seguridad y lista de proveedores encargados (SMS, correo,
     verificacion, notificaciones, asistente) con sus contratos, para pedirles el borrado.
   - L9. Plazo de respuesta a las solicitudes de acceso y correccion, y derechos que la
     politica debe listar.

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
