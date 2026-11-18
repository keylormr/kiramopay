import { describe, it, expect, beforeEach } from 'vitest';
import { MockQRPaymentRepository } from '../qrpayment.mock';
import type { QRCharge } from '../../../repositories/qrpayment.repository';

// La demo del cobro con Lightning: guarda los medios del comercio, da una
// factura que ninguna billetera paga y nunca marca un cobro pagado por
// Lightning, porque nadie recibio nada.
const cobro = (p: Partial<QRCharge> = {}): QRCharge => ({
  id: 'ch1', qrCodeId: 'q1', merchantId: 'm1', createdBy: 'u', amount: 5000, currency: 'CRC',
  channel: 'counter', status: 'pending', qrData: '{}', createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), ...p,
});

function estado(extra: Record<string, unknown> = {}) {
  localStorage.setItem(
    'kiramopay_app_state',
    JSON.stringify({
      qrMerchants: [
        { id: 'm1', name: 'Soda', role: 'owner' },
        { id: 'm2', name: 'Ajeno', role: 'cashier' },
      ],
      qrCharges: [cobro(), cobro({ id: 'ch2', status: 'cancelled' }), cobro({ id: 'ch3', merchantId: undefined })],
      ...extra,
    }),
  );
}

describe('medios de cobro en la demo', () => {
  beforeEach(() => {
    localStorage.clear();
    estado();
  });

  it('el dueno los guarda normalizados; un campo vacio los quita', async () => {
    const repo = new MockQRPaymentRepository();
    const vacio = await repo.getPaymentMethods('m1');
    expect(vacio.data).toEqual({ lightningHabilitado: true, lightningAddress: undefined, sinpeMovil: undefined, puedeEditar: true });

    const res = await repo.updatePaymentMethods('m1', { lightningAddress: ' Soda@Breez.Tips ', sinpeMovil: '+506 8888-7777' });
    expect(res.data).toMatchObject({ lightningAddress: 'soda@breez.tips', sinpeMovil: '88887777' });

    // Solo cambia lo que viaja.
    const solo = await repo.updatePaymentMethods('m1', { sinpeMovil: '' });
    expect(solo.data).toMatchObject({ lightningAddress: 'soda@breez.tips', sinpeMovil: undefined });
  });

  it('rechaza un numero fijo, una direccion sin forma y un dominio fuera de la lista', async () => {
    const repo = new MockQRPaymentRepository();
    expect((await repo.updatePaymentMethods('m1', { sinpeMovil: '2222-2222' })).error?.code).toBe('SINPE_MOVIL_INVALID');
    expect((await repo.updatePaymentMethods('m1', { lightningAddress: 'soda' })).error?.code).toBe('LIGHTNING_ADDRESS_INVALID');
    expect((await repo.updatePaymentMethods('m1', { lightningAddress: 'soda@otro.com' })).error?.code).toBe('LIGHTNING_ADDRESS_INVALID');
    expect((await repo.getPaymentMethods('m1')).data?.lightningAddress).toBeUndefined();
  });

  it('un cajero los lee pero no los cambia; un comercio ajeno no existe', async () => {
    const repo = new MockQRPaymentRepository();
    expect((await repo.getPaymentMethods('m2')).data?.puedeEditar).toBe(false);
    expect((await repo.updatePaymentMethods('m2', { sinpeMovil: '88887777' })).error?.code).toBe('MERCHANT_NOT_FOUND');
    expect((await repo.getPaymentMethods('nadie')).error?.code).toBe('MERCHANT_NOT_FOUND');
  });
});

describe('la factura Lightning en la demo', () => {
  beforeEach(() => {
    localStorage.clear();
    estado({ qrPaymentMethods: { m1: { lightningAddress: 'soda@breez.tips' } } });
  });

  it('cotiza con el precio de la demo, la vuelve a dar mientras vale y la pega al cobro', async () => {
    const repo = new MockQRPaymentRepository();
    const res = await repo.createChargeLightning('ch1');
    expect(res.success).toBe(true);
    const f = res.data!;
    // 5.000 colones a 42.850 USD x 526,50: techo(500000 x 1e6 / 22560525).
    expect(f.sats).toBe(Math.ceil((500_000 * 1_000_000) / (42_850 * 526.5)));
    expect(f.sats).toBe(22_163);
    expect(f.status).toBe('pending');
    expect(f.invoice.startsWith('lnbc')).toBe(true);
    const plazo = Date.parse(f.cotizacionVence) - Date.now();
    expect(plazo).toBeGreaterThan(9 * 60_000);
    expect(plazo).toBeLessThanOrEqual(10 * 60_000);

    expect((await repo.createChargeLightning('ch1')).data?.id).toBe(f.id);
    const leido = await repo.getCharge('ch1');
    expect(leido.data?.lightning?.id).toBe(f.id);
    // Nunca pagado: la demo no recibe nada.
    expect(leido.data?.status).toBe('pending');
    expect(leido.data?.paidVia).toBeUndefined();
  });

  it('sin direccion, sobre un cobro que no esta pendiente o que no es de un comercio, no da factura', async () => {
    const repo = new MockQRPaymentRepository();
    expect((await repo.createChargeLightning('ch2')).error?.code).toBe('COBRO_CANCELADO');
    expect((await repo.createChargeLightning('ch3')).error?.code).toBe('LIGHTNING_UNAVAILABLE');
    expect((await repo.createChargeLightning('no-existe')).error?.code).toBe('QR_INVALIDO');
    localStorage.clear();
    estado();
    expect((await repo.createChargeLightning('ch1')).error?.code).toBe('LIGHTNING_NO_ADDRESS');
  });

  it('las ventas por Lightning de la demo estan vacias y el mes se valida', async () => {
    const repo = new MockQRPaymentRepository();
    expect((await repo.getLightningSales('m1', '2026-11')).data).toEqual([]);
    expect((await repo.getLightningSales('m1', '2026-13')).error?.code).toBe('INVALID_MONTH');
    expect((await repo.getLightningSales('m2', '2026-11')).error?.code).toBe('MERCHANT_NOT_FOUND');
  });
});
