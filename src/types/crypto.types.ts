export interface CryptoAsset {
  id: string;
  symbol: string;
  name: string;
  icon: string;
  color: string;
  balance: number;
  avgBuyPrice: number;
  currentPrice: number;
  priceChange24h: number;
  priceHistory: number[];
}

export interface CryptoTransaction {
  id: string;
  type: 'buy' | 'sell' | 'convert' | 'send' | 'receive' | 'stake' | 'unstake' | 'yield';
  fromAsset: string;
  toAsset?: string;
  fromAmount: number;
  toAmount?: number;
  price: number;
  fee: number;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  txHash?: string;
}

export interface StakingPosition {
  id: string;
  asset: string;
  amount: number;
  apy: number;
  startDate: string;
  earned: number;
  locked: boolean;
  lockPeriodDays?: number;
}

export interface PriceAlert {
  id: string;
  asset: string;
  targetPrice: number;
  condition: 'above' | 'below';
  active: boolean;
  triggered?: boolean;
}

export interface CryptoState {
  assets: CryptoAsset[];
  transactions: CryptoTransaction[];
  stakingPositions: StakingPosition[];
  priceAlerts: PriceAlert[];
  favoriteAssets: string[];
  defaultConvertCurrency: string;
}
