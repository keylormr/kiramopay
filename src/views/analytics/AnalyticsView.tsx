import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { getApiLayer } from '@/api';
import { GraficoDona } from '@/components/GraficoDona';
import { txTitle } from '@/utils/txTitle';
import { getTxTime } from '@/utils/fechasTx';
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

// Filas viejas del backend pueden llegar sin moneda; se asume la del pais.
const ccyDe = (tx: Transaction) => tx.ccy || 'CRC';

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
  const half = 64; // px per side of the baseline
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
      <div className="flex items-stretch gap-[3px]">
        {buckets.map((b, i) => {
          const active = selected === i;
          const dim = selected != null && !active;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(active ? null : i)}
              aria-label={`${b.label}: +${format(b.income)} / -${format(b.expense)}`}
              className={`group flex-1 min-w-0 flex flex-col items-center transition-opacity duration-200 ${dim ? 'opacity-30' : 'opacity-100'}`}
            >
              {/* income (up) */}
              <div className="w-full flex flex-col justify-end items-center" style={{ height: half }}>
                <div
                  className="w-full max-w-[14px] rounded-full transition-all duration-500"
                  style={{
                    height: Math.max(b.income > 0 ? 4 : 0, (b.income / maxVal) * half),
                    background: `linear-gradient(to top, ${INCOME_COLOR}99, ${INCOME_COLOR})`,
                  }}
                />
              </div>
              {/* baseline */}
              <div className="w-full h-px my-[2px] bg-[var(--color-border)] dark:bg-[var(--color-border-dark)]" />
              {/* expense (down) */}
              <div className="w-full flex flex-col justify-start items-center" style={{ height: half }}>
                <div
                  className="w-full max-w-[14px] rounded-full transition-all duration-500"
                  style={{
                    height: Math.max(b.expense > 0 ? 4 : 0, (b.expense / maxVal) * half),
                    background: `linear-gradient(to bottom, ${EXPENSE_COLOR}99, ${EXPENSE_COLOR})`,
                  }}
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
  // Abre en "Todo": el mes en curso suele tener pocos movimientos y la vista
  // arrancaba casi vacia — la primera impresion debe ser la historia completa.
  const [period, setPeriod] = useState<Period>('all');
  // 0 = current month, -1 = previous, ... (only used when period === 'month')
  const [monthOffset, setMonthOffset] = useState(0);
  // Filtro de direccion para la lista de movimientos principales.
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');

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

  // Gastos del periodo ANTERIOR (semana pasada / mes pasado), para poner el
  // periodo actual en contexto: "gastaste 23% menos que el mes pasado" dice
  // algo; una cifra suelta no. En "todo" no hay periodo anterior.
  // Se guarda separado POR MONEDA: comparar contra un total que mezcla monedas
  // daria un porcentaje inventado.
  const [prevExpense, setPrevExpense] = useState<{
    key: string;
    byCcy: Record<string, number>;
  } | null>(null);

  // Ventana visible cargando desde el servidor: gobierna los esqueletos de la
  // vista para que la espera se VEA (pedido explicito del dueno: nada de
  // pantallas mudas mientras se consulta).
  const [loadingKey, setLoadingKey] = useState<string | null>(windowKey);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = getApiLayer();
      // Accumulate by id. OFFSET paging is not stable against writes: a
      // transaction landing between two page requests shifts every later
      // offset by one, so a row already collected would come back again and
      // be counted twice in the totals.
      const fetchWindow = async (startMs: number, endMs: number) => {
        const from = Number.isFinite(startMs) ? new Date(startMs).toISOString() : undefined;
        const to = Number.isFinite(endMs) ? new Date(endMs).toISOString() : undefined;
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
        return { txs: [...byId.values()], total };
      };

      setLoadingKey(windowKey);
      try {
        const win = await fetchWindow(range.start, range.end);
        if (cancelled) return;
        if (win.txs.length > 0) {
          setServerWindow({ key: windowKey, txs: win.txs, total: win.total });
          setFallbackKey(null);
        } else {
          // Nothing arrived: keep serverWindow null so the store fallback stays
          // in place rather than rendering an empty month, and flag it.
          setFallbackKey(windowKey);
        }
      } catch {
        // Offline / API error: analytics still render from the synced store.
        if (!cancelled) setFallbackKey(windowKey);
      } finally {
        if (!cancelled) setLoadingKey((k) => (k === windowKey ? null : k));
      }

      // Comparacion con el periodo anterior — best effort, nunca bloquea la
      // vista principal. Solo aplica a semana y mes.
      if (period === 'all') {
        if (!cancelled) setPrevExpense(null);
        return;
      }
      try {
        let prevStart: number;
        let prevEnd: number;
        if (period === 'week') {
          prevEnd = range.start;
          prevStart = range.start - 7 * 86400000;
        } else {
          const now = new Date();
          prevStart = new Date(now.getFullYear(), now.getMonth() + monthOffset - 1, 1).getTime();
          prevEnd = range.start;
        }
        const prev = await fetchWindow(prevStart, prevEnd);
        if (cancelled) return;
        const byCcy: Record<string, number> = {};
        for (const tx of prev.txs) {
          if (tx.amount >= 0) continue;
          const c = ccyDe(tx);
          byCcy[c] = (byCcy[c] || 0) + Math.abs(tx.amount);
        }
        setPrevExpense({ key: windowKey, byCcy });
      } catch {
        if (!cancelled) setPrevExpense(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowKey, range.start, range.end, period, monthOffset]);

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

  // Toda esta vista suma UNA sola moneda. Antes sumaba tx.amount en crudo y
  // rotulaba el total con la moneda base, que se cambia con un toque en las
  // tarjetas del home: un gasto de 1.196.850 colones se imprimia como
  // "$1,196,850.00", y ademas colones y dolares se sumaban 1:1.
  // Se rotula la moneda base; solo si la ventana no tiene ni un movimiento en
  // ella se cae a la moneda mas frecuente, para no mostrar ceros habiendo datos.
  const { viewCcy, viewTransactions, otherCcyCount } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of transactions) {
      const c = ccyDe(tx);
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const base = state.baseCurrency || 'CRC';
    let ccy = base;
    if (!counts.has(base) && counts.size > 0) {
      ccy = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    const inCcy = transactions.filter((tx) => ccyDe(tx) === ccy);
    return {
      viewCcy: ccy,
      viewTransactions: inCcy,
      otherCcyCount: transactions.length - inCcy.length,
    };
  }, [transactions, state.baseCurrency]);

  // Category breakdown for expenses
  const categoryData = useMemo(() => {
    const expenses = viewTransactions.filter((tx: Transaction) => tx.amount < 0);
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
  }, [viewTransactions]);

  // Income vs Expenses summary
  const summary = useMemo(() => {
    const income = viewTransactions
      .filter((tx: Transaction) => tx.amount > 0)
      .reduce((s: number, tx: Transaction) => s + tx.amount, 0);
    const expenses = viewTransactions
      .filter((tx: Transaction) => tx.amount < 0)
      .reduce((s: number, tx: Transaction) => s + Math.abs(tx.amount), 0);
    return { income, expenses, net: income - expenses };
  }, [viewTransactions]);

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
      for (const tx of viewTransactions) {
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
      for (const tx of viewTransactions) {
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
    const dated = viewTransactions
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
  }, [viewTransactions, period, range, locale]);

  const hasCashflow = cashflowBuckets.some((b) => b.income > 0 || b.expense > 0);

  // Spending by day of week (mini heatmap) over the active period.
  const { weekdaySpending, hasWeekdayData } = useMemo(() => {
    const days = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    let counted = 0;
    for (const tx of viewTransactions) {
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
  }, [viewTransactions, t]);

  // Movimientos principales del periodo: los montos mas grandes en absoluto,
  // filtrables por direccion. Es lo que el usuario reconoce de un vistazo:
  // nombres y montos, no abstracciones.
  const topMoves = useMemo(() => {
    const filtered = viewTransactions.filter((tx) =>
      direction === 'all' ? true : direction === 'in' ? tx.amount > 0 : tx.amount < 0,
    );
    return [...filtered].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 6);
  }, [viewTransactions, direction]);

  // Gasto promedio por dia del periodo activo. Para el mes en curso divide
  // entre los dias transcurridos (no los 30-31 del calendario); para "todo",
  // entre el rango real de fechas con datos.
  const dailyAvg = useMemo(() => {
    if (summary.expenses <= 0) return 0;
    const now = Date.now();
    let days: number;
    if (period === 'week') {
      days = 7;
    } else if (period === 'month') {
      const start = (range as { monthStart?: Date }).monthStart || new Date();
      const monthEnd = Math.min(range.end, now);
      days = Math.max(1, Math.ceil((monthEnd - start.getTime()) / 86400000));
    } else {
      const times = viewTransactions
        .map(getTxTime)
        .filter((x): x is number => x !== null);
      if (times.length === 0) return 0;
      days = Math.max(1, Math.ceil((Math.max(...times) - Math.min(...times)) / 86400000) + 1);
    }
    return summary.expenses / days;
  }, [summary.expenses, period, range, viewTransactions]);

  // Dia de la semana con mas gasto (solo si hay senal).
  const peakDay = hasWeekdayData
    ? weekdaySpending.reduce((a, b) => (b.value > a.value ? b : a))
    : null;

  // Comparacion contra el periodo anterior, cuando su fetch corresponde a la
  // ventana visible y hubo gasto contra el cual comparar.
  const comparison = useMemo(() => {
    if (period === 'all') return null;
    if (!prevExpense || prevExpense.key !== windowKey) return null;
    // Solo contra el gasto del periodo anterior EN LA MISMA MONEDA que se rotula.
    const base = prevExpense.byCcy[viewCcy] || 0;
    if (base <= 0) return null; // sin base: un % no significa nada
    const pct = ((summary.expenses - base) / base) * 100;
    return { pct };
  }, [period, prevExpense, windowKey, summary.expenses, viewCcy]);

  const txCounts = useMemo(
    () => ({
      total: viewTransactions.length,
      recibidos: viewTransactions.filter((tx) => tx.amount > 0).length,
      enviados: viewTransactions.filter((tx) => tx.amount < 0).length,
    }),
    [viewTransactions],
  );

  // Esqueletos mientras la ventana viaja desde el servidor: la espera se ve.
  const isLoadingWindow =
    loadingKey === windowKey && !(serverWindow && serverWindow.key === windowKey);

  const formatCurrency = (amount: number) => {
    const ccy = viewCcy;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currencyDisplay: 'narrowSymbol', currency: ccy }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${ccy}`;
    }
  };

  // Compact currency for chart readouts (keeps the line short).
  const formatCompact = (amount: number) => {
    const ccy = viewCcy;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currencyDisplay: 'narrowSymbol', currency: ccy, notation: 'compact', maximumFractionDigits: 1 }).format(amount);
    } catch {
      return `${Math.round(amount)}`;
    }
  };

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

          {/* Los movimientos en otra moneda quedan fuera de los totales: se
              dicen, no se esconden. */}
          {otherCcyCount > 0 && (
            <p className="mt-2 px-1 text-xs uv-text-muted">
              {t('other_currency_note').replace('{n}', String(otherCcyCount))}
            </p>
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

        {/* Resumen del periodo: el neto manda, con ingresos y gastos al lado y
            la comparacion contra el periodo anterior como lectura, no adorno. */}
        <div className="px-4 py-2">
          <div className="uv-surface-1 rounded-3xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5 shadow-sm">
            {isLoadingWindow ? (
              <div className="animate-pulse space-y-4" aria-hidden="true">
                <div className="h-3 w-24 rounded bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
                <div className="h-8 w-40 rounded bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
                <div className="h-24 rounded-xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
              </div>
            ) : (
              <>
                {/* La dona compone el TOTAL del periodo: ingresos (todo lo
                    recibido, sea SINPE, pago QR o lo que sea) + gastos = la
                    cifra del centro. Pedido del dueno: que las partes den el
                    total, a la vista. */}
                <div className="flex flex-col items-center gap-4">
                  <GraficoDona
                    segmentos={[
                      { valor: summary.income, color: '#10B981', etiqueta: t('income') },
                      { valor: summary.expenses, color: '#EF4444', etiqueta: t('expenses') },
                    ]}
                  >
                    <p className="text-[10px] font-bold uv-text-muted uppercase tracking-wide leading-tight">{t('analytics_total_movido')}</p>
                    <p className="text-lg font-black uv-text-primary tabular-nums leading-tight mt-0.5">
                      {formatCompact(summary.income + summary.expenses)}
                    </p>
                  </GraficoDona>

                  <div className="w-full grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#10B981' }} />
                      <div className="min-w-0">
                        <p className="text-[11px] uv-text-muted leading-tight">{t('income')}</p>
                        <p className="text-sm font-bold text-green-600 dark:text-green-400 tabular-nums truncate">{formatCurrency(summary.income)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 justify-end text-right">
                      <div className="min-w-0">
                        <p className="text-[11px] uv-text-muted leading-tight">{t('expenses')}</p>
                        <p className="text-sm font-bold text-red-500 dark:text-red-400 tabular-nums truncate">{formatCurrency(summary.expenses)}</p>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#EF4444' }} />
                    </div>
                  </div>

                  <div className="w-full flex items-center justify-between pt-3 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                    <span className="text-xs font-bold uv-text-muted uppercase tracking-wide">{t('net_balance')}</span>
                    <span className={`text-lg font-black tabular-nums ${summary.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                      {summary.net >= 0 ? '+' : ''}{formatCurrency(summary.net)}
                    </span>
                  </div>
                </div>

                {/* Lectura contra el periodo anterior */}
                {comparison && (
                  <p className="mt-3 text-sm uv-text-secondary">
                    {(comparison.pct <= -1
                      ? t('analytics_compare_less').replace('{pct}', Math.abs(comparison.pct).toFixed(0))
                      : comparison.pct >= 1
                        ? t('analytics_compare_more').replace('{pct}', comparison.pct.toFixed(0))
                        : t('analytics_compare_flat')
                    ).replace('{prev}', t(period === 'week' ? 'analytics_prev_week' : 'analytics_prev_month'))}
                  </p>
                )}

                <p className="mt-1 text-xs uv-text-muted">
                  {t('analytics_tx_line')
                    .replace('{n}', String(txCounts.total))
                    .replace('{in}', String(txCounts.recibidos))
                    .replace('{out}', String(txCounts.enviados))}
                </p>

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
              </>
            )}
          </div>
        </div>

        {/* Dos lecturas rapidas que si dicen algo: cuanto se gasta por dia y
            que dia de la semana pega mas fuerte. */}
        {!isLoadingWindow && (dailyAvg > 0 || peakDay) && (
          <div className="px-4 py-2 grid grid-cols-2 gap-3">
            {dailyAvg > 0 && (
              <div className="uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4">
                <p className="text-[11px] font-bold uv-text-muted uppercase tracking-wide">{t('analytics_daily_avg')}</p>
                <p className="text-lg font-extrabold uv-text-primary mt-1 tabular-nums">{formatCurrency(dailyAvg)}</p>
              </div>
            )}
            {peakDay && peakDay.value > 0 && (
              <div className="uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4">
                <p className="text-[11px] font-bold uv-text-muted uppercase tracking-wide">{t('analytics_peak_day')}</p>
                <p className="text-lg font-extrabold uv-text-primary mt-1">{peakDay.name}</p>
                <p className="text-xs uv-text-muted tabular-nums">{formatCurrency(peakDay.value)}</p>
              </div>
            )}
          </div>
        )}

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

        {/* Principales movimientos: nombres y montos reales, lo que el usuario
            reconoce. Filtro por direccion en chips. */}
        {!isLoadingWindow && (
          <div className="px-4 py-2">
            <div className="uv-surface-1 rounded-3xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="text-sm font-bold uv-text-muted">{t('analytics_top_moves')}</h3>
                <div className="flex gap-1">
                  {([['all', 'analytics_dir_all'], ['in', 'analytics_dir_in'], ['out', 'analytics_dir_out']] as const).map(([dir, key]) => (
                    <button
                      key={dir}
                      onClick={() => setDirection(dir)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                        direction === dir
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-secondary'
                      }`}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>

              {topMoves.length === 0 ? (
                <p className="text-sm uv-text-muted py-4 text-center">{t('analytics_no_moves')}</p>
              ) : (
                <div className="divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
                  {topMoves.map((tx) => {
                    const incoming = tx.amount > 0;
                    return (
                      <div key={tx.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${incoming ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]' : 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'}`}>
                          {incoming ? <Icons.ArrowDownLeft size={16} /> : <Icons.ArrowUpRight size={16} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold uv-text-primary truncate">{txTitle(tx, t)}</p>
                          <p className="text-xs uv-text-muted">{tx.date}</p>
                        </div>
                        <span className={`text-sm font-bold tabular-nums shrink-0 ${incoming ? 'text-green-600 dark:text-green-400' : 'uv-text-primary'}`}>
                          {incoming ? '+' : ''}{formatCurrency(tx.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
