import type { Transaction } from '@/types';

/**
 * Nombre visible de un movimiento.
 *
 * El título sale del nombre de la contraparte o, si no hay, de la descripción
 * que escribió la persona. Las dos pueden venir vacías: una transferencia SINPE
 * interna sin nota y un pago QR sin comentario no traen ninguna de las dos, y la
 * fila quedaba impresa sin texto — un hueco en el historial.
 *
 * Este respaldo nombra el movimiento por su tipo. Cubre además las transacciones
 * ya guardadas, que nunca van a tener contraparte por más que el backend empiece
 * a poblarla de ahora en adelante.
 */
// Un identificador tecnico no es un titulo. Filas viejas guardaron el UUID de
// la contraparte o del codigo QR en la descripcion, y la lista terminaba
// mostrando "b5f43f1a-1f10-48a3-..." como nombre del movimiento.
const CON_FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function legible(s: string | undefined): string {
  const limpio = (s || '').trim();
  return CON_FORMA_DE_UUID.test(limpio) ? '' : limpio;
}

/**
 * Movimientos de una meta de ahorro: backend/internal/savings/service.go
 * escribe la descripcion SIEMPRE en ingles y sin traducir ("savings deposit:
 * <nombre de la meta>"), y como nunca viene vacia, la prioridad normal
 * ("propio > tipo") la dejaba pasar tal cual en cualquier idioma de la app.
 *
 * Aca el tipo manda: el titulo se arma traducido a partir de `kind`, y el
 * nombre de la meta —lo unico que trae la descripcion cruda que vale la
 * pena conservar— se recorta del otro lado del prefijo conocido.
 */
const PREFIJOS_DESCRIPCION_AHORRO: Record<string, string> = {
  savings_deposit: 'savings deposit:',
  savings_withdraw: 'savings withdraw:',
};

function tituloDeAhorro(tx: Transaction, t: (key: string) => string): string | null {
  const kind = (tx.kind || '').trim();
  const prefijo = PREFIJOS_DESCRIPCION_AHORRO[kind];
  if (!prefijo) return null;

  const etiqueta = t(`tx_title_${kind}`);
  const cruda = (tx.description || tx.title || '').trim();
  const nombreMeta = cruda.startsWith(prefijo) ? legible(cruda.slice(prefijo.length)) : '';
  return nombreMeta ? `${etiqueta}: ${nombreMeta}` : etiqueta;
}

/**
 * La cuota de un pago dividido: backend/internal/splitpay/service.go la
 * describe "Split: <titulo de la division>", y la fila de quien paga llega sin
 * contraparte (la cuota del creador se guarda sin nombre), asi que esa
 * descripcion cruda, con el prefijo en ingles, era el titulo en cualquier
 * idioma.
 *
 * A diferencia del ahorro, el tipo no manda siempre: solo se reemplaza el
 * prefijo conocido. Cuando la fila trae un nombre de persona (quien cobra ve
 * el de quien le pago), ese nombre sigue siendo el titulo.
 */
const PREFIJO_CUOTA_DIVIDIDA = 'Split:';
const TIPOS_CUOTA_DIVIDIDA = new Set(['p2p_send', 'p2p_receive']);

function tituloDeCuotaDividida(tx: Transaction, t: (key: string) => string): string | null {
  const kind = (tx.kind || '').trim();
  if (!TIPOS_CUOTA_DIVIDIDA.has(kind)) return null;

  const cruda = (tx.title || tx.description || '').trim();
  if (!cruda.startsWith(PREFIJO_CUOTA_DIVIDIDA)) return null;

  const etiqueta = t(`tx_title_${kind}`);
  const division = legible(cruda.slice(PREFIJO_CUOTA_DIVIDIDA.length));
  return division ? `${etiqueta}: ${division}` : etiqueta;
}

export function txTitle(tx: Transaction, t: (key: string) => string): string {
  const deAhorro = tituloDeAhorro(tx, t);
  if (deAhorro) return deAhorro;

  const deCuota = tituloDeCuotaDividida(tx, t);
  if (deCuota) return deCuota;

  const propio = legible(tx.title) || legible(tx.description);
  if (propio) return propio;

  const kind = (tx.kind || '').trim();
  if (kind) {
    const traducido = t(`tx_title_${kind}`);
    // t() devuelve la clave cuando no existe: en ese caso no sirve como título.
    if (traducido && traducido !== `tx_title_${kind}`) return traducido;
  }

  // Último recurso: entrada o salida de dinero, que siempre es cierto.
  return t(tx.type === 'credit' ? 'tx_title_generic_in' : 'tx_title_generic_out');
}
