/**
 * Bloqueo del desplazamiento de la pagina mientras hay hojas o menus modales
 * abiertos.
 *
 * Cada hoja ponia `body.style.overflow = 'hidden'` al abrirse y lo vaciaba al
 * cerrarse, y tambien al montarse cerrada. Con dos hojas a la vez (Webhooks
 * monta la suya para crear uno, una hoja que abre otra) la que se montaba o
 * se cerraba soltaba el bloqueo de la que seguia abierta, y la pagina de abajo
 * volvia a desplazarse. Aqui se cuenta quien lo pide: el bloqueo se suelta
 * cuando se va el ultimo.
 *
 * Las pantallas completas (.kp-capa) no pasan por aqui: las bloquea una regla
 * de index.css que depende de que esten montadas.
 */
let pedidos = 0;
let anterior = '';

/** Bloquea el desplazamiento y devuelve la funcion que lo suelta (una sola vez). */
export function bloquearDesplazamiento(): () => void {
  if (pedidos === 0) {
    anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  pedidos++;
  let soltado = false;
  return () => {
    if (soltado) return;
    soltado = true;
    // Nunca por debajo de cero: una recarga en caliente del modulo en
    // desarrollo reinicia la cuenta con hojas todavia abiertas.
    pedidos = Math.max(0, pedidos - 1);
    if (pedidos === 0) document.body.style.overflow = anterior;
  };
}
