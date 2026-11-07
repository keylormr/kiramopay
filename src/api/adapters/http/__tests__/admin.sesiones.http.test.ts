import { describe, it, expect, vi } from 'vitest';
import { HttpAdminRepository } from '../admin.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides } as unknown as HttpClient;
}

describe('HttpAdminRepository y las sesiones de otra cuenta', () => {
  it('lista las sesiones de la cuenta y ninguna sale como la actual', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [
        { id: 's1', device_name: 'Mozilla/5.0 (Linux; Android 14)', ip_masked: '186.15.0.0', created_at: '2026-11-05T08:12:00Z', expires_at: '2026-11-12T08:12:00Z', current: true },
        'basura',
        { id: 's2', device_name: 'Dispositivo desconocido', ip_masked: '', created_at: '2026-11-04T19:40:00Z', expires_at: '2026-11-11T19:40:00Z' },
      ],
    });
    const res = await new HttpAdminRepository(fakeClient({ get })).listUserSessions('u 1');

    expect(get).toHaveBeenCalledWith('/api/v1/admin/users/u%201/sessions');
    expect(res.success).toBe(true);
    expect(res.data?.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(res.data?.every((s) => s.current === false)).toBe(true);
    expect(res.data?.[0]).toMatchObject({ deviceName: 'Mozilla/5.0 (Linux; Android 14)', ipMasked: '186.15.0.0' });
  });

  it('cierra un dispositivo por POST a su ruta y conserva SESSION_NOT_FOUND', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { revoked: true } })
      .mockResolvedValueOnce({ success: false, error: { code: 'SESSION_NOT_FOUND', message: 'session not found' } });
    const repo = new HttpAdminRepository(fakeClient({ post }));

    const ok = await repo.revokeUserSession('u1', 's1');
    expect(post).toHaveBeenCalledWith('/api/v1/admin/users/u1/sessions/s1/revoke', {});
    expect(ok.success).toBe(true);

    const ido = await repo.revokeUserSession('u1', 's1');
    expect(ido.success).toBe(false);
    expect(ido.error?.code).toBe('SESSION_NOT_FOUND');
  });

  it('cierra todas y devuelve cuantas; 0 si el servidor no manda el numero', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { revoked: 3 } })
      .mockResolvedValueOnce({ success: true, data: [] });
    const repo = new HttpAdminRepository(fakeClient({ post }));

    expect((await repo.revokeAllUserSessions('u1')).data).toBe(3);
    expect(post).toHaveBeenCalledWith('/api/v1/admin/users/u1/sessions/revoke-all', {});
    expect((await repo.revokeAllUserSessions('u1')).data).toBe(0);
  });

  it('conserva el codigo del servidor al fallar la lista (RATE_LIMITED)', async () => {
    const get = vi.fn().mockResolvedValue({ success: false, error: { code: 'RATE_LIMITED', message: 'espera' } });
    const res = await new HttpAdminRepository(fakeClient({ get })).listUserSessions('u1');
    expect(res.error?.code).toBe('RATE_LIMITED');
  });
});

describe('HttpAdminRepository y el historial de una cuenta', () => {
  it('lee GET .../history y cuenta cada accion con sus campos', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [
        { id: 'h1', action: 'user_blocked', actor_name: 'Keilor Martinez', automatic: false, reason: 'reporto el robo', sessions_revoked: 2, created_at: '2026-11-06T13:59:00Z' },
        { id: 'h2', action: 'user_blocked', actor_name: '', automatic: true, reason: 'demo vencido', sessions_revoked: 0, created_at: '2026-11-05T10:00:00Z' },
        { id: 'h3', action: 'user_expiry_set', actor_name: 'Keilor Martinez', automatic: false, expires_at: '2026-12-01T12:00:00Z', created_at: '2026-11-04T10:00:00Z' },
        { id: 'h4', action: 'admin_user_plan_set', actor_name: 'Keilor Martinez', automatic: false, plan_from: 'free', plan_to: 'plus', created_at: '2026-11-03T10:00:00Z' },
        { id: 'h5', action: 'admin_sessions_revoked_all', actor_name: 'Keilor Martinez', automatic: false, created_at: '2026-11-02T10:00:00Z' },
      ],
    });
    const res = await new HttpAdminRepository(fakeClient({ get })).userHistory('u1');

    expect(get).toHaveBeenCalledWith('/api/v1/admin/users/u1/history?limit=30');
    const [bloqueo, automatico, vencimiento, plan, todas] = res.data ?? [];
    expect(bloqueo).toMatchObject({ accion: 'user_blocked', actor: 'Keilor Martinez', motivo: 'reporto el robo', sesionesCerradas: 2, automatico: false });
    expect(automatico).toMatchObject({ automatico: true, actor: '', sesionesCerradas: 0 });
    expect(vencimiento).toMatchObject({ accion: 'user_expiry_set', venceEl: '2026-12-01T12:00:00Z', vencimientoQuitado: false });
    expect(plan).toMatchObject({ planAntes: 'free', planDespues: 'plus' });
    // Sin conteo en el rastro, el historial no inventa un cero.
    expect(todas.sesionesCerradas).toBeNull();
  });

  it('descarta lo que no es un objeto y las acciones que no sabe contar', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [null, 'x', [], { id: 'h1', action: 'login_success', created_at: '2026-11-06T13:59:00Z' }, { id: 'h2', action: 'user_unblocked', actor_name: 'K', created_at: '2026-11-06T14:00:00Z' }],
    });
    const res = await new HttpAdminRepository(fakeClient({ get })).userHistory('u1');
    expect(res.data?.map((e) => e.id)).toEqual(['h2']);
  });

  it('el stub de E2E (data: {}) da un historial vacio, no un fallo', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: {} });
    const res = await new HttpAdminRepository(fakeClient({ get })).userHistory('u1');
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });
});
