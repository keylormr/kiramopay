import { mensajeDeErrorCripto, posicionYaNoEsta } from '../erroresCripto';
import { leerMovimiento, fechaLegible } from '../movimientoCripto';
import { defaultTranslations } from '@/i18n/translations';
import en from '@/i18n/languages/en';
import type { CryptoTransaction } from '@/types';

const es = defaultTranslations as unknown as Record<string, string>;
const t = (clave: string) => es[clave] ?? clave;

describe('mensajeDeErrorCripto', () => {
  // Todo codigo que el servidor de cripto puede mandar tiene su texto, y
  // ninguno es la clave cruda (seria una clave que falta en el diccionario).
  it.each([
    'PRICE_STALE', 'PRICE_UNAVAILABLE', 'PRICE_MOVED', 'UNSUPPORTED_CURRENCY',
    'CRYPTO_INSUFFICIENT_BALANCE', 'CRYPTO_INVALID_AMOUNT', 'INSUFFICIENT_BALANCE',
    'DAILY_LIMIT_EXCEEDED', 'MONTHLY_LIMIT_EXCEEDED', 'LLAVE_REUTILIZADA',
    'STAKING_NOT_AVAILABLE', 'STAKING_POSITION_NOT_FOUND', 'STAKING_POSITION_INACTIVE',
    'STAKING_POSITION_LOCKED', 'CLAIM_NOT_AVAILABLE', 'NETWORK_ERROR', 'RATE_LIMITED', 'SESSION_EXPIRED',
  ])('%s tiene texto propio', (code) => {
    const texto = mensajeDeErrorCripto({ code }, t);
    expect(texto).not.toMatch(/^(crypto|err)_/);
    expect(texto).not.toBe(t('crypto_err_generic'));
  });

  it('un codigo desconocido, o ninguno, cae al generico y nunca al texto del servidor', () => {
    for (const err of [{ code: 'SELL_FAILED' }, { code: 'ALGO_NUEVO' }, {}, undefined]) {
      expect(mensajeDeErrorCripto(err, t)).toBe('No pudimos completar la operación. Intenta de nuevo en un momento.');
    }
  });

  it('las claves nuevas existen en ingles tambien', () => {
    const ingles = en as unknown as Record<string, string>;
    const conIngles = (clave: string) => ingles[clave] ?? `FALTA:${clave}`;
    expect(mensajeDeErrorCripto({ code: 'LLAVE_REUTILIZADA' }, conIngles)).not.toMatch(/^FALTA/);
    expect(mensajeDeErrorCripto({ code: 'STAKING_NOT_AVAILABLE' }, conIngles)).not.toMatch(/^FALTA/);
  });

  it('posicionYaNoEsta reconoce los dos rechazos que invitan a recargar la lista', () => {
    expect(posicionYaNoEsta('STAKING_POSITION_NOT_FOUND')).toBe(true);
    expect(posicionYaNoEsta('STAKING_POSITION_INACTIVE')).toBe(true);
    expect(posicionYaNoEsta('STAKING_POSITION_LOCKED')).toBe(false);
    expect(posicionYaNoEsta(undefined)).toBe(false);
  });
});

const mov = (extra: Partial<CryptoTransaction>): CryptoTransaction => ({
  id: 'x', type: 'buy', fromAsset: 'USD', fromAmount: 1, price: 2500, fee: 0,
  date: '2026-09-13T15:00:00Z', status: 'completed', ...extra,
});

describe('leerMovimiento', () => {
  it('compra: entra la cripto, sale el fiat', () => {
    const l = leerMovimiento(mov({ toAsset: 'ETH', toAmount: 0.0004 }));
    expect(l.principal).toEqual({ monto: 0.0004, activo: 'ETH', entra: true });
    expect(l.contraparte).toEqual({ monto: 1, activo: 'USD', entra: false });
  });

  it('una compra vieja sin cantidad recibida la deduce del precio', () => {
    const l = leerMovimiento(mov({ toAsset: 'ETH', toAmount: undefined }));
    expect(l.principal.monto).toBeCloseTo(0.0004, 10);
    expect(l.principal.activo).toBe('ETH');
  });

  it('venta: sale la cripto, entra el fiat', () => {
    const l = leerMovimiento(mov({ type: 'sell', fromAsset: 'BTC', fromAmount: 0.001, toAsset: 'CRC', toAmount: 20400 }));
    expect(l.principal).toEqual({ monto: 0.001, activo: 'BTC', entra: false });
    expect(l.contraparte).toEqual({ monto: 20400, activo: 'CRC', entra: true });
  });

  it('conversion: entra el destino, sale el origen', () => {
    const l = leerMovimiento(mov({ type: 'convert', fromAsset: 'BTC', fromAmount: 0.01, toAsset: 'ETH', toAmount: 0.3 }));
    expect(l.principal).toEqual({ monto: 0.3, activo: 'ETH', entra: true });
    expect(l.contraparte).toEqual({ monto: 0.01, activo: 'BTC', entra: false });
  });

  it.each([
    ['stake', false], ['send', false], ['unstake', true], ['receive', true], ['yield', true],
  ] as const)('%s sin contraparte, entra=%s', (type, entra) => {
    const l = leerMovimiento(mov({ type, fromAsset: 'ETH', fromAmount: 0.5 }));
    expect(l.principal).toEqual({ monto: 0.5, activo: 'ETH', entra });
    expect(l.contraparte).toBeNull();
    expect(l.entrega).toBeNull();
  });
});

describe('fechaLegible', () => {
  const ahora = Date.parse('2026-09-13T15:00:30Z');

  it('lo de hace menos de un minuto es "ahora"', () => {
    expect(fechaLegible('2026-09-13T15:00:00Z', 'es', 'Ahora', ahora)).toBe('Ahora');
  });

  it('una fecha de maquina se formatea, sin la T ni la zona', () => {
    const texto = fechaLegible('2026-09-10T15:00:00Z', 'es', 'Ahora', ahora);
    expect(texto).not.toContain('T15');
    expect(texto).toMatch(/2026/);
  });

  it('sin texto de "ahora" siempre da la fecha', () => {
    expect(fechaLegible('2026-09-13T15:00:00Z', 'en', '', ahora)).toMatch(/2026/);
  });

  it('una fecha ya escrita para leer, o invalida, se deja tal cual', () => {
    expect(fechaLegible('25 Dic, 2024', 'es', 'Ahora', ahora)).toBe('25 Dic, 2024');
    expect(fechaLegible('2026-99-99', 'es', 'Ahora', ahora)).toBe('2026-99-99');
  });
});
