/**
 * Limpieza de los datos por usuario al terminar una sesion.
 *
 * Todos estos stores persisten completos en localStorage y nada los tocaba al
 * cerrar sesion: el siguiente usuario del mismo navegador heredaba cuentas,
 * contactos SINPE, historial, cripto y notificaciones del anterior hasta que
 * el sync del backend los pisara — y para siempre si ese sync fallaba. Con
 * backend, el estado limpio es el inicial vacio (el login re-sincroniza todo
 * desde el servidor); en modo demo (sin backend) no se limpia nada, porque el
 * dispositivo es un unico usuario de demostracion y vaciarlo mataria la demo.
 *
 * Quedan fuera adrede: el store de auth (se limpia a si mismo en logout y
 * forceLogout), y settings y feature-flags, que son preferencias del
 * dispositivo (tema, idioma, laboratorio) y deben sobrevivir a la sesion.
 */
import { useAccountStore } from './account.store';
import { useTransactionStore } from './transaction.store';
import { useSinpeStore } from './sinpe.store';
import { useCryptoStore } from './crypto.store';
import { useServicesStore } from './services.store';
import { useNotificationStore } from './notification.store';
import { useSavingsStore } from './savings.store';
import { useRecurringStore } from './recurring.store';
import { useBusinessStore } from './business.store';
import { nuevaGeneracion } from '@/services/generacionDeSesion';

export function limpiarDatosDeUsuario(): void {
  // PRIMERO, y fuera del early-return de abajo: invalidar el trabajo
  // asincronico en vuelo. Sin esto, una sincronizacion disparada antes del
  // cierre de sesion termina DESPUES de esta limpieza y vuelve a escribir los
  // datos del usuario que ya salio sobre los stores recien vaciados.
  nuevaGeneracion();

  // Leido por llamada (no a nivel de modulo) para que las pruebas puedan
  // alternarlo, igual que hace useCryptoPricesWs.test.
  if (!import.meta.env.VITE_API_URL) return;

  // Los valores son los mismos estados iniciales que cada store declara para
  // el modo con backend. setState hace merge parcial, asi que las acciones de
  // cada store quedan intactas.
  useAccountStore.setState({ baseCurrency: 'CRC', accounts: [], budgets: [] });
  useTransactionStore.setState({ transactions: [] });
  useSinpeStore.setState({ sinpeContacts: [], sinpeHistory: [] });
  useCryptoStore.setState({
    assets: [],
    transactions: [],
    stakingPositions: [],
    priceAlerts: [],
    favoriteAssets: ['BTC', 'ETH', 'USDT'],
    defaultConvertCurrency: 'CRC',
  });
  useServicesStore.setState({
    savedServices: [],
    billHistory: [],
    rechargeHistory: [],
    connectedPartners: ['uber', 'ubereats'],
  });
  useNotificationStore.setState({ notifications: [] });
  useSavingsStore.setState({ goals: [] });
  useRecurringStore.setState({ payments: [] });
  useBusinessStore.setState({ activeMerchantId: null });

  // Ademas de resetear la memoria, borrar las claves persistidas: si nada
  // vuelve a escribir antes de un cierre abrupto, que en el disco no quede el
  // blob del usuario que ya salio.
  const persistidos = [
    useAccountStore,
    useTransactionStore,
    useSinpeStore,
    useCryptoStore,
    useServicesStore,
    useNotificationStore,
    useSavingsStore,
    useRecurringStore,
    useBusinessStore,
  ];
  for (const store of persistidos) {
    store.persist.clearStorage();
  }
}
