import { describe, it, expect } from 'vitest';
import { normalizarTelefonoCR, formatearTelefonoCR, mismoTelefonoCR, digitosLocalesCR } from '../telefono';

describe('normalizarTelefonoCR', () => {
  it('antepone +506 a los 8 digitos de la entrada manual', () => {
    expect(normalizarTelefonoCR('60000001')).toBe('+50660000001');
  });

  it('tolera guiones y espacios', () => {
    expect(normalizarTelefonoCR('6000-0001')).toBe('+50660000001');
    expect(normalizarTelefonoCR('8888 0001')).toBe('+50688880001');
  });

  it('deja pasar la forma de contacto sin duplicar el prefijo', () => {
    expect(normalizarTelefonoCR('+50688880001')).toBe('+50688880001');
    expect(normalizarTelefonoCR('50688880001')).toBe('+50688880001');
  });

  it('rechaza lo que no alcanza para un numero', () => {
    expect(normalizarTelefonoCR('')).toBeNull();
    expect(normalizarTelefonoCR('8888')).toBeNull();
    expect(normalizarTelefonoCR('123456789')).toBeNull();
  });
});

describe('formatearTelefonoCR', () => {
  it('muestra +506 y el guion local', () => {
    expect(formatearTelefonoCR('+50688880001')).toBe('+506 8888-0001');
    expect(formatearTelefonoCR('60000001')).toBe('+506 6000-0001');
  });

  it('devuelve la entrada intacta cuando no la puede interpretar', () => {
    expect(formatearTelefonoCR('abc')).toBe('abc');
  });
});

describe('mismoTelefonoCR', () => {
  it('reconoce el mismo numero en formas distintas', () => {
    expect(mismoTelefonoCR('8888-0001', '+506 8888-0001')).toBe(true);
    expect(mismoTelefonoCR('88880001', '+50688880001')).toBe(true);
    expect(mismoTelefonoCR('88880001', '50688880001')).toBe(true);
  });

  it('distingue numeros distintos', () => {
    expect(mismoTelefonoCR('8888-0001', '8888-0002')).toBe(false);
  });

  it('nunca da igual cuando alguna entrada no normaliza', () => {
    expect(mismoTelefonoCR('8888', '8888-0001')).toBe(false);
    expect(mismoTelefonoCR('', '')).toBe(false);
  });
});

describe('digitosLocalesCR', () => {
  it('deja pasar los digitos mientras no completan los 8', () => {
    expect(digitosLocalesCR('8888')).toBe('8888');
    expect(digitosLocalesCR('')).toBe('');
  });

  // Bug real: con .replace(/\D/g,'').slice(-8) en cada tecla, una vez el
  // numero ya tenia sus 8 digitos correctos, una tecla de mas hacia caer el
  // PRIMER digito y desplazaba el numero a otro de 8 digitos con la misma
  // pinta de valido, sin avisar nada.
  it('con 8 digitos completos ignora la tecla de mas en vez de desplazar el numero', () => {
    expect(digitosLocalesCR('600000012')).toBe('60000001');
    expect(digitosLocalesCR('6000000199')).toBe('60000001');
  });

  it('pegar el numero completo con el codigo de pais lo reduce a los 8 digitos locales', () => {
    expect(digitosLocalesCR('+50688881234')).toBe('88881234');
    expect(digitosLocalesCR('50688881234')).toBe('88881234');
    expect(digitosLocalesCR('+506 8888-1234')).toBe('88881234');
  });

  it('deja crecer el codigo de pais mientras se teclea a mano, sin cortarlo antes de tiempo', () => {
    // A medio teclear "+506" + los 8 digitos: todavia no hay que decidir nada.
    expect(digitosLocalesCR('50688')).toBe('50688');
    expect(digitosLocalesCR('5068888000')).toBe('5068888000');
  });

  it('una tecla de mas despues del codigo de pais completo tambien se ignora', () => {
    expect(digitosLocalesCR('506888812349')).toBe('88881234');
  });
});
