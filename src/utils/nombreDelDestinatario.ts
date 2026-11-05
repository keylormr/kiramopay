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
 * del registro. El QR puede dejar apellidos sin decir, no inventar uno.
 */
export function coincideConElRegistrado(nombreDelQr: string, registrado: string): boolean {
  const reg = nombreComparable(registrado).split(' ').filter(Boolean);
  const qr = nombreComparable(nombreDelQr).split(' ').filter(Boolean);
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
    } else if (siguienteInicial < iniciales.length && palabra[0] === iniciales[siguienteInicial]) {
      siguienteInicial++;
    } else {
      return false;
    }
  }
  return true;
}
