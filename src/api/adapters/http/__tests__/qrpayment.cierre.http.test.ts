import { describe, it, expect, vi } from 'vitest';
import { HttpQRPaymentRepository } from '../qrpayment.http';
import type { HttpClient } from '../client';

// El cierre logico de un comercio: el dueno lo cierra confirmando su
// contrasena, un administrador con un motivo, y la vista de administracion los
// lista a todos, cerrados incluidos.

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
    ...overrides,
  } as unknown as HttpClient;
}

const rawMerchant = {
  id: 'm1',
  user_id: 'u1',
  name: 'Cafeteria Central',
  description: '',
  category: 'restaurant',
  qr_code: 'MRC-ABC',
  active: true,
  cedula: '3-101-123',
  cedula_type: 'juridica',
  legal_name: 'Cafeteria Central SA',
  verification_status: 'verified',
  commission_bps: 50,
};

const cerrado = {
  ...rawMerchant,
  active: false,
  closed_at: '2026-10-18T20:00:00Z',
  closed_by: 'admin-1',
  closure_reason: 'Datos de prueba',
  owner_name: 'Victor Prueba',
};

describe('HttpQRPaymentRepository: cierre del comercio', () => {
  it('el dueno cierra con su contrasena y, si lo tiene, el codigo del autenticador', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: { ...cerrado, closure_reason: 'owner_request' } });
    const repo = new HttpQRPaymentRepository(fakeClient({ post }));

    const res = await repo.closeMerchant('m1', { password: 'secreta', totpCode: '123456' });
    expect(post).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/close', { password: 'secreta', totp_code: '123456' });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ id: 'm1', active: false, closedAt: '2026-10-18T20:00:00Z', closureReason: 'owner_request' });

    await repo.closeMerchant('m1', { password: 'secreta' });
    expect(post).toHaveBeenLastCalledWith('/api/v1/qr/merchants/m1/close', { password: 'secreta' });
  });

  it('el rechazo conserva el codigo y el detalle del servidor', async () => {
    const post = vi.fn().mockResolvedValue({
      success: false,
      error: { code: 'MERCHANT_HAS_BALANCE', message: 'x', details: { balances: [{ currency: 'CRC', amount: 99500 }] } },
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ post })).closeMerchant('m1', { password: 'secreta' });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('MERCHANT_HAS_BALANCE');
    expect(res.error?.details).toEqual({ balances: [{ currency: 'CRC', amount: 99500 }] });
  });

  it('un administrador cierra con motivo', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: cerrado });
    const res = await new HttpQRPaymentRepository(fakeClient({ post })).closeMerchantAsAdmin('m1', 'Datos de prueba');
    expect(post).toHaveBeenCalledWith('/api/v1/admin/merchants/m1/close', { reason: 'Datos de prueba' });
    expect(res.data).toMatchObject({ closedAt: '2026-10-18T20:00:00Z', closedBy: 'admin-1', closureReason: 'Datos de prueba' });
  });

  it('la lista de administracion trae a todos, con su estado y su dueno, y busca', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: [rawMerchant, cerrado] });
    const repo = new HttpQRPaymentRepository(fakeClient({ get }));

    const res = await repo.listAllMerchants();
    expect(get).toHaveBeenCalledWith('/api/v1/admin/merchants');
    expect(res.data?.[0]).toMatchObject({ id: 'm1', closedAt: null });
    expect(res.data?.[1]).toMatchObject({ closedAt: '2026-10-18T20:00:00Z', closureReason: 'Datos de prueba', ownerName: 'Victor Prueba' });

    await repo.listAllMerchants('café central');
    expect(get).toHaveBeenLastCalledWith('/api/v1/admin/merchants?q=caf%C3%A9%20central');
  });

  it('un comercio sin cierre (o de un servidor anterior) se lee abierto', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: [rawMerchant] });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchants();
    expect(res.data?.[0].closedAt).toBeNull();
    expect(res.data?.[0].closureReason).toBeUndefined();
  });

  it('el dueno lista sus comercios cerrados, con su rol', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: [{ ...cerrado, closure_reason: 'owner_request', role: 'owner' }] });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).listClosedMerchants();
    expect(get).toHaveBeenCalledWith('/api/v1/qr/merchants?status=closed');
    expect(res.success).toBe(true);
    expect(res.data?.[0]).toMatchObject({ id: 'm1', role: 'owner', closedAt: '2026-10-18T20:00:00Z', closureReason: 'owner_request' });
  });

  it('si la lista de cerrados falla, lo dice con su codigo', async () => {
    const get = vi.fn().mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED', message: 'x' } });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).listClosedMerchants();
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('FETCH_FAILED');
  });
});
