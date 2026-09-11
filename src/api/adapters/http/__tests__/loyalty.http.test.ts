import { describe, it, expect, vi } from 'vitest';
import { HttpLoyaltyRepository } from '../loyalty.http';
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

describe('HttpLoyaltyRepository.getReferrals', () => {
  it('maps the referral summary from snake_case', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      data: { referral_code: 'K7PM3XQ2', invited_count: 2, points_earned: 1000, bonus_points: 500 },
    });
    const res = await new HttpLoyaltyRepository(fakeClient({ get })).getReferrals();
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ referralCode: 'K7PM3XQ2', invitedCount: 2, pointsEarned: 1000, bonusPoints: 500 });
    expect(get).toHaveBeenCalledWith('/api/v1/loyalty/referrals');
  });

  it('rejects a body with another shape instead of returning undefined fields', async () => {
    // Un stub o un proxy que contesta con una lista no puede llegar a la vista
    // como resumen: la vista llama toLocaleString sobre los contadores.
    const get = vi.fn().mockResolvedValue({ success: true, data: [] });
    const res = await new HttpLoyaltyRepository(fakeClient({ get })).getReferrals();
    expect(res.success).toBe(false);
    expect(res.data).toBeUndefined();
  });

  it('forces the counters to numbers when they are missing', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: { referral_code: 'K7PM3XQ2' } });
    const res = await new HttpLoyaltyRepository(fakeClient({ get })).getReferrals();
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ referralCode: 'K7PM3XQ2', invitedCount: 0, pointsEarned: 0, bonusPoints: 0 });
  });

  it('propagates a failed request', async () => {
    const get = vi.fn().mockResolvedValue({ success: false, error: { code: 'UNAUTHORIZED', message: 'x' } });
    const res = await new HttpLoyaltyRepository(fakeClient({ get })).getReferrals();
    expect(res.success).toBe(false);
  });
});

// Canjear devolvia siempre REDEEM_FAILED, pisando el codigo del servidor: la
// pantalla no podia distinguir "no hay fondo de promociones" de un fallo
// cualquiera.
describe('HttpLoyaltyRepository.redeemReward', () => {
  it('conserva el codigo del servidor en un rechazo', async () => {
    const post = vi.fn().mockResolvedValue({
      success: false,
      error: { code: 'LOYALTY_SIN_FONDOS', message: 'the promotions fund cannot cover this reward' },
    });
    const res = await new HttpLoyaltyRepository(fakeClient({ post })).redeemReward('r1');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('LOYALTY_SIN_FONDOS');
  });

  it('trae lo que llego a la billetera', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'rd1', reward_id: 'r1', points: 500, status: 'completed', code: '', created_at: '', cashback_minor: 50000 },
    });
    const res = await new HttpLoyaltyRepository(fakeClient({ post })).redeemReward('r1');
    expect(res.data?.cashbackMinor).toBe(50000);
  });
});
