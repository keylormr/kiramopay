/**
 * Código de invitación que trae el enlace `?ref=` del programa de referidos.
 *
 * Se lee UNA vez, se borra de la URL (no es una credencial como el token de
 * recuperación, pero tampoco tiene por qué quedarse en el historial ni viajar
 * en el Referer) y se guarda en sessionStorage: el invitado suele pasar por
 * Login, esperar el bootstrap o recargar antes de tocar "Crear cuenta", y sin
 * la copia el código se perdería en el camino.
 *
 * Prioridad: URL (y se persiste) > sessionStorage. Devuelve '' si no hay
 * código o si el que viene no cumple el formato del backend.
 */
const CLAVE = 'kiramopay-ref-pendiente';
const FORMATO = /^[A-Z0-9]{8}$/;

/** Normaliza: trim + mayúsculas; '' si no cumple ^[A-Z0-9]{8}$. */
export function normalizarCodigoInvitacion(s: string): string {
  const codigo = s.trim().toUpperCase();
  return FORMATO.test(codigo) ? codigo : '';
}

function leerGuardado(): string {
  try {
    return normalizarCodigoInvitacion(sessionStorage.getItem(CLAVE) ?? '');
  } catch {
    return '';
  }
}

function guardar(codigo: string): void {
  try {
    sessionStorage.setItem(CLAVE, codigo);
  } catch {
    // sin sessionStorage el código vive solo en memoria (estado del componente)
  }
}

/**
 * Lee `?ref=` una sola vez, lo borra de la URL y lo deja en sessionStorage.
 * Devuelve el código normalizado o ''.
 */
export function takeReferralCode(): string {
  if (typeof window === 'undefined') return '';

  const params = new URLSearchParams(window.location.search);
  const crudo = params.get('ref');
  if (crudo === null) return leerGuardado();

  params.delete('ref');
  const query = params.toString();
  window.history.replaceState(
    null,
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
  );

  const codigo = normalizarCodigoInvitacion(crudo);
  if (codigo) {
    guardar(codigo);
    return codigo;
  }
  // Un `ref` malformado no pisa un código válido guardado antes.
  return leerGuardado();
}

/** Se llama tras un registro exitoso (o al desechar el código). */
export function clearReferralCode(): void {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // sin sessionStorage no hay nada que borrar
  }
}
