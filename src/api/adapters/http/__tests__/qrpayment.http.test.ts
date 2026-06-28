import { describe, it, expect, vi } from 'vitest';
import { HttpQRPaymentRepository } from '../qrpayment.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
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
});
