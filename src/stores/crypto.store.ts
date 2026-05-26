import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CryptoTransaction, StakingPosition, PriceAlert, CryptoAsset, CryptoState } from '@/types';
import {
  initialCryptoAssets,
  initialCryptoTransactions,
  initialStakingPositions,
} from '@/api/adapters/mock/mock-data';

const hasBackend = !!import.meta.env.VITE_API_URL;

interface CryptoStoreState extends CryptoState {
  setAssets: (assets: CryptoAsset[]) => void;
  setCryptoTransactions: (txs: CryptoTransaction[]) => void;
  setStakingPositions: (positions: StakingPosition[]) => void;
  updatePrices: (updates: { symbol: string; price: number; change24h: number; priceHistory?: number[] }[]) => void;
  buyCrypto: (asset: string, amount: number, price: number) => void;
  sellCrypto: (asset: string, amount: number) => void;
  convertCrypto: (fromAsset: string, toAsset: string, fromAmount: number, toAmount: number, price: number) => void;
  sendCrypto: (asset: string, amount: number, fee: number) => void;
  receiveCrypto: (asset: string, amount: number) => void;
  stakeCrypto: (asset: string, amount: number, apy: number, locked: boolean, lockDays?: number) => void;
  unstakeCrypto: (positionId: string) => void;
  claimYield: (positionId: string, amount: number) => void;
  addPriceAlert: (alert: PriceAlert) => void;
  removePriceAlert: (alertId: string) => void;
  toggleFavorite: (symbol: string) => void;
  addTransaction: (tx: CryptoTransaction) => void;
}

export const useCryptoStore = create<CryptoStoreState>()(
  persist(
    (set) => ({
      assets: hasBackend ? [] : initialCryptoAssets,
      transactions: hasBackend ? [] : initialCryptoTransactions,
      stakingPositions: hasBackend ? [] : initialStakingPositions,
      priceAlerts: [],
      favoriteAssets: ['BTC', 'ETH', 'USDT'],
      defaultConvertCurrency: 'CRC',

      setAssets: (assets) => set({ assets }),

      setCryptoTransactions: (txs) => set({ transactions: txs }),

      setStakingPositions: (positions) => set({ stakingPositions: positions }),

      updatePrices: (updates) =>
        set((s) => ({
          assets: s.assets.map((asset) => {
            const update = updates.find((p) => p.symbol === asset.symbol);
            if (update) {
              const newHistory =
                update.priceHistory && update.priceHistory.length > 0
                  ? update.priceHistory
                  : [...asset.priceHistory.slice(1), update.price || asset.currentPrice];
              return {
                ...asset,
                currentPrice: update.price > 0 ? update.price : asset.currentPrice,
                priceChange24h: update.change24h !== 0 ? update.change24h : asset.priceChange24h,
                priceHistory: newHistory,
              };
            }
            return asset;
          }),
        })),

      buyCrypto: (assetSymbol, amount, price) =>
        set((s) => ({
          assets: s.assets.map((a) => {
            if (a.symbol === assetSymbol) {
              const newBalance = a.balance + amount;
              const totalCost = a.balance * a.avgBuyPrice + amount * price;
              return {
                ...a,
                balance: newBalance,
                avgBuyPrice: newBalance > 0 ? totalCost / newBalance : price,
              };
            }
            return a;
          }),
        })),

      sellCrypto: (assetSymbol, amount) =>
        set((s) => ({
          assets: s.assets.map((a) =>
            a.symbol === assetSymbol ? { ...a, balance: a.balance - amount } : a,
          ),
        })),

      convertCrypto: (fromAsset, toAsset, fromAmount, toAmount, price) =>
        set((s) => ({
          assets: s.assets.map((a) => {
            if (a.symbol === fromAsset) return { ...a, balance: a.balance - fromAmount };
            if (a.symbol === toAsset) {
              const newBalance = a.balance + toAmount;
              const totalCost = a.balance * a.avgBuyPrice + toAmount * price;
              return {
                ...a,
                balance: newBalance,
                avgBuyPrice: newBalance > 0 ? totalCost / newBalance : price,
              };
            }
            return a;
          }),
        })),

      sendCrypto: (asset, amount, fee) =>
        set((s) => ({
          assets: s.assets.map((a) =>
            a.symbol === asset ? { ...a, balance: a.balance - amount - fee } : a,
          ),
        })),

      receiveCrypto: (asset, amount) =>
        set((s) => ({
          assets: s.assets.map((a) =>
            a.symbol === asset ? { ...a, balance: a.balance + amount } : a,
          ),
        })),

      stakeCrypto: (asset, amount, apy, locked, lockDays) =>
        set((s) => {
          const position: StakingPosition = {
            id: `stake-${Date.now()}`,
            asset,
            amount,
            apy,
            startDate: 'Ahora',
            earned: 0,
            locked,
            lockPeriodDays: lockDays,
          };
          return {
            assets: s.assets.map((a) =>
              a.symbol === asset ? { ...a, balance: a.balance - amount } : a,
            ),
            stakingPositions: [...s.stakingPositions, position],
          };
        }),

      unstakeCrypto: (positionId) =>
        set((s) => {
          const position = s.stakingPositions.find((p) => p.id === positionId);
          if (!position) return s;
          return {
            assets: s.assets.map((a) =>
              a.symbol === position.asset
                ? { ...a, balance: a.balance + position.amount + position.earned }
                : a,
            ),
            stakingPositions: s.stakingPositions.filter((p) => p.id !== positionId),
          };
        }),

      claimYield: (positionId, amount) =>
        set((s) => {
          const position = s.stakingPositions.find((p) => p.id === positionId);
          if (!position) return s;
          return {
            assets: s.assets.map((a) =>
              a.symbol === position.asset ? { ...a, balance: a.balance + amount } : a,
            ),
            stakingPositions: s.stakingPositions.map((p) =>
              p.id === positionId ? { ...p, earned: 0 } : p,
            ),
          };
        }),

      addPriceAlert: (alert) =>
        set((s) => ({ priceAlerts: [...s.priceAlerts, alert] })),

      removePriceAlert: (alertId) =>
        set((s) => ({ priceAlerts: s.priceAlerts.filter((a) => a.id !== alertId) })),

      toggleFavorite: (symbol) =>
        set((s) => ({
          favoriteAssets: s.favoriteAssets.includes(symbol)
            ? s.favoriteAssets.filter((a) => a !== symbol)
            : [...s.favoriteAssets, symbol],
        })),

      addTransaction: (tx) =>
        set((s) => ({ transactions: [tx, ...s.transactions] })),
    }),
    {
      name: 'kiramopay-crypto',
    },
  ),
);
