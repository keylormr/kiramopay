import { nombreComparable } from '@/utils/contactoEscaneado';

/**
 * El nombre del QR contra el nombre REGISTRADO a ese telefono.
 *
 * El servidor devuelve el registrado recortado: nombre(s) completos e inicial de
 * cada apellido ("Keilor M. R."). El del QR lo escribio quien lo creo y nadie lo
 * comprueba. Coinciden si el QR dice a la misma persona de otra forma —con o sin
 * tildes, con un solo apellido, con uno solo de los dos nombres de pila—; no si
 * dice otra cosa: un QR "de Mama" con el numero de un desconocido.
 *
 * Reglas: el primer nombre de pila tiene que ser el mismo y primero; lo demas
 * son otros nombres de pila registrados o apellidos cuya inicial va en el orden
 * del registro. El QR puede dejar apellidos sin decir (y saltarse iniciales: un
 * apellido compuesto "de la Cruz" llega como "D. L. C." y el QR dice "Cruz"),
 * no inventar uno. Es una comparacion de letras iniciales: reconoce a la misma
 * persona dicha de otra forma, no prueba quien es (el nombre del perfil lo
 * escribe cada persona).
 */
export function coincideConElRegistrado(nombreDelQr: string, registrado: string): boolean {
  // El punto solo marca las iniciales de apellido del registro; en el QR un
  // "Ma." abreviado se lee como "Ma".
  const palabras = (nombre: string) =>
    nombreComparable(nombre).split(' ').map((p) => p.replace(/\.+$/, '')).filter(Boolean);
  const reg = nombreComparable(registrado).split(' ').filter(Boolean);
  const qr = palabras(nombreDelQr);
  if (reg.length === 0 || qr.length === 0) return false;

  const dados: string[] = [];
  const iniciales: string[] = [];
  for (const parte of reg) {
    if (parte.endsWith('.')) iniciales.push(parte[0]);
    else dados.push(parte);
  }
  if (dados.length === 0 || qr[0] !== dados[0]) return false;

  let siguienteDado = 1;
  let siguienteInicial = 0;
  for (const palabra of qr.slice(1)) {
    if (siguienteDado < dados.length && palabra === dados[siguienteDado]) {
      siguienteDado++;
      continue;
    }
    // La inicial de esta palabra, en el registro, a partir de la ultima usada.
    const i = iniciales.indexOf(palabra[0], siguienteInicial);
    if (i === -1) return false;
    siguienteInicial = i + 1;
  }
  return true;
}
