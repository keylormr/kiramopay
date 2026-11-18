import { describe, it, expect, vi } from 'vitest';
import { HttpQRPaymentRepository } from '../qrpayment.http';
import type { HttpClient } from '../client';

// El cobro con Lightning por HTTP: los campos del servidor en snake_case se
// leen con sus unidades (centimos a unidades mayores) y un rechazo conserva
// su codigo, que es lo que la pantalla traduce.
function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides } as unknown as HttpClient;
}

const facturaDTO = {
  id: 'f1', charge_id: 'ch1', invoice: 'lnbc125u1p', payment_hash: 'ab', sats: 12_500, fiat_amount: 500_000,
  currency: 'CRC', btc_price: '40000000.5', quote_expires_at: '2026-11-18T15:10:00Z',
  invoice_expires_at: '2026-11-18T16:00:00Z', status: 'pending', paid_at: null, created_at: '2026-11-18T15:00:00Z',
};

describe('HttpQRPaymentRepository: cobro con Lightning', () => {
  it('pide la factura del cobro y la lee en unidades mayores', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: facturaDTO });
    const repo = new HttpQRPaymentRepository(fakeClient({ post }));
    const res = await repo.createChargeLightning('ch1');
    expect(post).toHaveBeenCalledWith('/api/v1/qr/charges/ch1/lightning');
    expect(res.data).toEqual({
      id: 'f1', chargeId: 'ch1', invoice: 'lnbc125u1p', paymentHash: 'ab', sats: 12_500, monto: 5000, currency: 'CRC',
      precioBtc: '40000000.5', cotizacionVence: '2026-11-18T15:10:00Z', facturaVence: '2026-11-18T16:00:00Z',
      status: 'pending', paidAt: undefined, createdAt: '2026-11-18T15:00:00Z',
    });
  });

  it('un rechazo conserva su codigo', async () => {
    const post = vi.fn().mockResolvedValue({ success: false, error: { code: 'LIGHTNING_NO_ADDRESS', message: 'x' } });
    const res = await new HttpQRPaymentRepository(fakeClient({ post })).createChargeLightning('ch1');
    expect(res.error?.code).toBe('LIGHTNING_NO_ADDRESS');
  });

  it('el cobro trae como se pago y su ultima factura', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'ch1', qr_code_id: 'q1', created_by: 'u', amount: 500_000, currency: 'CRC', channel: 'counter',
        status: 'paid', qr_data: 'KP', expires_at: '2026-11-18T15:30:00Z', created_at: '2026-11-18T15:00:00Z',
        paid_at: '2026-11-18T15:03:00Z', paid_via: 'lightning', lightning: { ...facturaDTO, status: 'paid', paid_at: '2026-11-18T15:03:00Z' },
      },
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getCharge('ch1');
    expect(res.data?.paidVia).toBe('lightning');
    expect(res.data?.lightning).toMatchObject({ status: 'paid', paidAt: '2026-11-18T15:03:00Z', monto: 5000 });

    get.mockResolvedValue({
      success: true,
      data: { id: 'ch2', qr_code_id: 'q1', created_by: 'u', amount: 100, currency: 'CRC', channel: 'counter', status: 'paid', qr_data: 'KP', expires_at: 'x', created_at: 'x', paid_via: 'otro' },
    });
    const otro = await new HttpQRPaymentRepository(fakeClient({ get })).getCharge('ch2');
    expect(otro.data?.paidVia).toBeUndefined();
    expect(otro.data?.lightning).toBeUndefined();
  });

  it('los medios de cobro: lee, y al guardar solo manda lo que cambio', async () => {
    const dto = { lightning_enabled: true, lightning_address: 'soda@breez.tips', sinpe_movil: '', can_edit: true };
    const get = vi.fn().mockResolvedValue({ success: true, data: dto });
    const put = vi.fn().mockResolvedValue({ success: true, data: dto });
    const repo = new HttpQRPaymentRepository(fakeClient({ get, put }));

    const leidos = await repo.getPaymentMethods('m1');
    expect(get).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/payment-methods');
    expect(leidos.data).toEqual({ lightningHabilitado: true, lightningAddress: 'soda@breez.tips', sinpeMovil: undefined, puedeEditar: true });

    await repo.updatePaymentMethods('m1', { sinpeMovil: '' });
    expect(put).toHaveBeenLastCalledWith('/api/v1/qr/merchants/m1/payment-methods', { sinpe_movil: '' });
    await repo.updatePaymentMethods('m1', { lightningAddress: 'a@breez.tips', sinpeMovil: '88887777' });
    expect(put).toHaveBeenLastCalledWith('/api/v1/qr/merchants/m1/payment-methods', {
      lightning_address: 'a@breez.tips',
      sinpe_movil: '88887777',
    });
  });

  it('las ventas por Lightning del mes van con la zona de quien mira', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [{ charge_id: 'ch1', note: 'Casado', fiat_amount: 250_050, currency: 'CRC', sats: 6_000, btc_price: '40000000', payment_hash: 'ab', paid_at: '2026-11-05T18:00:00Z', charge_status: 'paid' }],
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getLightningSales('m1', '2026-11');
    expect(get).toHaveBeenCalledWith(`/api/v1/qr/merchants/m1/lightning-sales?month=2026-11&tz=${new Date().getTimezoneOffset()}`);
    expect(res.data).toEqual([
      { chargeId: 'ch1', note: 'Casado', monto: 2500.5, currency: 'CRC', sats: 6_000, precioBtc: '40000000', paymentHash: 'ab', paidAt: '2026-11-05T18:00:00Z', chargeStatus: 'paid' },
    ]);
  });
});
