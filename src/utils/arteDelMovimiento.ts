// Que se dibuja a la izquierda de un movimiento en la actividad del Inicio: las
// iniciales de la persona o del comercio con quien fue, o el icono 3D de su
// categoria. Las iniciales solo salen de la contraparte que manda el servidor:
// armarlas del titulo de respaldo ("Transferencia SINPE enviada") daria "TS",
// que parece una persona y no lo es.

import type { Transaction } from '@/types';
import type { NombreIcono3D } from '@/components/arte3d/catalogo';

export type ArteDelMovimiento =
  | { tipo: 'iniciales'; texto: string }
  | { tipo: 'icono'; nombre: NombreIcono3D };

const CON_FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Las dos primeras letras de las dos primeras palabras: "Diego Rojas" -> "DR". */
export function iniciales(nombre: string | undefined): string {
  const limpio = (nombre || '').trim();
  if (!limpio || CON_FORMA_DE_UUID.test(limpio)) return '';
  // Un telefono o un numero de cuenta no es una cara: "8812 4471" daria "88".
  if (!/\p{L}/u.test(limpio)) return '';
  const palabras = limpio
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (palabras.length === 0) return '';
  const letras = palabras.length === 1 ? palabras[0].slice(0, 2) : palabras[0][0] + palabras[1][0];
  return letras.toLocaleUpperCase();
}

/** El tipo de movimiento del servidor (kind) -> su icono. */
const POR_TIPO: Record<string, NombreIcono3D> = {
  bill_payment: 'factura',
  recharge: 'recarga',
  deposit: 'pila',
  withdrawal: 'pila',
  merchant_withdrawal: 'pila',
  refund: 'moneda',
  savings_deposit: 'metas',
  savings_withdraw: 'metas',
  loyalty_cashback: 'recompensas',
  crypto_buy: 'cripto',
  crypto_sell: 'cripto',
  crypto_send: 'cripto',
  escrow_hold: 'protegido',
  escrow_release: 'protegido',
  escrow_refund: 'protegido',
};

/**
 * La categoria escrita (los movimientos de demostracion la traen en espanol, y
 * algunos servicios en ingles) -> su icono. Se compara sin tildes.
 */
const POR_CATEGORIA: [RegExp, NombreIcono3D][] = [
  [/^(comida|food|restaurant|restaurante|cafe)/, 'comida'],
  [/^(transporte|transport)/, 'transporte'],
  [/^(supermercado|super|groceries|grocery)/, 'supermercado'],
  [/^(entretenimiento|entertainment|ocio|cine)/, 'entretenimiento'],
  [/^(electricity|electricidad|luz)/, 'luz'],
  [/^(water|agua)/, 'agua'],
  [/^(telecom|telefonia|phone|mobile|movil)/, 'telefonia'],
  [/^internet/, 'internet'],
  [/^(cable|tv)/, 'cable'],
  [/^(servicios|services|utilities|insurance)/, 'factura'],
  [/^(crypto|cripto)/, 'cripto'],
  [/^(savings|ahorro|metas)/, 'metas'],
];

/** Movimientos entre personas: la cara es la de la otra persona. */
const ENTRE_PERSONAS = new Set(['sinpe_send', 'sinpe_receive', 'p2p_send', 'p2p_receive', 'qr_receive', 'qr_payment']);

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function arteDelMovimiento(tx: Transaction): ArteDelMovimiento {
  const kind = (tx.kind || '').trim();
  const deLaContraparte = iniciales(tx.counterparty);

  if (ENTRE_PERSONAS.has(kind) && deLaContraparte) return { tipo: 'iniciales', texto: deLaContraparte };
  if (POR_TIPO[kind]) return { tipo: 'icono', nombre: POR_TIPO[kind] };

  const categoria = sinTildes(tx.category || '');
  for (const [patron, nombre] of POR_CATEGORIA) {
    if (patron.test(categoria)) return { tipo: 'icono', nombre };
  }
  if (deLaContraparte) return { tipo: 'iniciales', texto: deLaContraparte };
  return { tipo: 'icono', nombre: 'moneda' };
}
