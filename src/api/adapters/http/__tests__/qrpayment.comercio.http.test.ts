import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpQRPaymentRepository } from '../qrpayment.http';
import type { HttpClient } from '../client';

// La interfaz del comercio: el detalle de cada cobro (quien pago, sucursal,
// cajero), los movimientos por periodo, los totales de cada dia, el resumen y
// los retiros. Todo viaja con la zona horaria de quien mira (tz), igual que el
// reporte.

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), getArchivo: vi.fn(), ...overrides } as unknown as HttpClient;
}

// Costa Rica.
afterEach(() => vi.restoreAllMocks());
function enCostaRica() {
  vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(360);
}

describe('HttpQRPaymentRepository: movimientos del comercio', () => {
  it('trae quien pago, la sucursal y el cajero tal como los dio el servidor', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [{
        id: 'p1', qr_code_id: 'q1', payer_id: 'u2', receiver_id: 'u1', merchant_id: 'm1',
        location_id: 'l1', collected_by: 'u3', amount: 100000, fee: 500, currency: 'CRC',
        status: 'completed', note: '', tx_id: 'tx-1', created_at: '2026-10-29T07:00:00Z',
        payer_name: 'Ana Mora', location_name: 'Sucursal Centro', collector_name: 'Luis Rojas',
      }],
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantPayments('m1');

    expect(get).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/payments');
    expect(res.data?.[0]).toMatchObject({
      id: 'p1', amount: 1000, fee: 5, txId: 'tx-1',
      payerName: 'Ana Mora', locationName: 'Sucursal Centro', collectorName: 'Luis Rojas',
    });
  });

  it('si el servidor no manda un nombre queda sin definir, no vacio ni inventado', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'p1', qr_code_id: 'q1', payer_id: 'u2', receiver_id: 'u1', amount: 100, currency: 'CRC', status: 'completed', created_at: '2026-10-29T07:00:00Z' }],
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantPayments('m1');
    expect(res.data?.[0].payerName).toBeUndefined();
    expect(res.data?.[0].locationName).toBeUndefined();
    expect(res.data?.[0].collectorName).toBeUndefined();
  });

  it('pide un periodo con la zona horaria de la persona', async () => {
    enCostaRica();
    const get = vi.fn().mockResolvedValue({ success: true, data: [] });
    await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantPayments('m1', { periodo: 'month' });
    expect(get).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/payments?period=month&tz=360');
  });

  it('el periodo y la pagina siguiente viajan juntos', async () => {
    enCostaRica();
    const get = vi.fn().mockResolvedValue({ success: true, data: [] });
    await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantPayments('m1', { periodo: 'prev_month', antesDe: 'p9' });
    expect(get).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/payments?period=prev_month&tz=360&before=p9');
  });

  it('sin periodo, la pagina siguiente sigue como siempre', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: [] });
    await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantPayments('m1', { antesDe: 'p9' });
    expect(get).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/payments?before=p9');
  });
});

describe('HttpQRPaymentRepository: totales de cada dia', () => {
  it('pasa de centimos a unidades y conserva la moneda de cada fila', async () => {
    enCostaRica();
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [
        { date: '2026-10-29', currency: 'CRC', gross: 140000, fee: 700, net: 139300, count: 2 },
        { date: '2026-10-28', currency: 'USD', gross: 10000, fee: 50, net: 9950, count: 1 },
      ],
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantDailyTotals('m1', 'week');

    expect(get).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/payments/daily?period=week&tz=360');
    expect(res.data).toEqual([
      { date: '2026-10-29', currency: 'CRC', gross: 1400, fee: 7, net: 1393, count: 2 },
      { date: '2026-10-28', currency: 'USD', gross: 100, fee: 0.5, net: 99.5, count: 1 },
    ]);
  });

  it('un fallo conserva el codigo del servidor', async () => {
    const get = vi.fn().mockResolvedValue({ success: false, error: { code: 'INVALID_PERIOD', message: 'x' } });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantDailyTotals('m1', 'week');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_PERIOD');
  });
});

describe('HttpQRPaymentRepository: resumen por periodo', () => {
  const crudo = {
    plan: 'analitica',
    periods: [
      {
        period: 'month', from: '2026-10-01', to: '2026-10-29', previous_from: '2026-09-01', previous_to: '2026-09-29',
        currencies: [{
          currency: 'CRC', gross: 160000, fee: 800, net: 159200, count: 3,
          previous: { gross: 60000, fee: 300, net: 59700, count: 1 },
          delta: { gross: 100000, fee: 500, net: 99500, count: 2, gross_pct: 166.67, net_pct: 166.5, count_pct: 200 },
        }],
      },
      { period: 'today', from: '2026-10-29', to: '2026-10-29', currencies: [] },
    ],
  };

  it('lo pide con la zona horaria y lo convierte a unidades', async () => {
    enCostaRica();
    const get = vi.fn().mockResolvedValue({ success: true, data: crudo });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantSummary('m1');

    expect(get).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/summary?tz=360');
    expect(res.data?.plan).toBe('analitica');
    const mes = res.data!.periods[0];
    expect(mes).toMatchObject({ period: 'month', from: '2026-10-01', to: '2026-10-29', previousFrom: '2026-09-01', previousTo: '2026-09-29' });
    expect(mes.currencies[0]).toMatchObject({
      currency: 'CRC', gross: 1600, fee: 8, net: 1592, count: 3,
      previous: { gross: 600, fee: 3, net: 597, count: 1 },
      delta: { gross: 1000, fee: 5, net: 995, count: 2, grossPct: 166.67, netPct: 166.5, countPct: 200 },
    });
  });

  it('un periodo sin ventas trae la lista vacia, que es un dato; sin comparacion queda sin definir', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: crudo });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantSummary('m1');
    const hoy = res.data!.periods[1];
    expect(hoy.currencies).toEqual([]);
    expect(hoy.previousFrom).toBeUndefined();
  });

  it('un porcentaje nulo contra un periodo sin ventas se queda nulo, no se vuelve cero', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        plan: 'analitica',
        periods: [{
          period: 'today', from: '2026-10-29', to: '2026-10-29',
          currencies: [{
            currency: 'CRC', gross: 100000, fee: 500, net: 99500, count: 1,
            previous: { gross: 0, fee: 0, net: 0, count: 0 },
            delta: { gross: 100000, fee: 500, net: 99500, count: 1, gross_pct: null, net_pct: null, count_pct: null },
          }],
        }],
      },
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantSummary('m1');
    expect(res.data!.periods[0].currencies[0].delta).toMatchObject({ grossPct: null, netPct: null, countPct: null });
  });

  it('un plan que no conoce se lee como base', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: { plan: 'premium', periods: [] } });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantSummary('m1');
    expect(res.data?.plan).toBe('base');
  });

  it('un fallo no se vuelve un resumen vacio', async () => {
    const get = vi.fn().mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantSummary('m1');
    expect(res.success).toBe(false);
    expect(res.data).toBeUndefined();
  });
});

describe('HttpQRPaymentRepository: retiros del comercio', () => {
  it('pide los del periodo y los pasa a unidades', async () => {
    enCostaRica();
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'r1', amount: 50000, currency: 'CRC', status: 'completed', withdrawn_by_name: 'Keilor Martinez', created_at: '2026-10-29T14:00:00Z' }],
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchantWithdrawals('m1', 'today');

    expect(get).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/withdrawals?period=today&tz=360');
    expect(res.data).toEqual([
      { id: 'r1', amount: 500, currency: 'CRC', status: 'completed', withdrawnByName: 'Keilor Martinez', createdAt: '2026-10-29T14:00:00Z' },
    ]);
  });
});

describe('HttpQRPaymentRepository: exportar el reporte de un periodo', () => {
  it('con periodo pide ese periodo, no una cantidad de dias', async () => {
    enCostaRica();
    const getArchivo = vi.fn().mockResolvedValue({ success: true, data: { blob: new Blob(['x']), nombre: 'reporte.csv' } });
    await new HttpQRPaymentRepository(fakeClient({ getArchivo })).exportMerchantReportCsv('m1', 30, 'es', 'prev_month');
    expect(getArchivo).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/report.csv?period=prev_month&tz=360&lang=es');
  });

  it('sin periodo sigue pidiendo los dias, como el reporte', async () => {
    enCostaRica();
    const getArchivo = vi.fn().mockResolvedValue({ success: true, data: { blob: new Blob(['x']), nombre: 'reporte.csv' } });
    await new HttpQRPaymentRepository(fakeClient({ getArchivo })).exportMerchantReportCsv('m1', 30, 'es');
    expect(getArchivo).toHaveBeenCalledWith('/api/v1/qr/merchants/m1/report.csv?days=30&tz=360&lang=es');
  });
});

describe('HttpQRPaymentRepository: el dueno en la lista de comercios', () => {
  it('lee el nombre del dueno cuando el servidor lo manda', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: [{
        id: 'm1', name: 'Super La Esquina', description: '', category: 'retail', qr_code: 'MRC-1', active: true,
        role: 'cashier', owner_name: 'Keilor Martinez',
      }],
    });
    const res = await new HttpQRPaymentRepository(fakeClient({ get })).getMerchants();
    expect(res.data?.[0]).toMatchObject({ role: 'cashier', ownerName: 'Keilor Martinez' });
  });
});
