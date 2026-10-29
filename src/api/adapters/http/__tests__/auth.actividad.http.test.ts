import { describe, it, expect, vi } from 'vitest';
import { HttpAuthRepository } from '../auth.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return { get: vi.fn(), post: vi.fn(), ...overrides } as unknown as HttpClient;
}

describe('HttpAuthRepository — aviso de actividad', () => {
  it('avisa con POST autenticado a /api/v1/auth/activity y sin cuerpo', async () => {
    const post = vi.fn().mockResolvedValue({ success: true });

    const res = await new HttpAuthRepository(fakeClient({ post })).registrarActividad();

    expect(res.success).toBe(true);
    // Sin tercer argumento: va con el token de acceso (auth=true) y, si vencio,
    // pasa por la renovacion de siempre.
    expect(post).toHaveBeenCalledWith('/api/v1/auth/activity');
  });

  it('conserva el codigo de un rechazo del servidor', async () => {
    const post = vi.fn().mockResolvedValue({
      success: false,
      error: { code: 'SESSION_IDLE', message: 'x' },
    });

    const res = await new HttpAuthRepository(fakeClient({ post })).registrarActividad();

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('SESSION_IDLE');
  });
});
