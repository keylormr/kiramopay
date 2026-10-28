import { HttpTransactionRepository, mapSummary } from '../transaction.http';
import type { HttpClient } from '../client';

// TransactionsView distingue un 429 ("hay demasiado trafico, espera un
// momento") de la falta de red. El adaptador pisaba todo con FETCH_FAILED y la
// pantalla mandaba siempre a revisar la conexion, que estaba bien.
describe('HttpTransactionRepository.listTransactions', () => {
  function clienteQueResponde(respuesta: unknown) {
    return { get: async () => respuesta } as unknown as HttpClient;
  }

  it('un 429 llega como RATE_LIMITED, no como falta de red', async () => {
    const limite = { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes.' };
    const repo = new HttpTransactionRepository(clienteQueResponde({ success: false, error: limite }));

    const res = await repo.listTransactions({ limit: 20, search: 'cafe' });

    expect(res.success).toBe(false);
    expect(res.error).toEqual(limite);
  });

  it('sin red llega como NETWORK_ERROR', async () => {
    const sinRed = { code: 'NETWORK_ERROR', message: 'Sin conexión.' };
    const repo = new HttpTransactionRepository(clienteQueResponde({ success: false, error: sinRed }));

    const res = await repo.listTransactions({ limit: 20 });

    expect(res.error?.code).toBe('NETWORK_ERROR');
  });
});

// El servidor guarda cinco estados (pending, processing, completed, failed,
// reversed: transaction/model.go) y el adaptador los pasaba con un `as` a un tipo
// que conocia dos. Ahora cada uno llega con su nombre, y uno que la app no
// conoce llega como 'unknown': ni completado ni pendiente, que serian un dato
// inventado.
describe('HttpTransactionRepository — el estado de cada fila', () => {
  const fila = (status: string) => ({
    id: `tx-${status || 'vacio'}`,
    type: 'sinpe_send',
    amount: 500000,
    currency: 'CRC',
    fee: 0,
    counterparty_name: 'Ana Mora',
    counterparty_phone: '',
    status,
    created_at: '2026-09-04T15:30:00Z',
    metadata: '',
  });

  async function estadoDe(status: string) {
    const client = {
      get: async () => ({ success: true, data: { transactions: [fila(status)], total: 1 } }),
    } as unknown as HttpClient;
    const res = await new HttpTransactionRepository(client).listTransactions({ limit: 20 });
    return res.data?.transactions[0].status;
  }

  it.each(['completed', 'pending', 'processing', 'failed', 'reversed'])('%s llega tal cual', async (status) => {
    expect(await estadoDe(status)).toBe(status);
  });

  it.each(['disputed', 'algo_nuevo', ''])('"%s", que la app no conoce, llega como unknown', async (status) => {
    expect(await estadoDe(status)).toBe('unknown');
  });
});

// Retiro por el riel de pagos salientes: si el banco lo rechaza, el servidor
// devuelve la plata con una fila `payout_refund`. El adaptador la clasificaba
// como salida ("todo lo demas es salida") y el Inicio mostraba el reembolso con
// signo menos, aunque el saldo si volvia.
describe('HttpTransactionRepository — el reembolso de un retiro rechazado', () => {
  const fila = (type: string) => ({
    id: `tx-${type}`,
    type,
    amount: 100000,
    currency: 'CRC',
    fee: 0,
    counterparty_name: 'Rechazado',
    counterparty_phone: '',
    status: 'completed',
    created_at: '2026-10-28T15:30:00Z',
    metadata: '',
  });

  async function leer(type: string) {
    const client = {
      get: async () => ({ success: true, data: { transactions: [fila(type)], total: 1 } }),
    } as unknown as HttpClient;
    const res = await new HttpTransactionRepository(client).listTransactions({ limit: 20 });
    return res.data!.transactions[0];
  }

  it('payout_refund es una entrada: credito y monto positivo', async () => {
    const tx = await leer('payout_refund');
    expect(tx.type).toBe('credit');
    expect(tx.amount).toBe(1000);
  });

  it('el retiro que salio (payout_sent) sigue siendo una salida', async () => {
    const tx = await leer('payout_sent');
    expect(tx.type).toBe('debit');
    expect(tx.amount).toBe(-1000);
  });

  it('el resumen lo cuenta como ingreso, igual que la lista', () => {
    const resumen = mapSummary({
      from: '2026-10-01',
      to: '2026-11-01',
      groups: [{ date: '2026-10-28', type: 'payout_refund', currency: 'CRC', count: 2, amount: 200000 }],
      top: [],
    });
    expect(resumen.groups[0].direction).toBe('in');
  });
});

// Los movimientos de cripto caian en "Otros": el adaptador no conocia sus tipos.
describe('HttpTransactionRepository — la categoria de los movimientos de cripto', () => {
  const fila = (type: string) => ({
    id: `tx-${type}`,
    type,
    amount: 100000,
    currency: 'CRC',
    fee: 0,
    counterparty_name: 'Bitcoin',
    counterparty_phone: '',
    status: 'completed',
    created_at: '2026-10-28T15:30:00Z',
    metadata: '',
  });

  async function categoriaDe(type: string) {
    const client = {
      get: async () => ({ success: true, data: { transactions: [fila(type)], total: 1 } }),
    } as unknown as HttpClient;
    const res = await new HttpTransactionRepository(client).listTransactions({ limit: 20 });
    return res.data!.transactions[0].category;
  }

  it.each(['crypto_buy', 'crypto_sell', 'crypto_send'])('%s es de la categoria cripto', async (type) => {
    expect(await categoriaDe(type)).toBe('crypto');
  });

  it('lo que sigue sin categoria propia sigue cayendo en otros', async () => {
    expect(await categoriaDe('un_tipo_nuevo')).toBe('other');
  });

  it('el resumen tambien las agrupa como cripto', () => {
    const resumen = mapSummary({
      from: '2026-10-01',
      to: '2026-11-01',
      groups: [{ date: '2026-10-28', type: 'crypto_buy', currency: 'CRC', count: 1, amount: 100000 }],
      top: [],
    });
    expect(resumen.groups[0].category).toBe('crypto');
  });
});
