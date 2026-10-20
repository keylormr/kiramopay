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
      pideCorreoParaRespuesta: false,
    });
  });

  it('el preflight dice si la cuenta no tiene correo y hay que pedir uno para la respuesta', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        success: true,
        data: { eligible: true, blockers: [], requires_totp: false, requires_response_email: true },
      }),
    });
    expect((await new HttpAuthRepository(client).deletionPreflight()).data?.pideCorreoParaRespuesta).toBe(true);
  });

  it('deleteAccount manda el correo para la respuesta solo si lo hay', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { already_requested: false, requested_at: '2026-10-18T15:00:00Z', deletion_due_at: '2026-11-17T15:00:00Z' },
    });
    const repo = new HttpAuthRepository(fakeClient({ post }));
    await repo.deleteAccount({ password: 'Clave-123', acceptTerms: true, responseEmail: 'respuesta@ejemplo.test' });
    expect(post).toHaveBeenLastCalledWith('/api/v1/users/me/delete-account', {
      password: 'Clave-123',
      totp_code: undefined,
      accept_terms: true,
      response_email: 'respuesta@ejemplo.test',
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

  it('deleteAccount manda la contrasena, la aceptacion del plazo y solo manda el codigo TOTP si hay', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { already_requested: false, requested_at: '2026-10-18T15:00:00Z', deletion_due_at: '2026-11-17T15:00:00Z' },
    });
    const repo = new HttpAuthRepository(fakeClient({ post }));

    const sinTotp = await repo.deleteAccount({ password: 'Clave-123', acceptTerms: true });
    expect(post).toHaveBeenCalledWith('/api/v1/users/me/delete-account', {
      password: 'Clave-123',
      totp_code: undefined,
      accept_terms: true,
    });
    expect(sinTotp.data).toEqual({
      yaPedida: false,
      solicitadaEn: '2026-10-18T15:00:00Z',
      seEliminaEl: '2026-11-17T15:00:00Z',
    });

    await repo.deleteAccount({ password: 'Clave-123', totpCode: '123456', acceptTerms: true });
    expect(post).toHaveBeenLastCalledWith('/api/v1/users/me/delete-account', {
      password: 'Clave-123',
      totp_code: '123456',
      accept_terms: true,
    });
  });

  it('el login manda reactivate solo cuando se pide, y un 403 por eliminar trae la fecha', async () => {
    const post = vi.fn().mockResolvedValue({
      success: false,
      error: { code: 'ACCOUNT_PENDING_DELETION', message: 'x', details: { deletion_due_at: '2026-11-17T15:00:00Z' } },
    });
    const repo = new HttpAuthRepository(fakeClient({ post }));

    const res = await repo.login({ identifier: 'keilor', password: 'Clave-123' });
    expect(post).toHaveBeenLastCalledWith('/api/v1/auth/login', { identifier: 'keilor', password: 'Clave-123' }, false);
    expect(res.error?.code).toBe('ACCOUNT_PENDING_DELETION');
    expect(res.error?.details).toEqual({ deletion_due_at: '2026-11-17T15:00:00Z' });

    await repo.login({ identifier: 'keilor', password: 'Clave-123', reactivate: true });
    expect(post).toHaveBeenLastCalledWith(
      '/api/v1/auth/login',
      { identifier: 'keilor', password: 'Clave-123', reactivate: true },
      false,
    );
  });

  it('un rechazo conserva el codigo Y el detalle de lo que hay que resolver', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({
        success: false,
        error: { code: 'DELETION_BLOCKED', message: 'pendiente', details: { blockers: [{ code: 'ESCROW_OPEN' }] } },
      }),
    });
    const res = await new HttpAuthRepository(client).deleteAccount({ password: 'x', acceptTerms: true });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DELETION_BLOCKED');
    expect(res.error?.details).toEqual({ blockers: [{ code: 'ESCROW_OPEN' }] });
  });
});
