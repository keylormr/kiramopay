import React, { useMemo, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import type { Transaction } from '@/types';

const CATEGORY_CONFIG: Record<string, { color: string; bg: string; darkBg: string }> = {
  Transfer: { color: '#3b82f6', bg: 'bg-blue-100', darkBg: 'dark:bg-blue-900/30' },
  'QR Payment': { color: '#a855f7', bg: 'bg-purple-100', darkBg: 'dark:bg-purple-900/30' },
  Services: { color: '#f59e0b', bg: 'bg-amber-100', darkBg: 'dark:bg-amber-900/30' },
  Recharge: { color: '#14b8a6', bg: 'bg-teal-100', darkBg: 'dark:bg-teal-900/30' },
  SINPE: { color: '#6366f1', bg: 'bg-indigo-100', darkBg: 'dark:bg-indigo-900/30' },
  Food: { color: '#f97316', bg: 'bg-orange-100', darkBg: 'dark:bg-orange-900/30' },
  Shopping: { color: '#ec4899', bg: 'bg-pink-100', darkBg: 'dark:bg-pink-900/30' },
  Transport: { color: '#06b6d4', bg: 'bg-cyan-100', darkBg: 'dark:bg-cyan-900/30' },
  General: { color: '#6b7280', bg: 'bg-gray-100', darkBg: 'dark:bg-gray-800' },
};

function getCategoryConfig(cat: string) {
  return CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.General;
}

type Period = 'week' | 'month' | 'all';

export const AnalyticsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { state } = useApp();
  const { t } = useLanguage();
  const [period, setPeriod] = useState<Period>('month');

  const transactions = state.transactions;

  // Category breakdown for expenses
  const categoryData = useMemo(() => {
    const expenses = transactions.filter((tx: Transaction) => tx.amount < 0);
    const totals: Record<string, number> = {};

    for (const tx of expenses) {
      const cat = tx.category || 'General';
      totals[cat] = (totals[cat] || 0) + Math.abs(tx.amount);
    }

    const totalExpenses = Object.values(totals).reduce((s, v) => s + v, 0);
    const sorted = Object.entries(totals)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return { items: sorted, total: totalExpenses };
  }, [transactions]);

  // Income vs Expenses summary
  const summary = useMemo(() => {
    const income = transactions
      .filter((tx: Transaction) => tx.amount > 0)
      .reduce((s: number, tx: Transaction) => s + tx.amount, 0);
    const expenses = transactions
      .filter((tx: Transaction) => tx.amount < 0)
      .reduce((s: number, tx: Transaction) => s + Math.abs(tx.amount), 0);
    return { income, expenses, net: income - expenses };
  }, [transactions]);

  // Spending by day of week (mini heatmap). Buckets real expenses by weekday.
  // Transaction dates that are relative labels ("Just now") don't parse and are
  // skipped rather than faked; hasWeekdayData gates an honest empty state.
  const { weekdaySpending, hasWeekdayData } = useMemo(() => {
    const days = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    let counted = 0;
    for (const tx of transactions) {
      if (tx.amount >= 0) continue; // expenses only
      const parsed = new Date(tx.date);
      if (Number.isNaN(parsed.getTime())) continue; // skip unparseable/relative dates
      days[parsed.getDay()] += Math.abs(tx.amount);
      counted++;
    }
    const dayNames = [t('analytics_sun'), t('analytics_mon'), t('analytics_tue'), t('analytics_wed'), t('analytics_thu'), t('analytics_fri'), t('analytics_sat')];
    const max = Math.max(...days, 1);
    return {
      weekdaySpending: dayNames.map((name, i) => ({ name, value: days[i], intensity: days[i] / max })),
      hasWeekdayData: counted > 0,
    };
  }, [transactions, t]);

  // Top spending category
  const topCategory = categoryData.items[0];

  const formatCurrency = (amount: number) => {
    const ccy = state.baseCurrency || 'CRC';
    try {
      return new Intl.NumberFormat('es-CR', { style: 'currency', currency: ccy }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${ccy}`;
    }
  };

  // Income vs Expense ratio for the visual bar
  const incomeRatio = summary.income + summary.expenses > 0
    ? (summary.income / (summary.income + summary.expenses)) * 100
    : 50;

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('analytics_title')}</h1>
        <div className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        {/* Period Selector */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex p-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl">
            {(['week', 'month', 'all'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                  period === p
                    ? 'bg-white dark:bg-gray-700 shadow-sm uv-text-primary'
                    : 'text-gray-500'
                }`}
              >
                {t(`analytics_${p}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Income vs Expenses Card */}
        <div className="px-4 py-2">
          <div className="uv-surface-1 rounded-3xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5 shadow-sm">
            <h3 className="text-sm font-bold uv-text-muted mb-4">{t('analytics_flow')}</h3>

            {/* Visual ratio bar */}
            <div className="h-4 rounded-full overflow-hidden flex mb-4 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]">
              <div
                className="h-full bg-gradient-to-r from-green-400 to-green-500 transition-all duration-700 ease-out rounded-l-full"
                style={{ width: `${incomeRatio}%` }}
              />
              <div
                className="h-full bg-gradient-to-r from-red-400 to-red-500 transition-all duration-700 ease-out rounded-r-full"
                style={{ width: `${100 - incomeRatio}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-xs font-medium text-gray-500">{t('income')}</span>
                </div>
                <div className="text-xl font-extrabold text-green-600 dark:text-green-400">
                  {formatCurrency(summary.income)}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="text-xs font-medium text-gray-500">{t('expenses')}</span>
                </div>
                <div className="text-xl font-extrabold text-red-500 dark:text-red-400">
                  {formatCurrency(summary.expenses)}
                </div>
              </div>
            </div>

            {/* Net */}
            <div className="mt-4 pt-4 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] flex justify-between items-center">
              <span className="text-sm font-medium text-gray-500">{t('net_balance')}</span>
              <span className={`text-lg font-extrabold ${summary.net >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {summary.net >= 0 ? '+' : ''}{formatCurrency(summary.net)}
              </span>
            </div>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="px-4 py-2">
          <div className="uv-surface-1 rounded-3xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold uv-text-muted">{t('analytics_by_category')}</h3>
              <span className="text-xs font-bold text-gray-400">{formatCurrency(categoryData.total)}</span>
            </div>

            {categoryData.items.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-gray-400">
                <Icons.PiggyBank size={40} className="mb-3 opacity-40" />
                <p className="text-sm font-medium">{t('analytics_no_expenses')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {categoryData.items.map((item, i) => {
                  const config = getCategoryConfig(item.category);
                  return (
                    <div key={item.category} className="animate-stagger" style={{ animationDelay: `${i * 60}ms` }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${config.bg} ${config.darkBg}`}>
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: config.color }} />
                          </div>
                          <span className="text-sm font-bold uv-text-primary">{item.category}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-extrabold uv-text-primary">
                            {formatCurrency(item.amount)}
                          </span>
                          <span className="text-xs text-gray-400 ml-2">{item.percentage.toFixed(1)}%</span>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="h-2.5 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-out animate-bar-grow"
                          style={{
                            width: `${item.percentage}%`,
                            backgroundColor: config.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Top Spending Insight */}
        {topCategory && (
          <div className="px-4 py-2">
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/10 rounded-3xl border border-amber-100 dark:border-amber-800/30 p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-800/40 flex items-center justify-center flex-shrink-0">
                  <Icons.TrendingUp size={20} className="text-amber-600" />
                </div>
                <div>
                  <h4 className="font-bold uv-text-primary text-sm mb-1">{t('analytics_insight')}</h4>
                  <p className="text-xs uv-text-secondary leading-relaxed">
                    {t('analytics_top_category')}: <strong>{topCategory.category}</strong> ({topCategory.percentage.toFixed(0)}% {t('analytics_of_spending')})
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Spending Heatmap (Weekly) */}
        <div className="px-4 py-2">
          <div className="uv-surface-1 rounded-3xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5 shadow-sm">
            <h3 className="text-sm font-bold uv-text-muted mb-4">{t('analytics_weekly_pattern')}</h3>
            {hasWeekdayData ? (
              <div className="flex gap-2 justify-between">
                {weekdaySpending.map((day) => (
                  <div key={day.name} className="flex flex-col items-center gap-2 flex-1">
                    <div
                      className="w-full aspect-square rounded-xl transition-all duration-500"
                      style={{
                        backgroundColor: day.intensity > 0
                          ? `rgba(10, 132, 255, ${0.15 + day.intensity * 0.7})`
                          : 'rgba(94, 115, 160, 0.10)',
                      }}
                    />
                    <span className="text-[10px] font-bold uv-text-muted">{day.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm uv-text-muted py-4 text-center">{t('analytics_no_expenses')}</p>
            )}
          </div>
        </div>

        {/* Transaction Count Stats */}
        <div className="px-4 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4 text-center">
              <div className="text-2xl font-black text-primary mb-1">{transactions.length}</div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t('analytics_total_tx')}</div>
            </div>
            <div className="uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4 text-center">
              <div className="text-2xl font-black text-green-600 mb-1">
                {transactions.filter((tx: Transaction) => tx.amount > 0).length}
              </div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t('analytics_received')}</div>
            </div>
            <div className="uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4 text-center">
              <div className="text-2xl font-black text-red-500 mb-1">
                {transactions.filter((tx: Transaction) => tx.amount < 0).length}
              </div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t('analytics_sent')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
