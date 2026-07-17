/**
 * Backward-compatible useApp() hook.
 *
 * Composes all Zustand stores into the same { state, dispatch } shape
 * that views expect from the old AppContext. This allows incremental
 * migration — views can switch to individual stores one by one.
 *
 * When VITE_API_URL is set, mutating actions call the real backend first,
 * then refresh the relevant stores with server data.
 */
import { useCallback } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useAccountStore } from '@/stores/account.store';
import { useTransactionStore } from '@/stores/transaction.store';
import { useSinpeStore } from '@/stores/sinpe.store';
import { useCryptoStore } from '@/stores/crypto.store';
import { useServicesStore } from '@/stores/services.store';
import { useNotificationStore } from '@/stores/notification.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { AppState, AppAction } from '@/types';
import { getApiLayer } from '@/api';
import {
  refreshAccounts,
  refreshTransactions,
  refreshSinpe,
  refreshNotifications,
} from '@/services/dataSync';

const hasBackend = !!import.meta.env.VITE_API_URL;

export function useApp(): { state: AppState; dispatch: React.Dispatch<AppAction> } {
  const auth = useAuthStore();
  const accounts = useAccountStore();
  const txStore = useTransactionStore();
  const sinpe = useSinpeStore();
  const crypto = useCryptoStore();
  const services = useServicesStore();
  const notifications = useNotificationStore();
  const settings = useSettingsStore();

  const state: AppState = {
    isAuthenticated: auth.isAuthenticated,
    isOnboarded: auth.isOnboarded,
    user: auth.user,
    // Legacy AppState compatibility — passwordHash is no longer used or
    // persisted; lock screen now operates on a separate PIN via lockKdf.
    passwordHash: '',
    baseCurrency: accounts.baseCurrency,
    accounts: accounts.accounts,
    transactions: txStore.transactions,
    budgets: accounts.budgets,
    cards: accounts.cards,
    sinpeContacts: sinpe.sinpeContacts,
    sinpeHistory: sinpe.sinpeHistory,
    savedServices: services.savedServices,
    billHistory: services.billHistory,
    connectedPartners: services.connectedPartners,
    rechargeHistory: services.rechargeHistory,
    crypto: {
      // Default to [] so a missing/corrupt persisted crypto slice (e.g. an old
      // localStorage blob where an array rehydrated as null/undefined) can never
      // crash a consumer that calls .reduce/.filter/.map on it — an empty
      // portfolio is a valid, already-handled state. Mirrors the `|| []` guard
      // used for state.notifications in App.tsx.
      assets: crypto.assets ?? [],
      transactions: crypto.transactions ?? [],
      stakingPositions: crypto.stakingPositions ?? [],
      priceAlerts: crypto.priceAlerts ?? [],
      favoriteAssets: crypto.favoriteAssets ?? [],
      defaultConvertCurrency: crypto.defaultConvertCurrency,
    },
    notifications: notifications.notifications,
    settings: {
      darkMode: settings.darkMode,
      offlineMode: settings.offlineMode,
      isLocked: settings.isLocked,
      biometricEnabled: settings.biometricEnabled,
      notificationsEnabled: settings.notificationsEnabled,
      language: settings.language,
    },
  };

  const dispatch = useCallback((action: AppAction) => {
    switch (action.type) {
      case 'TOGGLE_THEME':
        settings.toggleDarkMode();
        break;
      case 'TOGGLE_OFFLINE':
        settings.toggleOfflineMode();
        break;
      case 'TOGGLE_LOCK':
        settings.setLocked(action.payload);
        break;
      case 'TOGGLE_FREEZE':
        accounts.toggleFreeze();
        if (hasBackend) {
          const api = getApiLayer();
          // If frozen after toggle, freeze; otherwise unfreeze
          const willBeFrozen = !accounts.cards.frozen;
          api.cards?.freezeCard('default', willBeFrozen).catch(() => {});
        }
        break;
      case 'SET_BASE_CURRENCY':
        accounts.setBaseCurrency(action.payload);
        break;
      case 'ADD_TRANSACTION':
        txStore.addTransaction(action.payload);
        accounts.updateAccountBalance(action.payload.ccy, action.payload.amount);
        break;
      case 'ADD_ACCOUNT':
        accounts.addAccount(action.payload);
        break;
      case 'UPDATE_LIMITS':
        accounts.updateLimits(action.payload);
        if (hasBackend) {
          const api = getApiLayer();
          // Map the local {online, atm} limits to the repository's request shape.
          api.cards
            ?.updateLimits('default', {
              dailyLimit: action.payload.online,
              atmLimit: action.payload.atm,
            })
            .catch(() => {});
        }
        break;
      case 'CHANGE_PASSWORD':
        // No-op locally: actual password change goes through auth.changePassword
        // which talks to the backend. We do not retain any client-side
        // password derivative. The unlock PIN is managed independently.
        break;
      case 'LOGIN':
        auth.loginWithUser(action.payload);
        settings.setLocked(false);
        break;
      case 'LOGOUT':
        auth.logout();
        settings.setLocked(true);
        break;
      case 'COMPLETE_ONBOARDING':
        auth.completeOnboarding();
        break;
      case 'ADD_SINPE_CONTACT': {
        // Optimistic local update
        sinpe.addContact(action.payload);
        if (hasBackend) {
          const api = getApiLayer();
          api.sinpe.addContact(action.payload).catch(() => {});
        }
        break;
      }
      case 'ADD_SINPE_TRANSACTION': {
        // Optimistic local update
        sinpe.addTransaction(action.payload);
        const sinpeTx = {
          id: `sinpe-${action.payload.id}`,
          title:
            action.payload.type === 'sent'
              ? `SINPE a ${action.payload.name}`
              : `SINPE de ${action.payload.name}`,
          amount:
            action.payload.type === 'sent'
              ? -action.payload.amount
              : action.payload.amount,
          ccy: 'CRC',
          date: action.payload.date,
          type: (action.payload.type === 'sent' ? 'debit' : 'credit') as 'debit' | 'credit',
          category: 'SINPE',
          status: (action.payload.status === 'completed' ? 'completed' : 'pending') as
            | 'completed'
            | 'pending',
        };
        txStore.addTransaction(sinpeTx);
        accounts.updateAccountBalance(
          'CRC',
          action.payload.type === 'sent' ? -action.payload.amount : action.payload.amount,
        );
        // If backend is available, the SINPE send already happened through the view.
        // Just refresh to get canonical data.
        if (hasBackend) {
          refreshAccounts().catch(() => {});
          refreshTransactions().catch(() => {});
          refreshSinpe().catch(() => {});
        }
        break;
      }
      case 'ADD_SAVED_SERVICE':
        services.addSavedService(action.payload);
        if (hasBackend) {
          const api = getApiLayer();
          api.services.addSavedService(action.payload).catch(() => {});
        }
        break;
      case 'ADD_BILL_PAYMENT': {
        services.addBillPayment(action.payload);
        const billTx = {
          id: `bill-${action.payload.id}`,
          title: `Pago ${action.payload.providerName}`,
          amount: -action.payload.amount,
          ccy: 'CRC',
          date: 'Ahora',
          type: 'debit' as const,
          category: 'Servicios',
          status: 'completed' as const,
        };
        txStore.addTransaction(billTx);
        accounts.updateAccountBalance('CRC', -action.payload.amount);
        if (hasBackend) {
          refreshAccounts().catch(() => {});
          refreshTransactions().catch(() => {});
        }
        break;
      }
      case 'CONNECT_PARTNER':
        services.connectPartner(action.payload);
        break;
      case 'DISCONNECT_PARTNER':
        services.disconnectPartner(action.payload);
        break;
      case 'ADD_RECHARGE': {
        services.addRecharge(action.payload);
        const rechargeTx = {
          id: `recharge-${action.payload.id}`,
          title: `Recarga ${action.payload.phone}`,
          amount: -action.payload.amount,
          ccy: 'CRC',
          date: action.payload.date,
          type: 'debit' as const,
          category: 'Recarga',
          status: (action.payload.status === 'completed' ? 'completed' : 'pending') as
            | 'completed'
            | 'pending',
        };
        txStore.addTransaction(rechargeTx);
        accounts.updateAccountBalance('CRC', -action.payload.amount);
        if (hasBackend) {
          refreshAccounts().catch(() => {});
          refreshTransactions().catch(() => {});
        }
        break;
      }
      case 'TOGGLE_BIOMETRIC':
        settings.toggleBiometric();
        break;
      case 'TOGGLE_NOTIFICATIONS':
        settings.toggleNotifications();
        break;
      case 'SET_LANGUAGE':
        settings.setLanguage(action.payload);
        break;
      case 'ADD_NOTIFICATION':
        notifications.addNotification(action.payload);
        break;
      case 'MARK_NOTIFICATION_READ':
        notifications.markRead(action.payload); // optimistic
        if (hasBackend) {
          // Reconcile from the backend if the write didn't persist, so the read
          // state can't silently revert on the next sync.
          getApiLayer()
            .notifications.markRead(action.payload)
            .then((res) => {
              if (!res.success) refreshNotifications();
            })
            .catch(() => refreshNotifications());
        }
        break;
      case 'MARK_ALL_NOTIFICATIONS_READ':
        notifications.markAllRead(); // optimistic
        if (hasBackend) {
          getApiLayer()
            .notifications.markAllRead()
            .then((res) => {
              if (!res.success) refreshNotifications();
            })
            .catch(() => refreshNotifications());
        }
        break;
      case 'DELETE_NOTIFICATION':
        notifications.deleteNotification(action.payload);
        if (hasBackend) {
          const api = getApiLayer();
          api.notifications.delete(action.payload).catch(() => {});
        }
        break;
      case 'UPDATE_CRYPTO_PRICES':
        crypto.updatePrices(action.payload);
        break;
      case 'BUY_CRYPTO': {
        const { asset, amount, price, fromCurrency, fromAmount } = action.payload;
        crypto.buyCrypto(asset, amount, price);
        const buyTx = {
          id: `ctx-${Date.now()}`,
          type: 'buy' as const,
          fromAsset: fromCurrency,
          toAsset: asset,
          fromAmount,
          toAmount: amount,
          price,
          fee: fromAmount * 0.005,
          date: 'Ahora',
          status: 'completed' as const,
        };
        crypto.addTransaction(buyTx);
        accounts.updateAccountBalance(fromCurrency, -fromAmount);
        if (hasBackend) {
          const api = getApiLayer();
          api.crypto.buy({ asset, amount, price, fromCurrency, fromAmount }).catch(() => {});
          refreshAccounts().catch(() => {});
        }
        break;
      }
      case 'SELL_CRYPTO': {
        const { asset, amount, price, toCurrency, toAmount } = action.payload;
        crypto.sellCrypto(asset, amount);
        const sellTx = {
          id: `ctx-${Date.now()}`,
          type: 'sell' as const,
          fromAsset: asset,
          toAsset: toCurrency,
          fromAmount: amount,
          toAmount,
          price,
          fee: toAmount * 0.005,
          date: 'Ahora',
          status: 'completed' as const,
        };
        crypto.addTransaction(sellTx);
        accounts.updateAccountBalance(toCurrency, toAmount);
        if (hasBackend) {
          const api = getApiLayer();
          api.crypto.sell({ asset, amount, price, toCurrency, toAmount }).catch(() => {});
          refreshAccounts().catch(() => {});
        }
        break;
      }
      case 'CONVERT_CRYPTO': {
        const { fromAsset, toAsset, fromAmount, toAmount, price } = action.payload;
        crypto.convertCrypto(fromAsset, toAsset, fromAmount, toAmount, price);
        const convertTx = {
          id: `ctx-${Date.now()}`,
          type: 'convert' as const,
          fromAsset,
          toAsset,
          fromAmount,
          toAmount,
          price,
          fee: fromAmount * 0.001,
          date: 'Ahora',
          status: 'completed' as const,
        };
        crypto.addTransaction(convertTx);
        if (hasBackend) {
          const api = getApiLayer();
          api.crypto.convert({ fromAsset, toAsset, fromAmount, toAmount, price }).catch(() => {});
          refreshAccounts().catch(() => {});
        }
        break;
      }
      case 'SEND_CRYPTO': {
        const { asset, amount, fee } = action.payload;
        crypto.sendCrypto(asset, amount, fee);
        const currentAsset = crypto.assets.find((a) => a.symbol === asset);
        const sendTx = {
          id: `ctx-${Date.now()}`,
          type: 'send' as const,
          fromAsset: asset,
          fromAmount: amount,
          price: currentAsset?.currentPrice || 0,
          fee,
          date: 'Ahora',
          status: 'completed' as const,
          txHash: `0x${Math.random().toString(16).slice(2, 10)}...`,
        };
        crypto.addTransaction(sendTx);
        if (hasBackend) {
          refreshAccounts().catch(() => {});
        }
        break;
      }
      case 'RECEIVE_CRYPTO': {
        const { asset, amount } = action.payload;
        crypto.receiveCrypto(asset, amount);
        const currentAsset = crypto.assets.find((a) => a.symbol === asset);
        const receiveTx = {
          id: `ctx-${Date.now()}`,
          type: 'receive' as const,
          fromAsset: asset,
          fromAmount: amount,
          price: currentAsset?.currentPrice || 0,
          fee: 0,
          date: 'Ahora',
          status: 'completed' as const,
          txHash: `0x${Math.random().toString(16).slice(2, 10)}...`,
        };
        crypto.addTransaction(receiveTx);
        if (hasBackend) {
          refreshAccounts().catch(() => {});
        }
        break;
      }
      case 'STAKE_CRYPTO': {
        const { asset, amount, apy, locked, lockDays } = action.payload;
        crypto.stakeCrypto(asset, amount, apy, locked, lockDays);
        const currentAsset = crypto.assets.find((a) => a.symbol === asset);
        const stakeTx = {
          id: `ctx-${Date.now()}`,
          type: 'stake' as const,
          fromAsset: asset,
          fromAmount: amount,
          price: currentAsset?.currentPrice || 0,
          fee: 0,
          date: 'Ahora',
          status: 'completed' as const,
        };
        crypto.addTransaction(stakeTx);
        if (hasBackend) {
          const api = getApiLayer();
          api.crypto.stake({ asset, amount, apy, locked, lockDays }).catch(() => {});
          refreshAccounts().catch(() => {});
        }
        break;
      }
      case 'UNSTAKE_CRYPTO': {
        const position = crypto.stakingPositions.find(
          (p) => p.id === action.payload.positionId,
        );
        if (position) {
          const currentAsset = crypto.assets.find((a) => a.symbol === position.asset);
          crypto.unstakeCrypto(action.payload.positionId);
          const unstakeTx = {
            id: `ctx-${Date.now()}`,
            type: 'unstake' as const,
            fromAsset: position.asset,
            fromAmount: position.amount + position.earned,
            price: currentAsset?.currentPrice || 0,
            fee: 0,
            date: 'Ahora',
            status: 'completed' as const,
          };
          crypto.addTransaction(unstakeTx);
          if (hasBackend) {
            const api = getApiLayer();
            api.crypto.unstake(action.payload.positionId).catch(() => {});
            refreshAccounts().catch(() => {});
          }
        }
        break;
      }
      case 'CLAIM_STAKING_YIELD': {
        const { positionId, amount } = action.payload;
        const pos = crypto.stakingPositions.find((p) => p.id === positionId);
        if (pos) {
          const currentAsset = crypto.assets.find((a) => a.symbol === pos.asset);
          crypto.claimYield(positionId, amount);
          const yieldTx = {
            id: `ctx-${Date.now()}`,
            type: 'yield' as const,
            fromAsset: pos.asset,
            fromAmount: amount,
            price: currentAsset?.currentPrice || 0,
            fee: 0,
            date: 'Ahora',
            status: 'completed' as const,
          };
          crypto.addTransaction(yieldTx);
          if (hasBackend) {
            const api = getApiLayer();
            api.crypto.claimYield(positionId).catch(() => {});
            refreshAccounts().catch(() => {});
          }
        }
        break;
      }
      case 'ADD_PRICE_ALERT':
        crypto.addPriceAlert(action.payload);
        if (hasBackend) {
          const api = getApiLayer();
          api.crypto.addPriceAlert(action.payload).catch(() => {});
        }
        break;
      case 'REMOVE_PRICE_ALERT':
        crypto.removePriceAlert(action.payload);
        if (hasBackend) {
          const api = getApiLayer();
          api.crypto.removePriceAlert(action.payload).catch(() => {});
        }
        break;
      case 'TOGGLE_FAVORITE_ASSET':
        crypto.toggleFavorite(action.payload);
        break;
    }
  }, [auth, accounts, txStore, sinpe, crypto, services, notifications, settings]);

  return { state, dispatch };
}
