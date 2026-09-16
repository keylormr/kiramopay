import { useCryptoStore } from '../crypto.store';
import { initialCryptoAssets, initialCryptoTransactions, initialStakingPositions } from '@/api/adapters/mock/mock-data';

describe('useCryptoStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useCryptoStore.setState({
      assets: initialCryptoAssets.map((a) => ({ ...a })),
      transactions: [...initialCryptoTransactions],
      stakingPositions: initialStakingPositions.map((s) => ({ ...s })),
      priceAlerts: [],
      favoriteAssets: ['BTC', 'ETH', 'USDT'],
      defaultConvertCurrency: 'CRC',
    });
  });

  it('should have initial assets', () => {
    const { assets } = useCryptoStore.getState();
    expect(assets).toHaveLength(6);
    expect(assets[0].symbol).toBe('BTC');
  });

  it('should buy crypto', () => {
    const btcBefore = useCryptoStore.getState().assets.find((a) => a.symbol === 'BTC')!;
    useCryptoStore.getState().buyCrypto('BTC', 0.01, 42000);
    const btcAfter = useCryptoStore.getState().assets.find((a) => a.symbol === 'BTC')!;
    expect(btcAfter.balance).toBeCloseTo(btcBefore.balance + 0.01, 4);
  });

  it('should sell crypto', () => {
    const btcBefore = useCryptoStore.getState().assets.find((a) => a.symbol === 'BTC')!;
    useCryptoStore.getState().sellCrypto('BTC', 0.01);
    const btcAfter = useCryptoStore.getState().assets.find((a) => a.symbol === 'BTC')!;
    expect(btcAfter.balance).toBeCloseTo(btcBefore.balance - 0.01, 4);
  });

  it('should convert crypto', () => {
    useCryptoStore.getState().convertCrypto('USDT', 'ETH', 100, 0.042, 2380);
    const usdt = useCryptoStore.getState().assets.find((a) => a.symbol === 'USDT')!;
    const eth = useCryptoStore.getState().assets.find((a) => a.symbol === 'ETH')!;
    expect(usdt.balance).toBe(400);
    expect(eth.balance).toBeCloseTo(1.245 + 0.042, 4);
  });

  it('should stake crypto', () => {
    const ethBefore = useCryptoStore.getState().assets.find((a) => a.symbol === 'ETH')!;
    useCryptoStore.getState().stakeCrypto('ETH', 0.5, 4.5, false);
    const ethAfter = useCryptoStore.getState().assets.find((a) => a.symbol === 'ETH')!;
    expect(ethAfter.balance).toBeCloseTo(ethBefore.balance - 0.5, 4);
    const positions = useCryptoStore.getState().stakingPositions;
    expect(positions.length).toBeGreaterThan(initialStakingPositions.length);
  });

  it('should unstake crypto', () => {
    // Unstake the first position (ETH, 0.5, earned 0.0012)
    const ethBefore = useCryptoStore.getState().assets.find((a) => a.symbol === 'ETH')!;
    useCryptoStore.getState().unstakeCrypto('stake1');
    const ethAfter = useCryptoStore.getState().assets.find((a) => a.symbol === 'ETH')!;
    expect(ethAfter.balance).toBeCloseTo(ethBefore.balance + 0.5 + 0.0012, 4);
    expect(useCryptoStore.getState().stakingPositions.find((p) => p.id === 'stake1')).toBeUndefined();
  });

  it('should update prices', () => {
    useCryptoStore.getState().updatePrices([
      { symbol: 'BTC', price: 45000, change24h: 5.0 },
    ]);
    const btc = useCryptoStore.getState().assets.find((a) => a.symbol === 'BTC')!;
    expect(btc.currentPrice).toBe(45000);
    expect(btc.priceChange24h).toBe(5.0);
  });

  // PR #201: el sparkline de 7 dias que trae el backend (sparkline_7d via
  // getPrices) se corrompia porque los llamadores periodicos (sondeo REST de
  // fetchPrices() cada 5 min y el WebSocket de precios cada 5-15s en
  // CryptoView.tsx) despachaban UPDATE_CRYPTO_PRICES sin priceHistory. El
  // reductor de abajo (updatePrices) tomaba eso como "no hay historial nuevo,
  // simula un paso mas" y le cortaba el punto mas viejo al historial real
  // para pegarle el precio actual al final. La correccion fue en el llamador
  // (CryptoView.tsx propaga el priceHistory que ya trae getPrices() y
  // reenvia el ultimo real conocido en cada tick de WebSocket, ver
  // marketDataRef); esta prueba fija ese contrato: si el reductor recibe el
  // historial real (llegue de donde llegue), debe conservarlo intacto.
  it('conserva el sparkline real si el update lo trae, incluso en llamadas seguidas (fetchPrices + tick de WebSocket)', () => {
    const historialReal = Array.from({ length: 168 }, (_, i) => 60000 + i * 10);

    // 1) fetchPrices() del backend: trae el historial real de 7 dias.
    useCryptoStore.getState().updatePrices([
      { symbol: 'BTC', price: 65000, change24h: 1.5, priceHistory: historialReal },
    ]);
    let btc = useCryptoStore.getState().assets.find((a) => a.symbol === 'BTC')!;
    expect(btc.priceHistory).toEqual(historialReal);

    // 2) Tick de WebSocket instantes despues: CryptoView reenvia el mismo
    // historial (el socket no trae sparkline) en vez de omitirlo.
    useCryptoStore.getState().updatePrices([
      { symbol: 'BTC', price: 65123, change24h: 1.6, priceHistory: historialReal },
    ]);
    btc = useCryptoStore.getState().assets.find((a) => a.symbol === 'BTC')!;
    expect(btc.priceHistory).toEqual(historialReal); // ni se corto el primero ni se inventa uno al final
    expect(btc.priceHistory[0]).toBe(60000);
    expect(btc.currentPrice).toBe(65123);
  });

  it('sin priceHistory en el update (backend no lo trajo para este simbolo), sigue simulando un paso mas — comportamiento del modo demo', () => {
    const antes = useCryptoStore.getState().assets.find((a) => a.symbol === 'BTC')!.priceHistory;
    useCryptoStore.getState().updatePrices([
      { symbol: 'BTC', price: 45500, change24h: 2.0 },
    ]);
    const btc = useCryptoStore.getState().assets.find((a) => a.symbol === 'BTC')!;
    expect(btc.priceHistory).toEqual([...antes.slice(1), 45500]);
  });

  it('should toggle favorites', () => {
    expect(useCryptoStore.getState().favoriteAssets).toContain('BTC');
    useCryptoStore.getState().toggleFavorite('BTC');
    expect(useCryptoStore.getState().favoriteAssets).not.toContain('BTC');
    useCryptoStore.getState().toggleFavorite('BTC');
    expect(useCryptoStore.getState().favoriteAssets).toContain('BTC');
  });

  it('should add and remove price alerts', () => {
    useCryptoStore.getState().addPriceAlert({
      id: 'alert-1',
      asset: 'BTC',
      targetPrice: 50000,
      condition: 'above',
      active: true,
      status: 'active',
    });
    expect(useCryptoStore.getState().priceAlerts).toHaveLength(1);

    useCryptoStore.getState().removePriceAlert('alert-1');
    expect(useCryptoStore.getState().priceAlerts).toHaveLength(0);
  });

  it('coerces a corrupt persisted blob back to safe arrays on rehydrate', async () => {
    // An older/corrupt localStorage blob could carry null/missing array fields.
    // Before the persist `merge` guard, rehydrating this left e.g. assets=null,
    // which crashed CryptoView's .reduce/.map/.filter at render (the "Algo
    // salió mal" screen). stakingPositions is omitted to cover the missing case.
    localStorage.setItem(
      'kiramopay-crypto',
      JSON.stringify({
        state: {
          assets: null,
          transactions: null,
          priceAlerts: null,
          favoriteAssets: null,
          defaultConvertCurrency: 'USD',
        },
        version: 0,
      }),
    );

    await useCryptoStore.persist.rehydrate();

    const s = useCryptoStore.getState();
    expect(Array.isArray(s.assets)).toBe(true);
    expect(Array.isArray(s.transactions)).toBe(true);
    expect(Array.isArray(s.stakingPositions)).toBe(true);
    expect(Array.isArray(s.priceAlerts)).toBe(true);
    expect(Array.isArray(s.favoriteAssets)).toBe(true);
    // Valid scalar fields still rehydrate normally.
    expect(s.defaultConvertCurrency).toBe('USD');
  });
});
