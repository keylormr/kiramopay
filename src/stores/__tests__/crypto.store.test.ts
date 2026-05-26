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
    });
    expect(useCryptoStore.getState().priceAlerts).toHaveLength(1);

    useCryptoStore.getState().removePriceAlert('alert-1');
    expect(useCryptoStore.getState().priceAlerts).toHaveLength(0);
  });
});
