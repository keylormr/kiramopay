import type { User } from './auth.types';
import type { Account, Budget } from './account.types';
import type { Transaction } from './transaction.types';
import type { SinpeContact, SinpeTransaction } from './sinpe.types';
import type { SavedService, Bill, Recharge } from './services.types';
import type { CryptoState, PriceAlert } from './crypto.types';
import type { Notification } from './notification.types';

export interface AppState {
  // Auth
  isAuthenticated: boolean;
  isOnboarded: boolean;
  user: User | null;

  // Core
  baseCurrency: string;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  passwordHash: string;

  // Cards
  cards: {
    frozen: boolean;
    last4: string;
    limits: {
      online: number;
      atm: number;
    };
  };

  // SINPE
  sinpeContacts: SinpeContact[];
  sinpeHistory: SinpeTransaction[];

  // Services
  savedServices: SavedService[];
  billHistory: Bill[];

  // Marketplace
  connectedPartners: string[];

  // Recharges
  rechargeHistory: Recharge[];

  // Crypto
  crypto: CryptoState;

  // Notifications
  notifications: Notification[];

  // Settings
  settings: {
    darkMode: boolean;
    offlineMode: boolean;
    isLocked: boolean;
    biometricEnabled: boolean;
    notificationsEnabled: boolean;
    language: 'es' | 'en';
  };
}

export type AppAction =
  | { type: 'TOGGLE_THEME' }
  | { type: 'TOGGLE_OFFLINE' }
  | { type: 'TOGGLE_LOCK'; payload: boolean }
  | { type: 'TOGGLE_FREEZE' }
  | { type: 'ADD_TRANSACTION'; payload: Transaction }
  | { type: 'SET_BASE_CURRENCY'; payload: string }
  | { type: 'ADD_ACCOUNT'; payload: Account }
  | { type: 'UPDATE_LIMITS'; payload: { online: number; atm: number } }
  | { type: 'CHANGE_PASSWORD'; payload: string }
  | { type: 'LOGIN'; payload: User }
  | { type: 'LOGOUT' }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'ADD_SINPE_CONTACT'; payload: SinpeContact }
  | { type: 'ADD_SINPE_TRANSACTION'; payload: SinpeTransaction }
  | { type: 'ADD_SAVED_SERVICE'; payload: SavedService }
  | { type: 'ADD_BILL_PAYMENT'; payload: Bill }
  | { type: 'CONNECT_PARTNER'; payload: string }
  | { type: 'DISCONNECT_PARTNER'; payload: string }
  | { type: 'ADD_RECHARGE'; payload: Recharge }
  | { type: 'TOGGLE_BIOMETRIC' }
  | { type: 'TOGGLE_NOTIFICATIONS' }
  | { type: 'SET_LANGUAGE'; payload: 'es' | 'en' }
  | { type: 'ADD_NOTIFICATION'; payload: Notification }
  | { type: 'MARK_NOTIFICATION_READ'; payload: string }
  | { type: 'MARK_ALL_NOTIFICATIONS_READ' }
  | { type: 'DELETE_NOTIFICATION'; payload: string }
  | { type: 'UPDATE_CRYPTO_PRICES'; payload: { symbol: string; price: number; change24h: number }[] }
  | { type: 'BUY_CRYPTO'; payload: { asset: string; amount: number; price: number; fromCurrency: string; fromAmount: number } }
  | { type: 'SELL_CRYPTO'; payload: { asset: string; amount: number; price: number; toCurrency: string; toAmount: number } }
  | { type: 'CONVERT_CRYPTO'; payload: { fromAsset: string; toAsset: string; fromAmount: number; toAmount: number; price: number } }
  | { type: 'SEND_CRYPTO'; payload: { asset: string; amount: number; toAddress: string; fee: number } }
  | { type: 'RECEIVE_CRYPTO'; payload: { asset: string; amount: number; fromAddress: string } }
  | { type: 'STAKE_CRYPTO'; payload: { asset: string; amount: number; apy: number; locked: boolean; lockDays?: number } }
  | { type: 'UNSTAKE_CRYPTO'; payload: { positionId: string } }
  | { type: 'CLAIM_STAKING_YIELD'; payload: { positionId: string; amount: number } }
  | { type: 'ADD_PRICE_ALERT'; payload: PriceAlert }
  | { type: 'REMOVE_PRICE_ALERT'; payload: string }
  | { type: 'TOGGLE_FAVORITE_ASSET'; payload: string };
