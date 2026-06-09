import { describe, it, expect, vi } from 'vitest';
import { HttpMfaRepository } from '../mfa.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as unknown as HttpClient;
}

describe('HttpMfaRepository', () => {
  it('maps totpStatus', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ success: true, data: { enabled: true } }),
    });
    const repo = new HttpMfaRepository(client);
    const res = await repo.totpStatus();
    expect(res.success).toBe(true);
    expect(res.data?.enabled).toBe(true);
    expect(client.get).toHaveBeenCalledWith('/api/v1/mfa/totp/status');
  });

  it('maps enroll snake_case → camelCase', async () => {
    const client = fakeClient({
      post: vi
        .fn()
        .mockResolvedValue({ success: true, data: { secret: 'ABC', otpauth_url: 'otpauth://x' } }),
    });
    const repo = new HttpMfaRepository(client);
    const res = await repo.totpEnroll();
    expect(res.success).toBe(true);
    expect(res.data?.secret).toBe('ABC');
    expect(res.data?.otpauthUrl).toBe('otpauth://x');
    expect(client.post).toHaveBeenCalledWith('/api/v1/mfa/totp/enroll');
  });

  it('returns recovery codes from confirm', async () => {
    const client = fakeClient({
      post: vi
        .fn()
        .mockResolvedValue({ success: true, data: { recovery_codes: ['AAAA-BBBB', 'CCCC-DDDD'] } }),
    });
    const repo = new HttpMfaRepository(client);
    const res = await repo.totpConfirm('123456');
    expect(res.data?.recoveryCodes).toEqual(['AAAA-BBBB', 'CCCC-DDDD']);
    expect(client.post).toHaveBeenCalledWith('/api/v1/mfa/totp/confirm', { code: '123456' });
  });

  it('surfaces verify failure as error', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: false, error: { code: 'X', message: 'bad' } }),
    });
    const repo = new HttpMfaRepository(client);
    const res = await repo.totpVerify('000000', 'high_value_tx');
    expect(res.success).toBe(false);
    expect(client.post).toHaveBeenCalledWith('/api/v1/mfa/totp/verify', {
      code: '000000',
      purpose: 'high_value_tx',
    });
  });

  it('maps disable success', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: true, data: { status: 'disabled' } }),
    });
    const repo = new HttpMfaRepository(client);
    const res = await repo.totpDisable('123456');
    expect(res.success).toBe(true);
    expect(res.data?.disabled).toBe(true);
  });
});
