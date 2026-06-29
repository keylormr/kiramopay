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

const MOCK_DRIVERS = [
  { name: 'Carlos Ramírez', car: 'Toyota Corolla', plate: 'SJB-412', rating: 4.92 },
  { name: 'María Fernández', car: 'Hyundai Elantra', plate: 'BCR-738', rating: 4.88 },
  { name: 'José Mora', car: 'Nissan Sentra', plate: 'CLM-193', rating: 4.95 },
  { name: 'Ana Solís', car: 'Kia Rio', plate: 'MOT-264', rating: 4.81 },
];

// Live food-order progress mirrors backend/internal/marketplace/service.go:
// status is a deterministic function of the elapsed fraction of the ETA. Keep
// these fractions identical to the Go constants or dev and prod diverge.
const FOOD_FRAC_READY = 0.4;
const FOOD_FRAC_ON_THE_WAY = 0.75;
const FOOD_FRAC_DELIVERED = 1.0;

const MOCK_COURIERS = [
  { name: 'Diego Salas', vehicle: 'Honda CB125', plate: 'MOT-118' },
  { name: 'Karla Méndez', vehicle: 'Yamaha YBR', plate: 'MOT-204' },
  { name: 'Esteban Núñez', vehicle: 'Vespa Primavera', plate: 'MOT-377' },
  { name: 'Priscilla Vega', vehicle: 'Suzuki GN125', plate: 'MOT-461' },
];

type StoredFoodOrder = FoodOrder & { createdAt: string };

function etaMinutes(s: string): number {
  const m = s.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : 30;
  return n >= 1 ? n : 30;
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Recompute live status/ETA/courier from elapsed time (mirrors the backend).
function liveFoodOrder(o: StoredFoodOrder): FoodOrder {
  const { createdAt, ...rest } = o;
  if (o.status === 'delivered' || o.status === 'cancelled') {
    return { ...rest, minutesRemaining: 0 };
  }
  const eta = etaMinutes(o.estimatedDelivery);
  const created = createdAt ? new Date(createdAt).getTime() : Date.now();
  const elapsed = Math.max(0, (Date.now() - created) / 1000);
  const f = eta > 0 ? elapsed / (eta * 60) : 1;
  let status: FoodOrder['status'];
  if (f < FOOD_FRAC_READY) status = 'preparing';
  else if (f < FOOD_FRAC_ON_THE_WAY) status = 'ready';
  else if (f < FOOD_FRAC_DELIVERED) status = 'on_the_way';
  else status = 'delivered';
  const courier =
    status === 'on_the_way' || status === 'delivered'
      ? MOCK_COURIERS[hashId(o.id) % MOCK_COURIERS.length]
      : undefined;
  return {
    ...rest,
    status,
    minutesRemaining: status === 'delivered' ? 0 : Math.max(0, eta - Math.floor(elapsed / 60)),
    courier,
  };
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
    const driver = MOCK_DRIVERS[Math.floor(Math.random() * MOCK_DRIVERS.length)];
    const ride: RideRequest = {
      id: `ride-${Date.now()}`,
      partnerId: request.partnerCode,
      pickup: request.pickup,
      destination: request.destination,
      estimatedPrice: Math.floor(Math.random() * 5000) + 2000,
      estimatedTime: `${Math.floor(Math.random() * 15) + 5} min`,
      distance: `${(Math.random() * 10 + 1).toFixed(1)} km`,
      status: 'searching',
      driver: { ...driver, photo: '' },
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
    const estimated = Math.floor(Math.random() * 20) + 25;
    const stored: StoredFoodOrder = {
      id: `food-${Date.now()}`,
      partnerId: request.partnerCode,
      restaurantName: request.restaurantName,
      items: request.items,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      status: 'preparing',
      estimatedDelivery: `${estimated} min`,
      minutesRemaining: estimated,
      createdAt: new Date().toISOString(),
    };
    const state = getState();
    const orders: StoredFoodOrder[] = state?.foodOrders ?? [];
    orders.unshift(stored);
    saveField('foodOrders', orders);
    return apiSuccess(liveFoodOrder(stored));
  }

  async listFoodOrders(): Promise<ApiResponse<FoodOrder[]>> {
    const state = getState();
    const orders: StoredFoodOrder[] = state?.foodOrders ?? [];
    return apiSuccess(orders.map(liveFoodOrder));
  }

  async getFoodOrder(orderId: string): Promise<ApiResponse<FoodOrder>> {
    const state = getState();
    const orders: StoredFoodOrder[] = state?.foodOrders ?? [];
    const i = orders.findIndex((o) => o.id === orderId);
    if (i === -1) return apiError('NOT_FOUND', 'Orden no encontrada');
    const live = liveFoodOrder(orders[i]);
    // Persist the terminal state so later reads short-circuit (mirrors backend backfill).
    if (live.status === 'delivered' && orders[i].status !== 'delivered') {
      orders[i] = { ...orders[i], status: 'delivered', minutesRemaining: 0 };
      saveField('foodOrders', orders);
    }
    return apiSuccess(live);
  }
}
