import { describe, it, expect, vi } from 'vitest';
import { HttpServicesRepository } from '../services.http';
import type { HttpClient } from '../client';

// El historial de recargas pasaba `created_at` tal cual y la pantalla de
// servicios lo pintaba crudo: "2026-09-04T15:30:00Z" en la fila. La fecha de
// maquina viaja aparte, para que la pantalla la escriba en el idioma de la app.
describe('HttpServicesRepository.getRechargeHistory', () => {
  it('trae la fecha del servidor como fecha de maquina', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          id: 'r1',
          type: 'recharge',
          provider_code: 'kolbi',
          client_id: '88880000',
          amount: 500000,
          status: 'completed',
          created_at: '2026-09-04T15:30:00Z',
        },
      ],
    });
    const repo = new HttpServicesRepository({ get, post: vi.fn() } as unknown as HttpClient);

    const res = await repo.getRechargeHistory();

    expect(res.success).toBe(true);
    expect(res.data?.[0].dateISO).toBe('2026-09-04T15:30:00Z');
  });
});

// Pagar un recibo o recargar no mandaba llave de idempotencia: el reintento
// tras un corte de red era otro cobro. La llave la pone la pantalla y viaja tal
// cual; la repeticion que marca el servidor llega como `repetida`.
describe('HttpServicesRepository — la llave del pago y de la recarga', () => {
  it('payBill manda la llave y marca la repeticion', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { transaction_id: 't1', receipt_number: 'RCP-t1', provider_name: 'ICE', amount: 500000, status: 'completed', replayed: true },
    });
    const repo = new HttpServicesRepository({ get: vi.fn(), post } as unknown as HttpClient);

    const res = await repo.payBill({
      providerId: 'ICE', providerName: 'ICE', clientId: '123', amount: 5000, period: 'octubre de 2026', idempotencyKey: 'llave-1',
    });

    expect(post.mock.calls[0][1]).toMatchObject({ idempotency_key: 'llave-1' });
    expect(res.success).toBe(true);
    expect(res.data?.repetida).toBe(true);
  });

  it('recharge manda la llave, y sin repeticion no hay marca', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { transaction_id: 't2', operator: 'Kölbi (ICE)', phone: '88887777', amount: 100000, status: 'completed' },
    });
    const repo = new HttpServicesRepository({ get: vi.fn(), post } as unknown as HttpClient);

    const res = await repo.recharge({ operatorId: 'kolbi', phone: '88887777', amount: 1000, idempotencyKey: 'llave-2' });

    expect(post.mock.calls[0][1]).toMatchObject({ idempotency_key: 'llave-2' });
    expect(res.success).toBe(true);
    expect(res.data?.repetida).toBeUndefined();
  });
});

// La lista de empresas y operadores sale del servidor (GET /services/providers):
// la pantalla ya no la lleva escrita a mano. El mismo endpoint dice si el cobro
// se puede entregar, para avisarlo antes de que la persona llene el formulario.
describe('HttpServicesRepository.getCatalog', () => {
  it('trae empresas, operadores y si hay convenios', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        agreements_active: true,
        providers: [{ code: 'ice', name: 'ICE — Electricidad', category: 'electricity' }],
        operators: [{ code: 'kolbi', name: 'Kölbi (ICE)' }],
      },
    });
    const repo = new HttpServicesRepository({ get, post: vi.fn() } as unknown as HttpClient);

    const res = await repo.getCatalog();

    expect(get).toHaveBeenCalledWith('/api/v1/services/providers');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      agreementsActive: true,
      providers: [{ code: 'ice', name: 'ICE — Electricidad', category: 'electricity' }],
      operators: [{ code: 'kolbi', name: 'Kölbi (ICE)' }],
    });
  });

  it('sin convenios lo dice: no se asume que si', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: { agreements_active: false, providers: [], operators: [] },
    });
    const repo = new HttpServicesRepository({ get, post: vi.fn() } as unknown as HttpClient);

    const res = await repo.getCatalog();

    expect(res.data?.agreementsActive).toBe(false);
  });

  it('una respuesta sin listas ni bandera no revienta y no ofrece cobros', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: {} });
    const repo = new HttpServicesRepository({ get, post: vi.fn() } as unknown as HttpClient);

    const res = await repo.getCatalog();

    expect(res.data).toEqual({ agreementsActive: false, providers: [], operators: [] });
  });

  it('un fallo conserva el codigo del servidor', async () => {
    const error = { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes.' };
    const get = vi.fn().mockResolvedValue({ success: false, error });
    const repo = new HttpServicesRepository({ get, post: vi.fn() } as unknown as HttpClient);

    const res = await repo.getCatalog();

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('RATE_LIMITED');
  });
});
