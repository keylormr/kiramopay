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
      expect(result.error?.code).toBe('CRYPTO_INSUFFICIENT_BALANCE');
    });
  });

  describe('staking', () => {
    it('should get staking positions', async () => {
      const result = await repo.getStakingPositions();
      expect(result.success).toBe(true);
      expect(result.data!.length).toBeGreaterThanOrEqual(1);
      // USDT y USDC salieron del programa: la demostracion no las muestra.
      expect(result.data!.some((p) => p.asset === 'USDT' || p.asset === 'USDC')).toBe(false);
    });

    it('should stake crypto at the program rate', async () => {
      const result = await repo.stake({
        asset: 'ETH',
        amount: 0.1,
        locked: false,
      });
      expect(result.success).toBe(true);
      expect(result.data!.asset).toBe('ETH');
      // La tasa la pone el programa, no quien pide.
      expect(result.data!.apy).toBe(4.5);
    });

    it('should fail staking with insufficient balance', async () => {
      const result = await repo.stake({
        asset: 'SOL',
        amount: 1000,
        locked: false,
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CRYPTO_INSUFFICIENT_BALANCE');
    });

    it('rechaza las monedas fuera del programa, aunque haya saldo', async () => {
      for (const asset of ['USDT', 'USDC', 'BTC']) {
        const result = await repo.stake({ asset, amount: 1, locked: false });
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('STAKING_NOT_AVAILABLE');
      }
    });

    // El defecto de produccion: la posicion se retiraba con un id distinto
    // del que devolvio el alta. Con el id devuelto, el retiro funciona.
    it('retira la posicion con el id que devolvio el alta', async () => {
      const alta = await repo.stake({ asset: 'ETH', amount: 0.1, locked: false });
      const retiro = await repo.unstake(alta.data!.id);
      expect(retiro.success).toBe(true);
      const otra = await repo.unstake(alta.data!.id);
      expect(otra.error?.code).toBe('STAKING_POSITION_NOT_FOUND');
    });

    // Como el servidor: el alta y el retiro quedan en el historial, sin precio.
    it('el alta y el retiro quedan en el historial', async () => {
      const alta = await repo.stake({ asset: 'ETH', amount: 0.1, locked: false });
      await repo.unstake(alta.data!.id);
      const [retiro, apartado] = (await repo.getTransactions()).data!;
      expect(retiro).toMatchObject({ type: 'unstake', fromAsset: 'ETH', fromAmount: 0.1, price: 0, fee: 0 });
      expect(apartado).toMatchObject({ type: 'stake', fromAsset: 'ETH', fromAmount: 0.1, price: 0, fee: 0 });
    });
  });

  describe('price alerts', () => {
    it('should add a price alert', async () => {
      const result = await repo.addPriceAlert({ asset: 'BTC', targetPrice: 50000, condition: 'above' });
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ asset: 'BTC', status: 'active', active: true });
      expect(result.data!.id).toBeTruthy();

      const alerts = await repo.getPriceAlerts();
      expect(alerts.data!).toHaveLength(1);
    });

    it('should remove a price alert', async () => {
      const creada = await repo.addPriceAlert({ asset: 'ETH', targetPrice: 3000, condition: 'above' });
      const result = await repo.removePriceAlert(creada.data!.id);
      expect(result.success).toBe(true);

      const alerts = await repo.getPriceAlerts();
      expect(alerts.data!.find((a) => a.id === creada.data!.id)).toBeUndefined();
    });
  });
});
