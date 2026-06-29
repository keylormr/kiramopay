import { describe, it, expect, vi } from 'vitest';
import { HttpMarketplaceRepository } from '../marketplace.http';
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

const rawRide = {
  id: 'r1', partner_code: 'uber', pickup: 'A', destination: 'B',
  estimated_price: 525000, estimated_time: '12 min', distance: '5.0 km', status: 'confirmed',
  driver_name: 'Carlos', driver_rating: 4.9, driver_car: 'Corolla', driver_plate: 'ABC-123',
};

describe('HttpMarketplaceRepository', () => {
  it('creates a ride and maps the server price to colones', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: { ...rawRide, status: 'searching' } });
    const res = await new HttpMarketplaceRepository(fakeClient({ post })).createRide({ partnerCode: 'uber', pickup: 'A', destination: 'B' });
    expect(res.success).toBe(true);
    expect(res.data?.estimatedPrice).toBe(5250); // centimos -> colones
    expect(post).toHaveBeenCalledWith('/api/v1/marketplace/rides', expect.objectContaining({ partner_code: 'uber' }));
  });

  it('confirms a ride via the confirm endpoint', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: rawRide });
    const res = await new HttpMarketplaceRepository(fakeClient({ post })).confirmRide('r1');
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('confirmed');
    expect(post).toHaveBeenCalledWith('/api/v1/marketplace/rides/r1/confirm', {});
  });

  it('creates a food order sending item prices in centimos', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'o1', partner_code: 'ubereats', restaurant_name: 'Soda', subtotal: 700000, delivery_fee: 150000, total: 850000, status: 'preparing', estimated_delivery: '30 min' },
    });
    const res = await new HttpMarketplaceRepository(fakeClient({ post })).createFoodOrder({
      partnerCode: 'ubereats', restaurantName: 'Soda', items: [{ name: 'Casado', quantity: 2, price: 3500 }],
    });
    expect(res.success).toBe(true);
    expect(res.data?.total).toBe(8500); // centimos -> colones
    const body = post.mock.calls[0][1] as { items: Array<{ price: number }> };
    expect(body.items[0].price).toBe(350000); // 3500 colones -> centimos
  });
});
