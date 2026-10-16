import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import en from '@/i18n/languages/en';
import es from '@/i18n/languages/es';
import { fijarDiccionarioActivo } from '@/i18n/mensajesDeError';
import {
  initialBudgets,
  initialNotifications,
  initialSinpeHistory,
  initialTransactions,
} from '@/api/adapters/mock/mock-data';
import { useAccountStore } from '@/stores/account.store';
import { useNotificationStore } from '@/stores/notification.store';
import { useSinpeStore } from '@/stores/sinpe.store';
import { useTransactionStore } from '@/stores/transaction.store';
import { useSemillasDeLaDemo } from '../useSemillasDeLaDemo';

// Sin servidor, los stores arrancan con los datos de ejemplo, que se arman al
// importar: en espanol, porque el idioma de la app carga despues. Cuando el
// idioma carga (o la persona lo cambia), los ejemplos que nadie toco pasan a
// ese idioma. Lo que la persona cambio queda como lo dejo.

const envoltura = ({ children }: { children: ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

beforeEach(() => {
  fijarDiccionarioActivo(es);
  useTransactionStore.setState({ transactions: initialTransactions() });
  useAccountStore.setState({ budgets: initialBudgets() });
  useNotificationStore.setState({ notifications: initialNotifications() });
  useSinpeStore.setState({ sinpeHistory: initialSinpeHistory() });
  localStorage.setItem('kiramopay_language', 'en');
});

afterAll(() => fijarDiccionarioActivo(es));

describe('useSemillasDeLaDemo', () => {
  it('al cargar el idioma, los ejemplos pasan a ese idioma', async () => {
    renderHook(() => useSemillasDeLaDemo(), { wrapper: envoltura });
    await waitFor(() =>
      expect(useTransactionStore.getState().transactions.find((t) => t.id === '2')?.title).toBe(en.demo_tx_sinpe_diego),
    );
    expect(useAccountStore.getState().budgets.map((b) => b.label)).toContain(en.budget_icon_food);
    expect(useNotificationStore.getState().notifications.find((n) => n.id === '1')?.title).toBe(
      en.demo_notif_welcome_title,
    );
    expect(useSinpeStore.getState().sinpeHistory.find((s) => s.id === '1')?.reference).toBe(en.demo_sinpe_ref_lunch);
  });

  it('lo que la persona cambio no se toca', async () => {
    useAccountStore.setState({
      budgets: initialBudgets().map((b) => (b.id === '1' ? { ...b, label: 'Super' } : b)),
    });
    renderHook(() => useSemillasDeLaDemo(), { wrapper: envoltura });
    await waitFor(() =>
      expect(useAccountStore.getState().budgets.find((b) => b.id === '2')?.label).toBe(en.budget_icon_transport),
    );
    expect(useAccountStore.getState().budgets.find((b) => b.id === '1')?.label).toBe('Super');
  });
});
