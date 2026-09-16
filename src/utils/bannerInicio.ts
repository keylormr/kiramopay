/**
 * Estado de "cerrado" de las tarjetas del banner de Inicio.
 *
 * Cerrar una tarjeta la oculta 30 días, PERO solo para la cuenta que la
 * cerró: la clave lleva el id del usuario. Sin eso, cerrar una tarjeta en
 * una cuenta la escondería también para la siguiente persona que entre desde
 * el mismo navegador (el mismo problema que ya se corrigió una vez con los
 * stores de Zustand — ver `limpiarDatosDeUsuario`).
 */

const PREFIJO = 'kiramopay-banner-inicio-cerrado-';
const DIAS_DE_CIERRE = 30;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

function clave(userId: string, tarjetaId: string): string {
  return `${PREFIJO}${userId}::${tarjetaId}`;
}

/** true si ESTA cuenta cerró esta tarjeta y los 30 días todavía no pasaron. */
export function tarjetaBannerCerrada(userId: string, tarjetaId: string): boolean {
  if (!userId) return false;
  try {
    const guardado = localStorage.getItem(clave(userId, tarjetaId));
    if (!guardado) return false;
    const vence = Number(guardado);
    return Number.isFinite(vence) && Date.now() < vence;
  } catch {
    // Sin storage no hay memoria de cierres: la tarjeta se sigue mostrando.
    return false;
  }
}

/** Cierra la tarjeta para ESTA cuenta durante 30 días. */
export function cerrarTarjetaBanner(userId: string, tarjetaId: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(clave(userId, tarjetaId), String(Date.now() + DIAS_DE_CIERRE * MS_POR_DIA));
  } catch {
    // Sin storage la tarjeta vuelve a aparecer la próxima vez: no es ideal,
    // pero tampoco rompe nada.
  }
}
