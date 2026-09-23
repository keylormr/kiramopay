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
import { comoLista } from '@/stores/fusionPersistida';
import { biometricService } from '@/services/biometric';
import type { AppState, AppAction } from '@/types';
import { getApiLayer } from '@/api';
import {
  refreshAccounts,
  refreshCrypto,
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
    // Cada una de estas se recorre en alguna vista. Si una porcion persistida
    // rehidrata con otra forma, ese recorrido lanza durante el render y tumba
    // la aplicacion entera. La guarda de verdad esta en el `merge` de cada
    // store; esto es el cinturon por si algo llega por otro camino.
    accounts: comoLista(accounts.accounts),
    transactions: comoLista(txStore.transactions),
    budgets: comoLista(accounts.budgets),
    sinpeContacts: comoLista(sinpe.sinpeContacts),
    sinpeHistory: comoLista(sinpe.sinpeHistory),
    savedServices: comoLista(services.savedServices),
    billHistory: comoLista(services.billHistory),
    connectedPartners: comoLista(services.connectedPartners),
    rechargeHistory: comoLista(services.rechargeHistory),
    crypto: {
      // Esta porcion ya tenia la guarda desde el commit 3707f01, cuando un
      // estado de cripto corrupto tumbaba la aplicacion entera. Pasa de `?? []`
      // a la misma comprobacion que el resto: `??` solo salva de null y
      // undefined, y lo que hay que cubrir es que el valor tenga otra forma.
      assets: comoLista(crypto.assets),
      transactions: comoLista(crypto.transactions),
      stakingPositions: comoLista(crypto.stakingPositions),
      priceAlerts: comoLista(crypto.priceAlerts),
      favoriteAssets: comoLista(crypto.favoriteAssets),
      defaultConvertCurrency: crypto.defaultConvertCurrency,
    },
    notifications: comoLista(notifications.notifications),
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
      case 'SET_BASE_CURRENCY':
        accounts.setBaseCurrency(action.payload);
        break;
      case 'ADD_TRANSACTION':
        txStore.addTransaction(action.payload);
        accounts.updateAccountBalance(action.payload.ccy, action.payload.amount);
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
        // Optimistic local update. Antes el .catch(() => {}) se comia
        // cualquier rechazo del servidor (p. ej. CONTACT_EXISTS cuando otra
        // sesion del mismo usuario ya lo habia guardado con otro nombre/banco)
        // y el alta fantasma se quedaba en pantalla hasta el proximo
        // syncAllData completo. Se resincroniza contra el servidor -misma
        // verdad que ya usan MARK_NOTIFICATION_READ/MARK_ALL_NOTIFICATIONS_READ
        // arriba- para revertir o reemplazar por el contacto real.
        sinpe.addContact(action.payload);
        if (hasBackend) {
          const api = getApiLayer();
          api.sinpe
            .addContact(action.payload)
            .then((res) => {
              if (!res.success) refreshSinpe().catch(() => {});
            })
            .catch(() => refreshSinpe().catch(() => {}));
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
        // Tocar el toggle (en Perfil o donde sea) cuenta como haber visto la
        // oferta: sin esta marca, DESACTIVAR la biometria re-disparaba la
        // hoja de oferta encima del perfil (la oferta chequea !enabled).
        try {
          localStorage.setItem('kiramopay-biometria-ofrecida', '1');
        } catch { /* sin storage no hay marca que dejar */ }
        // If biometrics was just turned OFF, forget the stored credentials so a
        // fingerprint/Face ID login can no longer retrieve them (native Keychain).
        if (!useSettingsStore.getState().biometricEnabled) {
          void biometricService.deleteCredentials('kiramopay');
        }
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
        // La fila y los saldos salen del movimiento que devolvio el servidor, con
        // su id: el liquida con su precio, y el reintento con la misma llave trae
        // la compra de aquella vez. Antes se armaba una fila propia con el
        // estimado de la pantalla y un id que no existia en ningun lado.
        const { fromAsset, fromAmount, toAsset = '', toAmount = 0, price } = action.payload;
        crypto.buyCrypto(toAsset, toAmount, price);
        crypto.addTransaction(action.payload);
        accounts.updateAccountBalance(fromAsset, -fromAmount);
        // La llamada al backend NO va aca: la hace la vista y espera la
        // respuesta. Antes se despachaba primero y se llamaba con
        // .catch(() => {}), asi que un rechazo del servidor -incluido el de
        // MFA por monto alto- se tragaba y la pantalla mostraba una operacion
        // que nunca ocurrio.
        if (hasBackend) {
          refreshAccounts().catch(() => {});
          refreshCrypto().catch(() => {});
        }
        break;
      }
      case 'SELL_CRYPTO': {
        // Lo acreditado es lo que dijo el servidor: una venta en colones se
        // liquida con SU tipo de cambio, que no es el que tiene la pantalla.
        const { fromAsset, fromAmount, toAsset = '', toAmount = 0 } = action.payload;
        crypto.sellCrypto(fromAsset, fromAmount);
        crypto.addTransaction(action.payload);
        accounts.updateAccountBalance(toAsset, toAmount);
        // La llamada al backend NO va aca: la hace la vista y espera la
        // respuesta. Antes se despachaba primero y se llamaba con
        // .catch(() => {}), asi que un rechazo del servidor -incluido el de
        // MFA por monto alto- se tragaba y la pantalla mostraba una operacion
        // que nunca ocurrio.
        if (hasBackend) {
          refreshAccounts().catch(() => {});
          refreshCrypto().catch(() => {});
        }
        break;
      }
      case 'CONVERT_CRYPTO': {
        // Lo recibido es lo que calculo el servidor con sus precios, no el
        // estimado de la pantalla.
        const { fromAsset, fromAmount, toAsset = '', toAmount = 0, price } = action.payload;
        crypto.convertCrypto(fromAsset, toAsset, fromAmount, toAmount, price);
        crypto.addTransaction(action.payload);
        // La llamada al backend NO va aca: la hace la vista y espera la
        // respuesta, igual que compra y venta. Antes se despachaba primero y se
        // llamaba con .catch(() => {}), asi que un rechazo del servidor se
        // tragaba y la pantalla mostraba una conversion que nunca ocurrio.
        if (hasBackend) {
          refreshCrypto().catch(() => {});
        }
        break;
      }
      case 'SEND_CRYPTO': {
        const { asset, amount, fee, price, counterpartyName } = action.payload;
        // Los numeros son los que devolvio el servidor, no los del telefono: la
        // comision de KiramoPay la calcula el, y la vista ya espero su respuesta
        // antes de despachar. Antes esta rama inventaba la comision y un hash de
        // cadena al azar, y descontaba el saldo sin que nadie hubiera enviado
        // nada.
        crypto.sendCrypto(asset, amount, fee);
        const sendTx = {
          id: `ctx-${Date.now()}`,
          type: 'send' as const,
          fromAsset: asset,
          fromAmount: amount,
          price,
          fee,
          date: new Date().toISOString(),
          status: 'completed' as const,
          counterpartyName,
        };
        crypto.addTransaction(sendTx);
        if (hasBackend) {
          refreshCrypto().catch(() => {});
        }
        break;
      }
      case 'STAKE_CRYPTO': {
        const { asset, amount } = action.payload;
        crypto.stakeCrypto(action.payload);
        // Sin precio, igual que lo anota el servidor: apartar no compra ni
        // vende nada. Con el precio del momento, la fila mostraba un valor en
        // dolares que desaparecia en cuanto llegaba la lista del servidor.
        const stakeTx = {
          id: `ctx-${Date.now()}`,
          type: 'stake' as const,
          fromAsset: asset,
          fromAmount: amount,
          price: 0,
          fee: 0,
          date: new Date().toISOString(),
          status: 'completed' as const,
        };
        crypto.addTransaction(stakeTx);
        // Igual que en conversion: la vista ya espero la confirmacion del
        // servidor antes de despachar esta accion.
        if (hasBackend) {
          refreshCrypto().catch(() => {});
        }
        break;
      }
      case 'UNSTAKE_CRYPTO': {
        const position = crypto.stakingPositions.find(
          (p) => p.id === action.payload.positionId,
        );
        if (position) {
          crypto.unstakeCrypto(action.payload.positionId);
          const unstakeTx = {
            id: `ctx-${Date.now()}`,
            type: 'unstake' as const,
            fromAsset: position.asset,
            fromAmount: position.amount + position.earned,
            price: 0,
            fee: 0,
            date: new Date().toISOString(),
            status: 'completed' as const,
          };
          crypto.addTransaction(unstakeTx);
        }
        // Fuera del if: una posicion que la copia local no conocia tambien se
        // retiro en el servidor, y lo que vale es lo que el diga.
        if (hasBackend) {
          refreshCrypto().catch(() => {});
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
            date: new Date().toISOString(),
            status: 'completed' as const,
          };
          crypto.addTransaction(yieldTx);
          if (hasBackend) {
            refreshAccounts().catch(() => {});
          }
        }
        break;
      }
      // Antes ADD_PRICE_ALERT y REMOVE_PRICE_ALERT tocaban el estado y
      // llamaban al servidor con .catch(() => {}): un rechazo se tragaba y la
      // pantalla mostraba una alerta que no existia. Ahora la pantalla espera
      // al servidor y solo despues copia su lista aqui.
      case 'SET_PRICE_ALERTS':
        crypto.setPriceAlerts(action.payload);
        break;
      case 'TOGGLE_FAVORITE_ASSET':
        crypto.toggleFavorite(action.payload);
        break;
    }
  }, [auth, accounts, txStore, sinpe, crypto, services, notifications, settings]);

  return { state, dispatch };
}
