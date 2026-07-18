import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '../../i18n/LanguageContext';
import { Icons } from '../../components/Icons';
import { BottomSheet } from '../../components/BottomSheet';
import { ConfirmSendSheet } from '../../components/ConfirmSendSheet';
import { CryptoAsset, CryptoTransaction } from '../../types';
import { cryptoPriceService, CryptoPriceData } from '../../services/cryptoPrices';
import { useUsdToCrcRate } from '@/hooks/useFxRate';

// Static list of crypto symbols to track
const CRYPTO_SYMBOLS: string[] = ['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'MATIC'];

// Helper function to format large numbers (safer than calling service method)
const formatLargeNumber = (value: number | string | undefined | null): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
};

// Mini Sparkline Chart Component
const SparklineChart: React.FC<{ data: number[]; color: string; positive: boolean }> = ({ data, positive }) => {
  // Need at least 2 valid numbers to draw a line
  const validData = Array.isArray(data) ? data.filter(d => typeof d === 'number' && !isNaN(d)) : [];

  if (validData.length < 2) {
    // Show a flat line instead of loading skeleton when we have some data
    return (
      <svg width={80} height={40} className="overflow-visible">
        <line x1="0" y1="20" x2="80" y2="20" stroke="#9CA3AF" strokeWidth="2" strokeDasharray="4,4" />
      </svg>
    );
  }

  const min = Math.min(...validData);
  const max = Math.max(...validData);
  const range = max - min || 1;
  const height = 40;
  const width = 80;

  const points = validData.map((value, index) => {
    const x = (index / (validData.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={positive ? '#10B981' : '#EF4444'}
        strokeWidth="2"
        points={points}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const CryptoView: React.FC = () => {
  const { state, dispatch } = useApp();
  const { t } = useLanguage();
  // Single shared USD->CRC rate (same source as the wallet + balance summary).
  const crcRate = useUsdToCrcRate();

  const [activeSheet, setActiveSheet] = useState<'none' | 'assetDetail' | 'buy' | 'sell' | 'convert' | 'send' | 'receive' | 'stake' | 'txDetail'>('none');
  const [selectedAsset, setSelectedAsset] = useState<CryptoAsset | null>(null);
  const [selectedTx, setSelectedTx] = useState<CryptoTransaction | null>(null);
  const [activeTab, setActiveTab] = useState<'portfolio' | 'market' | 'staking'>('portfolio');

  // Form states
  const [amount, setAmount] = useState('');
  const [convertTo, setConvertTo] = useState('CRC');
  const [sendAddress, setSendAddress] = useState('');
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  // Real-time price states
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setPriceError] = useState<string | null>(null);
  const [marketData, setMarketData] = useState<Record<string, CryptoPriceData>>({});

  // Calculate totals
  const totalUsdValue = state.crypto.assets.reduce((acc, asset) =>
    acc + (asset.balance * asset.currentPrice), 0
  );

  const totalCrcValue = totalUsdValue * crcRate;

  const totalProfitLoss = state.crypto.assets.reduce((acc, asset) => {
    if (asset.balance > 0) {
      const currentValue = asset.balance * asset.currentPrice;
      const costBasis = asset.balance * asset.avgBuyPrice;
      return acc + (currentValue - costBasis);
    }
    return acc;
  }, 0);

  const totalProfitLossPercent = totalUsdValue > 0
    ? (totalProfitLoss / (totalUsdValue - totalProfitLoss)) * 100
    : 0;

  // Assets with balance
  const assetsWithBalance = state.crypto.assets.filter(a => a.balance > 0);

  // Use ref for dispatch to avoid re-creating callbacks on every render
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // Fetch prices from simulated service
  const fetchPrices = useCallback(async () => {
    try {
      setPriceError(null);
      const prices = await cryptoPriceService.getPrices(CRYPTO_SYMBOLS);

      if (prices.length > 0) {
        // Store full market data
        const dataMap: Record<string, CryptoPriceData> = {};
        prices.forEach(p => { dataMap[p.symbol] = p; });
        setMarketData(dataMap);

        // Update state with new prices
        const updates = prices.map(p => ({
          symbol: p.symbol,
          price: p.price,
          change24h: p.change24h
        }));
        dispatchRef.current({ type: 'UPDATE_CRYPTO_PRICES', payload: updates });
        setLastUpdated(new Date());
      }
      setIsLoading(false);
    } catch {
      setPriceError('Error al obtener precios');
      setIsLoading(false);
    }
  }, []);

  // Fetch price history for sparklines
  const fetchPriceHistories = useCallback(async () => {
    try {
      const histories = await cryptoPriceService.getAllPriceHistories(CRYPTO_SYMBOLS);

      // Update assets with price history
      const updates = Object.entries(histories).map(([symbol, history]) => ({
        symbol,
        price: 0,
        change24h: 0,
        priceHistory: history
      })).filter(u => u.priceHistory.length > 0);

      if (updates.length > 0) {
        dispatchRef.current({ type: 'UPDATE_CRYPTO_PRICES', payload: updates });
      }
    } catch {
      // Price history fetch failed — sparklines will show flat line
    }
  }, []);

  // Initial fetch and periodic updates — runs only once on mount
  useEffect(() => {
    // Schedule initial fetch asynchronously to avoid synchronous setState in effect
    const initialTimer = setTimeout(() => {
      fetchPrices();
      fetchPriceHistories();
    }, 0);

    // Update prices every 5 minutes (stable display, manual refresh available)
    const priceInterval = setInterval(fetchPrices, 300000);

    // Update histories every 10 minutes
    const historyInterval = setInterval(fetchPriceHistories, 600000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(priceInterval);
      clearInterval(historyInterval);
    };
  }, [fetchPrices, fetchPriceHistories]);

  const formatUsd = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  const formatCrc = (value: number) => {
    return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(value);
  };

  const formatCrypto = (value: number, decimals: number = 6) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '0';
    if (n < 0.000001) return n.toExponential(2);
    return n.toFixed(decimals).replace(/\.?0+$/, '');
  };

  const handleBuy = () => {
    if (!selectedAsset || !amount) return;
    const fiatAmount = parseFloat(amount);
    const cryptoAmount = fiatAmount / selectedAsset.currentPrice;

    dispatch({
      type: 'BUY_CRYPTO',
      payload: {
        asset: selectedAsset.symbol,
        amount: cryptoAmount,
        price: selectedAsset.currentPrice,
        fromCurrency: 'USD',
        fromAmount: fiatAmount
      }
    });
    setActiveSheet('none');
    setAmount('');
  };

  const handleSell = () => {
    if (!selectedAsset || !amount) return;
    const cryptoAmount = parseFloat(amount);
    const fiatAmount = cryptoAmount * selectedAsset.currentPrice;

    dispatch({
      type: 'SELL_CRYPTO',
      payload: {
        asset: selectedAsset.symbol,
        amount: cryptoAmount,
        price: selectedAsset.currentPrice,
        toCurrency: convertTo,
        toAmount: convertTo === 'CRC' ? fiatAmount * crcRate : fiatAmount
      }
    });
    setActiveSheet('none');
    setAmount('');
  };

  const handleConvert = () => {
    if (!selectedAsset || !amount || !convertTo) return;
    const fromAmount = parseFloat(amount);
    const toAsset = state.crypto.assets.find(a => a.symbol === convertTo);
    if (!toAsset) return;

    const fromUsd = fromAmount * selectedAsset.currentPrice;
    const toAmount = fromUsd / toAsset.currentPrice;

    dispatch({
      type: 'CONVERT_CRYPTO',
      payload: {
        fromAsset: selectedAsset.symbol,
        toAsset: convertTo,
        fromAmount,
        toAmount,
        price: toAsset.currentPrice
      }
    });
    setActiveSheet('none');
    setAmount('');
  };

  const handleSend = () => {
    if (!selectedAsset || !amount || !sendAddress) return;
    const sendAmount = parseFloat(amount);
    const fee = sendAmount * 0.0001;

    dispatch({
      type: 'SEND_CRYPTO',
      payload: {
        asset: selectedAsset.symbol,
        amount: sendAmount,
        toAddress: sendAddress,
        fee
      }
    });
    setShowSendConfirm(false);
    setActiveSheet('none');
    setAmount('');
    setSendAddress('');
  };

  const handleStake = () => {
    if (!selectedAsset || !amount) return;
    const stakeAmount = parseFloat(amount);
    const apyRates: Record<string, number> = { ETH: 4.5, USDT: 8.0, USDC: 6.5, SOL: 7.2 };
    const apy = apyRates[selectedAsset.symbol] || 3.0;

    dispatch({
      type: 'STAKE_CRYPTO',
      payload: {
        asset: selectedAsset.symbol,
        amount: stakeAmount,
        apy,
        locked: false
      }
    });
    setActiveSheet('none');
    setAmount('');
  };

  const getTxIcon = (type: CryptoTransaction['type']) => {
    switch (type) {
      case 'buy': return <Icons.ArrowDownLeft size={16} className="text-green-500" />;
      case 'sell': return <Icons.ArrowUpRight size={16} className="text-red-500" />;
      case 'send': return <Icons.Send size={16} className="text-orange-500" />;
      case 'receive': return <Icons.Receive size={16} className="text-green-500" />;
      case 'convert': return <Icons.RefreshCw size={16} className="text-blue-500" />;
      case 'stake': return <Icons.Lock size={16} className="text-purple-500" />;
      case 'unstake': return <Icons.Unlock size={16} className="text-purple-500" />;
      case 'yield': return <Icons.TrendingUp size={16} className="text-green-500" />;
      default: return <Icons.Circle size={16} />;
    }
  };

  const getTxLabel = (type: CryptoTransaction['type']) => {
    const labels: Record<string, string> = {
      buy: t('crypto_tx_buy'), sell: t('crypto_tx_sell'), send: t('crypto_tx_send'), receive: t('crypto_tx_receive'),
      convert: t('crypto_tx_convert'), stake: t('staking'), unstake: t('crypto_tx_unstake'), yield: t('crypto_tx_yield')
    };
    return labels[type] || type;
  };

  // Format time ago
  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return t('crypto_just_now');
    if (seconds < 3600) return t('crypto_minutes_ago').replace('{n}', String(Math.floor(seconds / 60)));
    return t('crypto_hours_ago').replace('{n}', String(Math.floor(seconds / 3600)));
  };

  return (
    <div className="pb-24 pt-4 space-y-6 px-4">

      {/* Portfolio Header — Unified Vision hero */}
      <div className="relative overflow-hidden uv-gradient-brand rounded-3xl p-6 text-white uv-shadow-floating">
        <div
          className="absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-30 pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.6), transparent)' }}
        />
        <div className="relative flex justify-between items-start mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">{t('total_portfolio')}</p>
              <div aria-live="polite">
                {isLoading ? (
                  <div className="w-2 h-2 rounded-full bg-[var(--color-warning)] animate-pulse" title={t('crypto_updating')} role="status" aria-label={t('crypto_updating')} />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-[var(--color-success)]" title={t('crypto_prices_updated')} role="status" aria-label={t('crypto_prices_updated')} />
                )}
              </div>
            </div>
            <h1 className="text-3xl font-black mt-1 tabular-nums">{formatUsd(totalUsdValue)}</h1>
            <p className="text-white/70 text-sm mt-1 tabular-nums">{formatCrc(totalCrcValue)}</p>
          </div>
          <div className="text-right shrink-0">
            <div className={`px-3 py-1.5 rounded-full text-sm font-bold backdrop-blur-sm border tabular-nums ${totalProfitLoss >= 0 ? 'bg-[var(--color-success)]/25 border-[var(--color-success)]/40 text-white' : 'bg-[var(--color-danger)]/25 border-[var(--color-danger)]/40 text-white'}`}>
              {totalProfitLoss >= 0 ? '+' : ''}{formatUsd(totalProfitLoss)} ({totalProfitLossPercent.toFixed(2)}%)
            </div>
            {lastUpdated && (
              <button
                onClick={() => { setIsLoading(true); fetchPrices(); }}
                aria-label={t('crypto_refresh_prices')}
                className="flex items-center gap-1 mt-2 text-xs text-white/70 hover:text-white transition-colors ml-auto"
              >
                <Icons.RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                {formatTimeAgo(lastUpdated)}
              </button>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="relative flex gap-2 mt-4">
          <button
            onClick={() => { setSelectedAsset(state.crypto.assets.find(a => a.symbol === 'BTC') || null); setActiveSheet('buy'); }}
            className="flex-1 bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            <Icons.Plus size={16} /> {t('buy')}
          </button>
          <button
            onClick={() => { setSelectedAsset(assetsWithBalance[0] || null); setActiveSheet('sell'); }}
            className="flex-1 bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            <Icons.Minus size={16} /> {t('sell')}
          </button>
          <button
            onClick={() => { setSelectedAsset(assetsWithBalance[0] || null); setActiveSheet('convert'); }}
            className="flex-1 bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            <Icons.RefreshCw size={16} /> {t('convert')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl p-1">
        {(['portfolio', 'market', 'staking'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === tab ? 'uv-surface-1 uv-shadow-soft uv-text-primary' : 'uv-text-muted hover:uv-text-secondary'}`}
          >
            {tab === 'portfolio' ? t('crypto_my_portfolio') : tab === 'market' ? t('market') : t('staking')}
          </button>
        ))}
      </div>

      {/* Portfolio Tab */}
      {activeTab === 'portfolio' && (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white">{t('my_assets')}</h3>

          {assetsWithBalance.length === 0 ? (
            <div className="uv-surface-1 rounded-2xl p-8 text-center border border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
              <div className="w-16 h-16 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full flex items-center justify-center mx-auto mb-4">
                <Icons.Wallet size={28} className="uv-text-muted" />
              </div>
              <p className="text-gray-500 mb-4">{t('no_crypto_yet')}</p>
              <button
                onClick={() => { setSelectedAsset(state.crypto.assets[0]); setActiveSheet('buy'); }}
                className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-6 py-2 rounded-xl font-bold"
              >
                {t('buy_crypto')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {assetsWithBalance.map(asset => {
                const value = asset.balance * asset.currentPrice;
                const profitLoss = (asset.currentPrice - asset.avgBuyPrice) * asset.balance;
                const profitLossPercent = ((asset.currentPrice - asset.avgBuyPrice) / asset.avgBuyPrice) * 100;

                return (
                  <button
                    key={asset.id}
                    onClick={() => { setSelectedAsset(asset); setActiveSheet('assetDetail'); }}
                    className="w-full uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] flex items-center gap-4 hover:shadow-md transition-all"
                  >
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-bold"
                      style={{ backgroundColor: asset.color }}
                    >
                      {asset.icon}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex justify-between items-center">
                        <span className="font-bold uv-text-primary">{asset.name}</span>
                        <span className="font-bold uv-text-primary">{formatUsd(value)}</span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm text-gray-500">{formatCrypto(asset.balance)} {asset.symbol}</span>
                        <span className={`text-sm font-medium ${profitLoss >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {profitLoss >= 0 ? '+' : ''}{profitLossPercent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    <SparklineChart data={asset.priceHistory} color={asset.color} positive={asset.priceChange24h >= 0} />
                  </button>
                );
              })}
            </div>
          )}

          {/* Recent Transactions */}
          {state.crypto.transactions.length > 0 && (
            <>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-6">{t('recent_crypto_tx')}</h3>
              <div className="uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
                {state.crypto.transactions.slice(0, 5).map(tx => (
                  <button
                    key={tx.id}
                    onClick={() => { setSelectedTx(tx); setActiveSheet('txDetail'); }}
                    className="w-full flex items-center p-4 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center mr-3">
                      {getTxIcon(tx.type)}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-bold text-sm uv-text-primary">
                        {getTxLabel(tx.type)} {tx.fromAsset}{tx.toAsset ? ` → ${tx.toAsset}` : ''}
                      </div>
                      <div className="text-xs text-gray-500">{tx.date}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold text-sm ${tx.type === 'buy' || tx.type === 'receive' || tx.type === 'yield' ? 'text-green-500' : 'uv-text-primary'}`}>
                        {tx.type === 'buy' || tx.type === 'receive' || tx.type === 'yield' ? '+' : '-'}{formatCrypto(tx.fromAmount)} {tx.fromAsset}
                      </div>
                      <div className="text-xs text-gray-500">{formatUsd(tx.fromAmount * tx.price)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Market Tab */}
      {activeTab === 'market' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">{t('crypto_market_live')}</h3>
            <button
              onClick={() => { setIsLoading(true); fetchPrices(); }}
              aria-label={t('crypto_refresh_prices')}
              className="flex items-center gap-1 text-sm text-[var(--color-primary)]"
            >
              <Icons.RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              {t('crypto_refresh')}
            </button>
          </div>

          {(
            state.crypto.assets.map(asset => {
              const mktData = marketData[asset.symbol];
              return (
                <button
                  key={asset.id}
                  onClick={() => { setSelectedAsset(asset); setActiveSheet('assetDetail'); }}
                  className="w-full uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-bold"
                      style={{ backgroundColor: asset.color }}
                    >
                      {asset.icon}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex justify-between items-center">
                        <span className="font-bold uv-text-primary">{asset.name}</span>
                        <span className="font-bold uv-text-primary">{formatUsd(asset.currentPrice)}</span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm text-gray-500">{asset.symbol}</span>
                        <span className={`text-sm font-medium ${asset.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {asset.priceChange24h >= 0 ? '+' : ''}{asset.priceChange24h.toFixed(2)}%
                        </span>
                      </div>
                      {mktData && mktData.marketCap > 0 && (
                        <div className="flex gap-4 mt-2 text-xs text-gray-400">
                          <span>{t('crypto_market_cap_short')}: {formatLargeNumber(mktData.marketCap)}</span>
                          <span>{t('crypto_volume_short')}: {formatLargeNumber(mktData.volume24h)}</span>
                        </div>
                      )}
                    </div>
                    <SparklineChart data={asset.priceHistory} color={asset.color} positive={asset.priceChange24h >= 0} />
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Staking Tab */}
      {activeTab === 'staking' && (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white">{t('crypto_staking_positions')}</h3>

          {state.crypto.stakingPositions.length === 0 ? (
            <div className="uv-surface-1 rounded-2xl p-8 text-center border border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
              <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icons.Percent size={28} className="text-purple-500" />
              </div>
              <p className="text-gray-500 mb-2">{t('earn_passive')}</p>
              <p className="text-sm text-gray-400 mb-4">{t('crypto_up_to_apy')}</p>
              <button
                onClick={() => { setSelectedAsset(assetsWithBalance.find(a => a.symbol === 'ETH' || a.symbol === 'USDT') || null); setActiveSheet('stake'); }}
                className="bg-purple-600 text-white px-6 py-2 rounded-xl font-bold"
                disabled={assetsWithBalance.length === 0}
              >
                {t('start_staking')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {state.crypto.stakingPositions.map(position => {
                const asset = state.crypto.assets.find(a => a.symbol === position.asset);
                const valueUsd = position.amount * (asset?.currentPrice || 0);
                const earnedUsd = position.earned * (asset?.currentPrice || 0);

                return (
                  <div key={position.id} className="uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                    <div className="flex items-center gap-4 mb-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: asset?.color || '#666' }}
                      >
                        {asset?.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between">
                          <span className="font-bold uv-text-primary">{position.asset} {t('staking')}</span>
                          <span className="text-green-500 font-bold">{position.apy}% APY</span>
                        </div>
                        <div className="text-sm text-gray-500">{t('crypto_since')} {position.startDate}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 uv-surface-2 rounded-xl p-3">
                      <div>
                        <p className="text-xs text-gray-500">{t('crypto_staked')}</p>
                        <p className="font-bold uv-text-primary">{formatCrypto(position.amount)} {position.asset}</p>
                        <p className="text-xs text-gray-500">{formatUsd(valueUsd)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">{t('earned')}</p>
                        <p className="font-bold text-green-500">{formatCrypto(position.earned)} {position.asset}</p>
                        <p className="text-xs text-gray-500">{formatUsd(earnedUsd)}</p>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                      {position.earned > 0 && (
                        <button
                          onClick={() => dispatch({ type: 'CLAIM_STAKING_YIELD', payload: { positionId: position.id, amount: position.earned } })}
                          className="flex-1 bg-green-500 text-white py-2 rounded-xl text-sm font-bold"
                        >
                          {t('claim')}
                        </button>
                      )}
                      {!position.locked && (
                        <button
                          onClick={() => dispatch({ type: 'UNSTAKE_CRYPTO', payload: { positionId: position.id } })}
                          className="flex-1 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary py-2 rounded-xl text-sm font-bold"
                        >
                          {t('crypto_withdraw')}
                        </button>
                      )}
                      {position.locked && (
                        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-gray-500">
                          <Icons.Lock size={14} />
                          {t('locked')} {position.lockPeriodDays} {t('crypto_days')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* APY Rates */}
          <div className="bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 rounded-2xl p-4">
            <h4 className="font-bold uv-text-primary mb-3">{t('yield_rates')}</h4>
            <div className="grid grid-cols-2 gap-3">
              {[
                { asset: 'ETH', apy: 4.5 },
                { asset: 'USDT', apy: 8.0 },
                { asset: 'USDC', apy: 6.5 },
                { asset: 'SOL', apy: 7.2 },
              ].map(rate => (
                <div key={rate.asset} className="flex justify-between items-center bg-white/50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
                  <span className="font-medium text-slate-700 dark:text-gray-300">{rate.asset}</span>
                  <span className="font-bold text-green-600">{rate.apy}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== Bottom Sheets ===== */}

      {/* Asset Detail Sheet */}
      {selectedAsset && (
        <BottomSheet
          isOpen={activeSheet === 'assetDetail'}
          onClose={() => setActiveSheet('none')}
          title={selectedAsset.name}
        >
          <div className="space-y-6">
            <div className="text-center py-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3"
                style={{ backgroundColor: selectedAsset.color }}
              >
                {selectedAsset.icon}
              </div>
              <div className="text-3xl font-black uv-text-primary">{formatUsd(selectedAsset.currentPrice)}</div>
              <div className={`text-sm font-medium mt-1 ${selectedAsset.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {selectedAsset.priceChange24h >= 0 ? '▲' : '▼'} {Math.abs(selectedAsset.priceChange24h).toFixed(2)}% (24h)
              </div>

              {/* Market Data */}
              {marketData[selectedAsset.symbol] && marketData[selectedAsset.symbol].marketCap > 0 && (
                <div className="grid grid-cols-2 gap-3 mt-4 text-left">
                  <div className="uv-surface-2 rounded-xl p-3">
                    <p className="text-xs text-gray-500">{t('crypto_market_cap')}</p>
                    <p className="font-bold uv-text-primary">
                      {formatLargeNumber(marketData[selectedAsset.symbol].marketCap)}
                    </p>
                  </div>
                  <div className="uv-surface-2 rounded-xl p-3">
                    <p className="text-xs text-gray-500">{t('crypto_volume_24h')}</p>
                    <p className="font-bold uv-text-primary">
                      {formatLargeNumber(marketData[selectedAsset.symbol].volume24h)}
                    </p>
                  </div>
                  <div className="uv-surface-2 rounded-xl p-3">
                    <p className="text-xs text-gray-500">{t('crypto_high_24h')}</p>
                    <p className="font-bold text-green-500">{formatUsd(marketData[selectedAsset.symbol].high24h || 0)}</p>
                  </div>
                  <div className="uv-surface-2 rounded-xl p-3">
                    <p className="text-xs text-gray-500">{t('crypto_low_24h')}</p>
                    <p className="font-bold text-red-500">{formatUsd(marketData[selectedAsset.symbol].low24h || 0)}</p>
                  </div>
                </div>
              )}
            </div>

            {selectedAsset.balance > 0 && (
              <div className="uv-surface-2 rounded-xl p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">{t('crypto_your_balance')}</p>
                    <p className="font-bold uv-text-primary">{formatCrypto(selectedAsset.balance)} {selectedAsset.symbol}</p>
                    <p className="text-sm text-gray-500">{formatUsd(selectedAsset.balance * selectedAsset.currentPrice)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{t('crypto_avg_price')}</p>
                    <p className="font-bold uv-text-primary">{formatUsd(selectedAsset.avgBuyPrice)}</p>
                    <p className={`text-sm ${selectedAsset.currentPrice >= selectedAsset.avgBuyPrice ? 'text-green-500' : 'text-red-500'}`}>
                      {((selectedAsset.currentPrice - selectedAsset.avgBuyPrice) / selectedAsset.avgBuyPrice * 100).toFixed(2)}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setActiveSheet('buy')}
                className="bg-green-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2"
              >
                <Icons.Plus size={18} /> {t('buy')}
              </button>
              <button
                onClick={() => setActiveSheet('sell')}
                disabled={selectedAsset.balance === 0}
                className="bg-red-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Icons.Minus size={18} /> {t('sell')}
              </button>
              <button
                onClick={() => setActiveSheet('send')}
                disabled={selectedAsset.balance === 0}
                className="border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Icons.Send size={18} /> {t('send')}
              </button>
              <button
                onClick={() => setActiveSheet('receive')}
                className="border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary py-3 rounded-xl font-bold flex items-center justify-center gap-2"
              >
                <Icons.Receive size={18} /> {t('receive')}
              </button>
            </div>

            {selectedAsset.balance > 0 && (selectedAsset.symbol === 'ETH' || selectedAsset.symbol === 'USDT' || selectedAsset.symbol === 'USDC') && (
              <button
                onClick={() => setActiveSheet('stake')}
                className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2"
              >
                <Icons.Percent size={18} /> {t('crypto_do_staking')}
              </button>
            )}
          </div>
        </BottomSheet>
      )}

      {/* Buy Sheet */}
      <BottomSheet isOpen={activeSheet === 'buy'} onClose={() => { setActiveSheet('none'); setAmount(''); }} title={`${t('buy')} ${selectedAsset?.symbol || t('crypto_generic')}`}>
        <div className="space-y-6">
          <div className="uv-surface-2 rounded-xl p-4">
            <label className="text-xs text-gray-500 font-bold">{t('select_crypto')}</label>
            <select
              className="w-full bg-transparent text-lg font-bold uv-text-primary mt-2 outline-none"
              value={selectedAsset?.symbol || ''}
              onChange={(e) => setSelectedAsset(state.crypto.assets.find(a => a.symbol === e.target.value) || null)}
            >
              {state.crypto.assets.map(a => (
                <option key={a.symbol} value={a.symbol}>{a.name} ({a.symbol}) - {formatUsd(a.currentPrice)}</option>
              ))}
            </select>
          </div>

          <div className="text-center">
            <label className="text-sm text-gray-500">{t('invest_amount')} (USD)</label>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="text-4xl font-bold uv-text-primary">$</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="text-5xl font-bold bg-transparent w-48 text-center outline-none uv-text-primary"
              />
            </div>
            {amount && selectedAsset && (
              <p className="text-sm text-gray-500 mt-2">
                ≈ {formatCrypto(parseFloat(amount) / selectedAsset.currentPrice)} {selectedAsset.symbol}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            {[50, 100, 250, 500].map(preset => (
              <button
                key={preset}
                onClick={() => setAmount(preset.toString())}
                className="flex-1 py-2 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-lg text-sm font-bold text-slate-700 dark:text-gray-300"
              >
                ${preset}
              </button>
            ))}
          </div>

          <button
            onClick={handleBuy}
            disabled={!amount || parseFloat(amount) <= 0}
            className="w-full bg-green-500 text-white py-4 rounded-xl font-bold disabled:opacity-50"
          >
            {t('buy')} {selectedAsset?.symbol}
          </button>
        </div>
      </BottomSheet>

      {/* Sell Sheet */}
      <BottomSheet isOpen={activeSheet === 'sell'} onClose={() => { setActiveSheet('none'); setAmount(''); }} title={`${t('sell')} ${selectedAsset?.symbol || ''}`}>
        <div className="space-y-6">
          {selectedAsset && (
            <div className="uv-surface-2 rounded-xl p-4">
              <div className="flex justify-between items-center">
                <span className="uv-text-muted">{t('available')}</span>
                <span className="font-bold uv-text-primary">{formatCrypto(selectedAsset.balance)} {selectedAsset.symbol}</span>
              </div>
            </div>
          )}

          <div className="text-center">
            <label className="text-sm text-gray-500">{t('crypto_amount_to_sell')}</label>
            <div className="flex items-center justify-center gap-2 mt-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="text-5xl font-bold bg-transparent w-48 text-center outline-none uv-text-primary"
              />
              <span className="text-2xl font-bold text-gray-400">{selectedAsset?.symbol}</span>
            </div>
            {amount && selectedAsset && (
              <p className="text-sm text-gray-500 mt-2">
                ≈ {formatUsd(parseFloat(amount) * selectedAsset.currentPrice)}
              </p>
            )}
          </div>

          <div className="uv-surface-2 rounded-xl p-4">
            <label className="text-xs text-gray-500 font-bold">{t('receive_in')}</label>
            <div className="flex gap-2 mt-2">
              {['CRC', 'USD'].map(ccy => (
                <button
                  key={ccy}
                  onClick={() => setConvertTo(ccy)}
                  className={`flex-1 py-2 rounded-lg font-bold ${convertTo === ccy ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                >
                  {ccy}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSell}
            disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > (selectedAsset?.balance || 0)}
            className="w-full bg-red-500 text-white py-4 rounded-xl font-bold disabled:opacity-50"
          >
            {t('crypto_sell_and_receive')} {convertTo}
          </button>
        </div>
      </BottomSheet>

      {/* Convert Sheet */}
      <BottomSheet isOpen={activeSheet === 'convert'} onClose={() => { setActiveSheet('none'); setAmount(''); }} title={`${t('convert')} ${t('crypto_generic')}`}>
        <div className="space-y-6">
          <div className="uv-surface-2 rounded-xl p-4">
            <label className="text-xs text-gray-500 font-bold">{t('from')}</label>
            <select
              className="w-full bg-transparent text-lg font-bold uv-text-primary mt-2 outline-none"
              value={selectedAsset?.symbol || ''}
              onChange={(e) => setSelectedAsset(state.crypto.assets.find(a => a.symbol === e.target.value) || null)}
            >
              {assetsWithBalance.map(a => (
                <option key={a.symbol} value={a.symbol}>{a.name} - {formatCrypto(a.balance)} {t('crypto_available_suffix')}</option>
              ))}
            </select>
          </div>

          <div className="text-center">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="text-4xl font-bold bg-transparent w-48 text-center outline-none uv-text-primary"
            />
          </div>

          <div className="flex justify-center">
            <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
              <Icons.ArrowDownUp size={20} className="uv-text-muted" />
            </div>
          </div>

          <div className="uv-surface-2 rounded-xl p-4">
            <label className="text-xs text-gray-500 font-bold">{t('crypto_to_label')}</label>
            <select
              className="w-full bg-transparent text-lg font-bold uv-text-primary mt-2 outline-none"
              value={convertTo}
              onChange={(e) => setConvertTo(e.target.value)}
            >
              {state.crypto.assets.filter(a => a.symbol !== selectedAsset?.symbol).map(a => (
                <option key={a.symbol} value={a.symbol}>{a.name} ({a.symbol})</option>
              ))}
            </select>
          </div>

          {amount && selectedAsset && convertTo && (
            <div className="text-center text-gray-500">
              {t('crypto_receive_approx')}: <span className="font-bold uv-text-primary">
                {formatCrypto((parseFloat(amount) * selectedAsset.currentPrice) / (state.crypto.assets.find(a => a.symbol === convertTo)?.currentPrice || 1))} {convertTo}
              </span>
            </div>
          )}

          <button
            onClick={handleConvert}
            disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > (selectedAsset?.balance || 0)}
            className="w-full bg-blue-500 text-white py-4 rounded-xl font-bold disabled:opacity-50"
          >
            {t('convert')}
          </button>
        </div>
      </BottomSheet>

      {/* Send Sheet */}
      <BottomSheet isOpen={activeSheet === 'send'} onClose={() => { setActiveSheet('none'); setAmount(''); setSendAddress(''); }} title={`${t('send')} ${selectedAsset?.symbol || ''}`}>
        <div className="space-y-6">
          <div className="uv-surface-2 rounded-xl p-4">
            <label className="text-xs text-gray-500 font-bold">{t('destination_address')}</label>
            <input
              type="text"
              value={sendAddress}
              onChange={(e) => setSendAddress(e.target.value)}
              placeholder={t('crypto_address_placeholder')}
              className="w-full bg-transparent text-lg font-mono uv-text-primary mt-2 outline-none"
            />
          </div>

          <div className="text-center">
            <label className="text-sm text-gray-500">{t('amount')}</label>
            <div className="flex items-center justify-center gap-2 mt-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="text-4xl font-bold bg-transparent w-48 text-center outline-none uv-text-primary"
              />
              <span className="text-xl font-bold text-gray-400">{selectedAsset?.symbol}</span>
            </div>
            <p className="text-sm text-gray-500 mt-2">{t('available')}: {formatCrypto(selectedAsset?.balance || 0)} {selectedAsset?.symbol}</p>
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Icons.AlertTriangle size={20} className="text-yellow-600 mt-0.5" />
              <div>
                <p className="font-bold text-yellow-800 dark:text-yellow-200">{t('verify_address')}</p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">{t('irreversible_warning')}</p>
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowSendConfirm(true)}
            disabled={!amount || !sendAddress || parseFloat(amount) <= 0 || parseFloat(amount) > (selectedAsset?.balance || 0)}
            className="w-full bg-orange-500 text-white py-4 rounded-xl font-bold disabled:opacity-50"
          >
            {t('send')} {selectedAsset?.symbol}
          </button>
        </div>
      </BottomSheet>

      {/* Review-before-send confirmation (crypto is irreversible) */}
      <ConfirmSendSheet
        isOpen={showSendConfirm}
        onClose={() => setShowSendConfirm(false)}
        onConfirm={handleSend}
        amountDisplay={`${amount || '0'} ${selectedAsset?.symbol || ''}`}
        confirmLabel={`${t('send')} ${selectedAsset?.symbol || ''}`}
        warning={t('crypto_irreversible_warning')}
        rows={[
          {
            label: t('address'),
            value: sendAddress ? `${sendAddress.slice(0, 10)}…${sendAddress.slice(-6)}` : '',
          },
          {
            label: t('network_fee'),
            value: `${formatCrypto(parseFloat(amount || '0') * 0.0001)} ${selectedAsset?.symbol || ''}`,
          },
        ]}
      />

      {/* Receive Sheet */}
      <BottomSheet isOpen={activeSheet === 'receive'} onClose={() => setActiveSheet('none')} title={`${t('receive')} ${selectedAsset?.symbol || ''}`}>
        <div className="flex flex-col items-center text-center py-8 px-4 gap-4">
          <div className="w-16 h-16 rounded-2xl uv-surface-2 flex items-center justify-center">
            <Icons.Clock size={30} className="text-[var(--color-primary)]" />
          </div>
          <h3 className="text-lg font-bold uv-text-primary">{t('crypto_deposit_unavailable_title')}</h3>
          <p className="text-sm text-gray-500 max-w-[300px]">{t('crypto_deposit_unavailable_desc')}</p>
        </div>
      </BottomSheet>

      {/* Stake Sheet */}
      <BottomSheet isOpen={activeSheet === 'stake'} onClose={() => { setActiveSheet('none'); setAmount(''); }} title={`${t('staking')} ${selectedAsset?.symbol || ''}`}>
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 rounded-xl p-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-300">{t('crypto_estimated_apy')}</span>
              <span className="text-2xl font-black text-green-600">
                {selectedAsset?.symbol === 'ETH' ? '4.5' : selectedAsset?.symbol === 'USDT' ? '8.0' : '6.5'}%
              </span>
            </div>
          </div>

          <div className="text-center">
            <label className="text-sm text-gray-500">{t('crypto_amount_to_stake')}</label>
            <div className="flex items-center justify-center gap-2 mt-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="text-4xl font-bold bg-transparent w-48 text-center outline-none uv-text-primary"
              />
              <span className="text-xl font-bold text-gray-400">{selectedAsset?.symbol}</span>
            </div>
            <p className="text-sm text-gray-500 mt-2">{t('available')}: {formatCrypto(selectedAsset?.balance || 0)} {selectedAsset?.symbol}</p>
          </div>

          {amount && (
            <div className="uv-surface-2 rounded-xl p-4">
              <p className="text-sm text-gray-500">{t('estimated_earnings')}</p>
              <p className="font-bold text-green-500">
                +{formatCrypto(parseFloat(amount) * (selectedAsset?.symbol === 'USDT' ? 0.08 : 0.045) / 12)} {selectedAsset?.symbol}
              </p>
            </div>
          )}

          <button
            onClick={handleStake}
            disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > (selectedAsset?.balance || 0)}
            className="w-full bg-purple-600 text-white py-4 rounded-xl font-bold disabled:opacity-50"
          >
            {t('start_staking')}
          </button>
        </div>
      </BottomSheet>

      {/* Transaction Detail Sheet */}
      {selectedTx && (
        <BottomSheet isOpen={activeSheet === 'txDetail'} onClose={() => setActiveSheet('none')} title={t('transaction_details')}>
          <div className="space-y-4">
            <div className="flex flex-col items-center py-4">
              <div className="w-16 h-16 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center mb-3">
                {getTxIcon(selectedTx.type)}
              </div>
              <h3 className="text-xl font-bold uv-text-primary">{getTxLabel(selectedTx.type)}</h3>
              <p className="uv-text-muted">{selectedTx.date}</p>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                <span className="uv-text-muted">{t('crypto_asset_label')}</span>
                <span className="font-bold uv-text-primary">{selectedTx.fromAsset}{selectedTx.toAsset ? ` → ${selectedTx.toAsset}` : ''}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                <span className="uv-text-muted">{t('amount')}</span>
                <span className="font-bold uv-text-primary">{formatCrypto(selectedTx.fromAmount)} {selectedTx.fromAsset}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                <span className="uv-text-muted">{t('crypto_price')}</span>
                <span className="font-bold uv-text-primary">{formatUsd(selectedTx.price)}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                <span className="uv-text-muted">{t('crypto_fee')}</span>
                <span className="font-bold uv-text-primary">{formatUsd(selectedTx.fee)}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                <span className="uv-text-muted">{t('crypto_total_usd')}</span>
                <span className="font-bold uv-text-primary">{formatUsd(selectedTx.fromAmount * selectedTx.price)}</span>
              </div>
              {selectedTx.txHash && (
                <div className="flex justify-between py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                  <span className="uv-text-muted">{t('tx_hash')}</span>
                  <span className="font-mono text-xs text-[var(--color-primary)]">{selectedTx.txHash}</span>
                </div>
              )}
              <div className="flex justify-between py-3">
                <span className="uv-text-muted">{t('status')}</span>
                <span className="font-bold text-green-500 flex items-center gap-1">
                  <Icons.Check size={14} /> {selectedTx.status}
                </span>
              </div>
            </div>
          </div>
        </BottomSheet>
      )}

    </div>
  );
};
