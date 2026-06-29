import React, { useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { Icons } from '../../components/Icons';
import { BottomSheet } from '../../components/BottomSheet';
import { getApiLayer } from '@/api';
import { refreshAccounts } from '@/services/dataSync';
import type { RideRequest, Transaction } from '@/types';

const hasBackend = !!import.meta.env.VITE_API_URL;

// Partners del marketplace
const MARKETPLACE_PARTNERS = {
  transport: [
    {
      id: 'uber',
      name: 'Uber',
      logo: '🚗',
      color: 'from-black to-gray-800',
      description: 'Viajes seguros y confiables',
      category: 'transport' as const,
    },
    {
      id: 'didi',
      name: 'DiDi',
      logo: '🟠',
      color: 'from-orange-500 to-orange-600',
      description: 'Tu viaje, tu precio',
      category: 'transport' as const,
    },
    {
      id: 'indriver',
      name: 'InDriver',
      logo: '🟢',
      color: 'from-green-500 to-green-600',
      description: 'Negocia tu tarifa',
      category: 'transport' as const,
    },
  ],
  food: [
    {
      id: 'ubereats',
      name: 'Uber Eats',
      logo: '🍔',
      color: 'from-green-600 to-green-700',
      description: 'Tu comida favorita a domicilio',
      category: 'food' as const,
    },
    {
      id: 'pedidosya',
      name: 'PedidosYa',
      logo: '🛵',
      color: 'from-red-500 to-red-600',
      description: 'Pide lo que quieras',
      category: 'food' as const,
    },
    {
      id: 'rappi',
      name: 'Rappi',
      logo: '📦',
      color: 'from-orange-500 to-red-500',
      description: 'Todo a tu puerta',
      category: 'food' as const,
    },
  ],
  supermarket: [
    {
      id: 'automercado',
      name: 'Auto Mercado',
      logo: '🛒',
      color: 'from-red-600 to-red-700',
      description: 'Supermercado premium',
      category: 'supermarket' as const,
    },
    {
      id: 'walmart',
      name: 'Walmart',
      logo: '🏪',
      color: 'from-blue-600 to-blue-700',
      description: 'Precios bajos siempre',
      category: 'supermarket' as const,
    },
    {
      id: 'masxmenos',
      name: 'Mas x Menos',
      logo: '🛍️',
      color: 'from-yellow-500 to-yellow-600',
      description: 'Tu súper de confianza',
      category: 'supermarket' as const,
    },
    {
      id: 'pricesmart',
      name: 'PriceSmart',
      logo: '📦',
      color: 'from-blue-700 to-blue-800',
      description: 'Compras al mayoreo',
      category: 'supermarket' as const,
    },
  ],
  entertainment: [
    {
      id: 'cinemark',
      name: 'Cinemark',
      logo: '🎬',
      color: 'from-purple-600 to-purple-700',
      description: 'La mejor experiencia de cine',
      category: 'entertainment' as const,
    },
    {
      id: 'novacinemas',
      name: 'Nova Cinemas',
      logo: '🍿',
      color: 'from-red-600 to-pink-600',
      description: 'Cine de calidad',
      category: 'entertainment' as const,
    },
  ],
};

// Restaurantes para demo de Uber Eats
const DEMO_RESTAURANTS = [
  { id: '1', name: 'McDonalds', logo: '🍟', rating: 4.5, time: '15-25 min', deliveryFee: 1500 },
  { id: '2', name: 'Taco Bell', logo: '🌮', rating: 4.3, time: '20-30 min', deliveryFee: 1200 },
  { id: '3', name: 'Pizza Hut', logo: '🍕', rating: 4.4, time: '25-35 min', deliveryFee: 1800 },
  { id: '4', name: 'KFC', logo: '🍗', rating: 4.2, time: '20-30 min', deliveryFee: 1500 },
  { id: '5', name: 'Subway', logo: '🥪', rating: 4.6, time: '15-20 min', deliveryFee: 1000 },
  { id: '6', name: 'Sushi Express', logo: '🍱', rating: 4.7, time: '30-40 min', deliveryFee: 2000 },
];

export const MarketplaceView: React.FC = () => {
  const { state, dispatch } = useApp();
  const [activeCategory, setActiveCategory] = useState<'all' | 'transport' | 'food' | 'supermarket' | 'entertainment'>('all');
  const [showPartnerSheet, setShowPartnerSheet] = useState(false);
  const [showRideSheet, setShowRideSheet] = useState(false);
  const [showFoodSheet, setShowFoodSheet] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<{
    id: string;
    name: string;
    logo: string;
    color: string;
    description: string;
    category: 'transport' | 'food' | 'supermarket' | 'entertainment';
  } | null>(null);

  // Ride states
  const [rideStep, setRideStep] = useState<'location' | 'searching' | 'found' | 'arriving'>('location');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [activeRide, setActiveRide] = useState<RideRequest | null>(null);

  // In http mode the backend moves the money and we refresh; in mock mode the
  // view mirrors the wallet debit locally (there is no backend ledger).
  const localDebit = (amount: number, label: string) => {
    const acct = state.accounts.find((a) => a.ccy === (state.baseCurrency || 'CRC')) || state.accounts[0];
    if (!acct) return;
    const tx: Transaction = {
      id: Date.now().toString(),
      title: label,
      amount: -amount,
      ccy: acct.ccy,
      date: new Date().toLocaleDateString(),
      type: 'debit',
      category: 'Marketplace',
      status: 'completed',
    };
    dispatch({ type: 'ADD_TRANSACTION', payload: tx });
  };

  // Food states
  const [selectedRestaurant, setSelectedRestaurant] = useState<typeof DEMO_RESTAURANTS[0] | null>(null);
  const [cartItems, setCartItems] = useState<{ name: string; price: number; qty: number }[]>([]);
  const [orderStep, setOrderStep] = useState<'menu' | 'cart' | 'confirm' | 'tracking'>('menu');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' }).format(amount);
  };

  const isConnected = (partnerId: string) => state.connectedPartners.includes(partnerId);

  const handleConnectPartner = (partnerId: string) => {
    dispatch({ type: 'CONNECT_PARTNER', payload: partnerId });
  };

  const handleSelectPartner = (partner: typeof allPartners[number]) => {
    setSelectedPartner(partner);

    if (partner.category === 'transport') {
      if (isConnected(partner.id)) {
        setShowRideSheet(true);
        setRideStep('location');
      } else {
        setShowPartnerSheet(true);
      }
    } else if (partner.category === 'food') {
      if (isConnected(partner.id)) {
        setShowFoodSheet(true);
        setOrderStep('menu');
        setCartItems([]);
        setSelectedRestaurant(null);
      } else {
        setShowPartnerSheet(true);
      }
    } else {
      setShowPartnerSheet(true);
    }
  };

  const handleRequestRide = async () => {
    if (!pickup || !destination || !selectedPartner) return;
    setRideStep('searching');
    const api = getApiLayer();
    if (api.marketplace) {
      const res = await api.marketplace.createRide({ partnerCode: selectedPartner.id, pickup, destination });
      if (res.success && res.data) setActiveRide(res.data);
    }
    setRideStep('found');
  };

  const handleConfirmRide = async () => {
    const api = getApiLayer();
    if (api.marketplace && activeRide) {
      const res = await api.marketplace.confirmRide(activeRide.id);
      if (res.success) {
        if (hasBackend) refreshAccounts().catch(() => {});
        else localDebit(activeRide.estimatedPrice, `${selectedPartner?.name || 'Viaje'}`);
      }
    }
    setRideStep('arriving');
    setTimeout(() => {
      setShowRideSheet(false);
      setRideStep('location');
      setPickup('');
      setDestination('');
      setActiveRide(null);
    }, 5000);
  };

  const handlePlaceOrder = async () => {
    if (!selectedRestaurant || !selectedPartner || cartItems.length === 0) return;
    const api = getApiLayer();
    if (api.marketplace) {
      const res = await api.marketplace.createFoodOrder({
        partnerCode: selectedPartner.id,
        restaurantName: selectedRestaurant.name,
        items: cartItems.map((i) => ({ name: i.name, quantity: i.qty, price: i.price })),
      });
      if (res.success) {
        if (hasBackend) refreshAccounts().catch(() => {});
        else localDebit(cartTotal + deliveryFee, `${selectedRestaurant.name}`);
      }
    }
    setOrderStep('confirm');
  };

  const addToCart = (item: { name: string; price: number }) => {
    const existing = cartItems.find(i => i.name === item.name);
    if (existing) {
      setCartItems(cartItems.map(i =>
        i.name === item.name ? { ...i, qty: i.qty + 1 } : i
      ));
    } else {
      setCartItems([...cartItems, { ...item, qty: 1 }]);
    }
  };

  const cartTotal = cartItems.reduce((acc, item) => acc + (item.price * item.qty), 0);
  const deliveryFee = selectedRestaurant?.deliveryFee || 0;

  const allPartners: Array<{
    id: string;
    name: string;
    logo: string;
    color: string;
    description: string;
    category: 'transport' | 'food' | 'supermarket' | 'entertainment';
  }> = [
    ...MARKETPLACE_PARTNERS.transport,
    ...MARKETPLACE_PARTNERS.food,
    ...MARKETPLACE_PARTNERS.supermarket,
    ...MARKETPLACE_PARTNERS.entertainment,
  ];

  const filteredPartners = activeCategory === 'all'
    ? allPartners
    : allPartners.filter(p => p.category === activeCategory);

  const categories = [
    { id: 'all', label: 'Todo', icon: '🏠' },
    { id: 'transport', label: 'Transporte', icon: '🚗' },
    { id: 'food', label: 'Comida', icon: '🍔' },
    { id: 'supermarket', label: 'Super', icon: '🛒' },
    { id: 'entertainment', label: 'Cine', icon: '🎬' },
  ];

  return (
    <div className="pb-24 pt-4 space-y-6 px-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black uv-text-primary mb-1">
          Marketplace
        </h1>
        <p className="uv-text-muted">Paga con KiramoPay en tus apps favoritas</p>
      </div>

      {/* Categories */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id as typeof activeCategory)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full whitespace-nowrap text-sm font-medium transition-all ${
              activeCategory === cat.id
                ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'
                : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-secondary'
            }`}
          >
            <span>{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Connected Apps */}
      {state.connectedPartners.length > 0 && (
        <div>
          <h3 className="text-sm font-bold uv-text-muted uppercase mb-3">
            Apps conectadas
          </h3>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
            {state.connectedPartners.map((partnerId) => {
              const partner = allPartners.find(p => p.id === partnerId);
              if (!partner) return null;
              return (
                <button
                  key={partnerId}
                  onClick={() => handleSelectPartner(partner)}
                  className="flex flex-col items-center gap-2"
                >
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${partner.color} flex items-center justify-center text-3xl shadow-lg`}>
                    {partner.logo}
                  </div>
                  <span className="text-xs font-medium uv-text-secondary">
                    {partner.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Partners Grid */}
      <div>
        <h3 className="text-sm font-bold uv-text-muted uppercase mb-3">
          {activeCategory === 'all' ? 'Todos los servicios' : categories.find(c => c.id === activeCategory)?.label}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {filteredPartners.map((partner) => (
            <button
              key={partner.id}
              onClick={() => handleSelectPartner(partner)}
              className="uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-left hover:border-primary transition-colors relative"
            >
              {isConnected(partner.id) && (
                <span className="absolute top-2 right-2 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-surface-dark" />
              )}
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${partner.color} flex items-center justify-center text-3xl mb-3 shadow-md`}>
                {partner.logo}
              </div>
              <p className="font-bold uv-text-primary">{partner.name}</p>
              <p className="text-xs text-gray-500 mt-1">{partner.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Partner Connect Sheet */}
      <BottomSheet
        isOpen={showPartnerSheet}
        onClose={() => setShowPartnerSheet(false)}
        title=""
      >
        {selectedPartner && (
          <div className="text-center py-4">
            <div className={`w-24 h-24 rounded-3xl bg-gradient-to-br ${selectedPartner.color} flex items-center justify-center text-5xl mx-auto mb-4 shadow-xl`}>
              {selectedPartner.logo}
            </div>
            <h2 className="text-2xl font-black uv-text-primary mb-2">
              {selectedPartner.name}
            </h2>
            <p className="text-gray-500 mb-6">{selectedPartner.description}</p>

            {isConnected(selectedPartner.id) ? (
              <div className="space-y-3">
                <div className="bg-green-100 dark:bg-green-900/30 text-green-600 px-4 py-3 rounded-xl flex items-center justify-center gap-2">
                  <Icons.Check size={18} />
                  <span className="font-bold">Cuenta conectada</span>
                </div>
                <button
                  onClick={() => {
                    setShowPartnerSheet(false);
                    if (selectedPartner.category === 'transport') {
                      setShowRideSheet(true);
                    } else if (selectedPartner.category === 'food') {
                      setShowFoodSheet(true);
                      setOrderStep('menu');
                    }
                  }}
                  className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg"
                >
                  Usar {selectedPartner.name}
                </button>
                <button
                  onClick={() => dispatch({ type: 'DISCONNECT_PARTNER', payload: selectedPartner.id })}
                  className="w-full text-red-500 py-3 font-medium"
                >
                  Desconectar cuenta
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="uv-surface-2 rounded-xl p-4 text-left">
                  <h4 className="font-bold uv-text-primary mb-2">
                    Al conectar podrás:
                  </h4>
                  <ul className="space-y-2 text-sm uv-text-secondary">
                    <li className="flex items-center gap-2">
                      <Icons.Check size={16} className="text-green-500" />
                      Pagar directamente con KiramoPay
                    </li>
                    <li className="flex items-center gap-2">
                      <Icons.Check size={16} className="text-green-500" />
                      Ver historial de transacciones
                    </li>
                    <li className="flex items-center gap-2">
                      <Icons.Check size={16} className="text-green-500" />
                      Recibir cashback exclusivo
                    </li>
                  </ul>
                </div>

                <button
                  onClick={() => {
                    handleConnectPartner(selectedPartner.id);
                    setShowPartnerSheet(false);
                    if (selectedPartner.category === 'transport') {
                      setTimeout(() => setShowRideSheet(true), 300);
                    } else if (selectedPartner.category === 'food') {
                      setTimeout(() => {
                        setShowFoodSheet(true);
                        setOrderStep('menu');
                      }, 300);
                    }
                  }}
                  className="w-full bg-gradient-to-r from-primary to-accent text-white py-4 rounded-xl font-bold text-lg shadow-lg"
                >
                  Conectar {selectedPartner.name}
                </button>
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {/* Ride Request Sheet (Uber/DiDi) */}
      <BottomSheet
        isOpen={showRideSheet}
        onClose={() => { setShowRideSheet(false); setRideStep('location'); }}
        title={selectedPartner?.name || 'Pedir viaje'}
      >
        <div className="space-y-6">
          {rideStep === 'location' && (
            <>
              <div className="space-y-3">
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 bg-green-500 rounded-full" />
                  <input
                    type="text"
                    value={pickup}
                    onChange={(e) => setPickup(e.target.value)}
                    placeholder="¿Dónde te recogemos?"
                    className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] pl-10 pr-4 py-4 rounded-xl outline-none uv-text-primary"
                  />
                </div>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 bg-red-500 rounded-full" />
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="¿A dónde vas?"
                    className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] pl-10 pr-4 py-4 rounded-xl outline-none uv-text-primary"
                  />
                </div>
              </div>

              {/* Quick locations */}
              <div className="space-y-2">
                <button
                  onClick={() => setPickup('Mi ubicación actual')}
                  className="w-full flex items-center gap-3 p-3 uv-surface-2 rounded-xl"
                >
                  <Icons.MapPin size={18} className="text-[var(--color-primary)]" />
                  <span className="uv-text-primary">Mi ubicación actual</span>
                </button>
                <button
                  onClick={() => setDestination('Escazú, San José')}
                  className="w-full flex items-center gap-3 p-3 uv-surface-2 rounded-xl"
                >
                  <Icons.Clock size={18} className="uv-text-muted" />
                  <span className="uv-text-primary">Escazú, San José</span>
                </button>
              </div>

              {pickup && destination && (
                <div className="uv-surface-2 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm text-gray-500">Precio estimado</p>
                      <p className="text-2xl font-black uv-text-primary">
                        {formatCurrency(5500)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">Tiempo</p>
                      <p className="font-bold uv-text-primary">12-18 min</p>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleRequestRide}
                disabled={!pickup || !destination}
                className={`w-full py-4 rounded-xl font-bold text-lg text-white disabled:opacity-50 bg-gradient-to-r ${selectedPartner?.color || 'from-primary to-accent'}`}
              >
                Pedir {selectedPartner?.name}
              </button>
            </>
          )}

          {rideStep === 'searching' && (
            <div className="text-center py-8">
              <div className="w-20 h-20 mx-auto mb-6 relative">
                <div className="w-full h-full rounded-full border-4 border-[var(--color-border)] dark:border-[var(--color-border-dark)]" />
                <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              </div>
              <h3 className="text-xl font-bold uv-text-primary mb-2">
                Buscando conductor...
              </h3>
              <p className="uv-text-muted">Esto puede tomar unos segundos</p>
            </div>
          )}

          {rideStep === 'found' && (
            <div className="space-y-4">
              <div className="bg-green-100 dark:bg-green-900/30 text-green-600 px-4 py-3 rounded-xl text-center font-bold">
                ¡Conductor encontrado!
              </div>

              <div className="flex items-center gap-4 uv-surface-2 p-4 rounded-xl">
                <div className="w-16 h-16 bg-gradient-to-br from-gray-300 to-gray-400 rounded-full flex items-center justify-center text-2xl">
                  👨
                </div>
                <div className="flex-1">
                  <p className="font-bold uv-text-primary">{activeRide?.driver?.name ?? 'Conductor asignado'}</p>
                  <div className="flex items-center gap-1 text-sm text-gray-500">
                    <Icons.Star size={14} className="text-yellow-500 fill-yellow-500" />
                    <span>{(activeRide?.driver?.rating ?? 5).toFixed(2)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold uv-text-primary">{activeRide?.driver?.car ?? 'Vehículo'}</p>
                  <p className="text-sm text-gray-500">{activeRide?.driver?.plate ?? ''}</p>
                </div>
              </div>

              <div className="uv-surface-2 rounded-xl p-4">
                <div className="flex justify-between">
                  <span className="uv-text-muted">Total a pagar</span>
                  <span className="font-black text-xl uv-text-primary">
                    {formatCurrency(activeRide?.estimatedPrice ?? 5250)}
                  </span>
                </div>
              </div>

              <button
                onClick={handleConfirmRide}
                className={`w-full py-4 rounded-xl font-bold text-lg text-white bg-gradient-to-r ${selectedPartner?.color || 'from-primary to-accent'}`}
              >
                Confirmar viaje
              </button>
            </div>
          )}

          {rideStep === 'arriving' && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">🚗</div>
              <h3 className="text-xl font-bold uv-text-primary mb-2">
                Tu conductor viene en camino
              </h3>
              <p className="text-3xl font-black text-primary mb-2">3 min</p>
              <p className="uv-text-muted">
                {activeRide?.driver ? `${activeRide.driver.car} • ${activeRide.driver.plate}` : 'En camino'}
              </p>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Food Order Sheet (Uber Eats/PedidosYa) */}
      <BottomSheet
        isOpen={showFoodSheet}
        onClose={() => { setShowFoodSheet(false); setOrderStep('menu'); setCartItems([]); }}
        title={selectedPartner?.name || 'Pedir comida'}
      >
        <div className="space-y-4 -mx-2">
          {orderStep === 'menu' && !selectedRestaurant && (
            <>
              <div className="px-2">
                <input
                  type="text"
                  placeholder="Buscar restaurantes..."
                  className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-4 py-3 rounded-xl outline-none"
                />
              </div>

              <div className="space-y-2 px-2">
                {DEMO_RESTAURANTS.map((rest) => (
                  <button
                    key={rest.id}
                    onClick={() => setSelectedRestaurant(rest)}
                    className="w-full flex items-center gap-4 uv-surface-2 p-4 rounded-xl"
                  >
                    <div className="w-14 h-14 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl flex items-center justify-center text-2xl">
                      {rest.logo}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-bold uv-text-primary">{rest.name}</p>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Icons.Star size={12} className="text-yellow-500 fill-yellow-500" />
                          {rest.rating}
                        </span>
                        <span>•</span>
                        <span>{rest.time}</span>
                        <span>•</span>
                        <span>Envío {formatCurrency(rest.deliveryFee)}</span>
                      </div>
                    </div>
                    <Icons.ChevronRight size={18} className="uv-text-muted" />
                  </button>
                ))}
              </div>
            </>
          )}

          {orderStep === 'menu' && selectedRestaurant && (
            <>
              <div className="px-2">
                <button
                  onClick={() => setSelectedRestaurant(null)}
                  className="flex items-center gap-2 text-gray-500 mb-4"
                >
                  <Icons.ChevronLeft size={18} />
                  Volver
                </button>

                <div className="flex items-center gap-4 mb-6">
                  <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl flex items-center justify-center text-3xl">
                    {selectedRestaurant.logo}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold uv-text-primary">
                      {selectedRestaurant.name}
                    </h3>
                    <p className="text-sm text-gray-500">{selectedRestaurant.time}</p>
                  </div>
                </div>

                <h4 className="font-bold uv-text-primary mb-3">Menú</h4>
                <div className="space-y-2">
                  {[
                    { name: 'Combo 1', price: 4500 },
                    { name: 'Combo 2', price: 5500 },
                    { name: 'Combo 3', price: 6500 },
                    { name: 'Papas Grandes', price: 2000 },
                    { name: 'Bebida', price: 1200 },
                  ].map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between uv-surface-2 p-4 rounded-xl"
                    >
                      <div>
                        <p className="font-bold uv-text-primary">{item.name}</p>
                        <p className="text-sm text-gray-500">{formatCurrency(item.price)}</p>
                      </div>
                      <button
                        onClick={() => addToCart(item)}
                        className="w-8 h-8 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-full flex items-center justify-center"
                      >
                        <Icons.Plus size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {cartItems.length > 0 && (
                <div className="sticky bottom-0 uv-surface-1 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4">
                  <button
                    onClick={() => setOrderStep('cart')}
                    className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold flex items-center justify-between px-4"
                  >
                    <span>Ver carrito ({cartItems.reduce((a, i) => a + i.qty, 0)})</span>
                    <span>{formatCurrency(cartTotal)}</span>
                  </button>
                </div>
              )}
            </>
          )}

          {orderStep === 'cart' && (
            <div className="px-2 space-y-4">
              <h3 className="text-xl font-bold uv-text-primary">Tu pedido</h3>

              <div className="space-y-2">
                {cartItems.map((item) => (
                  <div key={item.name} className="flex items-center justify-between uv-surface-2 p-4 rounded-xl">
                    <div>
                      <p className="font-bold uv-text-primary">{item.name}</p>
                      <p className="text-sm text-gray-500">{item.qty} x {formatCurrency(item.price)}</p>
                    </div>
                    <p className="font-bold">{formatCurrency(item.price * item.qty)}</p>
                  </div>
                ))}
              </div>

              <div className="uv-surface-2 rounded-xl p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="uv-text-muted">Subtotal</span>
                  <span className="font-bold uv-text-primary">{formatCurrency(cartTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="uv-text-muted">Envío</span>
                  <span className="font-bold uv-text-primary">{formatCurrency(deliveryFee)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                  <span className="font-bold uv-text-primary">Total</span>
                  <span className="font-black text-xl uv-text-primary">{formatCurrency(cartTotal + deliveryFee)}</span>
                </div>
              </div>

              <button
                onClick={handlePlaceOrder}
                className={`w-full py-4 rounded-xl font-bold text-lg text-white bg-gradient-to-r ${selectedPartner?.color || 'from-primary to-accent'}`}
              >
                Pagar con KiramoPay
              </button>
            </div>
          )}

          {orderStep === 'confirm' && (
            <div className="px-2 text-center py-6">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icons.Check size={40} className="text-green-500" />
              </div>
              <h3 className="text-xl font-bold uv-text-primary mb-2">
                ¡Pedido confirmado!
              </h3>
              <p className="text-gray-500 mb-6">
                Tu pedido de {selectedRestaurant?.name} está en preparación
              </p>

              <div className="uv-surface-2 rounded-xl p-4 mb-6">
                <p className="text-sm text-gray-500 mb-1">Tiempo estimado</p>
                <p className="text-2xl font-black uv-text-primary">
                  {selectedRestaurant?.time}
                </p>
              </div>

              <button
                onClick={() => { setShowFoodSheet(false); setOrderStep('menu'); setCartItems([]); }}
                className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold"
              >
                Listo
              </button>
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
};
