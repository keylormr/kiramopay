import { refreshCrypto } from '../dataSync';
import { nuevaGeneracion } from '../generacionDeSesion';
import { useCryptoStore } from '@/stores/crypto.store';
import type { CryptoAsset, CryptoTransaction, StakingPosition } from '@/types';

// La pantalla de cripto vivia de su propia copia local: las posiciones de
// staking guardaban un id inventado (`stake-<fecha>`) y el retiro fallaba
// SIEMPRE con "staking position not found", sin que nada le pidiera al
// servidor el estado real. refreshCrypto es esa peticion.
//
// hasBackend se lee UNA vez al cargar el modulo: la variable va en vi.hoisted.
const mocks = vi.hoisted(() => {
  import.meta.env.VITE_API_URL = 'http://localhost:8080';
  return {
    posiciones: [] as StakingPosition[],
    movimientos: [] as CryptoTransaction[],
    tenencias: [] as CryptoAsset[],
    esperar: null as null | Promise<void>,
    esperarMovimientos: null as null | Promise<void>,
  };
});

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    crypto: {
      getAssets: async () => {
        if (mocks.esperar) await mocks.esperar;
        return { success: true, data: mocks.tenencias };
      },
      getTransactions: async () => {
        // La foto es la del momento de la peticion, como en el servidor.
        const data = mocks.movimientos;
        const espera = mocks.esperarMovimientos;
        mocks.esperarMovimientos = null;
        if (espera) await espera;
        return { success: true, data };
      },
      getStakingPositions: async () => ({ success: true, data: mocks.posiciones }),
    },
  }),
}));

const REAL = '099fdd8d-c6df-4ba7-98a2-d60c60149523';

function activo(symbol: string, extra: Partial<CryptoAsset> = {}): CryptoAsset {
  return {
    id: symbol, symbol, name: symbol, icon: symbol.toLowerCase(), color: '#6B7280',
    balance: 0, avgBuyPrice: 0, currentPrice: 0, priceChange24h: 0, priceHistory: [], ...extra,
  };
}

beforeEach(() => {
  mocks.esperar = null;
  mocks.esperarMovimientos = null;
  mocks.tenencias = [activo('ETH', { balance: 0.5, avgBuyPrice: 2400 })];
  mocks.movimientos = [{
    id: 'm1', type: 'buy', fromAsset: 'USD', fromAmount: 1, toAsset: 'ETH', toAmount: 0.0004,
    price: 2500, priceCurrency: 'USD', fee: 0, date: '2026-09-13T15:00:00Z', status: 'completed',
  }];
  mocks.posiciones = [{
    id: REAL, asset: 'ETH', amount: 0.0001, apy: 4.5, startDate: '2026-09-13T15:00:00Z', earned: 0, locked: false,
  }];
  // Lo que quedo guardado en el aparato: una posicion con el id fabricado y un
  // ETH con precio ya cargado por el feed.
  useCryptoStore.setState({
    assets: [activo('ETH', { balance: 0.4, currentPrice: 2500, priceHistory: [1, 2, 3], icon: 'Ξ' })],
    transactions: [],
    stakingPositions: [{
      id: 'stake-1789326379706', asset: 'ETH', amount: 0.0001, apy: 4.5, startDate: 'Ahora', earned: 0, locked: false,
    }],
  });
});

describe('refreshCrypto', () => {
  it('reemplaza la copia local por lo que dice el servidor', async () => {
    await refreshCrypto();
    const s = useCryptoStore.getState();

    // La posicion con id inventado desaparece; queda la real, retirable.
    expect(s.stakingPositions.map((p) => p.id)).toEqual([REAL]);
    expect(s.transactions).toEqual(mocks.movimientos);

    const eth = s.assets.find((a) => a.symbol === 'ETH')!;
    expect(eth.balance).toBe(0.5);
    // El precio no se pierde por traer las tenencias, y la cara es la del
    // catalogo, no el simbolo en minusculas.
    expect(eth.currentPrice).toBe(2500);
    expect(eth.priceHistory).toEqual([1, 2, 3]);
    expect(eth.icon).toBe('Ξ');
    // El catalogo completo sigue ahi para poder comprar lo que no se tiene.
    expect(s.assets.some((a) => a.symbol === 'BTC')).toBe(true);
  });

  // El servidor anota el alta y el retiro de staking. La pantalla carga al
  // abrir y otra vez tras la operacion; si la carga del montaje contestaba al
  // final, pisaba la lista con una foto sin el alta y la fila desaparecia.
  it('una carga vieja que contesta tarde no pisa a la que trae el alta', async () => {
    let soltar: () => void = () => {};
    mocks.esperarMovimientos = new Promise<void>((r) => { soltar = r; });
    const delMontaje = refreshCrypto();

    const alta: CryptoTransaction = {
      id: 's1', type: 'stake', fromAsset: 'ETH', fromAmount: 0.0001, price: 0,
      priceCurrency: 'USD', fee: 0, date: '2026-09-13T15:05:00Z', status: 'completed',
    };
    mocks.movimientos = [alta, ...mocks.movimientos];
    await refreshCrypto();
    expect(useCryptoStore.getState().transactions.map((t) => t.id)).toEqual(['s1', 'm1']);

    soltar();
    await delMontaje;
    expect(useCryptoStore.getState().transactions.map((t) => t.id)).toEqual(['s1', 'm1']);
  });

  it('una respuesta que llega despues de cambiar de sesion no se escribe', async () => {
    let soltar: () => void = () => {};
    mocks.esperar = new Promise<void>((r) => { soltar = r; });
    const enVuelo = refreshCrypto();
    nuevaGeneracion();
    useCryptoStore.setState({ assets: [], transactions: [], stakingPositions: [] });
    soltar();
    await enVuelo;

    const s = useCryptoStore.getState();
    expect(s.assets).toEqual([]);
    expect(s.stakingPositions).toEqual([]);
    expect(s.transactions).toEqual([]);
  });
});
