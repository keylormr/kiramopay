import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { getApiLayer } from '@/api';
import type { PointsAccount, Reward, PointsTransaction, CashbackRule } from '@/api/repositories/loyalty.repository';

const TIER_CONFIG: Record<string, { color: string; bg: string; icon: React.FC<{ size?: number; className?: string }> }> = {
  bronze: { color: '#CD7F32', bg: 'from-amber-700/20 to-orange-600/10', icon: Icons.Award },
  silver: { color: '#C0C0C0', bg: 'from-gray-300/20 to-slate-400/10', icon: Icons.Award },
  gold: { color: '#FFD700', bg: 'from-yellow-400/20 to-amber-500/10', icon: Icons.Trophy },
  platinum: { color: '#E5E4E2', bg: 'from-slate-200/30 to-purple-300/10', icon: Icons.Trophy },
};

export const LoyaltyView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [account, setAccount] = useState<PointsAccount | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [history, setHistory] = useState<PointsTransaction[]>([]);
  const [cashbackRules, setCashbackRules] = useState<CashbackRule[]>([]);
  const [activeTab, setActiveTab] = useState<'rewards' | 'earn' | 'history'>('rewards');
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [loadTrigger, setLoadTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const api = getApiLayer();
      if (!api.loyalty) { if (!cancelled) setLoading(false); return; }

      const [accRes, rewRes, histRes, rulesRes] = await Promise.allSettled([
        api.loyalty.getAccount(),
        api.loyalty.getRewards(),
        api.loyalty.getTransactions(),
        api.loyalty.getCashbackRules(),
      ]);

      if (cancelled) return;
      if (accRes.status === 'fulfilled' && accRes.value.success && accRes.value.data) {
        setAccount(accRes.value.data);
      }
      if (rewRes.status === 'fulfilled' && rewRes.value.success && rewRes.value.data) {
        setRewards(rewRes.value.data);
      }
      if (histRes.status === 'fulfilled' && histRes.value.success && histRes.value.data) {
        setHistory(histRes.value.data);
      }
      if (rulesRes.status === 'fulfilled' && rulesRes.value.success && rulesRes.value.data) {
        setCashbackRules(rulesRes.value.data);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [loadTrigger]);

  const handleRedeem = async (rewardId: string) => {
    const api = getApiLayer();
    if (!api.loyalty) return;
    setRedeeming(rewardId);
    const res = await api.loyalty.redeemReward(rewardId);
    if (res.success) {
      setLoadTrigger(n => n + 1); // Refresh points and rewards
    }
    setRedeeming(null);
  };

  const tierConfig = TIER_CONFIG[account?.tier || 'bronze'];
  const TierIcon = tierConfig?.icon || Icons.Award;

  const formatPoints = (pts: number) => pts.toLocaleString();

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors" aria-label={t('back')}>
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('loyalty_title')}</h1>
        <div className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Points Card */}
            <div className="px-4 pt-4 pb-2">
              <div className={`bg-gradient-to-br ${tierConfig?.bg || 'from-gray-200/20 to-gray-300/10'} rounded-3xl border border-gray-200/50 dark:border-gray-700 p-6`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${tierConfig?.color}30` }}>
                      <TierIcon size={24} style={{ color: tierConfig?.color }} />
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: tierConfig?.color }}>
                        {account?.tier || 'Bronze'} {t('loyalty_tier')}
                      </p>
                      <p className="text-3xl font-black uv-text-primary">
                        {formatPoints(account?.availablePoints || 0)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('loyalty_lifetime')}</p>
                    <p className="text-sm font-extrabold uv-text-primary">{formatPoints(account?.lifetimePoints || 0)} pts</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('loyalty_available')}</p>
                    <p className="text-sm font-extrabold text-green-600">{formatPoints(account?.availablePoints || 0)} pts</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Tier Progress */}
            <div className="px-4 py-2">
              <div className="uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-gray-500">{t('loyalty_next_tier')}</span>
                  <span className="text-xs font-bold" style={{ color: tierConfig?.color }}>
                    {account?.tier === 'bronze' ? 'Silver: 5,000 pts' :
                     account?.tier === 'silver' ? 'Gold: 15,000 pts' :
                     account?.tier === 'gold' ? 'Platinum: 50,000 pts' : 'Max'}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 animate-bar-grow"
                    style={{
                      width: `${Math.min(((account?.lifetimePoints || 0) / (
                        account?.tier === 'bronze' ? 5000 :
                        account?.tier === 'silver' ? 15000 :
                        account?.tier === 'gold' ? 50000 : 50000
                      )) * 100, 100)}%`,
                      backgroundColor: tierConfig?.color,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="px-4 py-2">
              <div className="flex p-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl">
                {(['rewards', 'earn', 'history'] as const).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === tab ? 'bg-white dark:bg-gray-700 shadow-sm uv-text-primary' : 'text-gray-500'}`}>
                    {tab === 'rewards' ? t('loyalty_rewards') : tab === 'earn' ? t('loyalty_earn') : t('loyalty_history')}
                  </button>
                ))}
              </div>
            </div>

            {/* Rewards */}
            {activeTab === 'rewards' && (
              <div className="px-4 py-2 space-y-3">
                {rewards.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-gray-400">
                    <Icons.Gift size={40} className="mb-3 opacity-40" />
                    <p className="text-sm font-medium">{t('loyalty_no_rewards')}</p>
                  </div>
                ) : (
                  rewards.map((reward, i) => {
                    const canAfford = (account?.availablePoints || 0) >= reward.pointsCost;
                    return (
                      <div key={reward.id}
                        className="uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4 shadow-sm animate-stagger"
                        style={{ animationDelay: `${i * 60}ms` }}>
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center flex-shrink-0">
                            {reward.category === 'discount' && <Icons.Percent size={22} className="text-[var(--color-primary)]" />}
                            {reward.category === 'voucher' && <Icons.Tag size={22} className="text-accent" />}
                            {reward.category === 'gift_card' && <Icons.Gift size={22} className="text-green-600" />}
                            {reward.category === 'experience' && <Icons.Star size={22} className="text-purple-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold uv-text-primary text-sm">{reward.name}</h3>
                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{reward.description}</p>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-sm font-extrabold text-[var(--color-primary)]">{formatPoints(reward.pointsCost)} pts</span>
                              <button
                                onClick={() => handleRedeem(reward.id)}
                                disabled={!canAfford || redeeming === reward.id}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                                  canAfford
                                    ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'
                                    : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] text-gray-400'
                                }`}>
                                {redeeming === reward.id ? '...' : t('loyalty_redeem')}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Earn / Cashback Rules */}
            {activeTab === 'earn' && (
              <div className="px-4 py-2 space-y-3">
                <p className="text-xs text-gray-500 font-medium">{t('loyalty_earn_desc')}</p>
                {cashbackRules.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-gray-400">
                    <Icons.Percent size={40} className="mb-3 opacity-40" />
                    <p className="text-sm font-medium">{t('loyalty_no_rules')}</p>
                  </div>
                ) : (
                  cashbackRules.filter(r => r.active).map((rule, i) => {
                    const catIcons: Record<string, React.ReactNode> = {
                      sinpe: <Icons.Smartphone size={20} className="text-indigo-600" />,
                      services: <Icons.Zap size={20} className="text-amber-600" />,
                      crypto: <Icons.Bitcoin size={20} className="text-orange-500" />,
                      recharge: <Icons.Phone size={20} className="text-teal-600" />,
                      qr_payment: <Icons.QrCode size={20} className="text-purple-600" />,
                    };
                    const catColors: Record<string, string> = {
                      sinpe: 'bg-indigo-100 dark:bg-indigo-900/30',
                      services: 'bg-amber-100 dark:bg-amber-900/30',
                      crypto: 'bg-orange-100 dark:bg-orange-900/30',
                      recharge: 'bg-teal-100 dark:bg-teal-900/30',
                      qr_payment: 'bg-purple-100 dark:bg-purple-900/30',
                    };
                    return (
                      <div key={rule.id}
                        className="flex items-center gap-3 p-4 uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] animate-stagger"
                        style={{ animationDelay: `${i * 60}ms` }}>
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${catColors[rule.category] || 'bg-gray-100'}`}>
                          {catIcons[rule.category] || <Icons.Circle size={20} />}
                        </div>
                        <div className="flex-1">
                          <p className="font-bold uv-text-primary text-sm capitalize">{rule.category.replace('_', ' ')}</p>
                          <p className="text-xs text-gray-400">{t('loyalty_max_per_tx')}: {rule.maxPoints} pts</p>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-black text-green-600">{rule.percentage}%</span>
                          <p className="text-[10px] text-gray-400">cashback</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* History */}
            {activeTab === 'history' && (
              <div className="px-4 py-2 space-y-2">
                {history.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-gray-400">
                    <Icons.History size={40} className="mb-3 opacity-40" />
                    <p className="text-sm font-medium">{t('loyalty_no_history')}</p>
                  </div>
                ) : (
                  history.map((tx, i) => (
                    <div key={tx.id}
                      className="flex items-center gap-3 p-3 uv-surface-1 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] animate-stagger"
                      style={{ animationDelay: `${i * 40}ms` }}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        tx.type === 'earn' || tx.type === 'bonus'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-600'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-500'
                      }`}>
                        {tx.type === 'earn' || tx.type === 'bonus'
                          ? <Icons.ArrowDownLeft size={18} />
                          : <Icons.ArrowUpRight size={18} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold uv-text-primary truncate">{tx.description}</p>
                        <p className="text-xs text-gray-400">{tx.createdAt}</p>
                      </div>
                      <span className={`text-sm font-extrabold ${
                        tx.type === 'earn' || tx.type === 'bonus' ? 'text-green-600' : 'text-red-500'
                      }`}>
                        {tx.type === 'earn' || tx.type === 'bonus' ? '+' : '-'}{formatPoints(tx.points)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
