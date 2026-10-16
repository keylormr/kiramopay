/**
 * La llave de idempotencia de pagar un recibo y de recargar.
 *
 * Sin llave, una respuesta perdida (la red se corto despues del cobro) dejaba
 * la pantalla diciendo "revisa tu conexion" con el boton activo, y tocarlo
 * otra vez cobraba de nuevo. Con ella, el reintento con los mismos datos lleva
 * la misma llave y el servidor contesta con el pago que ya estaba hecho.
 *
 * La guarda intentoPendiente, como la de SINPE: sobrevive a cambiar de
 * pestana, al bloqueo y a recargar la app. Se suelta cuando el pago salio (o
 * ya estaba hecho), cuando el servidor dice que la llave es de otro pago, y
 * cuando se cancela el segundo factor; ante cualquier otro error se conserva,
 * porque la pantalla no sabe si el servidor llego a cobrar.
 *
 * La firma es lo que hace que dos pedidos sean el mismo pago. La pantalla de
 * Servicios y el asistente la arman igual, para que el mismo pago lleve la
 * misma llave desde cualquiera de las dos: el codigo del proveedor sin
 * distinguir mayusculas (la pantalla manda 'ice', el asistente 'ICE') y el
 * telefono por sus ocho digitos.
 */
export const AMBITO_DEL_RECIBO = 'recibo';
export const AMBITO_DE_LA_RECARGA = 'recarga';

export function firmaDelRecibo(proveedor: string, cliente: string, monto: number): string {
  return `${proveedor.trim().toUpperCase()}|${cliente.trim()}|${monto}`;
}

export function firmaDeLaRecarga(operador: string, telefono: string, monto: number): string {
  return `${operador.trim().toLowerCase()}|${telefono.replace(/\D/g, '').slice(-8)}|${monto}`;
}

export function llaveNueva(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `servicio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
