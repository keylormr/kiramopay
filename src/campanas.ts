// Campanas promocionales que la app muestra como pop-up (estilo billeteras
// grandes: una invitacion puntual, no spam). Cada campana se muestra UNA vez
// por dispositivo (localStorage) y las nuevas llegan con las actualizaciones
// de la app — que ahora se anuncian solas, asi que el canal existe.
//
// Los textos viven en i18n (claves por campana) para respetar los 7 idiomas.
// El copy de cada campana lo decide el dueno del producto. Regla: solo se
// ofrece lo que existe. La de invitados promete puntos por cada invitado
// registrado y eso ya lo paga el programa de referidos (enlace con el codigo
// del usuario, bono en puntos de lealtad al referidor).
//
// El `id` gobierna el "ya la vi": cambiarlo reabre la campana para todo el
// mundo. Se cambio una vez, de `invitar-2026-09` a la version `-referidos`,
// porque la primera se mostro cuando el programa todavia no existia y quien la
// descarto entonces se quedaba sin ver la oferta ya real.

export interface Campana {
  /** Identificador estable: gobierna el "ya la vi" en localStorage. */
  id: string;
  tituloKey: string;
  cuerpoKey: string;
  ctaKey: string;
  /** Accion del CTA: hoy solo compartir el enlace de la app. */
  accion: 'compartir';
  /** Emoji-free: nombre del icono de la casa (componente Icons). */
  icono: 'Gift' | 'Share' | 'TrendingUp';
}

export const CAMPANAS: Campana[] = [
  {
    id: 'invitar-2026-09-referidos',
    tituloKey: 'promo_invite_title',
    cuerpoKey: 'promo_invite_body',
    ctaKey: 'promo_invite_cta',
    accion: 'compartir',
    icono: 'Gift',
  },
];

const prefijo = 'kiramopay-campana-';

export function campanaPendiente(): Campana | null {
  try {
    for (const c of CAMPANAS) {
      if (!localStorage.getItem(prefijo + c.id)) return c;
    }
  } catch { /* sin storage no se muestran campanas */ }
  return null;
}

export function marcarCampanaVista(id: string): void {
  try {
    localStorage.setItem(prefijo + id, '1');
  } catch { /* sin storage, nada que marcar */ }
}
