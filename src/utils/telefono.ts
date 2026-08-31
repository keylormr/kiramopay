// Telefonos SINPE de Costa Rica: 8 digitos, prefijo de pais +506.
//
// El backend exige el formato +506XXXXXXXX. En la interfaz el numero llega de
// dos caminos con formas distintas: los contactos guardan "+50688880001" y la
// entrada manual produce solo los 8 digitos ("60000001"). Mandar la forma
// manual tal cual era un 400 seguro; anteponer "+506" a la forma de contacto
// duplicaba el prefijo en pantalla. Un solo punto de normalizacion evita las
// dos familias de errores.

/**
 * Lleva cualquier forma razonable de un numero costarricense al formato del
 * backend (+506XXXXXXXX). Devuelve null cuando los digitos no alcanzan para
 * un numero valido.
 */
export function normalizarTelefonoCR(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, '');
  if (digitos.length === 8) return '+506' + digitos;
  if (digitos.length === 11 && digitos.startsWith('506')) return '+' + digitos;
  return null;
}

/**
 * Forma de mostrar un numero al usuario: "+506 8888-0001". Acepta las mismas
 * entradas que la normalizacion; si no se puede interpretar, devuelve la
 * entrada tal cual para no esconder datos.
 */
export function formatearTelefonoCR(entrada: string): string {
  const normalizado = normalizarTelefonoCR(entrada);
  if (!normalizado) return entrada;
  const local = normalizado.slice(4);
  return `+506 ${local.slice(0, 4)}-${local.slice(4)}`;
}
