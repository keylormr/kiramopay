import { describe, it, expect, vi } from 'vitest';
import { HttpB2BRepository } from '../b2b.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
    ...overrides,
  } as unknown as HttpClient;
}

const rawKey = {
  id: 'k1',
  name: 'Store',
  prefix: 'kp_live_abc',
  scopes: 'escrow:read,escrow:write',
  status: 'active',
  last_used_at: '2026-01-02T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
};

describe('HttpB2BRepository — keys', () => {
  it('lists and maps keys', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ success: true, data: [rawKey] }),
    });
    const repo = new HttpB2BRepository(client);
    const res = await repo.listKeys();
    expect(res.data?.[0].lastUsedAt).toBe('2026-01-02T00:00:00Z');
    expect(res.data?.[0].prefix).toBe('kp_live_abc');
    expect(client.get).toHaveBeenCalledWith('/api/v1/b2b/keys');
  });

  it('creates a key and returns the full secret once', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: true, data: { key: rawKey, full: 'kp_live_FULLSECRET' } }),
    });
    const repo = new HttpB2BRepository(client);
    const res = await repo.createKey('Store', 'escrow:read');
    expect(res.data?.full).toBe('kp_live_FULLSECRET');
    expect(res.data?.key.name).toBe('Store');
    expect(client.post).toHaveBeenCalledWith('/api/v1/b2b/keys', { name: 'Store', scopes: 'escrow:read' });
  });

  it('revokes a key via DELETE', async () => {
    const del = vi.fn().mockResolvedValue({ success: true, data: { status: 'revoked' } });
    const repo = new HttpB2BRepository(fakeClient({ del }));
    const res = await repo.revokeKey('k1');
    expect(res.success).toBe(true);
    expect(del).toHaveBeenCalledWith('/api/v1/b2b/keys/k1');
  });
});

describe('HttpB2BRepository — webhooks', () => {
  const rawEndpoint = {
    id: 'w1',
    url: 'https://example.com/hook',
    events: '*',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
  };

  it('creates a webhook and returns the secret once', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ success: true, data: { endpoint: rawEndpoint, secret: 'whsec_X' } }),
    });
    const repo = new HttpB2BRepository(client);
    const res = await repo.createWebhook('https://example.com/hook', 'escrow.released');
    expect(res.data?.secret).toBe('whsec_X');
    expect(res.data?.endpoint.url).toBe('https://example.com/hook');
    expect(client.post).toHaveBeenCalledWith('/api/v1/b2b/webhooks', {
      url: 'https://example.com/hook',
      events: 'escrow.released',
    });
  });

  it('lists deliveries and maps them', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: 'd1',
            event_type: 'escrow.funded',
            status: 'delivered',
            attempts: 1,
            response_code: 200,
            created_at: '2026-01-01T00:00:00Z',
            delivered_at: '2026-01-01T00:00:01Z',
          },
        ],
      }),
    });
    const repo = new HttpB2BRepository(client);
    const res = await repo.listDeliveries('w1', 10);
    expect(res.data?.[0].eventType).toBe('escrow.funded');
    expect(res.data?.[0].responseCode).toBe(200);
    expect(client.get).toHaveBeenCalledWith('/api/v1/b2b/webhooks/w1/deliveries?limit=10');
  });

  it('deletes a webhook via DELETE', async () => {
    const del = vi.fn().mockResolvedValue({ success: true, data: { status: 'deleted' } });
    const repo = new HttpB2BRepository(fakeClient({ del }));
    const res = await repo.deleteWebhook('w1');
    expect(res.success).toBe(true);
    expect(del).toHaveBeenCalledWith('/api/v1/b2b/webhooks/w1');
  });
});
