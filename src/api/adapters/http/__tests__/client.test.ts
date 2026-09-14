import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HttpClient,
  registerTokenProvider,
  registerRefreshHandler,
  registerAuthFailureHandler,
  registerAccountBlockedHandler,
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

// Respuesta de error con el codigo que devolveria el backend.
function makeErrRes(status: number, code: string) {
  return {
    status,
    ok: false,
    json: async () => ({ error: { code, message: 'err' } }),
  } as unknown as Response;
}

// Respuesta de error CON data, en la forma real del envelope del backend:
// `data` es HERMANO de `error`, nunca anidado dentro de el (ver
// backend/pkg/response/response.go, ErrorWithData).
function makeErrResConData(status: number, code: string, data: unknown) {
  return {
    status,
    ok: false,
    json: async () => ({ success: false, data, error: { code, message: 'err' } }),
  } as unknown as Response;
}

describe('HttpClient: el detalle del error y los archivos', () => {
  beforeEach(() => {
    registerTokenProvider(() => ({ accessToken: 'tok', refreshToken: 'ref' }));
    registerRefreshHandler(async () => true);
    registerAuthFailureHandler(() => {});
  });

  it('pasa error.details de un 409 a quien llama', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 409,
      ok: false,
      json: async () => ({
        success: false,
        error: { code: 'SAVINGS_GOAL_LIMIT', message: 'limit', details: { plan: 'free', limite: 3, actuales: 3 } },
      }),
    }));
    const r = await new HttpClient('http://x').post('/api/v1/savings/goals', {});
    expect(r.error).toEqual({ code: 'SAVINGS_GOAL_LIMIT', message: 'limit', details: { plan: 'free', limite: 3, actuales: 3 } });
  });

  it('un details que no es objeto no se cuela', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 400,
      ok: false,
      json: async () => ({ error: { code: 'INVALID_BODY', message: 'x', details: [] } }),
    }));
    const r = await new HttpClient('http://x').post('/api/v1/cards', {});
    expect(r.error).toEqual({ code: 'INVALID_BODY', message: 'x' });
  });

  it('getArchivo entrega el cuerpo y el nombre del Content-Disposition con 200', async () => {
    const blob = new Blob(['seccion,desde']);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({ 'Content-Disposition': 'attachment; filename="reporte-2026-09-07-a-2026-09-13.csv"' }),
      blob: async () => blob,
      json: async () => { throw new Error('no es JSON'); },
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await new HttpClient('http://x').getArchivo('/api/v1/qr/merchants/m1/report.csv?days=7&tz=360');

    expect(r.success).toBe(true);
    expect(r.data?.blob).toBe(blob);
    expect(r.data?.nombre).toBe('reporte-2026-09-07-a-2026-09-13.csv');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('getArchivo lee el sobre de error como JSON cuando no es 200', async () => {
    const blob = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
      headers: new Headers(),
      blob,
      json: async () => ({ success: false, error: { code: 'PLAN_REQUIRED', message: 'plan', details: { plan_requerido: 'analitica' } } }),
    }));

    const r = await new HttpClient('http://x').getArchivo('/api/v1/qr/merchants/m1/report.csv');

    expect(r.error).toEqual({ code: 'PLAN_REQUIRED', message: 'plan', details: { plan_requerido: 'analitica' } });
    expect(blob).not.toHaveBeenCalled();
  });

  it('getArchivo refresca una vez ante un 401 y reintenta', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, ok: false, headers: new Headers(), json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, ok: true, headers: new Headers(), blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn(async () => true);
    registerRefreshHandler(refresh);

    const r = await new HttpClient('http://x').getArchivo('/api/v1/qr/merchants/m1/report.csv');

    expect(r.success).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

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

describe('HttpClient cuenta bloqueada (403 ACCOUNT_BLOCKED)', () => {
  const onBlocked = vi.fn<() => void>();
  const refresh = vi.fn<() => Promise<boolean>>(async () => true);
  const onFail = vi.fn<() => void>();

  beforeEach(() => {
    registerTokenProvider(() => ({ accessToken: 'tok', refreshToken: 'ref' }));
    onBlocked.mockClear();
    refresh.mockClear();
    onFail.mockClear();
    registerRefreshHandler(refresh);
    registerAuthFailureHandler(onFail);
    registerAccountBlockedHandler(onBlocked);
  });

  it('en una peticion autenticada llama al handler una vez, preserva el code y no intenta refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrRes(403, 'ACCOUNT_BLOCKED'));
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient('http://x');
    const r = await client.get('/api/v1/wallets');

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('ACCOUNT_BLOCKED');
    expect(onBlocked).toHaveBeenCalledTimes(1);
    // Sin refresh ni reintento: el backend ya revoco las sesiones.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    // Tampoco pasa por el camino de SESSION_EXPIRED.
    expect(onFail).not.toHaveBeenCalled();
  });

  it('un 403 con otro code (FORBIDDEN) no llama al handler', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeErrRes(403, 'FORBIDDEN')));

    const client = new HttpClient('http://x');
    const r = await client.get('/api/v1/admin/kyc/pending');

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('FORBIDDEN');
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('un 403 ACCOUNT_BLOCKED en una peticion sin auth (login) no llama al handler', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeErrRes(403, 'ACCOUNT_BLOCKED')));

    const client = new HttpClient('http://x');
    const r = await client.post('/api/v1/auth/login', { identifier: 'x', password: 'y' }, false);

    // El code viaja igual: la vista de login lo discrimina por su cuenta.
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('ACCOUNT_BLOCKED');
    expect(onBlocked).not.toHaveBeenCalled();
  });
});

describe('HttpClient error con data (p. ej. 409 CONTACT_EXISTS)', () => {
  beforeEach(() => {
    registerTokenProvider(() => ({ accessToken: 'tok', refreshToken: 'ref' }));
  });

  // Regresion: el backend manda `data` como HERMANO de `error` en el envelope
  // (backend/pkg/response/response.go, ErrorWithData), nunca anidado dentro
  // de el. Leer `json.error?.data` siempre daba undefined contra el backend
  // real aunque los tests de sinpe.http.test.ts (que mockean client.post()
  // directamente) no lo detectaran.
  it('toma data del nivel superior del envelope, no de dentro de error', async () => {
    const contactoExistente = {
      id: 'srv-1',
      phone: '+50688881234',
      name: 'Diego Mora',
      bank: 'BAC',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeErrResConData(409, 'CONTACT_EXISTS', contactoExistente)),
    );

    const client = new HttpClient('http://x');
    const r = await client.post('/api/v1/sinpe/contacts', { phone: '+50688881234' });

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('CONTACT_EXISTS');
    expect(r.error?.data).toEqual(contactoExistente);
  });
});
