import { HttpTransactionRepository } from '../transaction.http';
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
