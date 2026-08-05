import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { getApiLayer } from '@/api';
import type { Transaction } from '@/types';

// Keyed by the category slugs the transaction adapter emits (see mapCategory in
// api/adapters/http/transaction.http.ts). They used to be English display names,
// which matched nothing coming from the backend: every category fell through to
// the grey default and the raw slug was printed as its label.
const CATEGORY_CONFIG: Record<string, { color: string; bg: string; darkBg: string }> = {
  transfers: { color: '#3b82f6', bg: 'bg-blue-100', darkBg: 'dark:bg-blue-900/30' },
  services: { color: '#f59e0b', bg: 'bg-amber-100', darkBg: 'dark:bg-amber-900/30' },
  shopping: { color: '#ec4899', bg: 'bg-pink-100', darkBg: 'dark:bg-pink-900/30' },
  income: { color: '#10b981', bg: 'bg-emerald-100', darkBg: 'dark:bg-emerald-900/30' },
  cash: { color: '#14b8a6', bg: 'bg-teal-100', darkBg: 'dark:bg-teal-900/30' },
  other: { color: '#6b7280', bg: 'bg-gray-100', darkBg: 'dark:bg-gray-800' },
};

const FALLBACK_CATEGORY = 'other';

function getCategoryConfig(cat: string) {
  return CATEGORY_CONFIG[cat] || CATEGORY_CONFIG[FALLBACK_CATEGORY];
}

// Income (green) and expense (red) — the app-wide cash-flow semantics. In the
// trend chart these are also separated by POSITION (income up, expense down from
// a zero baseline), so identity never rests on color alone (colorblind-safe).
const INCOME_COLOR = '#10b981';
const EXPENSE_COLOR = '#ef4444';

const LOCALE_BY_LANG: Record<string, string> = {
  es: 'es-CR',
  en: 'en-US',
  fr: 'fr-FR',
  pt: 'pt-BR',
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-TW',
  ja: 'ja-JP',
  hi: 'hi-IN',
};

type Period = 'week' | 'month' | 'all';

// Server pagination for the active window. The synced store only ever holds
// the LAST 50 transactions (dataSync), so computing analytics off it made
// "all" and older months silently wrong; the view now asks the API for the
// whole window, page by page. The page cap bounds a pathological history —
// when it is hit, the UI says so instead of pretending the window is complete.
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

// Machine timestamp for a transaction, or null when it has no parseable date.
// dateISO is the reliable field; the localized `date` string only parses when it
// happens to be ISO-ish, otherwise it is skipped rather than faked.
function getTxTime(tx: Transaction): number | null {
  if (tx.dateISO) {
    const t = Date.parse(tx.dateISO);
    if (!Number.isNaN(t)) return t;
  }
  const t2 = Date.parse(tx.date);
  return Number.isNaN(t2) ? null : t2;
}

interface Bucket {
  label: string;
  income: number;
  expense: number;
}

// Diverging bar chart: income grows up, expense grows down from a shared
// baseline. One tap on a column reveals its exact figures.
const CashflowChart: React.FC<{
  buckets: Bucket[];
  format: (n: number) => string;
  incomeLabel: string;
  expenseLabel: string;
}> = ({ buckets, format, incomeLabel, expenseLabel }) => {
  const [selected, setSelected] = useState<number | null>(null);
  const half = 46; // px per side of the baseline
  const maxVal = Math.max(1, ...buckets.map((b) => Math.max(b.income, b.expense)));
  // Label density: always for few buckets, sparse for a full month.
  const step = buckets.length <= 10 ? 1 : Math.ceil(buckets.length / 6);
  const sel = selected != null ? buckets[selected] : null;

  return (
    <div>
      {/* Readout / legend line */}
      <div className="h-6 mb-1 flex items-center justify-between text-[11px]">
        {sel ? (
          <span className="font-semibold uv-text-primary truncate">
            {sel.label}
            <span className="ml-2 text-green-600 dark:text-green-400">+{format(sel.income)}</span>
            <span className="ml-2 text-red-500 dark:text-red-400">-{format(sel.expense)}</span>
          </span>
        ) : (
          <div className="flex items-center gap-4 uv-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: INCOME_COLOR }} />
              {incomeLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: EXPENSE_COLOR }} />
              {expenseLabel}
            </span>
          </div>
        )}
      </div>

      {/* Columns */}
      <div className="flex items-stretch gap-[2px]">
        {buckets.map((b, i) => {
          const active = selected === i;
          const dim = selected != null && !active;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(active ? null : i)}
              aria-label={`${b.label}: +${format(b.income)} / -${format(b.expense)}`}
              className={`group flex-1 min-w-0 flex flex-col items-center transition-opacity ${dim ? 'opacity-40' : 'opacity-100'}`}
            >
              {/* income (up) */}
              <div className="w-full flex flex-col justify-end" style={{ height: half }}>
                <div
                  className="w-full rounded-t-[3px] transition-all duration-500"
                  style={{ height: Math.max(b.income > 0 ? 2 : 0, (b.income / maxVal) * half), backgroundColor: INCOME_COLOR }}
                />
              </div>
              {/* baseline */}
              <div className="w-full h-px bg-[var(--color-border)] dark:bg-[var(--color-border-dark)]" />
              {/* expense (down) */}
              <div className="w-full flex flex-col justify-start" style={{ height: half }}>
                <div
                  className="w-full rounded-b-[3px] transition-all duration-500"
                  style={{ height: Math.max(b.expense > 0 ? 2 : 0, (b.expense / maxVal) * half), backgroundColor: EXPENSE_COLOR }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Labels */}
      <div className="flex gap-[2px] mt-1.5">
        {buckets.map((b, i) => (
          <span key={i} className="flex-1 min-w-0 text-center text-[9px] font-medium uv-text-muted truncate">
            {i % step === 0 ? b.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
};

export const AnalyticsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { state } = useApp();
  const { t, language } = useLanguage();
  const [period, setPeriod] = useState<Period>('month');
  // 0 = current month, -1 = previous, ... (only used when period === 'month')
  const [monthOffset, setMonthOffset] = useState(0);

  const locale = LOCALE_BY_LANG[language] || 'es-CR';

  // The stored category is a slug, never a display string: it goes through i18n
  // so the breakdown reads in the selected language.
  const categoryLabel = (cat: string) =>
    t(`analytics_cat_${cat in CATEGORY_CONFIG ? cat : FALLBACK_CATEGORY}`);
  const allTransactions = state.transactions;

  // The active date window for the selected period.
  const range = useMemo(() => {
    const now = new Date();
    if (period === 'week') {
      const end = now.getTime();
      return { start: end - 7 * 86400000, end, label: '' };
    }
    if (period === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1);
      const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(start);
      return { start: start.getTime(), end: end.getTime(), label, monthStart: start };
    }
    return { start: -Infinity, end: Infinity, label: '' };
  }, [period, monthOffset, locale]);

  // Identity of the active window, used to match a fetch result to the
  // selection that requested it (a stale response must not repaint a window
  // the user already left).
  const windowKey = period === 'month' ? `month:${monthOffset}` : period;

  // The window fetched from the server, or null while loading / when the very
  // first page failed (the synced store then serves as fallback).
  const [serverWindow, setServerWindow] = useState<{
    key: string;
    txs: Transaction[];
    total: number;
  } | null>(null);

  // Set when the window could not be fetched at all and the charts are running
  // on the synced store, which holds only the last 50 movements — the very
  // problem this view exists to fix, so it must be visible, not silent.
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = getApiLayer();
        const from = Number.isFinite(range.start) ? new Date(range.start).toISOString() : undefined;
        const to = Number.isFinite(range.end) ? new Date(range.end).toISOString() : undefined;
        // Accumulate by id. OFFSET paging is not stable against writes: a
        // transaction landing between two page requests shifts every later
        // offset by one, so a row already collected would come back again and
        // be counted twice in the totals.
        const byId = new Map<string, Transaction>();
        let total = 0;
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await api.transactions.listTransactions({
            from,
            to,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          });
          // A failed page keeps whatever earlier pages returned: partial data
          // still beats the 50-item store, and the coverage note below tells
          // the user it is partial rather than passing it off as complete.
          if (!res.success || !res.data) break;
          for (const tx of res.data.transactions) byId.set(tx.id, tx);
          total = res.data.total;
          if (byId.size >= total || res.data.transactions.length < PAGE_SIZE) break;
        }
        if (cancelled) return;
        if (byId.size > 0) {
          setServerWindow({ key: windowKey, txs: [...byId.values()], total });
          setFallbackKey(null);
        } else {
          // Nothing arrived: keep serverWindow null so the store fallback stays
          // in place rather than rendering an empty month, and flag it.
          setFallbackKey(windowKey);
        }
      } catch {
        // Offline / API error: analytics still render from the synced store.
        if (!cancelled) setFallbackKey(windowKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowKey, range.start, range.end]);

  // Transactions inside the active window: the server-fetched window when it
  // matches the current selection, else the synced store filtered locally
  // (undated ones are excluded from week/month and kept only in "all").
  const transactions = useMemo(() => {
    if (serverWindow && serverWindow.key === windowKey) return serverWindow.txs;
    if (period === 'all') return allTransactions;
    return allTransactions.filter((tx) => {
      const time = getTxTime(tx);
      return time !== null && time >= range.start && time < range.end;
    });
  }, [serverWindow, windowKey, allTransactions, period, range.start, range.end]);

  // True when the window is short of its own total — the page cap cut it, or a
  // page failed. Either way the charts cover only part of the period and the
  // UI must say so instead of presenting them as the whole month.
  const windowTruncated =
    serverWindow !== null &&
    serverWindow.key === windowKey &&
    serverWindow.txs.length < serverWindow.total;

  // The window could not be fetched and the charts are on the synced store.
  const usingFallback =
    fallbackKey === windowKey && !(serverWindow && serverWindow.key === windowKey);

  // Category breakdown for expenses
  const categoryData = useMemo(() => {
    const expenses = transactions.filter((tx: Transaction) => tx.amount < 0);
    const totals: Record<string, number> = {};

    for (const tx of expenses) {
      const cat = tx.category || FALLBACK_CATEGORY;
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

  // Cash-flow buckets over the active period (income up / expense down).
  const cashflowBuckets = useMemo<Bucket[]>(() => {
    const addTo = (b: Bucket, amount: number) => {
      if (amount >= 0) b.income += amount;
      else b.expense += Math.abs(amount);
    };

    if (period === 'week') {
      const now = new Date();
      const days: { key: string; b: Bucket }[] = [];
      const wd = new Intl.DateTimeFormat(locale, { weekday: 'short' });
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        days.push({ key: d.toDateString(), b: { label: wd.format(d), income: 0, expense: 0 } });
      }
      const byKey = new Map(days.map((d) => [d.key, d.b]));
      for (const tx of transactions) {
        const time = getTxTime(tx);
        if (time === null) continue;
        const b = byKey.get(new Date(time).toDateString());
        if (b) addTo(b, tx.amount);
      }
      return days.map((d) => d.b);
    }

    if (period === 'month') {
      const start = (range as { monthStart?: Date }).monthStart || new Date();
      const year = start.getFullYear();
      const month = start.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const buckets: Bucket[] = Array.from({ length: daysInMonth }, (_, i) => ({
        label: String(i + 1),
        income: 0,
        expense: 0,
      }));
      for (const tx of transactions) {
        const time = getTxTime(tx);
        if (time === null) continue;
        const day = new Date(time).getDate();
        if (day >= 1 && day <= daysInMonth) addTo(buckets[day - 1], tx.amount);
      }
      return buckets;
    }

    // all — group by calendar month
    const mo = new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' });
    const map = new Map<string, Bucket>();
    const order: string[] = [];
    const dated = transactions
      .map((tx) => ({ tx, time: getTxTime(tx) }))
      .filter((x): x is { tx: Transaction; time: number } => x.time !== null)
      .sort((a, b) => a.time - b.time);
    for (const { tx, time } of dated) {
      const d = new Date(time);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      let b = map.get(key);
      if (!b) {
        b = { label: mo.format(d), income: 0, expense: 0 };
        map.set(key, b);
        order.push(key);
      }
      addTo(b, tx.amount);
    }
    return order.map((k) => map.get(k)!);
  }, [transactions, period, range, locale]);

  const hasCashflow = cashflowBuckets.some((b) => b.income > 0 || b.expense > 0);

  // Spending by day of week (mini heatmap) over the active period.
  const { weekdaySpending, hasWeekdayData } = useMemo(() => {
    const days = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    let counted = 0;
    for (const tx of transactions) {
      if (tx.amount >= 0) continue; // expenses only
      const time = getTxTime(tx);
      if (time === null) continue; // skip unparseable/relative dates
      days[new Date(time).getDay()] += Math.abs(tx.amount);
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

  // Compact currency for chart readouts (keeps the line short).
  const formatCompact = (amount: number) => {
    const ccy = state.baseCurrency || 'CRC';
    try {
      return new Intl.NumberFormat('es-CR', { style: 'currency', currency: ccy, notation: 'compact', maximumFractionDigits: 1 }).format(amount);
    } catch {
      return `${Math.round(amount)}`;
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
                onClick={() => { setPeriod(p); if (p === 'month') setMonthOffset(0); }}
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

          {/* Honest coverage note: the window is incomplete, either because the
              page cap cut it or because a page failed. Never present partial
              charts as the whole period. */}
          {windowTruncated && serverWindow && (
            <p className="mt-2 px-1 text-xs uv-text-muted">
              {t('analytics_partial')
                .replace('{shown}', String(serverWindow.txs.length))
                .replace('{total}', String(serverWindow.total))}
            </p>
          )}
          {usingFallback && (
            <p className="mt-2 px-1 text-xs uv-text-muted">{t('analytics_offline')}</p>
          )}

          {/* Month navigator (only for the monthly view) */}
          {period === 'month' && (
            <div className="flex items-center justify-between mt-3 px-1">
              <button
                onClick={() => setMonthOffset((o) => o - 1)}
                aria-label={new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset - 1, 1))}
                className="p-1.5 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-text-secondary"
              >
                <Icons.ChevronLeft size={18} />
              </button>
              <span className="text-sm font-bold uv-text-primary capitalize">{range.label}</span>
              <button
                onClick={() => setMonthOffset((o) => Math.min(0, o + 1))}
                disabled={monthOffset >= 0}
                aria-label={new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset + 1, 1))}
                className="p-1.5 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Icons.ChevronRight size={18} />
              </button>
            </div>
          )}
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

            {/* Cash-flow trend over the period */}
            {hasCashflow && (
              <div className="mt-5 pt-4 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                <CashflowChart
                  buckets={cashflowBuckets}
                  format={formatCompact}
                  incomeLabel={t('income')}
                  expenseLabel={t('expenses')}
                />
              </div>
            )}
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
                          <span className="text-sm font-bold uv-text-primary">{categoryLabel(item.category)}</span>
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
                    {t('analytics_top_category')}: <strong>{categoryLabel(topCategory.category)}</strong> ({topCategory.percentage.toFixed(0)}% {t('analytics_of_spending')})
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
