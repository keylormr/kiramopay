import { getApiLayer } from '@/api';
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
      useCryptoStore.getState().setAssets(cryptoAssetsResult.value.data);
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
  const api = getApiLayer();
  const res = await api.accounts.getAccounts();
  if (res.success && res.data) {
    useAccountStore.getState().setAccounts(res.data);
  }
}

export async function refreshTransactions(): Promise<void> {
  if (!hasBackend) return;
  const api = getApiLayer();
  const res = await api.transactions.getTransactions(50);
  if (res.success && res.data) {
    useTransactionStore.getState().setTransactions(res.data);
  }
}

export async function refreshBudgets(): Promise<void> {
  if (!hasBackend) return;
  const api = getApiLayer();
  const res = await api.budgets.getBudgets();
  if (res.success && res.data) {
    useAccountStore.getState().setBudgets(res.data);
  }
}

export async function refreshRecurring(): Promise<void> {
  if (!hasBackend) return;
  const api = getApiLayer();
  const res = await api.recurring.getPayments();
  if (res.success && res.data) {
    useRecurringStore.getState().setPayments(res.data);
  }
}

export async function refreshNotifications(): Promise<void> {
  if (!hasBackend) return;
  const api = getApiLayer();
  const res = await api.notifications.getAll();
  if (res.success && res.data) {
    useNotificationStore.getState().setNotifications(res.data);
  }
}

export async function refreshSinpe(): Promise<void> {
  if (!hasBackend) return;
  const api = getApiLayer();
  const [contacts, history] = await Promise.allSettled([
    api.sinpe.getContacts(),
    api.sinpe.getHistory(),
  ]);
  if (contacts.status === 'fulfilled' && contacts.value.success && contacts.value.data) {
    useSinpeStore.getState().setContacts(contacts.value.data);
  }
  if (history.status === 'fulfilled' && history.value.success && history.value.data) {
    useSinpeStore.getState().setHistory(history.value.data);
  }
}
