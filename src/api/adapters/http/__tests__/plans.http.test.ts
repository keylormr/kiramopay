import { describe, it, expect, vi } from 'vitest';
import { HttpPlansRepository, leerTarifas } from '../plans.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides } as unknown as HttpClient;
}

// La forma que publica GET /api/v1/transparency/fees (version 2.1.0).
const fees = () => ({
  version: '2.1.0',
  merchant_commission: { bps: 50, pct: 0.5 },
  entry_promotion: { bps: 25, pct: 0.25, months: 3, existing_merchants: false },
  plans: {
    chargeable_today: false,
    status: 'coming_soon',
    announced: [
      { code: 'free', price: 0, currency: 'USD', period: 'month', limits: { savings_goals_active: 3, virtual_cards_active: 1, assistant_daily_questions: 2 } },
      { code: 'plus', price: 11.99, currency: 'USD', period: 'month', limits: { savings_goals_active: 10, virtual_cards_active: 3, assistant_daily_questions: 15 } },
      { code: 'pro', price: 34.99, currency: 'USD', period: 'month', limits: { savings_goals_active: null, virtual_cards_active: 5, assistant_daily_questions: 50 } },
    ],
    not_included: ['Tarjeta fisica'],
  },
  merchant_analytics: { code: 'analitica', price: 9.99, currency: 'USD', period: 'month', chargeable_today: false },
});

describe('leerTarifas', () => {
  it('lee precios, topes, promocion y analitica; null es sin tope', () => {
    const t = leerTarifas(fees());
    expect(t.comisionBps).toBe(50);
    expect(t.promo).toEqual({ bps: 25, meses: 3 });
    expect(t.planes.plus).toEqual({ precio: 11.99, topes: { metas: 10, tarjetas: 3, asistente: 15 } });
    expect(t.planes.pro.topes.metas).toBeNull();
    expect(t.analitica).toEqual({ precio: 9.99 });
  });

  it('respeta un tope configurado distinto del decidido', () => {
    const d = fees();
    d.plans.announced[0].limits.savings_goals_active = 5;
    expect(leerTarifas(d).planes.free.topes.metas).toBe(5);
  });

  it('sin asistente configurado no publica esa fila', () => {
    const d = fees();
    for (const fila of d.plans.announced) delete (fila.limits as Record<string, unknown>).assistant_daily_questions;
    const t = leerTarifas(d);
    expect('asistente' in t.planes.free.topes).toBe(false);
  });

  it('una promocion o una analitica que el servidor no publica no se anuncian', () => {
    const d: Record<string, unknown> = fees();
    delete d.entry_promotion;
    delete d.merchant_analytics;
    const t = leerTarifas(d);
    expect(t.promo).toBeNull();
    expect(t.analitica).toBeNull();
  });
});

describe('HttpPlansRepository', () => {
  it('pide las tarifas sin sesion', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: fees() });
    const res = await new HttpPlansRepository(fakeClient({ get })).getTarifas();
    expect(res.success).toBe(true);
    expect(get).toHaveBeenCalledWith('/api/v1/transparency/fees', false);
  });

  it('un arreglo (el stub de E2E) no se toma por tarifas', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: [] });
    const res = await new HttpPlansRepository(fakeClient({ get })).getTarifas();
    expect(res.success).toBe(false);
  });

  it('anota interes en analitica y conserva PLAN_INVALID', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: { plan: 'analitica', registered_at: '2026-09-13T00:00:00Z' } })
      .mockResolvedValueOnce({ success: false, error: { code: 'PLAN_INVALID', message: 'no' } });
    const repo = new HttpPlansRepository(fakeClient({ post }));

    const ok = await repo.registrarInteres('analitica');
    expect(post).toHaveBeenCalledWith('/api/v1/plans/interest', { plan: 'analitica' });
    expect(ok.data).toEqual({ plan: 'analitica', registeredAt: '2026-09-13T00:00:00Z' });

    const mal = await repo.registrarInteres('pro');
    expect(mal.error?.code).toBe('PLAN_INVALID');
  });
});
