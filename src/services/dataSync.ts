import { generacionActual, sigueVigente } from './generacionDeSesion';
import { getApiLayer } from '@/api';
import { fusionarConCatalogo } from '@/api/catalogoCripto';
import { useAccountStore } from '@/stores/account.store';
import { useTransactionStore } from '@/stores/transaction.store';
import { useSinpeStore } from '@/stores/sinpe.store';
import { useCryptoStore } from '@/stores/crypto.store';
import { useServicesStore } from '@/stores/services.store';
import { useNotificationStore } from '@/stores/notification.store';
import { useRecurringStore } from '@/stores/recurring.store';
import { useSyncStore } from '@/stores/sync.store';

const hasBackend = !!import.meta.env.VITE_API_URL;

export async function syncAllData(): Promise<void> {
  if (!hasBackend) return;

  const syncStore = useSyncStore.getState();
  if (syncStore.isSyncing) return;

  // Se guarda ANTES de disparar nada: si la sesion cambia de duenno mientras
  // estas nueve peticiones estan en vuelo, lo que llegue ya no es de nadie.
  const generacion = generacionActual();

  syncStore.setSyncing(true);

  try {
    const api = getApiLayer();

    const results = await Promise.allSettled([
      api.accounts.getAccounts(),
      api.transactions.getTransactions(50),
      api.sinpe.getContacts(),
      api.sinpe.getHistory(),
      api.crypto.getAssets(),
      api.services.getSavedServices(),
      api.notifications.getAll(),
      api.budgets.getBudgets(),
      api.recurring.getPayments(),
    ]);

    // La comprobacion va ANTES de la primera escritura, no repartida entre
    // ellas: escribir la mitad de los stores con datos del usuario anterior es
    // el mismo defecto, solo que a medias.
    if (!sigueVigente(generacion)) {
      // Se suelta la bandera igual: dejarla puesta bloquearia la
      // sincronizacion del usuario que entre despues, que es peor que la
      // carrera que se esta evitando.
      useSyncStore.getState().setSyncComplete();
      return;
    }

    const [
      accountsResult,
      transactionsResult,
      contactsResult,
      sinpeHistoryResult,
      cryptoAssetsResult,
      savedServicesResult,
      notificationsResult,
      budgetsResult,
      recurringResult,
    ] = results;

    if (accountsResult.status === 'fulfilled' && accountsResult.value.success && accountsResult.value.data) {
      useAccountStore.getState().setAccounts(accountsResult.value.data);
    }

    if (transactionsResult.status === 'fulfilled' && transactionsResult.value.success && transactionsResult.value.data) {
      useTransactionStore.getState().setTransactions(transactionsResult.value.data);
    }

    if (contactsResult.status === 'fulfilled' && contactsResult.value.success && contactsResult.value.data) {
      useSinpeStore.getState().setContacts(contactsResult.value.data);
    }

    if (sinpeHistoryResult.status === 'fulfilled' && sinpeHistoryResult.value.success && sinpeHistoryResult.value.data) {
      useSinpeStore.getState().setHistory(sinpeHistoryResult.value.data);
    }

    if (cryptoAssetsResult.status === 'fulfilled' && cryptoAssetsResult.value.success && cryptoAssetsResult.value.data) {
      // El backend devuelve TENENCIAS; el catalogo pone el piso. Sin la fusion,
      // una cuenta sin cripto recibia una lista vacia y el selector de Comprar
      // quedaba sin opciones: imposible comprar la primera vez.
      useCryptoStore.getState().setAssets(fusionarConCatalogo(cryptoAssetsResult.value.data));
    }

    if (savedServicesResult.status === 'fulfilled' && savedServicesResult.value.success && savedServicesResult.value.data) {
      useServicesStore.getState().setSavedServices(savedServicesResult.value.data);
    }

    if (notificationsResult.status === 'fulfilled' && notificationsResult.value.success && notificationsResult.value.data) {
      useNotificationStore.getState().setNotifications(notificationsResult.value.data);
    }

    if (budgetsResult.status === 'fulfilled' && budgetsResult.value.success && budgetsResult.value.data) {
      useAccountStore.getState().setBudgets(budgetsResult.value.data);
    }

    if (recurringResult.status === 'fulfilled' && recurringResult.value.success && recurringResult.value.data) {
      useRecurringStore.getState().setPayments(recurringResult.value.data);
    }

    syncStore.setSyncComplete();
  } catch {
    syncStore.setSyncError('Sync failed');
  }
}

export async function refreshAccounts(): Promise<void> {
  if (!hasBackend) return;
  const generacion = generacionActual();
  const api = getApiLayer();
  const res = await api.accounts.getAccounts();
  if (!sigueVigente(generacion)) return;
  if (res.success && res.data) {
    useAccountStore.getState().setAccounts(res.data);
  }
}

export async function refreshTransactions(): Promise<void> {
  if (!hasBackend) return;
  const generacion = generacionActual();
  const api = getApiLayer();
  const res = await api.transactions.getTransactions(50);
  if (!sigueVigente(generacion)) return;
  if (res.success && res.data) {
    useTransactionStore.getState().setTransactions(res.data);
  }
}

export async function refreshBudgets(): Promise<void> {
  if (!hasBackend) return;
  const generacion = generacionActual();
  const api = getApiLayer();
  const res = await api.budgets.getBudgets();
  if (!sigueVigente(generacion)) return;
  if (res.success && res.data) {
    useAccountStore.getState().setBudgets(res.data);
  }
}

export async function refreshRecurring(): Promise<void> {
  if (!hasBackend) return;
  const generacion = generacionActual();
  const api = getApiLayer();
  const res = await api.recurring.getPayments();
  if (!sigueVigente(generacion)) return;
  if (res.success && res.data) {
    useRecurringStore.getState().setPayments(res.data);
  }
}

export async function refreshNotifications(): Promise<void> {
  if (!hasBackend) return;
  const generacion = generacionActual();
  const api = getApiLayer();
  const res = await api.notifications.getAll();
  if (!sigueVigente(generacion)) return;
  if (res.success && res.data) {
    useNotificationStore.getState().setNotifications(res.data);
  }
}

export async function refreshSinpe(): Promise<void> {
  if (!hasBackend) return;
  const generacion = generacionActual();
  const api = getApiLayer();
  const [contacts, history] = await Promise.allSettled([
    api.sinpe.getContacts(),
    api.sinpe.getHistory(),
  ]);
  if (!sigueVigente(generacion)) return;
  if (contacts.status === 'fulfilled' && contacts.value.success && contacts.value.data) {
    useSinpeStore.getState().setContacts(contacts.value.data);
  }
  if (history.status === 'fulfilled' && history.value.success && history.value.data) {
    useSinpeStore.getState().setHistory(history.value.data);
  }
}
