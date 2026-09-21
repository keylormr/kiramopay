import { mapSummary } from '../adapters/http/transaction.http';

describe('mapSummary — el resumen del servidor en el idioma de la app', () => {
  // El servidor entrega el TIPO y no decide que es ingreso o gasto: lo decide
  // la misma clasificacion que usa la lista de movimientos.
  it('clasifica cada grupo con la regla de la lista y conserva los centimos', () => {
    const r = mapSummary({
      from: '2026-08-01',
      to: '2026-09-01',
      first_date: '2025-11-03',
      groups: [
        { date: '2026-08-01', type: 'sinpe_receive', currency: 'CRC', count: 2, amount: 1_250_050 },
        { date: '2026-08-01', type: 'qr_payment', currency: 'CRC', count: 1, amount: 99_900 },
        { date: '2026-08-02', type: 'savings_deposit', currency: 'USD', count: 1, amount: 1_549 },
      ],
      top: [
        {
          id: 't1',
          type: 'qr_payment',
          amount: 99_900,
          currency: 'CRC',
          fee: 0,
          counterparty_name: 'Automercado',
          counterparty_phone: '',
          status: 'completed',
          created_at: '2026-08-01T18:00:00Z',
          metadata: '{}',
        },
      ],
    });

    expect(r.groups).toEqual([
      { date: '2026-08-01', ccy: 'CRC', category: 'transfers', direction: 'in', count: 2, amountMinor: 1_250_050 },
      { date: '2026-08-01', ccy: 'CRC', category: 'shopping', direction: 'out', count: 1, amountMinor: 99_900 },
      { date: '2026-08-02', ccy: 'USD', category: 'savings', direction: 'out', count: 1, amountMinor: 1_549 },
    ]);
    expect(r.top[0]).toMatchObject({ id: 't1', amount: -999, ccy: 'CRC', title: 'Automercado', kind: 'qr_payment' });
    expect(r.firstDate).toBe('2025-11-03');
  });

  // Dividir cuenta mueve dinero de una persona a otra con p2p_send/p2p_receive:
  // caian en "Otros" en el grafico de categorias y en la lista.
  it('los pagos de dividir cuenta son transferencias', () => {
    const r = mapSummary({
      from: '2026-09-01',
      to: '2026-10-01',
      groups: [
        { date: '2026-09-03', type: 'p2p_send', currency: 'CRC', count: 1, amount: 350_000 },
        { date: '2026-09-03', type: 'p2p_receive', currency: 'CRC', count: 2, amount: 700_000 },
      ],
      top: [
        {
          id: 't2',
          type: 'p2p_send',
          amount: 350_000,
          currency: 'CRC',
          fee: 0,
          counterparty_name: 'Victor',
          counterparty_phone: '',
          status: 'completed',
          created_at: '2026-09-03T18:00:00Z',
          metadata: '{}',
        },
      ],
    });

    expect(r.groups.map((g) => [g.category, g.direction])).toEqual([
      ['transfers', 'out'],
      ['transfers', 'in'],
    ]);
    expect(r.top[0]).toMatchObject({ id: 't2', category: 'transfers', amount: -3500 });
  });

  it('tolera listas nulas del servidor', () => {
    expect(mapSummary({ from: 'a', to: 'b', groups: null, top: null, first_date: null })).toEqual({
      from: 'a',
      to: 'b',
      groups: [],
      top: [],
      firstDate: null,
    });
  });
});
