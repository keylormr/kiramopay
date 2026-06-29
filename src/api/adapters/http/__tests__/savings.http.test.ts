import { describe, it, expect, vi } from 'vitest';
import { HttpSavingsRepository } from '../savings.http';
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

const rawGoal = {
  id: 'g1', name: 'Casa', target_minor: 10000000, saved_minor: 250000,
  currency: 'CRC', icon: 'home', color: '#3b82f6', created_at: '2026-01-01T00:00:00Z',
};

describe('HttpSavingsRepository', () => {
  it('lists goals and maps centimos to major units', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: [rawGoal] });
    const res = await new HttpSavingsRepository(fakeClient({ get })).getGoals();
    expect(res.success).toBe(true);
    expect(res.data?.[0].target).toBe(100000);
    expect(res.data?.[0].saved).toBe(2500);
    expect(res.data?.[0].icon).toBe('home');
    expect(get).toHaveBeenCalledWith('/api/v1/savings/goals');
  });

  it('creates a goal sending target in centimos', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: rawGoal });
    const res = await new HttpSavingsRepository(fakeClient({ post })).createGoal({ name: 'Casa', target: 100000, icon: 'home' });
    expect(res.success).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/v1/savings/goals', expect.objectContaining({
      name: 'Casa', target_minor: 10000000, icon: 'home',
    }));
  });

  it('deposits sending amount in centimos and maps the result', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: { ...rawGoal, saved_minor: 500000 } });
    const res = await new HttpSavingsRepository(fakeClient({ post })).deposit('g1', 2500);
    expect(res.data?.saved).toBe(5000);
    expect(post).toHaveBeenCalledWith('/api/v1/savings/goals/g1/deposit', { amount_minor: 250000 });
  });

  it('withdraws via the withdraw endpoint', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: rawGoal });
    await new HttpSavingsRepository(fakeClient({ post })).withdraw('g1', 1000);
    expect(post).toHaveBeenCalledWith('/api/v1/savings/goals/g1/withdraw', { amount_minor: 100000 });
  });

  it('deletes a goal', async () => {
    const del = vi.fn().mockResolvedValue({ success: true, data: { status: 'deleted' } });
    const res = await new HttpSavingsRepository(fakeClient({ del })).deleteGoal('g1');
    expect(res.success).toBe(true);
    expect(del).toHaveBeenCalledWith('/api/v1/savings/goals/g1');
  });
});
