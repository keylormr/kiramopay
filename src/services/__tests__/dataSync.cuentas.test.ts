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
  return { respuesta: null as unknown, lanzar: false, esperar: null as null | Promise<void> };
});

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    accounts: {
      getAccounts: async () => {
        if (mocks.lanzar) throw new Error('sin red');
        // La foto es la del momento de la peticion, como en el servidor.
        const respuesta = mocks.respuesta;
        const espera = mocks.esperar;
        mocks.esperar = null;
        if (espera) await espera;
        return respuesta;
      },
    },
  }),
}));

const colones: Account = {
  ccy: 'CRC', balance: 125_000, symbol: '₡', flag: 'CR', iban: 'CR00', name: 'Colones', type: 'fiat',
};

beforeEach(() => {
  mocks.lanzar = false;
  mocks.esperar = null;
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

// Como en refreshCrypto: con dos lecturas en vuelo, la vieja que contesta al
// final pisaba el saldo nuevo con uno de antes, y el aviso de la repeticion
// decia "al dia" sobre esa cifra.
describe('refreshAccounts: gana la lectura mas reciente', () => {
  it('una lectura vieja que contesta tarde no pisa a la nueva, y dice lo que dijo esa', async () => {
    let soltar!: () => void;
    mocks.esperar = new Promise<void>((r) => {
      soltar = r;
    });
    const vieja = refreshAccounts();
    const despues = [{ ...colones, balance: 90_000 }];
    mocks.respuesta = { success: true, data: despues };

    await expect(refreshAccounts()).resolves.toBe(true);
    expect(useAccountStore.getState().accounts).toEqual(despues);

    soltar();
    await expect(vieja).resolves.toBe(true);
    expect(useAccountStore.getState().accounts).toEqual(despues);
  });

  it('si la mas nueva no las trajo, la superada tampoco da el saldo por bueno', async () => {
    let soltar!: () => void;
    mocks.esperar = new Promise<void>((r) => {
      soltar = r;
    });
    const vieja = refreshAccounts();
    mocks.respuesta = { success: false, error: { code: 'NETWORK_ERROR', message: 'x' } };

    await expect(refreshAccounts()).resolves.toBe(false);
    soltar();
    await expect(vieja).resolves.toBe(false);
    expect(useAccountStore.getState().accounts).toEqual([]);
  });
});
