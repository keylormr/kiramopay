// Crypto Price Service - Realistic Simulated Prices
// Uses current market values as base with realistic volatility simulation

// Base prices (approximate real market prices as of January 2025)
const BASE_PRICES: Record<string, { price: number; marketCap: number; volume24h: number }> = {
  BTC: { price: 42850, marketCap: 840000000000, volume24h: 18500000000 },
  ETH: { price: 2340, marketCap: 281000000000, volume24h: 8200000000 },
  USDT: { price: 1.00, marketCap: 95000000000, volume24h: 42000000000 },
  USDC: { price: 1.00, marketCap: 32000000000, volume24h: 5800000000 },
  SOL: { price: 98.50, marketCap: 42000000000, volume24h: 2100000000 },
  MATIC: { price: 0.89, marketCap: 8300000000, volume24h: 380000000 },
  BNB: { price: 312, marketCap: 48000000000, volume24h: 780000000 },
  XRP: { price: 0.62, marketCap: 33500000000, volume24h: 1200000000 },
  ADA: { price: 0.58, marketCap: 20500000000, volume24h: 420000000 },
  DOGE: { price: 0.082, marketCap: 11700000000, volume24h: 580000000 },
  DOT: { price: 7.45, marketCap: 9800000000, volume24h: 290000000 },
  AVAX: { price: 38.20, marketCap: 14200000000, volume24h: 520000000 },
  LINK: { price: 14.80, marketCap: 8700000000, volume24h: 410000000 },
  UNI: { price: 6.35, marketCap: 4800000000, volume24h: 180000000 },
  ATOM: { price: 9.85, marketCap: 3700000000, volume24h: 165000000 },
};

// Volatility profiles for different crypto types
const VOLATILITY: Record<string, number> = {
  BTC: 0.015,    // 1.5% typical daily volatility
  ETH: 0.02,     // 2%
  USDT: 0.0005,  // 0.05% (stablecoin)
  USDC: 0.0005,  // 0.05% (stablecoin)
  SOL: 0.035,    // 3.5% (more volatile)
  MATIC: 0.03,   // 3%
  BNB: 0.02,     // 2%
  XRP: 0.025,    // 2.5%
  ADA: 0.028,    // 2.8%
  DOGE: 0.04,    // 4% (meme coin, very volatile)
  DOT: 0.03,     // 3%
  AVAX: 0.032,   // 3.2%
  LINK: 0.028,   // 2.8%
  UNI: 0.03,     // 3%
  ATOM: 0.03,    // 3%
};

export interface CryptoPriceData {
  symbol: string;
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  lastUpdated: string;
}

export interface PriceHistoryPoint {
  timestamp: number;
  price: number;
}

class CryptoPriceService {
  private currentPrices: Map<string, number> = new Map();
  private priceHistories: Map<string, number[]> = new Map();
  private dailyChanges: Map<string, number> = new Map();
  private lastUpdateTime: Date = new Date();
  private initialized: boolean = false;

  constructor() {
    this.initializePrices();
  }

  // Initialize with base prices and generate initial histories
  private initializePrices(): void {
    Object.entries(BASE_PRICES).forEach(([symbol, data]) => {
      // Add small random offset to base price (-2% to +2%)
      const offset = 1 + (Math.random() * 0.04 - 0.02);
      this.currentPrices.set(symbol, data.price * offset);

      // Generate initial 24h change (-5% to +5% range based on volatility)
      const volatility = VOLATILITY[symbol] || 0.02;
      const change = (Math.random() - 0.5) * volatility * 10 * 100; // Scale to percentage
      this.dailyChanges.set(symbol, change);

      // Generate 7-day price history
      this.priceHistories.set(symbol, this.generatePriceHistory(symbol, 7));
    });
    this.initialized = true;
  }

  // Generate realistic price history
  private generatePriceHistory(symbol: string, days: number): number[] {
    const basePrice = BASE_PRICES[symbol]?.price || 100;
    const volatility = VOLATILITY[symbol] || 0.02;
    const history: number[] = [];

    // Start from days ago and work forward
    let price = basePrice * (1 + (Math.random() * 0.1 - 0.05)); // Start with ±5% variation

    for (let i = 0; i < days; i++) {
      // Random walk with mean reversion tendency
      const change = (Math.random() - 0.5) * volatility * 2;
      const meanReversion = (basePrice - price) / basePrice * 0.1;
      price = price * (1 + change + meanReversion);

      // Ensure stablecoins stay very close to $1
      if (symbol === 'USDT' || symbol === 'USDC') {
        price = 1 + (Math.random() - 0.5) * 0.002;
      }

      history.push(price);
    }

    // Make sure last point is close to current price
    const currentPrice = this.currentPrices.get(symbol) || basePrice;
    history[history.length - 1] = currentPrice;

    return history;
  }

  // Simulate price movement (called internally)
  // Designed for 5-minute intervals - produces subtle, realistic changes
  private simulatePriceMovement(symbol: string): number {
    const currentPrice = this.currentPrices.get(symbol) || BASE_PRICES[symbol]?.price || 100;
    const basePrice = BASE_PRICES[symbol]?.price || 100;
    const volatility = VOLATILITY[symbol] || 0.02;

    // Stablecoins stay very close to $1
    if (symbol === 'USDT' || symbol === 'USDC') {
      return 1 + (Math.random() - 0.5) * 0.0005;
    }

    // Subtle random walk with mean reversion (small changes for stability)
    const randomChange = (Math.random() - 0.5) * volatility * 0.15;
    const meanReversion = (basePrice - currentPrice) / basePrice * 0.01;

    const newPrice = currentPrice * (1 + randomChange + meanReversion);
    return Math.max(newPrice, basePrice * 0.7); // Don't let price drop below 70% of base
  }

  // Get current prices for multiple coins (simulated)
  async getPrices(symbols: string[]): Promise<CryptoPriceData[]> {
    // Simulate small delay for realism
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    const results: CryptoPriceData[] = [];
    const now = new Date();

    symbols.forEach(symbol => {
      const upperSymbol = symbol.toUpperCase();
      const baseData = BASE_PRICES[upperSymbol];

      if (!baseData) return;

      // Update price with small movement
      const newPrice = this.simulatePriceMovement(upperSymbol);
      this.currentPrices.set(upperSymbol, newPrice);

      // Slightly vary the 24h change
      let change24h = this.dailyChanges.get(upperSymbol) || 0;
      change24h += (Math.random() - 0.5) * 0.5; // Small variation
      this.dailyChanges.set(upperSymbol, change24h);

      // Calculate high/low based on price and change
      const priceVariation = Math.abs(change24h) / 100 + 0.02;
      const high24h = newPrice * (1 + priceVariation / 2);
      const low24h = newPrice * (1 - priceVariation / 2);

      // Vary volume slightly
      const volumeVariation = 1 + (Math.random() - 0.5) * 0.2;

      results.push({
        symbol: upperSymbol,
        price: newPrice,
        change24h: change24h,
        marketCap: baseData.marketCap * (newPrice / baseData.price),
        volume24h: baseData.volume24h * volumeVariation,
        high24h,
        low24h,
        lastUpdated: now.toISOString(),
      });
    });

    this.lastUpdateTime = now;
    return results;
  }

  // Get single coin price
  async getPrice(symbol: string): Promise<CryptoPriceData | null> {
    const prices = await this.getPrices([symbol]);
    return prices[0] || null;
  }

  // Get price history (7 days) for sparkline charts
  async getPriceHistory(symbol: string, days: number = 7): Promise<number[]> {
    await new Promise(resolve => setTimeout(resolve, 50)); // Small delay

    const upperSymbol = symbol.toUpperCase();
    let history = this.priceHistories.get(upperSymbol);

    if (!history || history.length === 0) {
      history = this.generatePriceHistory(upperSymbol, days);
      this.priceHistories.set(upperSymbol, history);
    }

    // Update last point to current price
    const currentPrice = this.currentPrices.get(upperSymbol);
    if (currentPrice && history.length > 0) {
      history[history.length - 1] = currentPrice;
    }

    return history;
  }

  // Get all price histories at once
  async getAllPriceHistories(symbols: string[]): Promise<Record<string, number[]>> {
    const histories: Record<string, number[]> = {};

    for (const symbol of symbols) {
      histories[symbol] = await this.getPriceHistory(symbol);
    }

    return histories;
  }

  // Convert crypto amount to fiat
  async convertToFiat(
    symbol: string,
    amount: number,
    fiatCurrency: 'USD' | 'CRC' = 'USD'
  ): Promise<number> {
    const priceData = await this.getPrice(symbol);
    if (!priceData) return 0;

    const usdValue = amount * priceData.price;

    if (fiatCurrency === 'CRC') {
      const CRC_RATE = 515;
      return usdValue * CRC_RATE;
    }

    return usdValue;
  }

  // Convert fiat to crypto amount
  async convertFromFiat(
    symbol: string,
    fiatAmount: number,
    fiatCurrency: 'USD' | 'CRC' = 'USD'
  ): Promise<number> {
    const priceData = await this.getPrice(symbol);
    if (!priceData) return 0;

    let usdAmount = fiatAmount;
    if (fiatCurrency === 'CRC') {
      const CRC_RATE = 515;
      usdAmount = fiatAmount / CRC_RATE;
    }

    return usdAmount / priceData.price;
  }

  // Get exchange rate between two cryptos
  async getExchangeRate(fromSymbol: string, toSymbol: string): Promise<number> {
    const prices = await this.getPrices([fromSymbol, toSymbol]);
    const fromPrice = prices.find(p => p.symbol === fromSymbol.toUpperCase())?.price;
    const toPrice = prices.find(p => p.symbol === toSymbol.toUpperCase())?.price;

    if (!fromPrice || !toPrice) return 0;
    return fromPrice / toPrice;
  }

  // Format price with appropriate decimals
  formatPrice(price: number): string {
    if (price >= 1000) {
      return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else if (price >= 1) {
      return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    } else if (price >= 0.01) {
      return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
    } else {
      return price.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
    }
  }

  // Format large numbers (market cap, volume)
  formatLargeNumber(num: number): string {
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  }
}

export const cryptoPriceService = new CryptoPriceService();
