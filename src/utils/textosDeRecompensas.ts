import { formatMoney } from './money';
import type { Reward } from '@/api/repositories/loyalty.repository';

// El catalogo de Recompensas lo siembra el servidor en espanol ("Cashback ₡500",
// "₡500 de vuelta a tu cuenta CRC") y el historial de puntos guarda sus
// descripciones ("Canje: Cashback ₡500", "Invitado registrado") tambien en
// espanol. Con la app en otro idioma, la pantalla quedaba a medias.
//
// Aca los textos conocidos se escriben en el idioma de la pantalla SIN tocar lo
// guardado: es una vista. Lo que no se reconoce con certeza se muestra como llega;
// nunca se inventa una traduccion.

type Traduce = (clave: string) => string;

// El monto como lo escribio el servidor en el nombre ("₡1,000"), con la misma
// regla de la app para todos los montos.
const montoDelPremio = (cashbackMinor: number) => formatMoney(cashbackMinor / 100, 'CRC');

// Solo un premio de descuento con monto es un cashback de los de siempre.
function esCashback(premio: Pick<Reward, 'category' | 'cashbackMinor'>): premio is { category: 'discount'; cashbackMinor: number } {
  return premio.category === 'discount' && typeof premio.cashbackMinor === 'number' && premio.cashbackMinor > 0;
}

/**
 * Nombre del premio en el idioma de la pantalla. Solo se reescribe el cashback
 * que tiene el nombre de siempre en espanol ("Cashback ₡500"): un premio con otro
 * nombre, aunque tenga monto, se muestra tal cual.
 */
export function nombreDelPremio(premio: Pick<Reward, 'name' | 'category' | 'cashbackMinor'>, t: Traduce): string {
  if (!esCashback(premio)) return premio.name;
  const monto = montoDelPremio(premio.cashbackMinor);
  if (premio.name !== `Cashback ${monto}`) return premio.name;
  return t('loyalty_reward_cashback_name').replace('{monto}', monto);
}

/** Descripcion del premio en el idioma de la pantalla; mismas reglas que el nombre. */
export function descripcionDelPremio(
  premio: Pick<Reward, 'description' | 'category' | 'cashbackMinor'>,
  t: Traduce,
): string {
  if (!esCashback(premio)) return premio.description;
  const monto = montoDelPremio(premio.cashbackMinor);
  if (premio.description !== `${monto} de vuelta a tu cuenta CRC`) return premio.description;
  return t('loyalty_reward_cashback_desc').replace('{monto}', monto);
}

const CANJE = /^Canje: Cashback (₡[\d.,]+)$/;
const REFERIDO = 'Invitado registrado';

/**
 * Descripcion de un movimiento de puntos en el idioma de la pantalla: el canje de
 * un cashback y el bono por un referido. Cualquier otra se muestra como llega.
 */
export function descripcionDelMovimiento(descripcion: string, t: Traduce): string {
  const canje = CANJE.exec(descripcion);
  if (canje) {
    const premio = t('loyalty_reward_cashback_name').replace('{monto}', canje[1]);
    return t('loyalty_tx_redeem').replace('{premio}', premio);
  }
  if (descripcion === REFERIDO) return t('loyalty_tx_referral');
  return descripcion;
}
