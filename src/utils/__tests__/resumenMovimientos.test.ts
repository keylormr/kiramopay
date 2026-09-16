import { PRINCIPALES_POR_GRUPO, resumirMovimientos } from '../resumenMovimientos';
import type { Transaction } from '@/types';

function tx(id: string, amount: number, dateISO: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    title: id,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy: 'CRC',
    date: dateISO,
    dateISO,
    status: 'completed',
    category: 'shopping',
    ...extra,
  };
}

const agosto = { desde: '2026-08-01', hasta: '2026-09-01' };

describe('resumirMovimientos — el mismo resumen que arma el servidor', () => {
  it('corta los dias en hora de Costa Rica', () => {
    const r = resumirMovimientos(
      [
        tx('julio', -100, '2026-08-01T05:59:00Z'), // 23:59 del 31 de julio en CR
        tx('agosto', -200, '2026-08-01T06:00:00Z'),
        tx('fin', -300, '2026-09-01T05:30:00Z'), // 23:30 del 31 de agosto en CR
        tx('septiembre', -400, '2026-09-01T06:00:00Z'),
      ],
      agosto,
    );
    expect(r.groups.map((g) => [g.date, g.amountMinor])).toEqual([
      ['2026-08-01', 20_000],
      ['2026-08-31', 30_000],
    ]);
    // La primera fecha es la del historial, aunque quede fuera del rango.
    expect(r.firstDate).toBe('2026-07-31');
  });

  it('suma por dia, moneda, categoria y direccion, y deja fuera lo que no se completo', () => {
    const r = resumirMovimientos(
      [
        tx('a', -100, '2026-08-10T15:00:00Z'),
        tx('b', -50, '2026-08-10T18:00:00Z'),
        tx('c', 900, '2026-08-10T18:00:00Z', { category: 'income' }),
        tx('d', -7, '2026-08-10T18:00:00Z', { ccy: 'USD' }),
        tx('pendiente', -999, '2026-08-10T18:00:00Z', { status: 'pending' }),
      ],
      agosto,
    );
    expect(r.groups).toHaveLength(3);
    expect(r.groups).toContainEqual({ date: '2026-08-10', ccy: 'CRC', category: 'shopping', direction: 'out', count: 2, amountMinor: 15_000 });
    expect(r.groups).toContainEqual({ date: '2026-08-10', ccy: 'CRC', category: 'income', direction: 'in', count: 1, amountMinor: 90_000 });
    expect(r.groups).toContainEqual({ date: '2026-08-10', ccy: 'USD', category: 'shopping', direction: 'out', count: 1, amountMinor: 700 });
    expect(r.top.map((t) => t.id)).not.toContain('pendiente');
  });

  // Por direccion: si los mas grandes fueran todos ingresos, el filtro "Gastos"
  // quedaria vacio aunque haya gastos.
  it('conserva los principales de cada direccion', () => {
    // Centimos que en binario no son exactos: 0,10 + 0,20 no da 0,30 en decimales.
    const decimales = resumirMovimientos(
      [tx('x', -0.1, '2026-08-05T15:00:00Z'), tx('y', -0.2, '2026-08-05T16:00:00Z')],
      agosto,
    );
    expect(decimales.groups[0].amountMinor).toBe(30);

    const ingresos = Array.from({ length: 10 }, (_, i) => tx(`in${i}`, 100_000 + i, '2026-08-05T15:00:00Z'));
    const r = resumirMovimientos([...ingresos, tx('gasto', -5, '2026-08-05T15:00:00Z')], agosto);
    expect(r.top.filter((t) => t.amount > 0)).toHaveLength(PRINCIPALES_POR_GRUPO);
    expect(r.top.map((t) => t.id)).toContain('gasto');
  });
});
