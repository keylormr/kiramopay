import { HttpTransactionRepository } from '../transaction.http';
import type { HttpClient } from '../client';

// El detalle de un movimiento muestra con quien fue y la nota que escribio la
// persona. El adaptador juntaba las dos en `title` y `description` ("la
// contraparte o, si no hay, la nota"), asi que el detalle no tenia de donde
// sacar cada una por separado.

const fila = (extra: Record<string, unknown>) => ({
  id: 'tx-1',
  type: 'sinpe_send',
  amount: 500000,
  currency: 'CRC',
  fee: 0,
  counterparty_name: '',
  counterparty_phone: '',
  status: 'completed',
  created_at: '2026-09-04T15:30:00Z',
  metadata: '',
  ...extra,
});

async function mapear(extra: Record<string, unknown>) {
  const client = {
    get: async () => ({ success: true, data: { transactions: [fila(extra)], total: 1 } }),
  } as unknown as HttpClient;
  const res = await new HttpTransactionRepository(client).listTransactions({ limit: 20 });
  return res.data?.transactions[0];
}

describe('HttpTransactionRepository: contraparte y nota por separado', () => {
  it('la contraparte y la nota llegan cada una en su campo', async () => {
    const tx = await mapear({ counterparty_name: 'Ana Mora', metadata: JSON.stringify({ description: 'Almuerzo' }) });

    expect(tx?.counterparty).toBe('Ana Mora');
    expect(tx?.note).toBe('Almuerzo');
    // El titulo sigue siendo la contraparte.
    expect(tx?.title).toBe('Ana Mora');
  });

  it('sin contraparte, la nota sigue siendo el titulo y tambien la nota', async () => {
    const tx = await mapear({ metadata: JSON.stringify({ description: 'Pago de luz' }) });

    expect(tx?.counterparty).toBeUndefined();
    expect(tx?.note).toBe('Pago de luz');
    expect(tx?.title).toBe('Pago de luz');
  });
});
