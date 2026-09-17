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

/**
 * Compara dos representaciones de un numero costarricense por su forma
 * canonica, sin importar si traen guion, espacios o el prefijo +506. Dos
 * entradas que no normalicen a un numero valido nunca se consideran iguales.
 */
export function mismoTelefonoCR(a: string, b: string): boolean {
  const na = normalizarTelefonoCR(a);
  return na !== null && na === normalizarTelefonoCR(b);
}

/**
 * Para un campo que solo debe llevar los 8 digitos locales (sin +506): toma
 * el valor crudo que el input ya tiene en el DOM en cada tecla y devuelve lo
 * que el campo debe mostrar.
 *
 * Quita lo que no sea digito. Si lo tecleado o pegado empieza con el codigo
 * de pais ("506..."), lo deja crecer hasta completar los 11 digitos y ahi le
 * quita el prefijo (misma regla de normalizarTelefonoCR) — asi pegar
 * "+50688881234" sigue funcionando. Fuera de ese caso, en cuanto hay 8
 * digitos completos ignora lo que sobre en vez de desplazar el numero: una
 * tecla de mas ya no cambia el destinatario en silencio.
 */
export function digitosLocalesCR(entrada: string): string {
  const digitos = entrada.replace(/\D/g, '');
  if (digitos.length <= 8) return digitos;
  if (digitos.startsWith('506')) {
    if (digitos.length < 11) return digitos; // codigo de pais a medio teclear
    const normalizado = normalizarTelefonoCR(digitos.slice(0, 11));
    return normalizado ? normalizado.slice(4) : digitos.slice(0, 8);
  }
  return digitos.slice(0, 8);
}
