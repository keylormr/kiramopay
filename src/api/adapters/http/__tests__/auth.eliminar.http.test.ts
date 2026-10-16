import { describe, it, expect, vi } from 'vitest';
import { HttpAuthRepository } from '../auth.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return { get: vi.fn(), post: vi.fn(), ...overrides } as unknown as HttpClient;
}

describe('HttpAuthRepository — eliminar la cuenta', () => {
  it('el preflight pasa los bloqueos a una lista de codigos, nunca null', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        success: true,
        data: { eligible: false, blockers: [{ code: 'BALANCE_POSITIVE' }, { code: 'TX_PENDING' }], requires_totp: true },
      }),
    });
    const res = await new HttpAuthRepository(client).deletionPreflight();
    expect(client.get).toHaveBeenCalledWith('/api/v1/users/me/delete-account/preflight');
    expect(res.data).toEqual({
      elegible: false,
      motivo: undefined,
      bloqueos: ['BALANCE_POSITIVE', 'TX_PENDING'],
      pideSegundoFactor: true,
    });
  });

  it('un preflight con blockers null (servidor viejo) es una lista vacia', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ success: true, data: { eligible: true, blockers: null, requires_totp: false } }),
    });
    const res = await new HttpAuthRepository(client).deletionPreflight();
    expect(res.data?.bloqueos).toEqual([]);
    expect(res.data?.elegible).toBe(true);
  });

  it('el motivo (DEMO_ACCOUNT, ADMIN_ACCOUNT...) llega tal cual', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ success: true, data: { eligible: false, reason: 'ADMIN_ACCOUNT', blockers: [], requires_totp: false } }),
    });
    expect((await new HttpAuthRepository(client).deletionPreflight()).data?.motivo).toBe('ADMIN_ACCOUNT');
  });

  it('un preflight que falla conserva el codigo del servidor', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ success: false, error: { code: 'PREFLIGHT_FAILED', message: 'x' } }),
    });
    const res = await new HttpAuthRepository(client).deletionPreflight();
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('PREFLIGHT_FAILED');
  });

  it('deleteAccount manda la contrasena y solo manda el codigo TOTP si hay', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: { already_deleted: false } });
    const repo = new HttpAuthRepository(fakeClient({ post }));

    const sinTotp = await repo.deleteAccount({ password: 'Clave-123' });
    expect(post).toHaveBeenCalledWith('/api/v1/users/me/delete-account', { password: 'Clave-123', totp_code: undefined });
    expect(sinTotp.data).toEqual({ alreadyDeleted: false });

    await repo.deleteAccount({ password: 'Clave-123', totpCode: '123456' });
    expect(post).toHaveBeenLastCalledWith('/api/v1/users/me/delete-account', { password: 'Clave-123', totp_code: '123456' });
  });

  it('un rechazo conserva el codigo Y el detalle de lo que hay que resolver', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({
        success: false,
        error: { code: 'DELETION_BLOCKED', message: 'pendiente', details: { blockers: [{ code: 'ESCROW_OPEN' }] } },
      }),
    });
    const res = await new HttpAuthRepository(client).deleteAccount({ password: 'x' });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DELETION_BLOCKED');
    expect(res.error?.details).toEqual({ blockers: [{ code: 'ESCROW_OPEN' }] });
  });
});
