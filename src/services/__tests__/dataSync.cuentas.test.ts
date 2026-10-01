import { refreshAccounts } from '../dataSync';
import { useAccountStore } from '@/stores/account.store';
import type { Account } from '@/types';

// La pantalla que avisa de una operacion repetida no anota nada: el saldo que
// se ve sale de esta lectura, y el aviso solo puede decir que esta al dia si
// de verdad llego.
//
// hasBackend se lee UNA vez al cargar el modulo: la variable va en vi.hoisted.
const mocks = vi.hoisted(() => {
  import.meta.env.VITE_API_URL = 'http://localhost:8080';
  return { respuesta: null as unknown, lanzar: false };
});

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    accounts: {
      getAccounts: async () => {
        if (mocks.lanzar) throw new Error('sin red');
        return mocks.respuesta;
      },
    },
  }),
}));

const colones: Account = {
  ccy: 'CRC', balance: 125_000, symbol: '₡', flag: 'CR', iban: 'CR00', name: 'Colones', type: 'fiat',
};

beforeEach(() => {
  mocks.lanzar = false;
  mocks.respuesta = { success: true, data: [colones] };
  useAccountStore.setState({ accounts: [] });
});

describe('refreshAccounts dice si trajo las cuentas', () => {
  it('con las cuentas, true, y quedan en el store', async () => {
    await expect(refreshAccounts()).resolves.toBe(true);
    expect(useAccountStore.getState().accounts).toEqual([colones]);
  });

  it('si el servidor no las da, false', async () => {
    mocks.respuesta = { success: false, error: { code: 'NETWORK_ERROR', message: 'x' } };
    await expect(refreshAccounts()).resolves.toBe(false);
    expect(useAccountStore.getState().accounts).toEqual([]);
  });

  it('si la peticion lanza, rechaza: quien llama decide', async () => {
    mocks.lanzar = true;
    await expect(refreshAccounts()).rejects.toThrow('sin red');
  });
});
