import { HttpCryptoRepository } from '../crypto.http';
import type { HttpClient } from '../client';

// The backend serializes decimal.Decimal money/amount fields as quoted JSON
// strings ("1.5"). The adapter must coerce them to numbers, or the UI crashes
// with "x.toFixed is not a function".
function clientRejecting(error: Record<string, unknown>): HttpClient {
  return {
    get: async () => ({ success: false, error }),
    post: async () => ({ success: false, error }),
    del: async () => ({ success: false, error }),
  } as unknown as HttpClient;
}

function clientReturning(data: unknown): HttpClient {
  return {
    get: async () => ({ success: true, data }),
    post: async () => ({ success: true, data }),
    del: async () => ({ success: true }),
  } as unknown as HttpClient;
}

describe('HttpCryptoRepository decimal-string coercion', () => {
  it('getAssets coerces string balance/avg_cost to numbers', async () => {
    const repo = new HttpCryptoRepository(
      clientReturning([{ id: '1', symbol: 'BTC', name: 'Bitcoin', balance: '1.5', avg_cost: '42000.50' }]),
    );
    const res = await repo.getAssets();
    const a = res.data![0];
    expect(typeof a.balance).toBe('number');
    expect(a.balance).toBeCloseTo(1.5, 6);
    expect(typeof a.avgBuyPrice).toBe('number');
    expect(a.avgBuyPrice).toBeCloseTo(42000.5, 2);
    // The original crash: value.toFixed() on a string. Now it must be a number.
    expect(() => a.balance.toFixed(6)).not.toThrow();
  });

  it('getTransactions coerces string amount/price/fee to numbers', async () => {
    const repo = new HttpCryptoRepository(
      clientReturning([
        {
          id: 't1', type: 'buy', asset: 'BTC', amount: '0.01', price: '42000',
          total: '420', currency: 'USD', fee: '0.5', status: 'completed',
          created_at: '2026-01-01T00:00:00Z',
        },
      ]),
    );
    const t = (await repo.getTransactions()).data![0];
    expect(typeof t.fromAmount).toBe('number');
    expect(t.fromAmount).toBeCloseTo(0.01, 6);
    expect(typeof t.price).toBe('number');
    expect(typeof t.fee).toBe('number');
  });

  it('getStakingPositions coerces string amount/earned to numbers', async () => {
    const repo = new HttpCryptoRepository(
      clientReturning([
        {
          id: 's1', asset: 'ETH', amount: '0.5', apy: 4.5, start_date: '2026-01-01',
          locked: false, lock_days: 0, earned: '0.012', status: 'active',
        },
      ]),
    );
    const p = (await repo.getStakingPositions()).data![0];
    expect(typeof p.amount).toBe('number');
    expect(p.amount).toBeCloseTo(0.5, 6);
    expect(typeof p.earned).toBe('number');
    expect(p.earned).toBeCloseTo(0.012, 6);
  });
});

describe('HttpCryptoRepository — alertas de precio', () => {
  const activa = {
    id: 'a1', user_id: 'u1', asset: 'BTC', target_price: '65000.5', direction: 'above',
    active: true, status: 'active', created_at: '2026-09-15T12:00:00Z',
  };
  const cumplida = {
    id: 'c1', user_id: 'u1', asset: 'ETH', target_price: '2800', direction: 'below',
    active: false, status: 'triggered', created_at: '2026-09-10T12:00:00Z',
    triggered_at: '2026-09-14T15:30:00Z', triggered_price: '2795.5',
  };

  it('convierte los precios decimales y conserva el estado de cada alerta', async () => {
    const repo = new HttpCryptoRepository(clientReturning([activa, cumplida]));
    const res = await repo.getPriceAlerts();
    expect(res.data).toEqual([
      {
        id: 'a1', asset: 'BTC', targetPrice: 65000.5, condition: 'above', active: true,
        status: 'active', createdAt: '2026-09-15T12:00:00Z', triggeredAt: undefined, triggeredPrice: undefined,
      },
      {
        id: 'c1', asset: 'ETH', targetPrice: 2800, condition: 'below', active: false,
        status: 'triggered', createdAt: '2026-09-10T12:00:00Z',
        triggeredAt: '2026-09-14T15:30:00Z', triggeredPrice: 2795.5,
      },
    ]);
  });

  it('data: null es una lista vacia, no un fallo', async () => {
    const res = await new HttpCryptoRepository(clientReturning(null)).getPriceAlerts();
    expect(res).toEqual({ success: true, data: [] });
  });

  it('crear devuelve la alerta que guardo el servidor', async () => {
    const res = await new HttpCryptoRepository(clientReturning(activa)).addPriceAlert({
      asset: 'btc', targetPrice: 65000.5, condition: 'above',
    });
    expect(res.data).toMatchObject({ id: 'a1', asset: 'BTC', targetPrice: 65000.5, status: 'active' });
  });

  it('crear no pisa el codigo ni los detalles del rechazo', async () => {
    const res = await new HttpCryptoRepository(
      clientRejecting({ code: 'ALERT_LIMIT_REACHED', message: 'limit', details: { limite: 20, actuales: 20, plan: 'free' } }),
    ).addPriceAlert({ asset: 'BTC', targetPrice: 1, condition: 'above' });
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'ALERT_LIMIT_REACHED', details: { limite: 20 } });
  });

  it('leer y quitar tambien conservan el codigo del rechazo', async () => {
    const repo = new HttpCryptoRepository(clientRejecting({ code: 'RATE_LIMITED', message: 'Espera un momento' }));
    expect((await repo.getPriceAlerts()).error).toMatchObject({ code: 'RATE_LIMITED', message: 'Espera un momento' });
    expect((await repo.removePriceAlert('a1')).error).toMatchObject({ code: 'RATE_LIMITED' });
  });
});
