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
    // En una compra lo que sale es el fiat pagado (total) y entra la cripto.
    expect(t.fromAmount).toBeCloseTo(420, 6);
    expect(t.toAmount).toBeCloseTo(0.01, 6);
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

// El servidor anota siempre `asset`/`amount` como la cripto y `total`/`currency`
// como lo que se movio del otro lado. El adaptador leia `asset` como "lo que
// sale" para todo, y en una compra eso es el fiat: la fila de una compra de
// US$1 decia "+1 USD" y "$2,505.24".
describe('HttpCryptoRepository — cada movimiento se lee segun su tipo', () => {
  const fila = (extra: Record<string, unknown>) => ({
    id: 'm1', amount: '0', price: '0', total: '0', currency: 'USD', fee: '0',
    status: 'completed', created_at: '2026-09-13T15:00:00Z', ...extra,
  });

  it('compra: sale el fiat pagado, entra la cripto, y el precio va en la moneda del pago', async () => {
    const repo = new HttpCryptoRepository(clientReturning([
      fila({ type: 'buy', asset: 'ETH', amount: '0.0003984508231994', price: '1254860', total: '500', currency: 'CRC' }),
    ]));
    const t = (await repo.getTransactions()).data![0];
    expect(t).toMatchObject({
      type: 'buy', fromAsset: 'CRC', fromAmount: 500, toAsset: 'ETH', priceCurrency: 'CRC', fee: 0,
      date: '2026-09-13T15:00:00Z',
    });
    expect(t.toAmount).toBeCloseTo(0.0003984508231994, 12);
  });

  it('venta: sale la cripto y entra el fiat', async () => {
    const repo = new HttpCryptoRepository(clientReturning([
      fila({ type: 'sell', asset: 'BTC', amount: '0.001', price: '39000000', total: '39000', currency: 'CRC' }),
    ]));
    const t = (await repo.getTransactions()).data![0];
    expect(t).toMatchObject({
      type: 'sell', fromAsset: 'BTC', fromAmount: 0.001, toAsset: 'CRC', toAmount: 39000, priceCurrency: 'CRC',
    });
  });

  it('conversion: separa origen y destino del "A→B" del servidor', async () => {
    const repo = new HttpCryptoRepository(clientReturning([
      fila({ type: 'convert', asset: 'BTC→ETH', amount: '0.01', price: '2500', total: '0.3', currency: 'ETH' }),
    ]));
    const t = (await repo.getTransactions()).data![0];
    expect(t).toMatchObject({
      type: 'convert', fromAsset: 'BTC', fromAmount: 0.01, toAsset: 'ETH', toAmount: 0.3, price: 2500, priceCurrency: 'USD',
    });
  });

  it('una fecha invalida no rompe la lista', async () => {
    const repo = new HttpCryptoRepository(clientReturning([
      fila({ type: 'buy', asset: 'BTC', amount: '1', total: '1', created_at: 'no-es-fecha' }),
    ]));
    const res = await repo.getTransactions();
    expect(res.success).toBe(true);
    expect(res.data![0].date).toBe('no-es-fecha');
  });
});

describe('HttpCryptoRepository — lo que se manda al servidor', () => {
  function clienteQueAnota() {
    const llamadas: Array<{ ruta: string; cuerpo: Record<string, unknown> }> = [];
    const client = {
      post: async (ruta: string, cuerpo: Record<string, unknown>) => {
        llamadas.push({ ruta, cuerpo });
        return {
          success: true,
          data: {
            id: 'b5f0c1d2-0000-4000-8000-000000000001', type: 'buy', asset: 'ETH', amount: '0.1',
            apy: 4.5, start_date: '2026-09-13T15:00:00Z', locked: false, earned: '0',
            price: '1', total: '1', currency: 'USD', created_at: '2026-09-13T15:00:00Z',
          },
        };
      },
      del: async (ruta: string) => {
        llamadas.push({ ruta, cuerpo: {} });
        return { success: true };
      },
    } as unknown as HttpClient;
    return { client, llamadas };
  }

  it('comprar y vender mandan la llave de idempotencia del intento', async () => {
    const { client, llamadas } = clienteQueAnota();
    const repo = new HttpCryptoRepository(client);
    await repo.buy({ asset: 'ETH', amount: 0.1, price: 10, fromCurrency: 'USD', fromAmount: 1, idempotencyKey: 'crypto:buy:k1' });
    await repo.sell({ asset: 'ETH', amount: 0.1, price: 10, toCurrency: 'CRC', toAmount: 500, idempotencyKey: 'crypto:sell:k2' });
    expect(llamadas[0].cuerpo.idempotency_key).toBe('crypto:buy:k1');
    expect(llamadas[1].cuerpo.idempotency_key).toBe('crypto:sell:k2');
  });

  it('sin llave no manda el campo', async () => {
    const { client, llamadas } = clienteQueAnota();
    await new HttpCryptoRepository(client).buy({ asset: 'ETH', amount: 0.1, price: 10, fromCurrency: 'USD', fromAmount: 1 });
    expect('idempotency_key' in llamadas[0].cuerpo).toBe(false);
  });

  // El cuerpo iba con `lockDays` en camelCase y el servidor lee `lock_days`.
  it('hacer staking manda los campos que lee el servidor y devuelve SU id', async () => {
    const { client, llamadas } = clienteQueAnota();
    const res = await new HttpCryptoRepository(client).stake({ asset: 'ETH', amount: 0.1, locked: true, lockDays: 30 });
    expect(llamadas[0].cuerpo).toEqual({ asset: 'ETH', amount: 0.1, locked: true, lock_days: 30 });
    expect(res.data!.id).toBe('b5f0c1d2-0000-4000-8000-000000000001');
    expect(res.data!.amount).toBe(0.1);
  });
});
