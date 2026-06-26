import { HttpCryptoRepository } from '../crypto.http';
import type { HttpClient } from '../client';

// The backend serializes decimal.Decimal money/amount fields as quoted JSON
// strings ("1.5"). The adapter must coerce them to numbers, or the UI crashes
// with "x.toFixed is not a function".
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
