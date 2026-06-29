export interface MarketplacePartner {
  id: string;
  code: string;
  name: string;
  category: 'transport' | 'food' | 'supermarket' | 'entertainment' | 'shopping';
  logo: string;
  color: string;
  description: string;
  isConnected?: boolean;
}

export interface RideRequest {
  id: string;
  partnerId: string;
  pickup: string;
  destination: string;
  estimatedPrice: number;
  estimatedTime: string;
  distance: string;
  status: 'searching' | 'confirmed' | 'arriving' | 'in_progress' | 'completed';
  driver?: {
    name: string;
    rating: number;
    car: string;
    plate: string;
    photo: string;
  };
}

export interface FoodOrder {
  id: string;
  partnerId: string;
  restaurantName: string;
  items: { name: string; quantity: number; price: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: 'preparing' | 'ready' | 'on_the_way' | 'delivered' | 'cancelled';
  estimatedDelivery: string;
  minutesRemaining?: number;
  courier?: { name: string; vehicle: string; plate: string };
}
