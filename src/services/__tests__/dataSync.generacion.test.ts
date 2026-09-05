import { syncAllData } from '../dataSync';
import { nuevaGeneracion } from '../generacionDeSesion';
import { useAccountStore } from '@/stores/account.store';
import { useTransactionStore } from '@/stores/transaction.store';
import { useSyncStore } from '@/stores/sync.store';

// LA CARRERA QUE ESTO CIERRA: syncAllData dispara nueve peticiones y las
// espera. Si el usuario cierra sesion mientras estan en vuelo,
// limpiarDatosDeUsuario vacia los stores y ACTO SEGUIDO llegan esas respuestas
// y vuelven a escribir los datos del usuario anterior sobre los stores ya
// limpios. El siguiente en usar el aparato hereda cuentas, contactos e
// historial de quien salio: justo lo que esa limpieza existe para impedir.
// hasBackend se lee UNA vez al cargar el modulo, asi que la variable tiene que
// estar puesta antes de que se importe: por eso va en vi.hoisted, que corre
// antes que los imports.
const mocks = vi.hoisted(() => {
  import.meta.env.VITE_API_URL = 'http://localhost:8080';
  return { resolver: null as null | (() => void) };
});

const CUENTA = { id: 'a1', ccy: 'CRC', balance: 999, symbol: '₡' };
const MOVIMIENTO = { id: 't1', title: 'Del usuario anterior', amount: -100, ccy: 'CRC' };

// La capa de API responde cuando la prueba lo decide, para poder cerrar sesion
// EN MEDIO de la espera.
vi.mock('@/api', () => ({
  getApiLayer: () => ({
    accounts: {
      getAccounts: () =>
        new Promise((resolve) => {
          mocks.resolver = () => resolve({ success: true, data: [CUENTA] });
        }),
      getBudgets: async () => ({ success: true, data: [] }),
    },
    transactions: { getTransactions: async () => ({ success: true, data: [MOVIMIENTO] }) },
    sinpe: { getContacts: async () => ({ success: true, data: [] }), getHistory: async () => ({ success: true, data: [] }) },
    crypto: { getAssets: async () => ({ success: true, data: [] }) },
    services: { getSavedServices: async () => ({ success: true, data: [] }) },
    notifications: { getAll: async () => ({ success: true, data: [] }) },
    budgets: { getBudgets: async () => ({ success: true, data: [] }) },
    recurring: { getPayments: async () => ({ success: true, data: [] }) },
  }),
}));

describe('syncAllData y el cambio de sesion', () => {
  beforeEach(() => {
    mocks.resolver = null;
    useAccountStore.setState({ accounts: [] });
    useTransactionStore.setState({ transactions: [] });
    useSyncStore.setState({ isSyncing: false });
  });

  it('descarta lo que llega despues de que la sesion cambio de duenno', async () => {
    const enVuelo = syncAllData();
    // Esperar a que la sincronizacion haya empezado de verdad.
    await vi.waitFor(() => expect(mocks.resolver).not.toBeNull());

    // El usuario cierra sesion: los stores se vacian y la generacion sube.
    nuevaGeneracion();
    useAccountStore.setState({ accounts: [] });
    useTransactionStore.setState({ transactions: [] });

    // Ahora llegan las respuestas del usuario que ya salio.
    mocks.resolver!();
    await enVuelo;

    expect(useAccountStore.getState().accounts).toEqual([]);
    expect(useTransactionStore.getState().transactions).toEqual([]);
  });

  // Y la bandera se suelta igual: dejarla puesta bloquearia la sincronizacion
  // del usuario que entre despues, que es peor que la carrera que se evita.
  it('no deja la sincronizacion trabada para el siguiente usuario', async () => {
    const enVuelo = syncAllData();
    await vi.waitFor(() => expect(mocks.resolver).not.toBeNull());
    nuevaGeneracion();
    mocks.resolver!();
    await enVuelo;

    expect(useSyncStore.getState().isSyncing).toBe(false);
  });

  // Sin cambio de sesion, la sincronizacion escribe con normalidad.
  it('sin cambio de sesion escribe lo que llega', async () => {
    const enVuelo = syncAllData();
    await vi.waitFor(() => expect(mocks.resolver).not.toBeNull());
    mocks.resolver!();
    await enVuelo;

    expect(useAccountStore.getState().accounts).toHaveLength(1);
    expect(useTransactionStore.getState().transactions).toHaveLength(1);
  });
});
