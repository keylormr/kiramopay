import { describe, it, expect } from 'vitest';
import { cryptoPriceService } from '../cryptoPrices';

describe('CryptoPriceService', () => {
  describe('getPrices', () => {
    it('returns price data for known symbols', async () => {
      const prices = await cryptoPriceService.getPrices(['BTC', 'ETH']);

      expect(prices).toHaveLength(2);

      const btc = prices.find(p => p.symbol === 'BTC');
      expect(btc).toBeDefined();
      expect(btc!.price).toBeGreaterThan(0);
      expect(btc!.symbol).toBe('BTC');
      expect(btc!.lastUpdated).toBeTruthy();

      const eth = prices.find(p => p.symbol === 'ETH');
      expect(eth).toBeDefined();
      expect(eth!.price).toBeGreaterThan(0);
    });

    it('returns all required fields in price data', async () => {
      const prices = await cryptoPriceService.getPrices(['BTC']);
      const btc = prices[0];

      expect(btc).toHaveProperty('symbol');
      expect(btc).toHaveProperty('price');
      expect(btc).toHaveProperty('change24h');
      expect(btc).toHaveProperty('marketCap');
      expect(btc).toHaveProperty('volume24h');
      expect(btc).toHaveProperty('high24h');
      expect(btc).toHaveProperty('low24h');
      expect(btc).toHaveProperty('lastUpdated');
    });

    it('handles case-insensitive symbols', async () => {
      const prices = await cryptoPriceService.getPrices(['btc', 'eth']);
      expect(prices).toHaveLength(2);
      expect(prices[0].symbol).toBe('BTC');
      expect(prices[1].symbol).toBe('ETH');
    });

    it('ignores unknown symbols', async () => {
      const prices = await cryptoPriceService.getPrices(['BTC', 'FAKE_COIN']);
      expect(prices).toHaveLength(1);
      expect(prices[0].symbol).toBe('BTC');
    });

    it('returns empty array for empty input', async () => {
      const prices = await cryptoPriceService.getPrices([]);
      expect(prices).toEqual([]);
    });

    it('high24h is above price and low24h is below price', async () => {
      const prices = await cryptoPriceService.getPrices(['BTC']);
      const btc = prices[0];
      expect(btc.high24h).toBeGreaterThanOrEqual(btc.price);
      expect(btc.low24h).toBeLessThanOrEqual(btc.price);
    });

    it('stablecoins stay near $1', async () => {
      const prices = await cryptoPriceService.getPrices(['USDT', 'USDC']);
      for (const p of prices) {
        expect(p.price).toBeGreaterThan(0.99);
        expect(p.price).toBeLessThan(1.01);
      }
    });

    it('returns all 15 supported symbols', async () => {
      const allSymbols = [
        'BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'MATIC', 'BNB', 'XRP',
        'ADA', 'DOGE', 'DOT', 'AVAX', 'LINK', 'UNI', 'ATOM',
      ];
      const prices = await cryptoPriceService.getPrices(allSymbols);
      expect(prices).toHaveLength(15);
    });
  });

  describe('getPrice', () => {
    it('returns single coin price data', async () => {
      const price = await cryptoPriceService.getPrice('ETH');
      expect(price).not.toBeNull();
      expect(price!.symbol).toBe('ETH');
      expect(price!.price).toBeGreaterThan(0);
    });

    it('returns null for unknown symbol', async () => {
      const price = await cryptoPriceService.getPrice('NOTREAL');
      expect(price).toBeNull();
    });
  });

  describe('getPriceHistory', () => {
    it('returns array of price numbers (default 7 days)', async () => {
      const history = await cryptoPriceService.getPriceHistory('BTC');
      expect(history.length).toBeGreaterThan(0);
      history.forEach(p => {
        expect(typeof p).toBe('number');
        expect(p).toBeGreaterThan(0);
      });
    });

    it('last point in history matches current price', async () => {
      // Get current price first
      const priceData = await cryptoPriceService.getPrice('ETH');
      const currentPrice = priceData!.price;

      // Then get history - last point should be updated to current price
      const history = await cryptoPriceService.getPriceHistory('ETH');
      expect(history[history.length - 1]).toBe(currentPrice);
    });

    it('generates history for symbol not yet tracked', async () => {
      const history = await cryptoPriceService.getPriceHistory('ATOM');
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('getAllPriceHistories', () => {
    it('returns histories for multiple symbols', async () => {
      const histories = await cryptoPriceService.getAllPriceHistories(['BTC', 'ETH']);
      expect(histories).toHaveProperty('BTC');
      expect(histories).toHaveProperty('ETH');
      expect(histories.BTC.length).toBeGreaterThan(0);
      expect(histories.ETH.length).toBeGreaterThan(0);
    });
  });

  describe('convertToFiat', () => {
    it('converts crypto amount to USD', async () => {
      const usdValue = await cryptoPriceService.convertToFiat('BTC', 1, 'USD');
      // BTC is roughly ~42850, so 1 BTC should be a large number
      expect(usdValue).toBeGreaterThan(30000);
    });

    it('converts crypto amount to CRC using 515 rate', async () => {
      const crcValue = await cryptoPriceService.convertToFiat('USDT', 1, 'CRC');
      // 1 USDT ~ $1 * 515 = ~515 CRC
      expect(crcValue).toBeGreaterThan(500);
      expect(crcValue).toBeLessThan(530);
    });

    it('returns 0 for unknown symbol', async () => {
      const value = await cryptoPriceService.convertToFiat('UNKNOWN', 10, 'USD');
      expect(value).toBe(0);
    });

    it('defaults to USD when fiatCurrency not specified', async () => {
      const value = await cryptoPriceService.convertToFiat('ETH', 1);
      // ETH ~2340, should be in that ballpark
      expect(value).toBeGreaterThan(1500);
      expect(value).toBeLessThan(4000);
    });
  });

  describe('convertFromFiat', () => {
    it('converts USD to crypto amount', async () => {
      const btcAmount = await cryptoPriceService.convertFromFiat('BTC', 42850, 'USD');
      // Should be approximately 1 BTC (with some variance)
      expect(btcAmount).toBeGreaterThan(0.8);
      expect(btcAmount).toBeLessThan(1.5);
    });

    it('converts CRC to crypto amount', async () => {
      const btcAmount = await cryptoPriceService.convertFromFiat('BTC', 515 * 42850, 'CRC');
      // CRC / 515 = USD, then USD / BTC price ~ 1
      expect(btcAmount).toBeGreaterThan(0.8);
      expect(btcAmount).toBeLessThan(1.5);
    });

    it('returns 0 for unknown symbol', async () => {
      const amount = await cryptoPriceService.convertFromFiat('FAKE', 1000, 'USD');
      expect(amount).toBe(0);
    });
  });

  describe('getExchangeRate', () => {
    it('returns exchange rate between two cryptos', async () => {
      const rate = await cryptoPriceService.getExchangeRate('BTC', 'ETH');
      // BTC ~42850, ETH ~2340 => rate ~18.3
      expect(rate).toBeGreaterThan(10);
      expect(rate).toBeLessThan(30);
    });

    it('returns 0 when from symbol is unknown', async () => {
      const rate = await cryptoPriceService.getExchangeRate('FAKE', 'ETH');
      expect(rate).toBe(0);
    });

    it('returns 0 when to symbol is unknown', async () => {
      const rate = await cryptoPriceService.getExchangeRate('BTC', 'FAKE');
      expect(rate).toBe(0);
    });

    it('same symbol exchange rate is approximately 1', async () => {
      const rate = await cryptoPriceService.getExchangeRate('BTC', 'BTC');
      expect(rate).toBeCloseTo(1, 1);
    });
  });

  describe('formatPrice', () => {
    it('formats large prices (>= 1000) with 2 decimals', () => {
      const formatted = cryptoPriceService.formatPrice(42850.5);
      expect(formatted).toContain('42');
      expect(formatted).toContain('850');
    });

    it('formats medium prices (1-999) with up to 4 decimals', () => {
      const formatted = cryptoPriceService.formatPrice(98.5123);
      expect(formatted).toContain('98');
    });

    it('formats small prices (0.01-0.99) with up to 6 decimals', () => {
      const formatted = cryptoPriceService.formatPrice(0.082);
      expect(formatted).toContain('082');
    });

    it('formats very small prices (< 0.01) with up to 8 decimals', () => {
      const formatted = cryptoPriceService.formatPrice(0.00123);
      expect(formatted).toContain('123');
    });
  });

  describe('formatLargeNumber', () => {
    it('formats trillions', () => {
      expect(cryptoPriceService.formatLargeNumber(1.5e12)).toBe('$1.50T');
    });

    it('formats billions', () => {
      expect(cryptoPriceService.formatLargeNumber(840e9)).toBe('$840.00B');
    });

    it('formats millions', () => {
      expect(cryptoPriceService.formatLargeNumber(42e6)).toBe('$42.00M');
    });

    it('formats thousands', () => {
      expect(cryptoPriceService.formatLargeNumber(5000)).toBe('$5.00K');
    });

    it('formats small numbers without suffix', () => {
      expect(cryptoPriceService.formatLargeNumber(999)).toBe('$999.00');
    });
  });

  describe('price simulation behavior', () => {
    it('BTC price stays within reasonable range of base price', async () => {
      // Call getPrices multiple times and verify price doesn't drift too far
      for (let i = 0; i < 5; i++) {
        const prices = await cryptoPriceService.getPrices(['BTC']);
        const btcPrice = prices[0].price;
        // BTC base is 42850; should not drop below 70% or go too high
        expect(btcPrice).toBeGreaterThan(42850 * 0.65);
        expect(btcPrice).toBeLessThan(42850 * 1.35);
      }
    });

    it('marketCap scales proportionally with price', async () => {
      const prices = await cryptoPriceService.getPrices(['BTC']);
      const btc = prices[0];
      // marketCap = baseMarketCap * (newPrice / basePrice)
      // Base marketCap for BTC is 840B
      expect(btc.marketCap).toBeGreaterThan(500e9);
      expect(btc.marketCap).toBeLessThan(1200e9);
    });
  });
});
