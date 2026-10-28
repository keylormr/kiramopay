-- 085_actividad_de_sesion.sql
--
-- Dos cosas sobre las sesiones, ambas del cierre por inactividad.
--
-- 1. Cuando fue la ultima ACCION de la persona en cada sesion.
--
-- El cierre por inactividad (JWT_IDLE_MINUTES, 30 por defecto) se media desde la
-- ultima EMISION del token de refresh. Con un token de acceso de quince
-- minutos la inactividad efectiva iba de 15 a 30, y una peticion que sale sola
-- en segundo plano (precios cada cinco minutos, el sondeo de un pedido) que
-- cayera con el token vencido renovaba la sesion sin que nadie tocara la app.
--
-- Ahora el cliente avisa cada accion real de la persona (POST /auth/activity) y
-- el servidor la guarda aca. Renovar el token no la mueve: una renovacion no es
-- una accion.
--
-- NULL = la sesion nunca aviso: la abrio un cliente anterior a este cambio
-- (un APK sin actualizar). Esas sesiones se siguen midiendo como antes, desde la
-- emision del token, hasta que el cliente se actualice; si se les pusiera un
-- valor, el servidor las cerraria a los 30 minutos con la persona usando la app,
-- porque ese cliente no sabe avisar. El login tampoco la llena, por lo mismo: la
-- llena el primer aviso.
--
-- 2. Por que cerro el servidor una sesion, y las sesiones que quedaron abiertas
-- con su familia de refresh ya muerta.
--
-- Cuando el servidor cerraba una sesion por inactividad (o por reuso de un
-- refresh token) revocaba la familia de refresh_tokens pero dejaba sin marcar la
-- fila de user_sessions. "Dispositivos conectados" la seguia mostrando como
-- abierta, con su vencimiento, cuando ya no podia renovarse ni servir. El codigo
-- ya cierra las dos cosas juntas; aqui se cierran las que quedaron asi.
--
-- Una sesion cuyo refresh token vigente esta revocado no puede renovarse: es una
-- sesion muerta. Se marca con la hora a la que murio su refresh token (no con la
-- de la migracion) y el motivo generico 'refresh_revoked': de las que ya
-- quedaron no se sabe si fue inactividad, reuso, un cambio de contrasena o un
-- bloqueo, y el rastro de cada una esta en audit_logs. La fila no se borra.
-- Una sesion con el refresh vigente (aunque ya rotado) no se toca.
--
-- Con zona, como toda fecha desde la 034.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_reason TEXT;

UPDATE user_sessions s
   SET revoked_at = rt.revoked_at,
       revoked_reason = 'refresh_revoked'
  FROM refresh_tokens rt
 WHERE rt.jti = s.refresh_jti
   AND rt.revoked_at IS NOT NULL
   AND s.revoked_at IS NULL;
