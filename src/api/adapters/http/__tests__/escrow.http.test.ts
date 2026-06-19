import { describe, it, expect, vi } from 'vitest';
import { HttpEscrowRepository } from '../escrow.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
    ...overrides,
  } as unknown as HttpClient;
}

const rawAgreement = {
  id: 'a1',
  buyer_id: 'b1',
  seller_id: 's1',
  amount_minor: 250000,
  currency: 'CRC',
  status: 'pending',
  description: 'laptop',
  dispute_reason: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('HttpEscrowRepository', () => {
  it('lists and maps snake_case → camelCase', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ success: true, data: [rawAgreement] }),
    });
    const repo = new HttpEscrowRepository(client);
    const res = await repo.list(25);
    expect(res.success).toBe(true);
    expect(res.data?.[0].buyerId).toBe('b1');
    expect(res.data?.[0].amountMinor).toBe(250000);
    expect(client.get).toHaveBeenCalledWith('/api/v1/escrow?limit=25');
  });

  it('creates with snake_case body and maps the result', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: true, data: rawAgreement }),
    });
    const repo = new HttpEscrowRepository(client);
    const res = await repo.create({ sellerId: 's1', amountMinor: 250000, currency: 'CRC', description: 'laptop' });
    expect(res.success).toBe(true);
    expect(res.data?.sellerId).toBe('s1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/escrow', {
      seller_id: 's1',
      amount_minor: 250000,
      currency: 'CRC',
      description: 'laptop',
    });
  });

  it('routes the body-less actions to the right path', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: true, data: { ...rawAgreement, status: 'funded' } }),
    });
    const repo = new HttpEscrowRepository(client);
    const res = await repo.fund('a1');
    expect(res.data?.status).toBe('funded');
    expect(client.post).toHaveBeenCalledWith('/api/v1/escrow/a1/fund', undefined);

    await repo.release('a1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/escrow/a1/release', undefined);
    await repo.cancel('a1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/escrow/a1/cancel', undefined);
  });

  it('sends a reason for dispute', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: true, data: { ...rawAgreement, status: 'disputed' } }),
    });
    const repo = new HttpEscrowRepository(client);
    await repo.dispute('a1', 'not received');
    expect(client.post).toHaveBeenCalledWith('/api/v1/escrow/a1/dispute', { reason: 'not received' });
  });

  it('surfaces backend errors', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: false, error: { code: 'X', message: 'nope' } }),
    });
    const repo = new HttpEscrowRepository(client);
    const res = await repo.fund('a1');
    expect(res.success).toBe(false);
    expect(res.error?.message).toBe('nope');
  });
});
