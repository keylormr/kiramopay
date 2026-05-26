import { MockCryptoRepository } from '../../adapters/mock/crypto.mock';

describe('MockCryptoRepository', () => {
  let repo: MockCryptoRepository;

  beforeEach(() => {
    localStorage.clear();
    repo = new MockCryptoRepository();
  });

  describe('getAssets', () => {
    it('should return initial crypto assets', async () => {
      const result = await repo.getAssets();
      expect(result.success).toBe(true);
      expect(result.data!.length).toBeGreaterThanOrEqual(6);
      expect(result.data![0].symbol).toBe('BTC');
    });
  });

  describe('buy', () => {
    it('should buy crypto and update balance', async () => {
      const result = await repo.buy({
        asset: 'BTC',
        amount: 0.01,
        price: 42000,
        fromCurrency: 'USD',
        fromAmount: 420,
      });
      expect(result.success).toBe(true);
      expect(result.data!.type).toBe('buy');
      expect(result.data!.fromAsset).toBe('USD');
      expect(result.data!.toAsset).toBe('BTC');
      expect(result.data!.toAmount).toBe(0.01);

      // Verify asset balance was updated in storage
      const assetsAfter = await repo.getAssets();
      const btcAfter = assetsAfter.data!.find((a) => a.symbol === 'BTC')!;
      // Initial balance is 0.0523, after buying 0.01 it should be 0.0623
      expect(btcAfter.balance).toBeCloseTo(0.0623, 4);
    });

    it('should fail for non-existent asset', async () => {
      const result = await repo.buy({
        asset: 'DOGE',
        amount: 100,
        price: 0.1,
        fromCurrency: 'USD',
        fromAmount: 10,
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('sell', () => {
    it('should sell crypto and reduce balance', async () => {
      const result = await repo.sell({
        asset: 'BTC',
        amount: 0.01,
        price: 42000,
        toCurrency: 'USD',
        toAmount: 420,
      });
      expect(result.success).toBe(true);
      expect(result.data!.type).toBe('sell');
    });

    it('should fail with insufficient balance', async () => {
      const result = await repo.sell({
        asset: 'BTC',
        amount: 999,
        price: 42000,
        toCurrency: 'USD',
        toAmount: 999 * 42000,
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INSUFFICIENT');
    });
  });

  describe('staking', () => {
    it('should get staking positions', async () => {
      const result = await repo.getStakingPositions();
      expect(result.success).toBe(true);
      expect(result.data!.length).toBeGreaterThanOrEqual(2);
    });

    it('should stake crypto', async () => {
      const result = await repo.stake({
        asset: 'ETH',
        amount: 0.1,
        apy: 5.0,
        locked: false,
      });
      expect(result.success).toBe(true);
      expect(result.data!.asset).toBe('ETH');
      expect(result.data!.apy).toBe(5.0);
    });

    it('should fail staking with insufficient balance', async () => {
      const result = await repo.stake({
        asset: 'SOL',
        amount: 1000,
        apy: 7.0,
        locked: false,
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INSUFFICIENT');
    });
  });

  describe('price alerts', () => {
    it('should add a price alert', async () => {
      const alert = {
        id: 'alert-1',
        asset: 'BTC',
        targetPrice: 50000,
        condition: 'above' as const,
        active: true,
      };
      const result = await repo.addPriceAlert(alert);
      expect(result.success).toBe(true);

      const alerts = await repo.getPriceAlerts();
      expect(alerts.data!).toHaveLength(1);
    });

    it('should remove a price alert', async () => {
      await repo.addPriceAlert({
        id: 'alert-2',
        asset: 'ETH',
        targetPrice: 3000,
        condition: 'above',
        active: true,
      });
      const result = await repo.removePriceAlert('alert-2');
      expect(result.success).toBe(true);

      const alerts = await repo.getPriceAlerts();
      expect(alerts.data!.find((a) => a.id === 'alert-2')).toBeUndefined();
    });
  });
});
