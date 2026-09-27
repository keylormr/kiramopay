import { HttpSplitPayRepository } from '../splitpay.http';
import type { HttpClient } from '../client';
import es from '@/i18n/languages/es';
import fr from '@/i18n/languages/fr';
import { fijarDiccionarioActivo } from '@/i18n/mensajesDeError';

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

// createSplit() pisaba TODO codigo de error real con el literal 'CREATE_FAILED',
// asi que SplitPayView nunca podia distinguir SPLIT_SELF_INCLUDED de
// SPLIT_EXCEEDS_TOTAL de cualquier otro caso: el switch de CLAVES_ERROR_CREAR
// caia siempre al mensaje crudo en ingles del servidor (hallazgo QA n=52, la
// parte que sobrevivia despues de agregar la tabla de traduccion en la vista).
describe('HttpSplitPayRepository.createSplit', () => {
  function clienteQueResponde(respuesta: unknown) {
    return { post: async () => respuesta } as unknown as HttpClient;
  }

  const pedido = {
    title: 'Cena', totalAmount: 300, currency: 'CRC', splitType: 'equal' as const,
    participants: [{ userName: 'Ana', userPhone: '+50688880001' }],
  };

  it('un codigo de error especifico del backend llega intacto, sin pisarse', async () => {
    const client = clienteQueResponde({
      success: false,
      error: { code: 'SPLIT_SELF_INCLUDED', message: 'cannot include your own phone as a participant' },
    });
    const res = await new HttpSplitPayRepository(client).createSplit(pedido);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('SPLIT_SELF_INCLUDED');
  });

  it('sin codigo del servidor, cae al literal generico como antes', async () => {
    const client = clienteQueResponde({ success: false, error: { message: 'algo fallo' } });
    const res = await new HttpSplitPayRepository(client).createSplit(pedido);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('CREATE_FAILED');
  });

  // Sin un texto que mostrar, el adaptador inventaba 'Failed' en ingles, y la
  // pantalla lo pintaba tal cual en cualquier idioma. El respaldo es el aviso
  // generico en el idioma activo, como el que arma el cliente HTTP.
  describe('sin un texto que mostrar', () => {
    afterEach(() => {
      fijarDiccionarioActivo(es);
    });

    it('una respuesta exitosa sin datos da el aviso generico en el idioma de la app', async () => {
      fijarDiccionarioActivo(fr);
      const client = clienteQueResponde({ success: true, data: null });
      const res = await new HttpSplitPayRepository(client).createSplit(pedido);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('CREATE_FAILED');
      expect(res.error?.message).toBe(fr.err_generic);
    });

    it('una falla sin codigo ni mensaje, tambien', async () => {
      fijarDiccionarioActivo(fr);
      const client = clienteQueResponde({ success: false, error: { message: '' } });
      const res = await new HttpSplitPayRepository(client).createSplit(pedido);
      expect(res.error?.code).toBe('CREATE_FAILED');
      expect(res.error?.message).toBe(fr.err_generic);
    });
  });

  it('un exito se sigue mapeando igual que antes', async () => {
    const client = clienteQueResponde({
      success: true,
      data: {
        group: {
          id: 'g1', creator_id: 'u1', title: 'Cena', description: '',
          total_amount: 30000, currency: 'CRC', split_type: 'equal', status: 'active',
          created_at: '2026-09-13T00:00:00Z',
        },
        shares: [],
      },
    });
    const res = await new HttpSplitPayRepository(client).createSplit(pedido);
    expect(res.success).toBe(true);
    expect(res.data?.group.id).toBe('g1');
  });
});
