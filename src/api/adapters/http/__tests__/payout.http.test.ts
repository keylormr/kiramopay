import { describe, it, expect, vi } from 'vitest';
import { HttpPayoutRepository } from '../payout.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
    ...overrides,
  } as unknown as HttpClient;
}

const rawPayout = {
  id: 'p1',
  user_id: 'u1',
  rail: 'mock',
  amount_minor: 250000,
  currency: 'CRC',
  status: 'processing',
  destination: { type: 'bank_account', account: '123456789', name: 'Acme SA', bank: '0151', country: 'CR' },
  external_id: 'mock_p1',
  failure_reason: '',
  processing_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('HttpPayoutRepository', () => {
  it('lists and maps snake_case → camelCase (incl. nested destination)', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ success: true, data: [rawPayout] }),
    });
    const repo = new HttpPayoutRepository(client);
    const res = await repo.list(25);
    expect(res.success).toBe(true);
    expect(res.data?.[0].userId).toBe('u1');
    expect(res.data?.[0].amountMinor).toBe(250000);
    expect(res.data?.[0].externalId).toBe('mock_p1');
    expect(res.data?.[0].destination.name).toBe('Acme SA');
    expect(res.data?.[0].destination.bank).toBe('0151');
    expect(client.get).toHaveBeenCalledWith('/api/v1/payouts?limit=25');
  });

  it('creates with snake_case body and maps the result', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: true, data: rawPayout }),
    });
    const repo = new HttpPayoutRepository(client);
    const res = await repo.create({
      rail: 'mock',
      amountMinor: 250000,
      currency: 'CRC',
      destination: { type: 'bank_account', account: '123456789', name: 'Acme SA' },
      idempotencyKey: 'idem-1',
    });
    expect(res.success).toBe(true);
    expect(res.data?.rail).toBe('mock');
    expect(client.post).toHaveBeenCalledWith('/api/v1/payouts', {
      rail: 'mock',
      amount_minor: 250000,
      currency: 'CRC',
      destination: { type: 'bank_account', account: '123456789', name: 'Acme SA', bank: undefined, country: undefined },
      idempotency_key: 'idem-1',
    });
  });

  it('refreshes a processing payout', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: true, data: { ...rawPayout, status: 'completed' } }),
    });
    const repo = new HttpPayoutRepository(client);
    const res = await repo.refresh('p1');
    expect(res.data?.status).toBe('completed');
    expect(client.post).toHaveBeenCalledWith('/api/v1/payouts/p1/refresh', undefined);
  });

  it('unwraps the rails list', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ success: true, data: { rails: ['mock'] } }),
    });
    const repo = new HttpPayoutRepository(client);
    const res = await repo.rails();
    expect(res.success).toBe(true);
    expect(res.data).toEqual(['mock']);
    expect(client.get).toHaveBeenCalledWith('/api/v1/payouts/rails');
  });

  const createWith = (errorResult: unknown) => {
    const client = fakeClient({ post: vi.fn().mockResolvedValue(errorResult) });
    return new HttpPayoutRepository(client).create({
      rail: 'mock',
      amountMinor: 100,
      destination: { type: 'bank_account', account: '1', name: 'X' },
      idempotencyKey: 'idem-2',
    });
  };

  it('preserves the backend error code (not just the message)', async () => {
    const res = await createWith({
      success: false,
      error: { code: 'INSUFFICIENT_FUNDS', message: 'Saldo insuficiente' },
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INSUFFICIENT_FUNDS');
    expect(res.error?.message).toBe('Saldo insuficiente');
  });

  it('still preserves MFA_REQUIRED', async () => {
    const res = await createWith({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa' } });
    expect(res.error?.code).toBe('MFA_REQUIRED');
  });

  it('falls back to a generic code when the backend gives none', async () => {
    const res = await createWith({ success: false });
    expect(res.error?.code).toBe('PAYOUT_CREATE_FAILED');
  });
});
