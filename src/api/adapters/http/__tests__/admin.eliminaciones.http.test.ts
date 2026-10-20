import { describe, it, expect, vi } from 'vitest';
import { HttpAdminRepository } from '../admin.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return { get: vi.fn(), post: vi.fn(), ...overrides } as unknown as HttpClient;
}

describe('HttpAdminRepository — cola de eliminaciones', () => {
  it('lista la cola con la cuenta enmascarada y tolera una solicitud sin cuenta', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: 'r1', contact_kind: 'phone', status: 'verified', created_at: '2026-10-14T15:00:00Z', verified_at: '2026-10-14T15:05:00Z',
            account: { id: 'u1', first_name: 'Maria', last_name: 'Rojas', cedula_masked: '••••930', status: 'blocked' },
          },
          { id: 'r2', contact_kind: 'email', created_at: '2026-10-14T16:00:00Z', verified_at: null, account: null },
        ],
      }),
    });
    const res = await new HttpAdminRepository(client).listDeletionRequests();
    expect(client.get).toHaveBeenCalledWith('/api/v1/admin/account-deletion-requests?limit=50');
    expect(res.data).toHaveLength(2);
    expect(res.data?.[0]).toMatchObject({ id: 'r1', contactKind: 'phone', account: { firstName: 'Maria', cedulaMasked: '••••930', status: 'blocked' } });
    expect(res.data?.[1]).toMatchObject({ id: 'r2', contactKind: 'email', verifiedAt: null, account: null });
  });

  it('lo que no es una lista (el stub de E2E) es una cola vacia', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ success: true, data: { no: 'lista' } }) });
    expect((await new HttpAdminRepository(client).listDeletionRequests()).data).toEqual([]);
  });

  it('atender devuelve el estado y los codigos de bloqueo, que no son un error', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({
        success: true,
        data: { status: 'blocked', result_code: 'BALANCE_POSITIVE', blockers: [{ code: 'BALANCE_POSITIVE' }] },
      }),
    });
    const res = await new HttpAdminRepository(client).processDeletionRequest('r 1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/admin/account-deletion-requests/r%201/process', {});
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ status: 'blocked', resultCode: 'BALANCE_POSITIVE', blockers: ['BALANCE_POSITIVE'] });
  });

  it('lista las respuestas escritas que pasaron a operaciones, con lo que hay que decirle a la persona', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: 'd1', kind: 'scheduled', reason: 'no_channel', attempts: 1,
            created_at: '2026-10-19T15:00:00Z', respond_by: '2026-10-26T15:00:00Z',
            deletion_due_at: '2026-11-18T15:00:00Z', retained_until: '2031-11-18T15:00:00Z', blockers: [],
            account: { id: 'u1', first_name: 'Maria', last_name: 'Rojas', cedula_masked: '••••930', status: 'pending_deletion' },
          },
          {
            id: 'd2', kind: 'blocked', reason: 'send_failed', attempts: 9,
            created_at: '2026-10-17T15:00:00Z', respond_by: '2026-10-24T15:00:00Z', blockers: ['BALANCE_POSITIVE'], account: null,
          },
        ],
      }),
    });
    const res = await new HttpAdminRepository(client).listDeletionResponses();
    expect(client.get).toHaveBeenCalledWith('/api/v1/admin/account-deletion-responses?limit=50');
    expect(res.data).toHaveLength(2);
    expect(res.data?.[0]).toMatchObject({
      id: 'd1', tipo: 'scheduled', motivo: 'no_channel', intentos: 1, responderAntesDe: '2026-10-26T15:00:00Z',
      seEliminaEl: '2026-11-18T15:00:00Z', conservaHasta: '2031-11-18T15:00:00Z', bloqueos: [],
      account: { firstName: 'Maria', cedulaMasked: '••••930' },
    });
    expect(res.data?.[1]).toMatchObject({
      id: 'd2', tipo: 'blocked', motivo: 'send_failed', seEliminaEl: null, conservaHasta: null,
      bloqueos: ['BALANCE_POSITIVE'], account: null,
    });
  });

  it('marcar una respuesta entregada manda la nota', async () => {
    const client = fakeClient({ post: vi.fn().mockResolvedValue({ success: true, data: null }) });
    const res = await new HttpAdminRepository(client).markDeletionResponseDelivered('d 1', 'Se la leimos por telefono');
    expect(client.post).toHaveBeenCalledWith('/api/v1/admin/account-deletion-responses/d%201/delivered', {
      note: 'Se la leimos por telefono',
    });
    expect(res.success).toBe(true);
  });

  it('un rechazo del servidor conserva el codigo (NOT_PENDING)', async () => {
    const client = fakeClient({ post: vi.fn().mockResolvedValue({ success: false, error: { code: 'NOT_PENDING', message: 'x' } }) });
    const res = await new HttpAdminRepository(client).rejectDeletionRequest('r1');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('NOT_PENDING');
  });
});
