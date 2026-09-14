import { HttpSplitPayRepository } from '../splitpay.http';
import type { HttpClient } from '../client';

// El backend responde 200 {"success":true,"data":null} cuando el usuario no
// tiene divisiones (Go serializa un slice nil como null). El adaptador
// confundia eso con una falla real y la pantalla mostraba "No pudimos cargar
// tus cuentas divididas" a quien simplemente no tenia ninguna (hallazgo QA
// n=6 / n=73). Mismo patron ya corregido en cards.http.ts.
describe('HttpSplitPayRepository.listSplits', () => {
  function clienteQueResponde(respuesta: unknown) {
    return { get: async () => respuesta } as unknown as HttpClient;
  }

  it('un data:null se lee como "sin divisiones todavia", no como una falla', async () => {
    const client = clienteQueResponde({ success: true, data: null });
    const res = await new HttpSplitPayRepository(client).listSplits();
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('una lista real se sigue mapeando igual que antes', async () => {
    const client = clienteQueResponde({
      success: true,
      data: [{
        id: 'g1', creator_id: 'u1', title: 'Cena', description: '',
        total_amount: 30000, currency: 'CRC', split_type: 'equal', status: 'active',
        created_at: '2026-09-13T00:00:00Z',
      }],
    });
    const res = await new HttpSplitPayRepository(client).listSplits();
    expect(res.success).toBe(true);
    expect(res.data).toEqual([{
      id: 'g1', creatorId: 'u1', title: 'Cena', description: undefined,
      totalAmount: 300, currency: 'CRC', splitType: 'equal', status: 'active',
      createdAt: '2026-09-13T00:00:00Z',
    }]);
  });

  it('una falla real del servidor sigue siendo una falla', async () => {
    const client = clienteQueResponde({ success: false, error: { code: 'RATE_LIMITED', message: 'Espera un momento.' } });
    const res = await new HttpSplitPayRepository(client).listSplits();
    expect(res.success).toBe(false);
    expect(res.error?.message).toBe('Espera un momento.');
  });
});
