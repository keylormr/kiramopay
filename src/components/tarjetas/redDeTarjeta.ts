// Red de pago de una tarjeta por su IIN (los primeros digitos del numero).
//
// Rangos (ISO/IEC 7812 y los publicados por cada red):
//   4                     Visa
//   51-55 y 2221-2720     Mastercard (la serie 2 se abrio en 2017)
//   34 y 37               American Express: 15 digitos, 4-6-5, CID al frente
//   todo lo demas         la tarjeta propia de KiramoPay
//
// Las tarjetas de KiramoPay empiezan en 8, que no es de ninguna red, asi que
// caen en el ultimo caso. Hoy son las unicas que existen: vincular tarjetas de
// otros bancos exige un procesador PCI con tokenizacion, y la app no captura
// el numero de una tarjeta ajena.

export type RedDeTarjeta = 'visa' | 'mastercard' | 'amex' | 'kiramopay';

/** El nombre de la red, tal cual: no se traduce. */
export const NOMBRE_DE_RED: Readonly<Record<RedDeTarjeta, string>> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  kiramopay: 'KiramoPay',
};

const GRUPOS: Readonly<Record<RedDeTarjeta, readonly number[]>> = {
  visa: [4, 4, 4, 4],
  mastercard: [4, 4, 4, 4],
  amex: [4, 6, 5],
  kiramopay: [4, 4, 4, 4],
};

/** Cuantos digitos tiene el numero en cada red. */
export const largoDelNumero = (red: RedDeTarjeta): number => GRUPOS[red].reduce((a, b) => a + b, 0);

/**
 * La red que dicen los primeros digitos. Acepta espacios y guiones. Con menos
 * digitos de los que hacen falta para decidir (un "2" o un "22" sueltos) no
 * adivina: devuelve la propia.
 */
export function redPorIin(numero: string): RedDeTarjeta {
  const d = numero.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(d)) return 'kiramopay';
  if (d.startsWith('4')) return 'visa';
  if (d.length >= 2) {
    const dos = Number(d.slice(0, 2));
    if (dos === 34 || dos === 37) return 'amex';
    if (dos >= 51 && dos <= 55) return 'mastercard';
  }
  if (d.length >= 4) {
    const cuatro = Number(d.slice(0, 4));
    if (cuatro >= 2221 && cuatro <= 2720) return 'mastercard';
  }
  return 'kiramopay';
}

/** Largos validos del numero completo en cada red. */
const LARGOS_VALIDOS: Readonly<Record<Exclude<RedDeTarjeta, 'kiramopay'>, readonly number[]>> = {
  visa: [13, 16, 19],
  mastercard: [16],
  amex: [15],
};

/** El digito verificador de Luhn, que toda tarjeta de una red cumple. */
function pasaLuhn(digitos: string): boolean {
  let suma = 0;
  let duplicar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48;
    if (duplicar) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    duplicar = !duplicar;
  }
  return suma % 10 === 0;
}

/**
 * La red de una tarjeta de la lista. Solo cuenta un numero completo: la lista
 * trae el enmascarado ("•••• •••• •••• 4242") y leer el IIN de esos digitos
 * seria leer los ultimos cuatro como si fueran los primeros.
 *
 * Para nombrar una red el numero tiene que poder ser de ella: el largo de la
 * red y el digito de Luhn. El numero de KiramoPay falla Luhn a proposito
 * (backend/internal/cards, numeroDecorativo), asi que nunca toma la cara de una
 * red aunque algun dia cambie su prefijo.
 *
 * El campo `brand` del servidor NO decide la cara: las filas viejas con
 * "visa" eran tarjetas de KiramoPay rotuladas como VISA (migracion 063), y una
 * vencida todavia sale en la lista. Pintarla de Visa repetiria ese error.
 */
export function redDeLaTarjeta(tarjeta: { cardNumber?: string | null }): RedDeTarjeta {
  const numero = (tarjeta.cardNumber ?? '').replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(numero) || !pasaLuhn(numero)) return 'kiramopay';
  const red = redPorIin(numero);
  if (red === 'kiramopay' || !LARGOS_VALIDOS[red].includes(numero.length)) return 'kiramopay';
  return red;
}

/** Agrupa los digitos como los imprime la red (4-4-4-4, o 4-6-5 en Amex). */
export function agruparNumero(numero: string, red: RedDeTarjeta = redPorIin(numero)): string {
  const d = numero.replace(/[\s-]/g, '');
  const partes: string[] = [];
  let i = 0;
  for (const g of GRUPOS[red]) {
    if (i >= d.length) break;
    partes.push(d.slice(i, i + g));
    i += g;
  }
  // Lo que sobre (un numero mas largo que el de su red) no se pierde.
  if (i < d.length) partes.push(d.slice(i));
  return partes.join(' ');
}

/** El numero oculto con los ultimos cuatro a la vista, agrupado segun la red. */
export function numeroOculto(ultimos4: string, red: RedDeTarjeta): string {
  const largo = largoDelNumero(red);
  const visibles = ultimos4.slice(-4);
  return agruparNumero('•'.repeat(largo - visibles.length) + visibles, red);
}
