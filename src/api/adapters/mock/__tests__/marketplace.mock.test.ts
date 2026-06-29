import { describe, it, expect, beforeEach } from 'vitest';
import { MockMarketplaceRepository } from '../marketplace.mock';

const KEY = 'kiramopay_app_state';

// Rewrites the stored order's createdAt so `msAgo` of its ETA appears elapsed.
function backdate(id: string, msAgo: number) {
  const state = JSON.parse(localStorage.getItem(KEY) || '{}') as {
    foodOrders: Array<{ id: string; createdAt: string }>;
  };
  const o = state.foodOrders.find((x) => x.id === id);
  if (o) o.createdAt = new Date(Date.now() - msAgo).toISOString();
  localStorage.setItem(KEY, JSON.stringify(state));
}

describe('MockMarketplaceRepository food order tracking', () => {
  beforeEach(() => localStorage.clear());

  it('progresses preparing -> ready -> on_the_way -> delivered from elapsed time', async () => {
    const repo = new MockMarketplaceRepository();
    const created = await repo.createFoodOrder({
      partnerCode: 'ubereats',
      restaurantName: 'Soda',
      items: [{ name: 'Casado', quantity: 1, price: 3500 }],
    });
    expect(created.success).toBe(true);
    const id = created.data!.id;
    expect(created.data!.status).toBe('preparing');

    const etaMs = parseInt(created.data!.estimatedDelivery, 10) * 60 * 1000;

    backdate(id, etaMs * 0.1);
    expect((await repo.getFoodOrder(id)).data!.status).toBe('preparing');

    backdate(id, etaMs * 0.5);
    let r = await repo.getFoodOrder(id);
    expect(r.data!.status).toBe('ready');
    expect(r.data!.courier).toBeUndefined(); // courier hidden before on_the_way

    backdate(id, etaMs * 0.8);
    r = await repo.getFoodOrder(id);
    expect(r.data!.status).toBe('on_the_way');
    expect(r.data!.courier?.name).toBeTruthy();

    backdate(id, etaMs * 1.2);
    expect((await repo.getFoodOrder(id)).data!.status).toBe('delivered');

    // Terminal state is persisted: even reset to "just created", it stays delivered.
    backdate(id, 0);
    expect((await repo.getFoodOrder(id)).data!.status).toBe('delivered');
  });

  it('keeps the courier stable across reads for the same order', async () => {
    const repo = new MockMarketplaceRepository();
    const created = await repo.createFoodOrder({
      partnerCode: 'ubereats',
      restaurantName: 'Soda',
      items: [{ name: 'Casado', quantity: 1, price: 3500 }],
    });
    const id = created.data!.id;
    const etaMs = parseInt(created.data!.estimatedDelivery, 10) * 60 * 1000;
    backdate(id, etaMs * 0.8);
    const a = (await repo.getFoodOrder(id)).data!.courier;
    const b = (await repo.getFoodOrder(id)).data!.courier;
    expect(a).toEqual(b);
  });
});
