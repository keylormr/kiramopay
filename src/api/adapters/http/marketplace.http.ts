import type {
  IMarketplaceRepository,
  MarketplacePartnersResponse,
  CreateRideRequest,
  CreateFoodOrderRequest,
} from '../../repositories/marketplace.repository';
import type { ApiResponse } from '../../types';
import type { MarketplacePartner, RideRequest, FoodOrder } from '@/types';
import { apiSuccess, apiError } from '../../types';
import { HttpClient } from './client';

export class HttpMarketplaceRepository implements IMarketplaceRepository {
  constructor(private client: HttpClient) {}

  async getPartners(): Promise<ApiResponse<MarketplacePartnersResponse>> {
    const res = await this.client.get<{
      partners: Array<{
        id: string;
        code: string;
        name: string;
        category: string;
        logo: string;
        color: string;
        description: string;
      }>;
      connected: string[];
    }>('/api/v1/marketplace/partners');

    if (!res.success || !res.data) {
      return apiError('FETCH_FAILED', 'Failed to fetch partners');
    }

    const partners: MarketplacePartner[] = res.data.partners.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      category: p.category as MarketplacePartner['category'],
      logo: p.logo,
      color: p.color,
      description: p.description,
      isConnected: res.data!.connected.includes(p.code),
    }));

    return apiSuccess({ partners, connected: res.data.connected });
  }

  async connectPartner(partnerCode: string): Promise<ApiResponse<void>> {
    const res = await this.client.post('/api/v1/marketplace/connect', { partner_code: partnerCode });
    if (!res.success) return apiError('CONNECT_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  async disconnectPartner(partnerCode: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/marketplace/connect/${partnerCode}`);
    if (!res.success) return apiError('DISCONNECT_FAILED', res.error?.message || 'Failed');
    return apiSuccess(undefined as unknown as void);
  }

  async createRide(request: CreateRideRequest): Promise<ApiResponse<RideRequest>> {
    const res = await this.client.post<{
      id: string; partner_code: string; pickup: string; destination: string;
      estimated_price: number; estimated_time: string; distance: string; status: string;
      driver_name: string; driver_rating: number; driver_car: string; driver_plate: string;
    }>('/api/v1/marketplace/rides', {
      partner_code: request.partnerCode,
      pickup: request.pickup,
      destination: request.destination,
    });

    if (!res.success || !res.data) return apiError('RIDE_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      id: res.data.id,
      partnerId: res.data.partner_code,
      pickup: res.data.pickup,
      destination: res.data.destination,
      estimatedPrice: res.data.estimated_price / 100,
      estimatedTime: res.data.estimated_time,
      distance: res.data.distance,
      status: res.data.status as RideRequest['status'],
      driver: res.data.driver_name ? {
        name: res.data.driver_name,
        rating: res.data.driver_rating,
        car: res.data.driver_car,
        plate: res.data.driver_plate,
        photo: '',
      } : undefined,
    });
  }

  async confirmRide(rideId: string): Promise<ApiResponse<RideRequest>> {
    const res = await this.client.post<{
      id: string; partner_code: string; pickup: string; destination: string;
      estimated_price: number; estimated_time: string; distance: string; status: string;
      driver_name: string; driver_rating: number; driver_car: string; driver_plate: string;
    }>(`/api/v1/marketplace/rides/${rideId}/confirm`, {});

    if (!res.success || !res.data) return apiError('CONFIRM_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      id: res.data.id,
      partnerId: res.data.partner_code,
      pickup: res.data.pickup,
      destination: res.data.destination,
      estimatedPrice: res.data.estimated_price / 100,
      estimatedTime: res.data.estimated_time,
      distance: res.data.distance,
      status: res.data.status as RideRequest['status'],
      driver: res.data.driver_name ? {
        name: res.data.driver_name,
        rating: res.data.driver_rating,
        car: res.data.driver_car,
        plate: res.data.driver_plate,
        photo: '',
      } : undefined,
    });
  }

  async listRides(): Promise<ApiResponse<RideRequest[]>> {
    const res = await this.client.get<Array<{
      id: string; partner_code: string; pickup: string; destination: string;
      estimated_price: number; estimated_time: string; distance: string; status: string;
      driver_name: string; driver_rating: number; driver_car: string; driver_plate: string;
    }>>('/api/v1/marketplace/rides');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch rides');

    return apiSuccess(res.data.map((r) => ({
      id: r.id,
      partnerId: r.partner_code,
      pickup: r.pickup,
      destination: r.destination,
      estimatedPrice: r.estimated_price / 100,
      estimatedTime: r.estimated_time,
      distance: r.distance,
      status: r.status as RideRequest['status'],
      driver: r.driver_name ? {
        name: r.driver_name,
        rating: r.driver_rating,
        car: r.driver_car,
        plate: r.driver_plate,
        photo: '',
      } : undefined,
    })));
  }

  async getRide(rideId: string): Promise<ApiResponse<RideRequest>> {
    const res = await this.client.get<{
      id: string; partner_code: string; pickup: string; destination: string;
      estimated_price: number; estimated_time: string; distance: string; status: string;
      driver_name: string; driver_rating: number; driver_car: string; driver_plate: string;
    }>(`/api/v1/marketplace/rides/${rideId}`);

    if (!res.success || !res.data) return apiError('NOT_FOUND', 'Ride not found');

    return apiSuccess({
      id: res.data.id,
      partnerId: res.data.partner_code,
      pickup: res.data.pickup,
      destination: res.data.destination,
      estimatedPrice: res.data.estimated_price / 100,
      estimatedTime: res.data.estimated_time,
      distance: res.data.distance,
      status: res.data.status as RideRequest['status'],
      driver: res.data.driver_name ? {
        name: res.data.driver_name,
        rating: res.data.driver_rating,
        car: res.data.driver_car,
        plate: res.data.driver_plate,
        photo: '',
      } : undefined,
    });
  }

  async createFoodOrder(request: CreateFoodOrderRequest): Promise<ApiResponse<FoodOrder>> {
    const res = await this.client.post<{
      id: string; partner_code: string; restaurant_name: string;
      subtotal: number; delivery_fee: number; total: number;
      status: string; estimated_delivery: string; minutes_remaining: number;
    }>('/api/v1/marketplace/food-orders', {
      partner_code: request.partnerCode,
      restaurant_name: request.restaurantName,
      items: request.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price * 100 })),
    });

    if (!res.success || !res.data) return apiError('ORDER_FAILED', res.error?.message || 'Failed');

    return apiSuccess({
      id: res.data.id,
      partnerId: res.data.partner_code,
      restaurantName: res.data.restaurant_name,
      items: request.items,
      subtotal: res.data.subtotal / 100,
      deliveryFee: res.data.delivery_fee / 100,
      total: res.data.total / 100,
      status: res.data.status as FoodOrder['status'],
      estimatedDelivery: res.data.estimated_delivery,
      minutesRemaining: res.data.minutes_remaining,
    });
  }

  async listFoodOrders(): Promise<ApiResponse<FoodOrder[]>> {
    const res = await this.client.get<Array<{
      id: string; partner_code: string; restaurant_name: string;
      subtotal: number; delivery_fee: number; total: number;
      status: string; estimated_delivery: string; minutes_remaining: number;
    }>>('/api/v1/marketplace/food-orders');

    if (!res.success || !res.data) return apiError('FETCH_FAILED', 'Failed to fetch orders');

    return apiSuccess(res.data.map((o) => ({
      id: o.id,
      partnerId: o.partner_code,
      restaurantName: o.restaurant_name,
      items: [],
      subtotal: o.subtotal / 100,
      deliveryFee: o.delivery_fee / 100,
      total: o.total / 100,
      status: o.status as FoodOrder['status'],
      estimatedDelivery: o.estimated_delivery,
      minutesRemaining: o.minutes_remaining,
    })));
  }

  async getFoodOrder(orderId: string): Promise<ApiResponse<FoodOrder>> {
    const res = await this.client.get<{
      order: {
        id: string; partner_code: string; restaurant_name: string;
        subtotal: number; delivery_fee: number; total: number;
        status: string; estimated_delivery: string; minutes_remaining: number;
        courier?: { name: string; vehicle: string; plate: string };
      };
      items: Array<{ name: string; quantity: number; price: number }>;
    }>(`/api/v1/marketplace/food-orders/${orderId}`);

    if (!res.success || !res.data) return apiError('NOT_FOUND', 'Order not found');

    return apiSuccess({
      id: res.data.order.id,
      partnerId: res.data.order.partner_code,
      restaurantName: res.data.order.restaurant_name,
      items: res.data.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price / 100 })),
      subtotal: res.data.order.subtotal / 100,
      deliveryFee: res.data.order.delivery_fee / 100,
      total: res.data.order.total / 100,
      status: res.data.order.status as FoodOrder['status'],
      estimatedDelivery: res.data.order.estimated_delivery,
      minutesRemaining: res.data.order.minutes_remaining,
      courier: res.data.order.courier,
    });
  }
}
