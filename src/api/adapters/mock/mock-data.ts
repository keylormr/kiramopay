import type {
  Account,
  Transaction,
  Budget,
  SinpeContact,
  SinpeTransaction,
  Notification,
  CryptoAsset,
  CryptoTransaction,
  StakingPosition,
  SavedService,
  Recharge,
} from '@/types';

export const initialAccounts: Account[] = [
  { ccy: 'CRC', balance: 384500, symbol: '₡', flag: '🇨🇷', iban: 'CR14 0152 0001 2345 6789 01', name: 'Colones Account', type: 'fiat', rateToUsd: 0.0019 },
  { ccy: 'USD', balance: 356.40, symbol: '$', flag: '🇺🇸', iban: 'GB66 SWLT 0012 3456 00US', name: 'US Dollar Account', type: 'fiat', rateToUsd: 1 },
];

export const initialTransactions: Transaction[] = [
  { id: '1', title: 'Café Alma', amount: -7500, ccy: 'CRC', date: 'Hoy, 9:41 AM', type: 'debit', category: 'Comida', status: 'completed' },
  { id: '2', title: 'SINPE de Diego', amount: 25000, ccy: 'CRC', date: 'Ayer, 4:20 PM', type: 'credit', category: 'SINPE', status: 'completed' },
  { id: '3', title: 'Uber', amount: -4350, ccy: 'CRC', date: 'Ayer, 8:15 AM', type: 'debit', category: 'Transporte', status: 'completed' },
  { id: '4', title: 'Pago ICE', amount: -32450, ccy: 'CRC', date: '24 Dic, 2024', type: 'debit', category: 'Servicios', status: 'completed' },
  { id: '5', title: 'Uber Eats', amount: -12800, ccy: 'CRC', date: '23 Dic, 2024', type: 'debit', category: 'Comida', status: 'completed' },
];

export const initialBudgets: Budget[] = [
  { id: '1', label: 'Comida', spent: 45000, limit: 80000, ccy: 'CRC', icon: 'utensils', color: '#f97316' },
  { id: '2', label: 'Transporte', spent: 12500, limit: 30000, ccy: 'CRC', icon: 'car', color: '#3b82f6' },
  { id: '3', label: 'Entretenimiento', spent: 8000, limit: 25000, ccy: 'CRC', icon: 'gamepad-2', color: '#a855f7' },
  { id: '4', label: 'Servicios', spent: 32450, limit: 60000, ccy: 'CRC', icon: 'zap', color: '#eab308' },
];

export const initialSinpeContacts: SinpeContact[] = [
  { id: '1', name: 'Diego Mora', phone: '8888-1234', bank: 'BAC', isFavorite: true },
  { id: '2', name: 'María González', phone: '7777-5678', bank: 'BCR', isFavorite: true },
  { id: '3', name: 'Carlos Jiménez', phone: '6666-9012', bank: 'Banco Nacional', isFavorite: false },
  { id: '4', name: 'Ana Rodríguez', phone: '8585-3456', bank: 'Scotiabank', isFavorite: false },
];

export const initialSinpeHistory: SinpeTransaction[] = [
  { id: '1', type: 'sent', amount: 15000, phone: '8888-1234', name: 'Diego Mora', date: 'Hoy, 2:30 PM', status: 'completed', reference: 'Almuerzo' },
  { id: '2', type: 'received', amount: 25000, phone: '7777-5678', name: 'María González', date: 'Ayer, 4:20 PM', status: 'completed', reference: 'Pago deuda' },
  { id: '3', type: 'sent', amount: 50000, phone: '6666-9012', name: 'Carlos Jiménez', date: '22 Dic, 10:15 AM', status: 'completed', reference: 'Regalo' },
];

export const initialNotifications: Notification[] = [
  { id: '1', title: 'Bienvenido a KiramoPay', message: 'Tu cuenta ha sido creada exitosamente. ¡Comienza a disfrutar de todos los beneficios!', type: 'info', date: 'Hoy, 10:00 AM', read: false },
  { id: '2', title: 'SINPE recibido', message: 'María González te envió ₡25,000 por SINPE Móvil', type: 'transaction', date: 'Ayer, 4:20 PM', read: false },
  { id: '3', title: 'Pago exitoso', message: 'Tu pago de ₡32,450 a ICE fue procesado correctamente', type: 'transaction', date: '24 Dic, 2024', read: true },
  { id: '4', title: 'Promoción especial', message: 'Obtén 5% de cashback en tus compras de supermercado este fin de semana', type: 'promo', date: '22 Dic, 2024', read: true },
  { id: '5', title: 'Seguridad', message: 'Se detectó un nuevo inicio de sesión desde tu dispositivo', type: 'security', date: '20 Dic, 2024', read: true },
];

export const initialCryptoAssets: CryptoAsset[] = [
  { id: 'btc', symbol: 'BTC', name: 'Bitcoin', icon: '₿', color: '#F7931A', balance: 0.0523, avgBuyPrice: 42500, currentPrice: 42850, priceChange24h: 2.35, priceHistory: [41200, 41800, 42100, 42500, 42300, 42650, 42850] },
  { id: 'eth', symbol: 'ETH', name: 'Ethereum', icon: 'Ξ', color: '#627EEA', balance: 1.245, avgBuyPrice: 2180, currentPrice: 2340, priceChange24h: 1.85, priceHistory: [2250, 2280, 2310, 2290, 2320, 2335, 2340] },
  { id: 'usdt', symbol: 'USDT', name: 'Tether', icon: '₮', color: '#26A17B', balance: 500.00, avgBuyPrice: 1, currentPrice: 1.00, priceChange24h: 0.01, priceHistory: [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00] },
  { id: 'usdc', symbol: 'USDC', name: 'USD Coin', icon: '$', color: '#2775CA', balance: 250.00, avgBuyPrice: 1, currentPrice: 1.00, priceChange24h: -0.01, priceHistory: [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00] },
  { id: 'sol', symbol: 'SOL', name: 'Solana', icon: '◎', color: '#9945FF', balance: 0, avgBuyPrice: 0, currentPrice: 98.50, priceChange24h: 4.25, priceHistory: [92.80, 94.50, 95.20, 96.80, 97.40, 98.10, 98.50] },
  { id: 'matic', symbol: 'MATIC', name: 'Polygon', icon: '⬡', color: '#8247E5', balance: 0, avgBuyPrice: 0, currentPrice: 0.89, priceChange24h: -1.25, priceHistory: [0.92, 0.91, 0.90, 0.88, 0.87, 0.88, 0.89] },
];

export const initialCryptoTransactions: CryptoTransaction[] = [
  { id: 'ctx1', type: 'buy', fromAsset: 'USD', toAsset: 'BTC', fromAmount: 500, toAmount: 0.0115, price: 43478, fee: 2.50, date: 'Hoy, 10:30 AM', status: 'completed', txHash: '0xabc123...' },
  { id: 'ctx2', type: 'receive', fromAsset: 'ETH', fromAmount: 0.5, price: 2320, fee: 0, date: 'Ayer, 3:15 PM', status: 'completed', txHash: '0xdef456...' },
  { id: 'ctx3', type: 'convert', fromAsset: 'USDT', toAsset: 'ETH', fromAmount: 200, toAmount: 0.085, price: 2352, fee: 1.00, date: '28 Dic, 2024', status: 'completed' },
  { id: 'ctx4', type: 'stake', fromAsset: 'ETH', fromAmount: 0.5, price: 2340, fee: 0, date: '25 Dic, 2024', status: 'completed' },
  { id: 'ctx5', type: 'yield', fromAsset: 'ETH', fromAmount: 0.0012, price: 2340, fee: 0, date: '30 Dic, 2024', status: 'completed' },
];

export const initialStakingPositions: StakingPosition[] = [
  { id: 'stake1', asset: 'ETH', amount: 0.5, apy: 4.5, startDate: '25 Dic, 2024', earned: 0.0012, locked: false },
  { id: 'stake2', asset: 'USDT', amount: 200, apy: 8.0, startDate: '20 Dic, 2024', earned: 1.32, locked: true, lockPeriodDays: 30 },
];

export const initialSavedServices: SavedService[] = [
  { id: '1', providerId: 'ice', clientId: '1234567', nickname: 'Casa', lastAmount: 32450, dueDate: '2025-01-15' },
  { id: '2', providerId: 'aya', clientId: '7654321', nickname: 'Apartamento', lastAmount: 8500, dueDate: '2025-01-20' },
];

export const initialRechargeHistory: Recharge[] = [
  { id: '1', operatorId: 'kolbi', phone: '8888-0000', amount: 5000, date: '20 Dic, 2024', status: 'completed' },
];
