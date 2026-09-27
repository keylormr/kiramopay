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
