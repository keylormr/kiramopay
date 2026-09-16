import { analizar, elegirMoneda, monedasDe, totalesEn, variacion } from '../calculosAnalitica';
import type { SummaryGroup, TransactionSummary } from '@/api/repositories/transaction.repository';

// Montos en colones para leer las pruebas; el grupo los lleva en centimos.
const g = (date: string, direction: 'in' | 'out', amount: number, extra: Partial<SummaryGroup> = {}): SummaryGroup => ({
  date,
  ccy: 'CRC',
  category: 'shopping',
  direction,
  count: 1,
  amountMinor: Math.round(amount * 100),
  ...extra,
});

const resumen = (groups: SummaryGroup[]): TransactionSummary => ({ from: '', to: '', groups, top: [], firstDate: null });

describe('calculosAnalitica', () => {
  it('rotula la moneda base, o la mas usada si el periodo no tiene nada en ella', () => {
    expect(elegirMoneda([g('2026-08-01', 'out', 1, { ccy: 'USD' })], 'CRC')).toBe('USD');
    expect(elegirMoneda([g('2026-08-01', 'out', 1, { ccy: 'USD' }), g('2026-08-01', 'out', 1)], 'CRC')).toBe('CRC');
    expect(elegirMoneda([], 'USD')).toBe('USD');
  });

  // Quien tiene colones y dolares puede ver cualquiera de las dos: la elegida
  // manda si el periodo la tiene, y si no se vuelve a la regla de siempre.
  it('respeta la moneda elegida solo si el periodo la tiene', () => {
    const ambas = [g('2026-08-01', 'out', 1), g('2026-08-01', 'out', 1, { ccy: 'USD', count: 4 })];
    expect(monedasDe(ambas)).toEqual(['USD', 'CRC']);
    expect(elegirMoneda(ambas, 'CRC', 'USD')).toBe('USD');
    expect(elegirMoneda([g('2026-08-01', 'out', 1)], 'CRC', 'USD')).toBe('CRC');
  });

  // Sumar decimales binarios corre centavos: 0,10 + 0,20 da 0,30000000000000004.
  it('suma en centimos y no arrastra error de decimales', () => {
    const a = analizar(
      resumen([g('2026-08-02', 'out', 0.1), g('2026-08-03', 'out', 0.2), g('2026-08-03', 'in', 0.3)]),
      { desde: '2026-08-01', hasta: '2026-09-01' },
      '2026-09-13',
      'CRC',
    );
    expect(a.gastos).toBe(0.3);
    expect(a.neto).toBe(0);
  });

  it('nunca suma otra moneda y cuenta cuantos movimientos quedaron fuera', () => {
    const a = analizar(
      resumen([g('2026-08-02', 'in', 500), g('2026-08-03', 'out', 120), g('2026-08-03', 'out', 9, { ccy: 'USD', count: 3 })]),
      { desde: '2026-08-01', hasta: '2026-09-01' },
      '2026-09-13',
      'CRC',
    );
    expect(a.ingresos).toBe(500);
    expect(a.gastos).toBe(120);
    expect(a.neto).toBe(380);
    expect(a.otrasMonedas).toBe(3);
    expect(totalesEn(resumen([g('2026-08-03', 'out', 9, { ccy: 'USD' })]).groups, 'CRC')).toEqual({ ingresos: 0, gastos: 0 });
  });

  it('reparte en tramos, categorias y dias sin perder un colon', () => {
    const a = analizar(
      resumen([
        g('2026-01-15', 'out', 100, { category: 'services' }),
        g('2026-03-02', 'out', 300, { category: 'shopping' }),
        g('2026-03-02', 'in', 1000, { category: 'income' }),
        g('2026-03-09', 'out', 100, { category: 'inventada' }),
      ]),
      { desde: '2026-01-01', hasta: '2027-01-01' },
      '2026-09-13',
      'CRC',
    );
    expect(a.granularidad).toBe('mes');
    expect(a.tramos).toHaveLength(12);
    expect(a.tramos[0].gastos).toBe(100);
    expect(a.tramos[2]).toMatchObject({ ingresos: 1000, gastos: 400 });
    expect(a.tramos.reduce((s, t) => s + t.gastos, 0)).toBe(a.gastos);
    // Una categoria que la app no conoce cae en "otros", no en un color gris sin nombre.
    expect(a.categorias.map((c) => c.categoria)).toEqual(['shopping', 'services', 'other']);
    expect(a.categorias.reduce((s, c) => s + c.porcentaje, 0)).toBeCloseTo(100);
    // Lunes 2 y lunes 9 de marzo: 400 de gasto el lunes.
    expect(a.diaPico).toEqual({ dia: 1, monto: 400 });
    // 500 de gasto entre los 256 dias transcurridos al 13 de septiembre.
    expect(a.promedioDiario).toBeCloseTo(500 / 256);
  });

  it('una variacion sin base no es un porcentaje', () => {
    expect(variacion(100, 0)).toBeNull();
    expect(variacion(80, 100)).toBeCloseTo(-20);
  });
});
