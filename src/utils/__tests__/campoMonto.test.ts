import { describe, it, expect } from 'vitest';
import {
  groupThousands,
  sanitizeAmountInput,
  formatAmountDisplay,
  mapCursorToDisplay,
} from '../campoMonto';

describe('groupThousands', () => {
  it('no toca numeros de tres digitos o menos', () => {
    expect(groupThousands('')).toBe('');
    expect(groupThousands('7')).toBe('7');
    expect(groupThousands('700')).toBe('700');
  });

  it('agrupa de a tres desde la derecha', () => {
    expect(groupThousands('1234')).toBe('1,234');
    expect(groupThousands('1234567')).toBe('1,234,567');
    expect(groupThousands('252200')).toBe('252,200');
  });
});

describe('sanitizeAmountInput', () => {
  it('deja pasar digitos simples', () => {
    expect(sanitizeAmountInput('5', 1, 2)).toEqual({ clean: '5', cursor: 1 });
  });

  it('descarta letras y simbolos de moneda pegados', () => {
    expect(sanitizeAmountInput('₡252,200.50', 11, 2)).toEqual({ clean: '252200.50', cursor: 9 });
  });

  it('permite un unico punto decimal e ignora los siguientes', () => {
    expect(sanitizeAmountInput('1.2.3', 5, 2)).toEqual({ clean: '1.23', cursor: 4 });
  });

  it('recorta los decimales sobrantes segun el maximo', () => {
    expect(sanitizeAmountInput('10.999', 6, 2)).toEqual({ clean: '10.99', cursor: 5 });
  });

  it('con decimals=0 no deja escribir el punto', () => {
    // El punto se descarta y TAMBIEN los digitos que le siguen (son
    // decimales, no mas digitos enteros): '12.5' trunca a '12', no se
    // convierte en '125' (10x el valor).
    expect(sanitizeAmountInput('12.5', 4, 0)).toEqual({ clean: '12', cursor: 2 });
  });

  it('con decimals=0 pegar un monto con decimales trunca en vez de multiplicar', () => {
    // Caso real: limite de presupuesto (BudgetView, decimals=0) pegado de un
    // tiron. Antes del fix, sanitizeAmountInput('80,000.99', 9, 0) daba
    // '8000099' (100x el valor) porque los digitos tras el punto se leian
    // como parte entera.
    expect(sanitizeAmountInput('80,000.99', 9, 0)).toEqual({ clean: '80000', cursor: 5 });
  });

  it('nunca deja signos negativos', () => {
    expect(sanitizeAmountInput('-500', 4, 2)).toEqual({ clean: '500', cursor: 3 });
  });

  it('quita ceros a la izquierda pero respeta "0.5"', () => {
    expect(sanitizeAmountInput('007', 3, 2)).toEqual({ clean: '7', cursor: 1 });
    expect(sanitizeAmountInput('00', 2, 2)).toEqual({ clean: '0', cursor: 1 });
    expect(sanitizeAmountInput('0.5', 3, 2)).toEqual({ clean: '0.5', cursor: 3 });
  });

  it('vacio se queda vacio', () => {
    expect(sanitizeAmountInput('', 0, 2)).toEqual({ clean: '', cursor: 0 });
  });

  it('recalcula el cursor cuando se borra un caracter en medio', () => {
    // "252,200" con el cursor tras borrar la coma en la posicion 3 -> "25200"
    // con el cursor donde quedo el corte.
    expect(sanitizeAmountInput('25200', 2, 2)).toEqual({ clean: '25200', cursor: 2 });
  });
});

describe('formatAmountDisplay', () => {
  it('agrupa miles cuando thousands=true', () => {
    expect(formatAmountDisplay('252200', true)).toBe('252,200');
    expect(formatAmountDisplay('252200.5', true)).toBe('252,200.5');
  });

  it('conserva el punto final mientras se sigue escribiendo el decimal', () => {
    expect(formatAmountDisplay('252200.', true)).toBe('252,200.');
  });

  it('no agrupa cuando thousands=false (cantidades cripto)', () => {
    expect(formatAmountDisplay('1234.12345678', false)).toBe('1234.12345678');
  });

  it('vacio se muestra vacio', () => {
    expect(formatAmountDisplay('', true)).toBe('');
  });
});

describe('mapCursorToDisplay', () => {
  it('identidad cuando no hay agrupacion', () => {
    expect(mapCursorToDisplay('1234.5', 3, false)).toBe(3);
  });

  it('corre el cursor para saltar las comas insertadas antes de el', () => {
    // "252200" -> "252,200"; cursor tras el ultimo digito (6) debe quedar
    // tras el ultimo digito del formateado (7, porque hay una coma antes).
    expect(mapCursorToDisplay('252200', 6, true)).toBe(7);
  });

  it('cursor al principio se queda al principio', () => {
    expect(mapCursorToDisplay('252200', 0, true)).toBe(0);
  });

  it('cursor en la parte decimal no se ve afectado por las comas del entero', () => {
    // "252200.5" -> "252,200.5"; cursor justo tras el "5" decimal (posicion 8)
    // debe quedar al final del formateado (9).
    expect(mapCursorToDisplay('252200.5', 8, true)).toBe(9);
  });

  it('no corre el cursor si la coma cae despues de el', () => {
    // "123456" -> "123,456"; cursor tras el 3er digito cae justo antes de la
    // coma insertada, asi que la posicion no cambia.
    expect(mapCursorToDisplay('123456', 3, true)).toBe(3);
  });

  it('cuenta digitos, no caracteres, cuando la coma cae antes del cursor', () => {
    // "1234567" -> "1,234,567"; el grupo inicial tiene un solo digito, asi
    // que la coma ya aparecio antes del cursor que cuenta 3 o 4 digitos.
    expect(mapCursorToDisplay('1234567', 3, true)).toBe(4);
    expect(mapCursorToDisplay('1234567', 4, true)).toBe(5);
  });
});
