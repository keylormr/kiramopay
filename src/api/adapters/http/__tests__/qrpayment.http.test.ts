import { describe, it, expect, vi } from 'vitest';
import { HttpQRPaymentRepository } from '../qrpayment.http';
import type { HttpClient } from '../client';

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
  name: 'Soda Tica',
  description: 'Comidas',
  category: 'restaurant',
  qr_code: 'MRC-ABC',
  active: true,
  cedula: '3-101-123',
  cedula_type: 'juridica',
  legal_name: 'Soda Tica SA',
  verification_status: 'verified',
  rejection_reason: '',
  commission_bps: 50,
};

describe('HttpQRPaymentRepository: planes del comercio', () => {
  it('mapea el plan, la comision que se cobra hoy y el fin de la promocion', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        success: true,
        data: [{ ...rawMerchant, comision_efectiva_bps: 25, promo_hasta: '2026-12-13T12:00:00Z', plan: 'analitica' }],
      }),
    });
    const res = await new HttpQRPaymentRepository(client).getMerchants();
    expect(res.data?.[0]).toMatchObject({ commissionBps: 50, comisionEfectivaBps: 25, promoHasta: '2026-12-13T12:00:00Z', plan: 'analitica' });
  });

  it('sin los campos nuevos (servidor anterior) se cobra la fijada, sin promocion, plan base', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ success: true, data: [rawMerchant] }) });
    const res = await new HttpQRPaymentRepository(client).getMerchants();
    expect(res.data?.[0]).toMatchObject({ comisionEfectivaBps: 50, promoHasta: null, plan: 'base' });
  });

  it('mapea la comparacion del reporte de Analitica a unidades mayores y conserva los porcentajes null', async () => {
    const bucket = (gross: number, fee: number, count: number) => ({ gross, fee, net: gross - fee, count });
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        days: 7, from: '2026-09-07', to: '2026-09-13', totals: bucket(100000, 500, 4),
        daily: [], by_location: [], by_collector: [], plan: 'analitica',
        comparison: {
          previous_from: '2026-08-31', previous_to: '2026-09-06', previous_totals: bucket(80000, 400, 0),
          delta: { gross: 20000, fee: 100, net: 19900, count: 4, gross_pct: 25, net_pct: 25, count_pct: null },
        },
      },
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantReport('m1', 7);
    expect(res.data?.plan).toBe('analitica');
    expect(res.data?.comparison).toEqual({
      previousFrom: '2026-08-31',
      previousTo: '2026-09-06',
      previousTotals: { key: undefined, label: undefined, gross: 800, fee: 4, net: 796, count: 0 },
      delta: { gross: 200, fee: 1, net: 199, count: 4, grossPct: 25, netPct: 25, countPct: null },
    });
  });

  it('el reporte base no trae comparacion', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: { days: 30, totals: { gross: 0, fee: 0, net: 0, count: 0 }, daily: [], by_location: [], by_collector: [], plan: 'base' },
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantReport('m1', 30);
    expect(res.data?.plan).toBe('base');
    expect(res.data?.comparison).toBeUndefined();
  });

  it('pide el CSV como archivo con los dias y la zona, y conserva PLAN_REQUIRED con su detalle', async () => {
    const getArchivo = vi.fn().mockResolvedValue({
      success: false,
      error: { code: 'PLAN_REQUIRED', message: 'plan', details: { plan_requerido: 'analitica' } },
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ getArchivo } as Partial<HttpClient>)).exportMerchantReportCsv('m1', 90);
    expect(getArchivo.mock.calls[0][0]).toMatch(/^\/api\/v1\/qr\/merchants\/m1\/report\.csv\?days=90&tz=-?\d+$/);
    expect(res.error).toEqual({ code: 'PLAN_REQUIRED', message: 'plan', details: { plan_requerido: 'analitica' } });
  });

  it('asigna el plan del comercio con exactamente {plan} y conserva MERCHANT_NOT_FOUND', async () => {
    const patch = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: { ...rawMerchant, plan: 'analitica' } })
      .mockResolvedValueOnce({ success: false, error: { code: 'MERCHANT_NOT_FOUND', message: 'no' } });
    const repo = new HttpQRPaymentRepository(fakeClient({ patch }));

    const ok = await repo.setMerchantPlan('m1', 'analitica');
    expect(patch).toHaveBeenCalledWith('/api/v1/admin/merchants/m1/plan', { plan: 'analitica' });
    expect(ok.data?.plan).toBe('analitica');

    const mal = await repo.setMerchantPlan('m2', 'base');
    expect(mal.error?.code).toBe('MERCHANT_NOT_FOUND');
  });
});

describe('HttpQRPaymentRepository', () => {
  it('lists merchants and maps snake_case → camelCase', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ success: true, data: [rawMerchant] }) });
    const res = await new HttpQRPaymentRepository(client).getMerchants();
    expect(res.success).toBe(true);
    expect(res.data?.[0].qrCode).toBe('MRC-ABC');
    expect(res.data?.[0].cedulaType).toBe('juridica');
    expect(res.data?.[0].legalName).toBe('Soda Tica SA');
    expect(res.data?.[0].verificationStatus).toBe('verified');
    expect(res.data?.[0].commissionBps).toBe(50);
    expect(client.get).toHaveBeenCalledWith('/api/v1/qr/merchants');
  });

  it('registers a merchant with snake_case KYC body', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: rawMerchant });
    const res = await new HttpQRPaymentRepository(fakeClient({ post })).registerMerchant({
      name: 'Soda Tica', description: 'Comidas', category: 'restaurant',
      cedula: '3-101-123', cedulaType: 'juridica', legalName: 'Soda Tica SA',
    });
    expect(res.success).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/v1/qr/merchant', expect.objectContaining({
      cedula: '3-101-123', cedula_type: 'juridica', legal_name: 'Soda Tica SA',
    }));
  });

  it('creates a merchant QR code passing merchant_id and centimos amount', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'q1', type: 'merchant_fixed', amount: 100000, currency: 'CRC', note: '', qr_data: 'KP:...', single_use: false, used: false, expires_at: '' },
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ post })).createQRCode({
      type: 'merchant_fixed', amount: 1000, currency: 'CRC', singleUse: false, merchantId: 'm1',
    });
    expect(res.success).toBe(true);
    expect(res.data?.amount).toBe(1000); // centimos → colones
    expect(post).toHaveBeenCalledWith('/api/v1/qr/codes', expect.objectContaining({
      amount: 100000, merchant_id: 'm1',
    }));
  });

  it('maps payment fee from centimos in history', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'pay1', qr_code_id: 'q1', payer_id: 'u2', receiver_id: 'u1', merchant_id: 'm1', amount: 100000, fee: 500, currency: 'CRC', status: 'completed', note: '', created_at: '2026-01-01T00:00:00Z' }],
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getPaymentHistory();
    expect(res.success).toBe(true);
    expect(res.data?.[0].amount).toBe(1000);
    expect(res.data?.[0].fee).toBe(5); // 500 centimos → 5 colones
    expect(res.data?.[0].merchantId).toBe('m1');
  });

  it('admin: approves a merchant via the admin endpoint', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: rawMerchant });
    const res = await new HttpQRPaymentRepository(fakeClient({ post })).approveMerchant('m1');
    expect(res.success).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/v1/admin/merchants/m1/approve', {});
  });

  it('admin: rejects a merchant with a reason', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: { ...rawMerchant, verification_status: 'rejected', rejection_reason: 'docs' } });
    const res = await new HttpQRPaymentRepository(fakeClient({ post })).rejectMerchant('m1', 'docs');
    expect(res.success).toBe(true);
    expect(res.data?.verificationStatus).toBe('rejected');
    expect(post).toHaveBeenCalledWith('/api/v1/admin/merchants/m1/reject', { reason: 'docs' });
  });

  it('admin: sets a merchant commission via PATCH', async () => {
    const patch = vi.fn().mockResolvedValue({ success: true, data: { ...rawMerchant, commission_bps: 100 } });
    const res = await new HttpQRPaymentRepository(fakeClient({ patch })).setMerchantCommission('m1', 100);
    expect(res.success).toBe(true);
    expect(res.data?.commissionBps).toBe(100);
    expect(patch).toHaveBeenCalledWith('/api/v1/admin/merchants/m1/commission', { commission_bps: 100 });
  });

  it('maps merchantId on listed codes', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'q1', type: 'merchant_fixed', amount: 100000, currency: 'CRC', note: '', qr_data: 'KP:...', single_use: false, used: false, expires_at: '', merchant_id: 'm1' }],
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getQRCodes();
    expect(res.success).toBe(true);
    expect(res.data?.[0].merchantId).toBe('m1');
    expect(res.data?.[0].amount).toBe(1000);
  });
});
