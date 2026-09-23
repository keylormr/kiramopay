import type { User } from './auth.types';
import type { Account, Budget } from './account.types';
import type { Transaction } from './transaction.types';
import type { SinpeContact, SinpeTransaction } from './sinpe.types';
import type { SavedService, Bill, Recharge } from './services.types';
import type { CryptoState, CryptoTransaction, PriceAlert, StakingPosition } from './crypto.types';
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
  | { type: 'ADD_TRANSACTION'; payload: Transaction }
  | { type: 'SET_BASE_CURRENCY'; payload: string }
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
  | { type: 'UPDATE_CRYPTO_PRICES'; payload: { symbol: string; price: number; change24h: number; priceHistory?: number[] }[] }
  // El movimiento tal como lo devolvio el servidor, con su id, su precio y sus
  // cantidades: el las liquida, y el reintento con la misma llave devuelve la
  // operacion original. El estimado de la pantalla no sirve para anotarlo.
  | { type: 'BUY_CRYPTO'; payload: CryptoTransaction }
  | { type: 'SELL_CRYPTO'; payload: CryptoTransaction }
  | { type: 'CONVERT_CRYPTO'; payload: CryptoTransaction }
  // El envio ya ocurrio en el servidor cuando esto se despacha: `fee` es la
  // comision de KiramoPay que el cobro y `counterpartyName` la persona a la que
  // le llego, ambos tal como vinieron en su respuesta. No hay direccion de
  // destino porque esta cripto no vive en ninguna cadena: el destinatario es
  // otra persona de KiramoPay, resuelta desde su QR.
  | { type: 'SEND_CRYPTO'; payload: { asset: string; amount: number; fee: number; price: number; counterpartyName: string } }
  // La posicion tal como la devolvio el servidor: su id es el unico con el que
  // despues se puede retirar.
  | { type: 'STAKE_CRYPTO'; payload: StakingPosition }
  | { type: 'UNSTAKE_CRYPTO'; payload: { positionId: string } }
  | { type: 'CLAIM_STAKING_YIELD'; payload: { positionId: string; amount: number } }
  // La lista que devolvio el servidor. Crear y quitar alertas pasan primero
  // por la API (ver views/crypto/AlertasDePrecio.tsx); el estado solo copia
  // lo que el servidor confirmo.
  | { type: 'SET_PRICE_ALERTS'; payload: PriceAlert[] }
  | { type: 'TOGGLE_FAVORITE_ASSET'; payload: string };
