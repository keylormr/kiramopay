import {
  CLAVES_DEL_RECHAZO_DE_MEDIOS,
  CLAVES_DEL_RECHAZO_LIGHTNING,
  RECHAZOS_DEL_COBRO,
  normalizarSinpeMovil,
  pareceDireccionLightning,
  relojDeCuentaRegresiva,
  segundosRestantes,
  sinpeMovilLegible,
  textoDelQrLightning,
} from '../lightning';
import es from '@/i18n/languages/es';

const FACTURA = 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu';

describe('textoDelQrLightning', () => {
  it('lleva el esquema y la factura en mayusculas (modo alfanumerico del QR)', () => {
    expect(textoDelQrLightning(FACTURA)).toBe(`LIGHTNING:${FACTURA.toUpperCase()}`);
  });

  it('no duplica el esquema ni deja espacios', () => {
    expect(textoDelQrLightning(`  lightning:${FACTURA} `)).toBe(`LIGHTNING:${FACTURA.toUpperCase()}`);
    expect(textoDelQrLightning(`LIGHTNING:${FACTURA.toUpperCase()}`)).toBe(`LIGHTNING:${FACTURA.toUpperCase()}`);
  });
});

describe('segundosRestantes y relojDeCuentaRegresiva', () => {
  const ahora = Date.parse('2026-11-18T15:00:00Z');

  it('cuenta los segundos enteros que faltan', () => {
    expect(segundosRestantes('2026-11-18T15:09:42Z', ahora)).toBe(582);
    expect(segundosRestantes('2026-11-18T15:00:00.999Z', ahora)).toBe(0);
    expect(segundosRestantes('2026-11-18T15:00:01Z', ahora)).toBe(1);
  });

  it('un plazo cumplido, vacio o que no es fecha es cero, nunca negativo ni NaN', () => {
    expect(segundosRestantes('2026-11-18T14:59:00Z', ahora)).toBe(0);
    expect(segundosRestantes(undefined, ahora)).toBe(0);
    expect(segundosRestantes('mañana', ahora)).toBe(0);
  });

  it('escribe minutos y segundos con dos cifras', () => {
    expect(relojDeCuentaRegresiva(582)).toBe('9:42');
    expect(relojDeCuentaRegresiva(600)).toBe('10:00');
    expect(relojDeCuentaRegresiva(65)).toBe('1:05');
    expect(relojDeCuentaRegresiva(0)).toBe('0:00');
    expect(relojDeCuentaRegresiva(-3)).toBe('0:00');
    expect(relojDeCuentaRegresiva(Number.NaN)).toBe('0:00');
  });
});

describe('SINPE Movil', () => {
  // Los mismos casos que TestNormalizarSinpeMovil del servidor.
  it('acepta como lo escribe la gente y deja 8 digitos', () => {
    const buenos: Record<string, string> = {
      '88887777': '88887777',
      '8888-7777': '88887777',
      '+506 6000 1234': '60001234',
      '506-7000-1234': '70001234',
      ' 5000 1234 ': '50001234',
    };
    for (const [entrada, quiero] of Object.entries(buenos)) expect(normalizarSinpeMovil(entrada)).toBe(quiero);
  });

  it('rechaza fijos, cortos, largos y otro pais', () => {
    for (const malo of ['', '2222-2222', '4000-1234', '8888777', '888877776', '+1 305 555 1234', '9888-7777']) {
      expect(normalizarSinpeMovil(malo)).toBeNull();
    }
  });

  it('muestra el numero con guion y deja tal cual lo que no son 8 digitos', () => {
    expect(sinpeMovilLegible('88887777')).toBe('8888-7777');
    expect(sinpeMovilLegible('123')).toBe('123');
  });
});

describe('pareceDireccionLightning', () => {
  it('nombre@dominio, sin espacios dentro', () => {
    expect(pareceDireccionLightning('soda@breez.tips')).toBe(true);
    expect(pareceDireccionLightning(' Soda.Tica@pay.kiramopay.com ')).toBe(true);
    expect(pareceDireccionLightning('soda')).toBe(false);
    expect(pareceDireccionLightning('soda@breez')).toBe(false);
    expect(pareceDireccionLightning('@breez.tips')).toBe(false);
    expect(pareceDireccionLightning('so da@breez.tips')).toBe(false);
  });
});

describe('textos de los rechazos', () => {
  it('cada clave existe en el diccionario', () => {
    for (const clave of [...Object.values(CLAVES_DEL_RECHAZO_LIGHTNING), ...Object.values(CLAVES_DEL_RECHAZO_DE_MEDIOS)]) {
      expect(es[clave as keyof typeof es], clave).toBeTruthy();
    }
  });

  it('los rechazos del cobro son los cuatro estados que no son pendiente', () => {
    expect([...RECHAZOS_DEL_COBRO].sort()).toEqual(['COBRO_CANCELADO', 'COBRO_REEMPLAZADO', 'COBRO_VENCIDO', 'COBRO_YA_PAGADO']);
  });
});
