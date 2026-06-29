import type {
  IMarketplaceRepository,
  MarketplacePartnersResponse,
  CreateRideRequest,
  CreateFoodOrderRequest,
} from '../../repositories/marketplace.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';
import type { MarketplacePartner, RideRequest, FoodOrder } from '@/types';

const STORAGE_KEY = 'kiramopay_app_state';

function getState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveField(field: string, value: unknown) {
  const state = getState() || {};
  state[field] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const initialPartners: MarketplacePartner[] = [
  { id: 'p-uber', code: 'uber', name: 'Uber', category: 'transport', logo: '🚗', color: '#000000', description: 'Solicita viajes y pagalos desde KiramoPay' },
  { id: 'p-didi', code: 'didi', name: 'DiDi', category: 'transport', logo: '🚕', color: '#FF6611', description: 'Viajes con tarifa competitiva' },
  { id: 'p-ubereats', code: 'ubereats', name: 'Uber Eats', category: 'food', logo: '🍔', color: '#06C167', description: 'Ordena comida a domicilio' },
  { id: 'p-rappi', code: 'rappi', name: 'Rappi', category: 'food', logo: '🛵', color: '#FF441F', description: 'Delivery de todo lo que necesites' },
  { id: 'p-automercado', code: 'automercado', name: 'Auto Mercado', category: 'supermarket', logo: '🛒', color: '#E31937', description: 'Compras de supermercado en linea' },
];

export class MockMarketplaceRepository implements IMarketplaceRepository {
  async getPartners(): Promise<ApiResponse<MarketplacePartnersResponse>> {
    const state = getState();
    const connected: string[] = state?.connectedPartners ?? [];
    const partners = initialPartners.map((p) => ({
      ...p,
      isConnected: connected.includes(p.code),
    }));
    return apiSuccess({ partners, connected });
  }

  async connectPartner(partnerCode: string): Promise<ApiResponse<void>> {
    const partner = initialPartners.find((p) => p.code === partnerCode);
    if (!partner) return apiError('NOT_FOUND', 'Partner no encontrado');
    const state = getState();
    const connected: string[] = state?.connectedPartners ?? [];
    if (!connected.includes(partnerCode)) {
      connected.push(partnerCode);
      saveField('connectedPartners', connected);
    }
    return apiSuccess(undefined as unknown as void);
  }

  async disconnectPartner(partnerCode: string): Promise<ApiResponse<void>> {
    const state = getState();
    const connected: string[] = state?.connectedPartners ?? [];
    saveField('connectedPartners', connected.filter((c) => c !== partnerCode));
    return apiSuccess(undefined as unknown as void);
  }

  async createRide(request: CreateRideRequest): Promise<ApiResponse<RideRequest>> {
    const ride: RideRequest = {
      id: `ride-${Date.now()}`,
      partnerId: request.partnerCode,
      pickup: request.pickup,
      destination: request.destination,
      estimatedPrice: Math.floor(Math.random() * 5000) + 2000,
      estimatedTime: `${Math.floor(Math.random() * 15) + 5} min`,
      distance: `${(Math.random() * 10 + 1).toFixed(1)} km`,
      status: 'searching',
    };
    const state = getState();
    const rides: RideRequest[] = state?.rides ?? [];
    rides.unshift(ride);
    saveField('rides', rides);
    return apiSuccess(ride);
  }

  async confirmRide(rideId: string): Promise<ApiResponse<RideRequest>> {
    const state = getState();
    const rides: RideRequest[] = state?.rides ?? [];
    const i = rides.findIndex((r) => r.id === rideId);
    if (i === -1) return apiError('NOT_FOUND', 'Viaje no encontrado');
    rides[i] = { ...rides[i], status: 'confirmed' };
    saveField('rides', rides);
    return apiSuccess(rides[i]);
  }

  async listRides(): Promise<ApiResponse<RideRequest[]>> {
    const state = getState();
    return apiSuccess(state?.rides ?? []);
  }

  async getRide(rideId: string): Promise<ApiResponse<RideRequest>> {
    const state = getState();
    const rides: RideRequest[] = state?.rides ?? [];
    const ride = rides.find((r) => r.id === rideId);
    if (!ride) return apiError('NOT_FOUND', 'Viaje no encontrado');
    return apiSuccess(ride);
  }

  async createFoodOrder(request: CreateFoodOrderRequest): Promise<ApiResponse<FoodOrder>> {
    const subtotal = request.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const deliveryFee = 1500;
    const order: FoodOrder = {
      id: `food-${Date.now()}`,
      partnerId: request.partnerCode,
      restaurantName: request.restaurantName,
      items: request.items,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      status: 'preparing',
      estimatedDelivery: `${Math.floor(Math.random() * 20) + 25} min`,
    };
    const state = getState();
    const orders: FoodOrder[] = state?.foodOrders ?? [];
    orders.unshift(order);
    saveField('foodOrders', orders);
    return apiSuccess(order);
  }

  async listFoodOrders(): Promise<ApiResponse<FoodOrder[]>> {
    const state = getState();
    return apiSuccess(state?.foodOrders ?? []);
  }

  async getFoodOrder(orderId: string): Promise<ApiResponse<FoodOrder>> {
    const state = getState();
    const orders: FoodOrder[] = state?.foodOrders ?? [];
    const order = orders.find((o) => o.id === orderId);
    if (!order) return apiError('NOT_FOUND', 'Orden no encontrada');
    return apiSuccess(order);
  }
}
