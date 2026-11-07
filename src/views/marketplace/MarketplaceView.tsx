import React, { useState, useEffect } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '../../i18n/LanguageContext';
import { Icons, IconosLinea } from '../../components/Icons';
import type { LucideIcon } from 'lucide-react';
import { BottomSheet } from '../../components/BottomSheet';
import { Icono3D } from '../../components/arte3d/Arte3D';
import type { NombreIcono3D } from '../../components/arte3d/catalogo';
import { EstadoVacio } from '../../components/EstadoVacio';
import { getApiLayer } from '@/api';
import { refreshAccounts } from '@/services/dataSync';
import type { RideRequest, FoodOrder, Transaction } from '@/types';

const hasBackend = !!import.meta.env.VITE_API_URL;

// Live food-order tracker steps (status -> step index).
// Cada paso lleva un icono de linea (no un emoji: cambian de dibujo en cada
// sistema y no siguen el color del tema).
const FOOD_STEPS = [
  { key: 'preparing', labelKey: 'market_food_step_preparing', Icono: IconosLinea.Cocinando },
  { key: 'ready', labelKey: 'market_food_step_ready', Icono: IconosLinea.PedidoListo },
  { key: 'on_the_way', labelKey: 'market_food_step_on_the_way', Icono: IconosLinea.Moto },
  { key: 'delivered', labelKey: 'market_food_step_delivered', Icono: IconosLinea.Entregado },
] as const;
const FOOD_STATUS_INDEX: Record<string, number> = {
  preparing: 0,
  ready: 1,
  on_the_way: 2,
  delivered: 3,
  cancelled: -1,
};

// Live ride tracker steps (status -> step index).
const RIDE_STEPS = [
  { key: 'confirmed', labelKey: 'market_ride_step_confirmed', Icono: IconosLinea.Confirmado },
  { key: 'arriving', labelKey: 'market_ride_step_arriving', Icono: IconosLinea.Transporte },
  { key: 'in_progress', labelKey: 'market_ride_step_in_progress', Icono: IconosLinea.Ruta },
  { key: 'completed', labelKey: 'market_ride_step_completed', Icono: IconosLinea.Llegada },
] as const;

// Los socios y restaurantes no llevan logo propio (las marcas de terceros no
// se dibujan sin licencia): su mosaico muestra el icono 3D de su categoria y el
// nombre va al lado. Los chips de categoria, de 18 px, siguen con el icono de
// linea: el dibujo 3D a ese tamano se ve como una mancha.
type CategoriaDelMercado = 'transport' | 'food' | 'supermarket' | 'entertainment';
const ICONO_DE_CATEGORIA: Record<CategoriaDelMercado | 'all', LucideIcon> = {
  all: IconosLinea.Todo,
  transport: IconosLinea.Transporte,
  food: IconosLinea.Comida,
  supermarket: IconosLinea.Super,
  entertainment: IconosLinea.Ocio,
};
const ARTE_DE_CATEGORIA: Record<CategoriaDelMercado, NombreIcono3D> = {
  transport: 'transporte',
  food: 'comida',
  supermarket: 'supermercado',
  entertainment: 'entretenimiento',
};

const MosaicoDeCategoria: React.FC<{ categoria: CategoriaDelMercado; className: string; tamano: number }> = ({ categoria, className, tamano }) => (
  <div className={`flex shrink-0 items-center justify-center bg-[var(--color-surface-2)] shadow-[inset_0_0_0_1px_var(--color-border-strong)] dark:bg-[var(--color-surface-2-dark)] dark:shadow-[inset_0_0_0_1px_var(--color-border-strong-dark)] ${className}`}>
    <Icono3D nombre={ARTE_DE_CATEGORIA[categoria]} tamano={Math.max(28, tamano)} />
  </div>
);
const RIDE_STATUS_INDEX: Record<string, number> = {
  confirmed: 0,
  arriving: 1,
  in_progress: 2,
  completed: 3,
  searching: -1,
  cancelled: -1,
};

// Partners del marketplace. La descripcion se guarda como clave de traduccion:
// la pantalla la traduce al pintar, asi que sigue al idioma de la app.
const MARKETPLACE_PARTNERS = {
  transport: [
    {
      id: 'uber',
      name: 'Uber',
      color: 'from-black to-gray-800',
      descriptionKey: 'market_desc_uber',
      category: 'transport' as const,
    },
    {
      id: 'didi',
      name: 'DiDi',
      color: 'from-orange-500 to-orange-600',
      descriptionKey: 'market_desc_didi',
      category: 'transport' as const,
    },
    {
      id: 'indriver',
      name: 'InDriver',
      color: 'from-green-500 to-green-600',
      descriptionKey: 'market_desc_indriver',
      category: 'transport' as const,
    },
  ],
  food: [
    {
      id: 'ubereats',
      name: 'Uber Eats',
      color: 'from-green-600 to-green-700',
      descriptionKey: 'market_desc_ubereats',
      category: 'food' as const,
    },
    {
      id: 'pedidosya',
      name: 'PedidosYa',
      color: 'from-red-500 to-red-600',
      descriptionKey: 'market_desc_pedidosya',
      category: 'food' as const,
    },
    {
      id: 'rappi',
      name: 'Rappi',
      color: 'from-orange-500 to-red-500',
      descriptionKey: 'market_desc_rappi',
      category: 'food' as const,
    },
  ],
  supermarket: [
    {
      id: 'automercado',
      name: 'Auto Mercado',
      color: 'from-red-600 to-red-700',
      descriptionKey: 'market_desc_automercado',
      category: 'supermarket' as const,
    },
    {
      id: 'walmart',
      name: 'Walmart',
      color: 'from-blue-600 to-blue-700',
      descriptionKey: 'market_desc_walmart',
      category: 'supermarket' as const,
    },
    {
      id: 'masxmenos',
      name: 'Mas x Menos',
      color: 'from-yellow-500 to-yellow-600',
      descriptionKey: 'market_desc_masxmenos',
      category: 'supermarket' as const,
    },
    {
      id: 'pricesmart',
      name: 'PriceSmart',
      color: 'from-blue-700 to-blue-800',
      descriptionKey: 'market_desc_pricesmart',
      category: 'supermarket' as const,
    },
  ],
  entertainment: [
    {
      id: 'cinemark',
      name: 'Cinemark',
      color: 'from-purple-600 to-purple-700',
      descriptionKey: 'market_desc_cinemark',
      category: 'entertainment' as const,
    },
    {
      id: 'novacinemas',
      name: 'Nova Cinemas',
      color: 'from-red-600 to-pink-600',
      descriptionKey: 'market_desc_novacinemas',
      category: 'entertainment' as const,
    },
  ],
};

// Restaurantes para demo de Uber Eats. Sin costo de envio: el que se cobra lo
// fija el servidor al crear el pedido, y la tabla local decia otro numero.
// El rango de minutos va sin unidad: la pantalla le pone "min" en el idioma de
// la app (market_minutes).
const DEMO_RESTAURANTS = [
  { id: '1', name: 'McDonalds', rating: 4.5, minutes: '15-25' },
  { id: '2', name: 'Taco Bell', rating: 4.3, minutes: '20-30' },
  { id: '3', name: 'Pizza Hut', rating: 4.4, minutes: '25-35' },
  { id: '4', name: 'KFC', rating: 4.2, minutes: '20-30' },
  { id: '5', name: 'Subway', rating: 4.6, minutes: '15-20' },
  { id: '6', name: 'Sushi Express', rating: 4.7, minutes: '30-40' },
];

// Menu de demostracion. Los combos son nombres propios del restaurante y se
// quedan como estan; el resto lleva la clave de su nombre.
const DEMO_MENU: { id: string; name?: string; nameKey?: string; price: number }[] = [
  { id: 'combo-1', name: 'Combo 1', price: 4500 },
  { id: 'combo-2', name: 'Combo 2', price: 5500 },
  { id: 'combo-3', name: 'Combo 3', price: 6500 },
  { id: 'papas', nameKey: 'market_item_fries', price: 2000 },
  { id: 'bebida', nameKey: 'market_item_drink', price: 1200 },
];

// El servidor niega el cobro con este codigo cuando no hay integracion con el
// socio: no hay a quien entregarle el viaje ni el pedido, asi que no debita.
const SIN_INTEGRACION = 'SIN_INTEGRACION';

// Aviso al pie de una hoja. 'bloqueo' marca la negativa explicada — no es culpa
// del usuario ni de su saldo, va en tono neutro; el resto son fallos, van en rojo.
type Aviso = { texto: string; bloqueo: boolean };

const AvisoHoja: React.FC<{ aviso: Aviso | null }> = ({ aviso }) => {
  if (!aviso) return null;
  return aviso.bloqueo ? (
    <div role="status" className="uv-surface-2 rounded-xl p-4 text-sm uv-text-secondary text-center">
      {aviso.texto}
    </div>
  ) : (
    <p role="alert" className="text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)] text-sm text-center">
      {aviso.texto}
    </p>
  );
};

export const MarketplaceView: React.FC = () => {
  const { state, dispatch } = useApp();
  const { t } = useLanguage();
  const [activeCategory, setActiveCategory] = useState<'all' | 'transport' | 'food' | 'supermarket' | 'entertainment'>('all');
  const [showPartnerSheet, setShowPartnerSheet] = useState(false);
  const [showRideSheet, setShowRideSheet] = useState(false);
  const [showFoodSheet, setShowFoodSheet] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<{
    id: string;
    name: string;
    color: string;
    descriptionKey: string;
    category: 'transport' | 'food' | 'supermarket' | 'entertainment';
  } | null>(null);

  // Ride states
  const [rideStep, setRideStep] = useState<'location' | 'searching' | 'found' | 'tracking'>('location');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [activeRide, setActiveRide] = useState<RideRequest | null>(null);
  const [isConfirmingRide, setIsConfirmingRide] = useState(false);
  const [rideAviso, setRideAviso] = useState<Aviso | null>(null);

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
  const [orderStep, setOrderStep] = useState<'menu' | 'cart' | 'tracking'>('menu');
  const [activeOrder, setActiveOrder] = useState<FoodOrder | null>(null);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [orderAviso, setOrderAviso] = useState<Aviso | null>(null);

  // While tracking, poll the backend for the live order status. The status is
  // authoritative (server-derived); polling stops on unmount, sheet close, and
  // once the order reaches a terminal state.
  useEffect(() => {
    if (orderStep !== 'tracking' || !activeOrder?.id) return;
    const mp = getApiLayer().marketplace;
    if (!mp) return;
    const orderId = activeOrder.id;
    let cancelled = false;
    const timer = setInterval(() => {
      mp.getFoodOrder(orderId)
        .then((res) => {
          if (cancelled || !res.success || !res.data) return;
          setActiveOrder(res.data);
          if (res.data.status === 'delivered' || res.data.status === 'cancelled') {
            clearInterval(timer);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orderStep, activeOrder?.id]);

  // While tracking a ride, poll the backend for the live trip status (arriving ->
  // in_progress -> completed). Backend status is authoritative; polling stops on
  // unmount, sheet close, and once the ride is terminal.
  useEffect(() => {
    if (rideStep !== 'tracking' || !activeRide?.id) return;
    const mp = getApiLayer().marketplace;
    if (!mp) return;
    const rideId = activeRide.id;
    let cancelled = false;
    const timer = setInterval(() => {
      mp.getRide(rideId)
        .then((res) => {
          if (cancelled || !res.success || !res.data) return;
          setActiveRide(res.data);
          if (res.data.status === 'completed' || res.data.status === 'cancelled') {
            clearInterval(timer);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rideStep, activeRide?.id]);

  // "9 min" en el idioma de la app. Acepta un rango ya armado ("15-25").
  const minutosEn = (minutos: number | string) => t('market_minutes').replace('{n}', String(minutos));
  // El servidor cotiza el tiempo como texto ("9 min"): los minutos salen con la
  // unidad del idioma, como en el seguimiento. Uno que no empieza con un numero
  // queda como llego.
  const tiempoEstimado = (texto: string) => {
    const minutos = parseInt(texto, 10);
    return Number.isNaN(minutos) ? texto : minutosEn(minutos);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currencyDisplay: 'narrowSymbol', currency: 'CRC' }).format(amount);
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

  // Traduce el fallo del servidor: la negativa por falta de integracion tiene
  // mensaje propio; cualquier otra cosa se muestra como error.
  const avisoDeError = (error: { code: string; message: string } | undefined, clave: string): Aviso =>
    error?.code === SIN_INTEGRACION
      ? { texto: t(clave), bloqueo: true }
      : { texto: error?.message || t('assistant_action_failed'), bloqueo: false };

  const handleRequestRide = async () => {
    if (!pickup || !destination || !selectedPartner || rideStep === 'searching') return;
    const api = getApiLayer();
    if (!api.marketplace) {
      setRideAviso({ texto: t('assistant_action_failed'), bloqueo: false });
      return;
    }
    setRideAviso(null);
    setRideStep('searching');
    const res = await api.marketplace.createRide({ partnerCode: selectedPartner.id, pickup, destination });
    // Sin cotizacion del servidor no hay viaje que mostrar. Antes se pasaba a
    // 'found' igual y la pantalla rellenaba conductor, calificacion y precio
    // que no habia dado nadie.
    if (!res.success || !res.data) {
      setRideAviso(avisoDeError(res.error, 'ride_no_integration'));
      setRideStep('location');
      return;
    }
    setActiveRide(res.data);
    setRideStep('found');
  };

  const handleConfirmRide = async () => {
    if (isConfirmingRide || !activeRide) return;
    const api = getApiLayer();
    if (!api.marketplace) {
      setRideAviso({ texto: t('assistant_action_failed'), bloqueo: false });
      return;
    }
    setIsConfirmingRide(true);
    setRideAviso(null);
    try {
      const res = await api.marketplace.confirmRide(activeRide.id);
      // Confirmar es el paso que cobra: si el servidor lo niega no hay viaje
      // que seguir, asi que la pantalla se queda donde estaba y lo explica.
      if (!res.success || !res.data) {
        setRideAviso(avisoDeError(res.error, 'ride_no_integration'));
        return;
      }
      setActiveRide(res.data); // status confirmed; the tracker polls from here
      if (hasBackend) refreshAccounts().catch(() => {});
      else localDebit(res.data.estimatedPrice, `${selectedPartner?.name || t('market_trip_label')}`);
      setRideStep('tracking');
    } finally {
      setIsConfirmingRide(false);
    }
  };

  const closeRideSheet = () => {
    setShowRideSheet(false);
    setRideStep('location');
    setPickup('');
    setDestination('');
    setActiveRide(null);
    setRideAviso(null);
  };

  const handlePlaceOrder = async () => {
    if (isPlacingOrder) return;
    if (!selectedRestaurant || !selectedPartner || cartItems.length === 0) return;
    const api = getApiLayer();
    if (!api.marketplace) {
      setOrderAviso({ texto: t('assistant_action_failed'), bloqueo: false });
      return;
    }
    setIsPlacingOrder(true);
    setOrderAviso(null);
    try {
      const res = await api.marketplace.createFoodOrder({
        partnerCode: selectedPartner.id,
        restaurantName: selectedRestaurant.name,
        items: cartItems.map((i) => ({ name: i.name, quantity: i.qty, price: i.price })),
      });
      // Crear el pedido es el paso que cobra: si el servidor lo niega no existe
      // el pedido, asi que no hay nada que seguir. Antes se saltaba igual a la
      // pantalla de seguimiento desde el finally.
      if (!res.success || !res.data) {
        setOrderAviso(avisoDeError(res.error, 'order_no_integration'));
        return;
      }
      setActiveOrder(res.data);
      // The charge already happened server-side at creation; just refresh.
      if (hasBackend) refreshAccounts().catch(() => {});
      else localDebit(res.data.total, `${selectedRestaurant.name}`);
      setOrderStep('tracking');
    } finally {
      setIsPlacingOrder(false);
    }
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

  const allPartners: Array<{
    id: string;
    name: string;
    color: string;
    descriptionKey: string;
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
    { id: 'all', label: t('market_cat_all'), Icono: ICONO_DE_CATEGORIA.all },
    { id: 'transport', label: t('market_cat_transport'), Icono: ICONO_DE_CATEGORIA.transport },
    { id: 'food', label: t('market_cat_food'), Icono: ICONO_DE_CATEGORIA.food },
    { id: 'supermarket', label: t('market_cat_supermarket'), Icono: ICONO_DE_CATEGORIA.supermarket },
    { id: 'entertainment', label: t('market_cat_entertainment'), Icono: ICONO_DE_CATEGORIA.entertainment },
  ];

  // El nombre que se muestra es el mismo que va al carrito y al pedido, ya en
  // el idioma de la app.
  const menu = DEMO_MENU.map((plato) => ({
    id: plato.id,
    name: plato.nameKey ? t(plato.nameKey) : (plato.name ?? ''),
    price: plato.price,
  }));

  return (
    <div className="@container/mercado pb-24 pt-4 space-y-6 px-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold uv-text-primary mb-1">
          {t('home_marketplace')}
        </h1>
        {/* El mismo texto de la tarjeta del Inicio. Antes decia "Paga con
            KiramoPay en tus apps favoritas", en espanol fijo y prometiendo una
            integracion con esas apps que no existe (ver help_marketplace_body). */}
        <p className="uv-text-muted">{t('home_marketplace_desc')}</p>
      </div>

      {/* Categories */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 @min-[40rem]/mercado:flex-wrap @min-[40rem]/mercado:overflow-visible">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id as typeof activeCategory)}
            className={`kp-toque kp-foco flex items-center gap-2 px-4 py-2.5 rounded-full whitespace-nowrap text-sm font-medium transition-colors duration-[var(--kp-mov-estado)] ease-kp ${
              activeCategory === cat.id
                ? 'bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white'
                : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-secondary'
            }`}
          >
            <cat.Icono size={18} aria-hidden="true" />
            {cat.label}
          </button>
        ))}
      </div>

      {/* Connected Apps */}
      {state.connectedPartners.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uv-text-muted mb-3">
            {t('market_connected_apps')}
          </h3>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
            {state.connectedPartners.map((partnerId) => {
              const partner = allPartners.find(p => p.id === partnerId);
              if (!partner) return null;
              return (
                <button
                  key={partnerId}
                  onClick={() => handleSelectPartner(partner)}
                  className="kp-toque kp-foco flex flex-col items-center gap-2 rounded-2xl"
                >
                  <MosaicoDeCategoria categoria={partner.category} className="w-16 h-16 rounded-[20px]" tamano={44} />
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
        <h3 className="text-sm font-semibold uv-text-muted mb-3">
          {activeCategory === 'all' ? t('market_all_services') : categories.find(c => c.id === activeCategory)?.label}
        </h3>
        {filteredPartners.length === 0 ? (
          <EstadoVacio
            icono="mercado"
            titulo={t('help_no_results')}
            descripcion={t('help_no_results_desc')}
            className="uv-surface-1 rounded-[20px]"
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 @min-[40rem]/mercado:grid-cols-3 @min-[56rem]/mercado:grid-cols-4">
            {filteredPartners.map((partner) => (
              <button
                key={partner.id}
                onClick={() => handleSelectPartner(partner)}
                className="kp-toque kp-foco uv-surface-1 rounded-[20px] p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-left hover:border-primary dark:hover:border-primary transition-colors duration-[var(--kp-mov-estado)] ease-kp relative"
              >
                {isConnected(partner.id) && (
                  <span className="absolute top-3 right-3 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-surface-dark" />
                )}
                <MosaicoDeCategoria categoria={partner.category} className="w-14 h-14 rounded-[16px] mb-3" tamano={40} />
                <p className="font-semibold uv-text-primary break-words">{partner.name}</p>
                <p className="text-xs text-gray-500 mt-1">{t(partner.descriptionKey)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Partner Connect Sheet */}
      <BottomSheet
        isOpen={showPartnerSheet}
        onClose={() => setShowPartnerSheet(false)}
        title=""
      >
        {selectedPartner && (
          <div className="text-center py-4">
            <MosaicoDeCategoria categoria={selectedPartner.category} className="w-24 h-24 rounded-[28px] mx-auto mb-4" tamano={64} />
            <h2 className="text-2xl font-semibold uv-text-primary mb-2">
              {selectedPartner.name}
            </h2>
            <p className="text-gray-500 mb-6">{t(selectedPartner.descriptionKey)}</p>

            {isConnected(selectedPartner.id) ? (
              <div className="space-y-3">
                <div className="bg-green-100 dark:bg-green-900/30 text-green-600 px-4 py-3 rounded-xl flex items-center justify-center gap-2">
                  <Icons.Check size={18} />
                  <span className="font-bold">{t('market_account_connected')}</span>
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
                  className="w-full bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg"
                >
                  {t('market_use_partner').replace('{name}', selectedPartner.name)}
                </button>
                <button
                  onClick={() => dispatch({ type: 'DISCONNECT_PARTNER', payload: selectedPartner.id })}
                  className="w-full text-red-500 py-3 font-medium"
                >
                  {t('market_disconnect_account')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="uv-surface-2 rounded-xl p-4 text-left">
                  <h4 className="font-bold uv-text-primary mb-2">
                    {t('market_connect_benefits_title')}
                  </h4>
                  <ul className="space-y-2 text-sm uv-text-secondary">
                    <li className="flex items-center gap-2">
                      <Icons.Check size={16} className="text-green-500" />
                      {t('market_benefit_pay')}
                    </li>
                    <li className="flex items-center gap-2">
                      <Icons.Check size={16} className="text-green-500" />
                      {t('market_benefit_history')}
                    </li>
                    <li className="flex items-center gap-2">
                      <Icons.Check size={16} className="text-green-500" />
                      {t('market_benefit_cashback')}
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
                  {t('market_connect_partner').replace('{name}', selectedPartner.name)}
                </button>
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {/* Ride Request Sheet (Uber/DiDi) */}
      <BottomSheet
        isOpen={showRideSheet}
        onClose={closeRideSheet}
        title={selectedPartner?.name || t('market_request_ride_title')}
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
                    placeholder={t('market_pickup_placeholder')}
                    className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] pl-10 pr-4 py-4 rounded-xl outline-none uv-text-primary"
                  />
                </div>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 bg-red-500 rounded-full" />
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={t('market_destination_placeholder')}
                    className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] pl-10 pr-4 py-4 rounded-xl outline-none uv-text-primary"
                  />
                </div>
              </div>

              {/* Quick locations */}
              <div className="space-y-2">
                <button
                  onClick={() => setPickup(t('market_my_location'))}
                  className="w-full flex items-center gap-3 p-3 uv-surface-2 rounded-xl"
                >
                  <Icons.MapPin size={18} className="text-[var(--color-primary)] dark:text-[var(--color-primary-light)]" />
                  <span className="uv-text-primary">{t('market_my_location')}</span>
                </button>
                <button
                  onClick={() => setDestination('Escazú, San José')}
                  className="w-full flex items-center gap-3 p-3 uv-surface-2 rounded-xl"
                >
                  <Icons.Clock size={18} className="uv-text-muted" />
                  <span className="uv-text-primary">Escazú, San José</span>
                </button>
              </div>

              {/* Nada de precio ni de tiempo aqui: los da el servidor al pedir
                  el viaje. Lo que habia era una constante sin relacion con el
                  origen ni el destino. */}
              {pickup && destination && (
                <p className="uv-text-muted text-sm text-center">
                  {t('ride_price_after_quote')}
                </p>
              )}

              <AvisoHoja aviso={rideAviso} />

              <button
                onClick={handleRequestRide}
                disabled={!pickup || !destination}
                className={`w-full py-4 rounded-xl font-bold text-lg text-white disabled:opacity-50 bg-gradient-to-r ${selectedPartner?.color || 'from-primary to-accent'}`}
              >
                {t('market_request_partner').replace('{name}', selectedPartner?.name ?? '')}
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
                {t('market_searching_driver')}
              </h3>
              <p className="uv-text-muted">{t('market_searching_driver_hint')}</p>
            </div>
          )}

          {/* Solo se llega aqui con un viaje cotizado por el servidor: el
              conductor y el precio salen de esa respuesta, sin rellenos. */}
          {rideStep === 'found' && activeRide && (
            <div className="space-y-4">
              <div className="bg-green-100 dark:bg-green-900/30 text-green-600 px-4 py-3 rounded-xl text-center font-bold">
                {t('market_driver_found')}
              </div>

              {activeRide.driver && (
                <div className="flex items-center gap-4 uv-surface-2 p-4 rounded-xl">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-3-dark)] uv-text-secondary">
                    <IconosLinea.Perfil size={30} aria-hidden="true" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold uv-text-primary">{activeRide.driver.name}</p>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <Icons.Star size={14} className="text-yellow-500 fill-yellow-500" />
                      <span>{activeRide.driver.rating.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold uv-text-primary">{activeRide.driver.car}</p>
                    <p className="text-sm text-gray-500">{activeRide.driver.plate}</p>
                  </div>
                </div>
              )}

              <div className="uv-surface-2 rounded-xl p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="uv-text-muted">{t('market_total_to_pay')}</span>
                  <span className="font-semibold text-xl uv-text-primary">
                    {formatCurrency(activeRide.estimatedPrice)}
                  </span>
                </div>
                {activeRide.estimatedTime && (
                  <div className="flex justify-between text-sm">
                    <span className="uv-text-muted">{t('market_estimated_time')}</span>
                    <span className="font-bold uv-text-primary">{tiempoEstimado(activeRide.estimatedTime)}</span>
                  </div>
                )}
              </div>

              <AvisoHoja aviso={rideAviso} />

              <button
                onClick={handleConfirmRide}
                disabled={isConfirmingRide}
                className={`w-full py-4 rounded-xl font-bold text-lg text-white bg-gradient-to-r ${selectedPartner?.color || 'from-primary to-accent'} disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
              >
                {isConfirmingRide ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('processing')}
                  </>
                ) : (
                  t('market_confirm_ride')
                )}
              </button>
            </div>
          )}

          {rideStep === 'tracking' && (
            <div className="py-2 space-y-5">
              <div className="text-center">
                <h3 className="text-xl font-bold uv-text-primary mb-1">
                  {activeRide?.status === 'completed'
                    ? t('market_ride_arrived')
                    : activeRide?.status === 'in_progress'
                      ? t('market_ride_step_in_progress')
                      : t('market_ride_driver_coming')}
                </h3>
                <p className="uv-text-muted">{activeRide?.destination}</p>
              </div>

              {activeRide?.status !== 'completed' && (
                <div className="uv-surface-2 rounded-xl p-4 text-center">
                  <p className="text-sm text-gray-500 mb-1">
                    {activeRide?.status === 'in_progress' ? t('market_ride_arrives_in') : t('market_ride_driver_arrives_in')}
                  </p>
                  <p className="text-3xl font-semibold uv-text-primary">
                    {(activeRide?.minutesRemaining ?? 0) > 0 ? minutosEn(activeRide?.minutesRemaining ?? 0) : t('market_very_soon')}
                  </p>
                </div>
              )}

              {/* Live status stepper (driven by the backend status) */}
              <div className="space-y-3">
                {RIDE_STEPS.map((step, i) => {
                  const current = RIDE_STATUS_INDEX[activeRide?.status ?? 'confirmed'];
                  const done = current >= i;
                  const active = current === i;
                  return (
                    <div key={step.key} className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-lg ${
                          done
                            ? 'bg-green-500 text-white'
                            : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-gray-400'
                        } ${active ? 'ring-2 ring-green-400' : ''}`}
                      >
                        {done ? <Icons.Check size={18} /> : <step.Icono size={18} aria-hidden="true" />}
                      </div>
                      <span className={`font-medium ${done ? 'uv-text-primary' : 'uv-text-muted'}`}>
                        {t(step.labelKey)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Driver card */}
              {activeRide?.driver && (
                <div className="flex items-center gap-4 uv-surface-2 p-4 rounded-xl">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-3-dark)] uv-text-secondary">
                    <IconosLinea.Perfil size={26} aria-hidden="true" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold uv-text-primary">{activeRide.driver.name}</p>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <Icons.Star size={14} className="text-yellow-500 fill-yellow-500" />
                      <span>{activeRide.driver.rating.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold uv-text-primary">{activeRide.driver.car}</p>
                    <p className="text-sm text-gray-500">{activeRide.driver.plate}</p>
                  </div>
                </div>
              )}

              <button
                onClick={closeRideSheet}
                className="w-full bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold"
              >
                {activeRide?.status === 'completed' ? t('done') : t('market_keep_in_background')}
              </button>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Food Order Sheet (Uber Eats/PedidosYa) */}
      <BottomSheet
        isOpen={showFoodSheet}
        onClose={() => { setShowFoodSheet(false); setOrderStep('menu'); setCartItems([]); setActiveOrder(null); setOrderAviso(null); }}
        title={selectedPartner?.name || t('market_order_food_title')}
      >
        <div className="space-y-4 -mx-2">
          {orderStep === 'menu' && !selectedRestaurant && (
            <>
              <div className="px-2">
                <input
                  type="text"
                  placeholder={t('market_search_restaurants')}
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
                    <MosaicoDeCategoria categoria="food" className="w-14 h-14 rounded-[16px]" tamano={40} />
                    <div className="flex-1 text-left">
                      <p className="font-bold uv-text-primary">{rest.name}</p>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Icons.Star size={12} className="text-yellow-500 fill-yellow-500" />
                          {rest.rating}
                        </span>
                        <span>•</span>
                        <span>{minutosEn(rest.minutes)}</span>
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
                  {t('back')}
                </button>

                <div className="flex items-center gap-4 mb-6">
                  <MosaicoDeCategoria categoria="food" className="w-16 h-16 rounded-[18px]" tamano={44} />
                  <div>
                    <h3 className="text-xl font-bold uv-text-primary">
                      {selectedRestaurant.name}
                    </h3>
                    <p className="text-sm text-gray-500">{minutosEn(selectedRestaurant.minutes)}</p>
                  </div>
                </div>

                <h4 className="font-bold uv-text-primary mb-3">{t('market_menu')}</h4>
                <div className="space-y-2">
                  {menu.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between uv-surface-2 p-4 rounded-xl"
                    >
                      <div>
                        <p className="font-bold uv-text-primary">{item.name}</p>
                        <p className="text-sm text-gray-500">{formatCurrency(item.price)}</p>
                      </div>
                      <button
                        onClick={() => addToCart({ name: item.name, price: item.price })}
                        className="w-8 h-8 bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white rounded-full flex items-center justify-center"
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
                    className="w-full bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold flex items-center justify-between px-4"
                  >
                    <span>{t('market_view_cart').replace('{n}', String(cartItems.reduce((a, i) => a + i.qty, 0)))}</span>
                    <span>{formatCurrency(cartTotal)}</span>
                  </button>
                </div>
              )}
            </>
          )}

          {orderStep === 'cart' && (
            <div className="px-2 space-y-4">
              <h3 className="text-xl font-bold uv-text-primary">{t('market_your_order')}</h3>

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

              {/* El envio lo fija el servidor al crear el pedido, asi que aqui
                  no hay total: el que se mostraba salia de una tabla local y no
                  coincidia con lo que se debitaba. */}
              <div className="uv-surface-2 rounded-xl p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="uv-text-muted">{t('market_subtotal')}</span>
                  <span className="font-bold uv-text-primary">{formatCurrency(cartTotal)}</span>
                </div>
                <p className="uv-text-muted text-sm pt-2 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                  {t('order_delivery_fee_pending')}
                </p>
              </div>

              <AvisoHoja aviso={orderAviso} />

              <button
                onClick={handlePlaceOrder}
                disabled={isPlacingOrder}
                className={`w-full py-4 rounded-xl font-bold text-lg text-white bg-gradient-to-r ${selectedPartner?.color || 'from-primary to-accent'} disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
              >
                {isPlacingOrder ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('processing')}
                  </>
                ) : (
                  t('market_pay_with_kiramopay')
                )}
              </button>
            </div>
          )}

          {orderStep === 'tracking' && (
            <div className="px-2 py-2 space-y-5">
              <div className="text-center">
                <h3 className="text-xl font-bold uv-text-primary mb-1">
                  {activeOrder?.status === 'delivered' ? t('market_order_delivered') : t('market_order_in_progress')}
                </h3>
                <p className="uv-text-muted">{selectedRestaurant?.name}</p>
              </div>

              {activeOrder?.status !== 'delivered' && (
                <div className="uv-surface-2 rounded-xl p-4 text-center">
                  <p className="text-sm text-gray-500 mb-1">{t('market_order_arrives_in')}</p>
                  <p className="text-3xl font-semibold uv-text-primary">
                    {(activeOrder?.minutesRemaining ?? 0) > 0 ? minutosEn(activeOrder?.minutesRemaining ?? 0) : t('market_almost_ready')}
                  </p>
                </div>
              )}

              {/* Live status stepper (driven by the backend status) */}
              <div className="space-y-3">
                {FOOD_STEPS.map((step, i) => {
                  const current = FOOD_STATUS_INDEX[activeOrder?.status ?? 'preparing'];
                  const done = current >= i;
                  const active = current === i;
                  return (
                    <div key={step.key} className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-lg ${
                          done
                            ? 'bg-green-500 text-white'
                            : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-gray-400'
                        } ${active ? 'ring-2 ring-green-400' : ''}`}
                      >
                        {done ? <Icons.Check size={18} /> : <step.Icono size={18} aria-hidden="true" />}
                      </div>
                      <span className={`font-medium ${done ? 'uv-text-primary' : 'uv-text-muted'}`}>
                        {t(step.labelKey)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Lo cobrado, con las cifras que devolvio el servidor: el envio
                  es el suyo, no el de ninguna tabla local. */}
              {activeOrder && (
                <div className="uv-surface-2 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="uv-text-muted">{t('market_subtotal')}</span>
                    <span className="font-bold uv-text-primary">{formatCurrency(activeOrder.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="uv-text-muted">{t('market_delivery')}</span>
                    <span className="font-bold uv-text-primary">{formatCurrency(activeOrder.deliveryFee)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                    <span className="font-bold uv-text-primary">{t('market_total_charged')}</span>
                    <span className="font-semibold text-xl uv-text-primary">{formatCurrency(activeOrder.total)}</span>
                  </div>
                </div>
              )}

              {/* Courier card appears once the order is on the way */}
              {activeOrder?.courier && (
                <div className="flex items-center gap-4 uv-surface-2 p-4 rounded-xl">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-3-dark)] uv-text-secondary">
                    <IconosLinea.Moto size={26} aria-hidden="true" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold uv-text-primary">{activeOrder.courier.name}</p>
                    <p className="text-sm text-gray-500">{t('market_your_courier')}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold uv-text-primary">{activeOrder.courier.vehicle}</p>
                    <p className="text-sm text-gray-500">{activeOrder.courier.plate}</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => { setShowFoodSheet(false); setOrderStep('menu'); setCartItems([]); setActiveOrder(null); setOrderAviso(null); }}
                className="w-full bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold"
              >
                {activeOrder?.status === 'delivered' ? t('done') : t('market_keep_in_background')}
              </button>
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
};
