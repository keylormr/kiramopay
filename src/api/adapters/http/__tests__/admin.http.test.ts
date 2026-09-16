import { describe, it, expect, vi } from 'vitest';
import { HttpAdminRepository } from '../admin.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides } as unknown as HttpClient;
}

describe('HttpAdminRepository y el plan de una persona', () => {
  it('mapea el plan de la ficha; si el servidor no lo manda es free', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'u1', first_name: 'K', plan: 'pro' }, { id: 'u2', first_name: 'V' }],
    });
    const res = await new HttpAdminRepository(fakeClient({ post })).searchUsers('kei');
    expect(res.data?.map((u) => u.plan)).toEqual(['pro', 'free']);
  });

  it('asigna el plan con exactamente {plan} por PATCH y lee el plan anterior', async () => {
    const patch = vi.fn().mockResolvedValue({
      success: true,
      data: { user_id: 'u1', plan: 'plus', plan_anterior: 'free', updated_at: '2026-09-13T10:00:00Z' },
    });
    const res = await new HttpAdminRepository(fakeClient({ patch })).setUserPlan('u1', 'plus');

    expect(patch).toHaveBeenCalledWith('/api/v1/admin/users/u1/plan', { plan: 'plus' });
    expect(res.data).toEqual({ userId: 'u1', plan: 'plus', planAnterior: 'free', updatedAt: '2026-09-13T10:00:00Z' });
  });

  it('conserva el codigo del servidor (RATE_LIMITED, USER_NOT_FOUND)', async () => {
    const patch = vi.fn().mockResolvedValue({ success: false, error: { code: 'RATE_LIMITED', message: 'espera' } });
    const res = await new HttpAdminRepository(fakeClient({ patch })).setUserPlan('u1', 'pro');
    expect(res.error?.code).toBe('RATE_LIMITED');
  });
});
