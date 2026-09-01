import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { limpiarDatosDeUsuario } from './limpiarDatosDeUsuario';
import { useAccountStore } from './account.store';
import { useTransactionStore } from './transaction.store';
import { useSinpeStore } from './sinpe.store';
import { useNotificationStore } from './notification.store';
import { useCryptoStore } from './crypto.store';
import { useBusinessStore } from './business.store';
import type { Account, Notification, SinpeContact, Transaction } from '@/types';

// Mismo mecanismo que useCryptoPricesWs.test: el modulo lee VITE_API_URL por
// llamada, asi que basta con mutar import.meta.env alrededor de cada caso.
const envOriginal = import.meta.env.VITE_API_URL;

const cuentaAjena: Account = {
  ccy: 'CRC',
  balance: 250000,
  symbol: '₡',
  flag: '🇨🇷',
  iban: 'CR01-VIC',
  name: 'Colones',
  type: 'fiat',
};

const contactoAjeno: SinpeContact = {
  id: 'c1',
  name: 'Contacto de Victor',
  phone: '+50610101010',
  bank: 'BAC',
  isFavorite: true,
};

const notificacionAjena: Notification = {
  id: 'n1',
  type: 'transaction',
  title: 'SINPE recibido',
  message: 'Recibiste ₡1.000 por SINPE Móvil',
  date: 'Ahora',
  read: false,
};

const transaccionAjena: Transaction = {
  id: 't1',
  title: 'SINPE de Keilor',
  amount: 1000,
  ccy: 'CRC',
  date: 'Ahora',
  type: 'credit',
  category: 'SINPE',
  status: 'completed',
};

function sembrarDatosDeOtroUsuario() {
  useAccountStore.setState({ baseCurrency: 'USD', accounts: [cuentaAjena], budgets: [] });
  useTransactionStore.setState({ transactions: [transaccionAjena] });
  useSinpeStore.setState({ sinpeContacts: [contactoAjeno], sinpeHistory: [] });
  useNotificationStore.setState({ notifications: [notificacionAjena] });
  useCryptoStore.setState({ favoriteAssets: ['DOGE'] });
  useBusinessStore.setState({ activeMerchantId: 'm-1' });
}

describe('limpiarDatosDeUsuario', () => {
  beforeEach(() => {
    import.meta.env.VITE_API_URL = 'http://localhost:8080';
    sembrarDatosDeOtroUsuario();
  });

  afterEach(() => {
    import.meta.env.VITE_API_URL = envOriginal;
  });

  it('vacia los stores por usuario y vuelve a los valores iniciales', () => {
    limpiarDatosDeUsuario();

    expect(useAccountStore.getState().accounts).toEqual([]);
    expect(useAccountStore.getState().baseCurrency).toBe('CRC');
    expect(useTransactionStore.getState().transactions).toEqual([]);
    expect(useSinpeStore.getState().sinpeContacts).toEqual([]);
    expect(useNotificationStore.getState().notifications).toEqual([]);
    expect(useCryptoStore.getState().favoriteAssets).toEqual(['BTC', 'ETH', 'USDT']);
    expect(useBusinessStore.getState().activeMerchantId).toBeNull();
  });

  it('conserva las acciones de los stores tras la limpieza', () => {
    limpiarDatosDeUsuario();

    // setState con merge parcial no debe habernos borrado las funciones.
    useNotificationStore.getState().addNotification(notificacionAjena);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('borra las claves persistidas de localStorage', () => {
    // Forzar un write persistido y verificar que la limpieza lo quita.
    useSinpeStore.getState().addContact(contactoAjeno);
    expect(localStorage.getItem('kiramopay-sinpe')).not.toBeNull();

    limpiarDatosDeUsuario();

    expect(localStorage.getItem('kiramopay-sinpe')).toBeNull();
    expect(localStorage.getItem('kiramopay-accounts')).toBeNull();
    expect(localStorage.getItem('kiramopay-transactions')).toBeNull();
  });

  it('no toca nada en modo demo (sin backend)', () => {
    import.meta.env.VITE_API_URL = '';

    limpiarDatosDeUsuario();

    // La demo vive de sus datos locales: deben sobrevivir intactos.
    expect(useAccountStore.getState().accounts).toEqual([cuentaAjena]);
    expect(useSinpeStore.getState().sinpeContacts).toEqual([contactoAjeno]);
  });
});
