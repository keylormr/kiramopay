import type { ApiResponse } from '../types';
import type { MarketplacePartner, RideRequest, FoodOrder } from '@/types';

export interface MarketplacePartnersResponse {
  partners: MarketplacePartner[];
  connected: string[];
}

export interface CreateRideRequest {
  partnerCode: string;
  pickup: string;
  destination: string;
}

export interface CreateFoodOrderRequest {
  partnerCode: string;
  restaurantName: string;
  items: { name: string; quantity: number; price: number }[];
}

export interface IMarketplaceRepository {
  getPartners(): Promise<ApiResponse<MarketplacePartnersResponse>>;
  connectPartner(partnerCode: string): Promise<ApiResponse<void>>;
  disconnectPartner(partnerCode: string): Promise<ApiResponse<void>>;
  createRide(request: CreateRideRequest): Promise<ApiResponse<RideRequest>>;
  confirmRide(rideId: string): Promise<ApiResponse<RideRequest>>;
  listRides(): Promise<ApiResponse<RideRequest[]>>;
  getRide(rideId: string): Promise<ApiResponse<RideRequest>>;
  createFoodOrder(request: CreateFoodOrderRequest): Promise<ApiResponse<FoodOrder>>;
  listFoodOrders(): Promise<ApiResponse<FoodOrder[]>>;
  getFoodOrder(orderId: string): Promise<ApiResponse<FoodOrder>>;
}
