import es from '@/i18n/languages/es';
import {
  TARIFAS_POR_DEFECTO,
  diaCorto,
  mensajeDeTope,
  normalizarPlan,
  normalizarPlanComercio,
  porcentajeDeBps,
  rellenar,
  siguientePlan,
  topeDelError,
} from '../planes';

const t = (clave: string) => (es as unknown as Record<string, string>)[clave] ?? clave;

describe('planes: ayudantes', () => {
  it('pasa puntos basicos a porcentaje con punto decimal', () => {
    expect(porcentajeDeBps(50)).toBe('0.5%');
    expect(porcentajeDeBps(25)).toBe('0.25%');
    expect(porcentajeDeBps(100)).toBe('1%');
    expect(porcentajeDeBps(0)).toBe('0%');
  });

  it('lee un plan desconocido o ausente como free, sensible a mayusculas como el servidor', () => {
    expect(normalizarPlan('plus')).toBe('plus');
    expect(normalizarPlan('PLUS')).toBe('free');
    expect(normalizarPlan(undefined)).toBe('free');
    expect(normalizarPlanComercio('analitica')).toBe('analitica');
    expect(normalizarPlanComercio('cima')).toBe('base');
  });

  it('la escalera de planes termina en Pro', () => {
    expect(siguientePlan('free')).toBe('plus');
    expect(siguientePlan('plus')).toBe('pro');
    expect(siguientePlan('pro')).toBeNull();
  });

  it('rellena todas las apariciones de una clave', () => {
    expect(rellenar('{a} y {a} con {b}', { a: 'x', b: 2 })).toBe('x y x con 2');
  });

  it('un dia YYYY-MM-DD se lee como fecha local, no como medianoche UTC', () => {
    expect(diaCorto('2026-08-14', 'es')).toMatch(/^14/);
    expect(diaCorto('no-es-fecha', 'es')).toBe('');
  });
});

describe('planes: el tope que responde el servidor', () => {
  it('lee plan, limite y actuales del detalle', () => {
    const tope = topeDelError(
      { code: 'SAVINGS_GOAL_LIMIT', message: 'x', details: { plan: 'plus', limite: 10, actuales: 12 } },
      'SAVINGS_GOAL_LIMIT',
    );
    expect(tope).toEqual({ plan: 'plus', limite: 10, actuales: 12 });
  });

  it('otro codigo no es un tope', () => {
    expect(topeDelError({ code: 'CREATE_FAILED', message: 'x' }, 'SAVINGS_GOAL_LIMIT')).toBeNull();
    expect(topeDelError({ code: 'CARD_LIMIT', message: 'x' }, 'SAVINGS_GOAL_LIMIT')).toBeNull();
  });

  it('sin detalle se sabe que es el tope, no cuanto vale', () => {
    expect(topeDelError({ code: 'CARD_LIMIT', message: 'x' }, 'CARD_LIMIT')).toEqual({ plan: 'free', limite: 0, actuales: 0 });
  });
});

describe('planes: el mensaje del tope', () => {
  const tarifas = TARIFAS_POR_DEFECTO;

  it('Gratis en metas anuncia Plus con su tope', () => {
    expect(mensajeDeTope(t, 'goals', 'free', 3, tarifas)).toBe(
      'Tu plan Gratis permite 3 metas activas. Plus permitirá hasta 10, muy pronto.',
    );
  });

  it('Plus en metas anuncia que Pro no tendra tope', () => {
    expect(mensajeDeTope(t, 'goals', 'plus', 10, tarifas)).toBe(
      'Tu plan Plus permite 10 metas activas. Pro no tendrá tope, muy pronto.',
    );
  });

  it('Gratis en tarjetas habla en singular', () => {
    expect(mensajeDeTope(t, 'cards', 'free', 1, tarifas)).toBe(
      'Tu plan Gratis permite 1 tarjeta activa. Plus permitirá hasta 3, muy pronto.',
    );
  });

  it('Pro en tarjetas dice que es el tope mas alto', () => {
    expect(mensajeDeTope(t, 'cards', 'pro', 5, tarifas)).toBe(
      'Tu plan Pro permite 5 tarjetas activas. Es el tope más alto que hay.',
    );
  });

  it('no anuncia como mejora un plan siguiente con el mismo tope', () => {
    const iguales = JSON.parse(JSON.stringify(tarifas));
    iguales.planes.plus.topes.tarjetas = 1;
    expect(mensajeDeTope(t, 'cards', 'free', 1, iguales)).toBe('Tu plan Gratis permite 1 tarjeta activa.');
  });

  it('sin el limite cae al mensaje general', () => {
    expect(mensajeDeTope(t, 'cards', 'free', 0, tarifas)).toBe('Llegaste al tope de tu plan.');
  });
});
