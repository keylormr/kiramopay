import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HttpClient,
  registerTokenProvider,
  registerRefreshHandler,
  registerAuthFailureHandler,
} from '../client';

function makeRes(status: number, data: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({
      data,
      error: status >= 400 ? { code: 'HTTP', message: 'err' } : undefined,
    }),
  } as unknown as Response;
}

describe('HttpClient refresh-on-401', () => {
  beforeEach(() => {
    registerTokenProvider(() => ({ accessToken: 'tok', refreshToken: 'ref' }));
    registerRefreshHandler(async () => true);
    registerAuthFailureHandler(() => {});
  });

  it('refreshes once and replays the request on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeRes(401, null))
      .mockResolvedValueOnce(makeRes(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn(async () => true);
    registerRefreshHandler(refresh);

    const client = new HttpClient('http://x');
    const r = await client.get<{ ok: number }>('/api/v1/thing');

    expect(r.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('forces logout and returns SESSION_EXPIRED when refresh fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeRes(401, null));
    vi.stubGlobal('fetch', fetchMock);
    registerRefreshHandler(async () => false);
    const onFail = vi.fn();
    registerAuthFailureHandler(onFail);

    const client = new HttpClient('http://x');
    const r = await client.get('/api/v1/thing');

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('SESSION_EXPIRED');
    expect(onFail).toHaveBeenCalledTimes(1);
    // No infinite loop: original + (no replay because refresh failed).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent 401s into a single refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeRes(401, null))
      .mockResolvedValueOnce(makeRes(401, null))
      .mockResolvedValue(makeRes(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    let refreshCalls = 0;
    registerRefreshHandler(async () => {
      refreshCalls++;
      await new Promise((res) => setTimeout(res, 10));
      return true;
    });

    const client = new HttpClient('http://x');
    const [a, b] = await Promise.all([client.get('/a'), client.get('/b')]);

    expect(a.success && b.success).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('does not attempt refresh for unauthenticated (auth=false) calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeRes(401, null));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn(async () => true);
    registerRefreshHandler(refresh);

    const client = new HttpClient('http://x');
    const r = await client.post('/api/v1/auth/refresh', { x: 1 }, false);

    expect(r.success).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
