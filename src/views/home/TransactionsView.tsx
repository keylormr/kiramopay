import React, { useState, useMemo } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import {
  exportTransactionsCSV,
  exportTransactionsJSON,
  copyTransactionsToClipboard,
  shareTransactions,
} from '@/utils/export';
import type { Transaction } from '@/types';

// Category icon/color mapping
const CATEGORY_STYLES: Record<string, { icon: React.FC<{ size?: number }>; bg: string; text: string }> = {
  Transfer: { icon: Icons.ArrowDownUp, bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  'QR Payment': { icon: Icons.QrCode, bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400' },
  Services: { icon: Icons.Zap, bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' },
  Recharge: { icon: Icons.Phone, bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-400' },
  SINPE: { icon: Icons.Smartphone, bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-400' },
  Food: { icon: Icons.UtensilsCrossed, bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400' },
  Shopping: { icon: Icons.ShoppingCart, bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-600 dark:text-pink-400' },
  Transport: { icon: Icons.Car, bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-600 dark:text-cyan-400' },
};

const DEFAULT_STYLE = { icon: Icons.Circle, bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500' };

function getCategoryStyle(category?: string) {
  if (!category) return DEFAULT_STYLE;
  return CATEGORY_STYLES[category] || DEFAULT_STYLE;
}

export const TransactionsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { state } = useApp();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showExportSheet, setShowExportSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Derived data
  const allTransactions = state.transactions;
  const categories = useMemo(() => {
    const cats = new Set<string>();
    allTransactions.forEach((tx) => { if (tx.category) cats.add(tx.category); });
    return Array.from(cats);
  }, [allTransactions]);

  const filtered = useMemo(() => {
    let txs = allTransactions;
    if (selectedCategory) {
      txs = txs.filter((tx) => tx.category === selectedCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      txs = txs.filter(
        (tx) =>
          tx.title.toLowerCase().includes(q) ||
          (tx.category || '').toLowerCase().includes(q) ||
          tx.amount.toString().includes(q),
      );
    }
    return txs;
  }, [allTransactions, selectedCategory, search]);

  const totalIncome = useMemo(
    () => filtered.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0),
    [filtered],
  );
  const totalExpenses = useMemo(
    () => filtered.filter((tx) => tx.amount < 0).reduce((s, tx) => s + Math.abs(tx.amount), 0),
    [filtered],
  );
  const net = totalIncome - totalExpenses;

  const formatCurrency = (amount: number, ccy?: string) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy || 'CRC' }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${ccy || ''}`;
    }
  };

  const baseCcy = state.baseCurrency || 'CRC';

  // Export handlers
  const handleExportCSV = () => {
    exportTransactionsCSV(filtered);
    setShowExportSheet(false);
    showToast(t('export_success'));
  };
  const handleExportJSON = () => {
    exportTransactionsJSON(filtered);
    setShowExportSheet(false);
    showToast(t('export_success'));
  };
  const handleCopy = async () => {
    const ok = await copyTransactionsToClipboard(filtered);
    setShowExportSheet(false);
    showToast(ok ? t('copied_to_clipboard') : t('error'));
  };
  const handleShare = async () => {
    await shareTransactions(filtered);
    setShowExportSheet(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] animate-onboard-slide flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 uv-surface-1/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-text-primary"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold uv-text-primary tracking-tight">{t('recent_transactions')}</h1>
        <button
          onClick={() => setShowExportSheet(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-primary-soft)] text-[var(--color-primary)] rounded-lg text-sm font-semibold hover:bg-[var(--color-primary)] hover:text-white transition-colors"
          aria-label={t('export_options')}
        >
          <Icons.Download size={16} />
          {t('export_transactions')}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-8">
        {/* Summary Cards */}
        <div className="px-4 pt-4 pb-2">
          <div className="grid grid-cols-3 gap-3">
            {/* Income */}
            <div className="uv-surface-1 rounded-2xl p-3.5 uv-shadow-soft">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-full bg-[var(--color-success-soft)] flex items-center justify-center">
                  <Icons.ArrowDownLeft size={12} className="text-[var(--color-success)]" />
                </div>
                <span className="text-[10px] font-bold text-[var(--color-success)] uppercase tracking-wider">{t('income')}</span>
              </div>
              <div className="text-base font-extrabold text-[var(--color-success)] truncate tabular-nums">
                +{formatCurrency(totalIncome, baseCcy)}
              </div>
            </div>

            {/* Expenses */}
            <div className="uv-surface-1 rounded-2xl p-3.5 uv-shadow-soft">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-full bg-[var(--color-danger-soft)] flex items-center justify-center">
                  <Icons.ArrowUpRight size={12} className="text-[var(--color-danger)]" />
                </div>
                <span className="text-[10px] font-bold text-[var(--color-danger)] uppercase tracking-wider">{t('expenses')}</span>
              </div>
              <div className="text-base font-extrabold text-[var(--color-danger)] truncate tabular-nums">
                -{formatCurrency(totalExpenses, baseCcy)}
              </div>
            </div>

            {/* Net */}
            <div className="uv-surface-1 rounded-2xl p-3.5 uv-shadow-soft">
              <div className="flex items-center gap-1.5 mb-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  net >= 0 ? 'bg-[var(--color-primary-soft)]' : 'bg-[var(--color-warning-soft)]'
                }`}>
                  <Icons.TrendingUp size={12} className={net >= 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-warning)]'} />
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  net >= 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-warning)]'
                }`}>{t('net_balance')}</span>
              </div>
              <div className={`text-base font-extrabold truncate tabular-nums ${
                net >= 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-warning)]'
              }`}>
                {net >= 0 ? '+' : ''}{formatCurrency(net, baseCcy)}
              </div>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-4 py-2">
          <div className="relative">
            <Icons.Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 uv-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search_transactions')}
              className="w-full bg-[var(--color-surface-1)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium outline-none placeholder:uv-text-muted focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 uv-text-muted hover:uv-text-primary"
              >
                <Icons.X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Category Chips */}
        {categories.length > 0 && (
          <div className="px-4 py-2">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                  selectedCategory === null
                    ? 'bg-[var(--color-primary)] text-white uv-shadow-primary'
                    : 'uv-surface-1 uv-text-secondary uv-shadow-soft'
                }`}
              >
                {t('all_categories')}
              </button>
              {categories.map((cat) => {
                const style = getCategoryStyle(cat);
                const isActive = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(isActive ? null : cat)}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-[var(--color-primary)] text-white uv-shadow-primary'
                        : `${style.bg} ${style.text}`
                    }`}
                  >
                    <style.icon size={12} />
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Transaction Count */}
        <div className="px-4 py-1">
          <span className="text-xs font-semibold uv-text-muted uppercase tracking-wider">
            {filtered.length} {t('num_transactions')}
          </span>
        </div>

        {/* Transactions List */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 uv-text-muted">
            <div className="w-20 h-20 rounded-3xl uv-surface-2 flex items-center justify-center mb-4">
              <Icons.Receipt size={32} className="opacity-40" />
            </div>
            <p className="text-lg font-bold mb-1 uv-text-primary">{t('no_transactions_yet')}</p>
            <p className="text-sm">{search ? t('search_transactions') : ''}</p>
          </div>
        ) : (
          <div className="px-4 space-y-2 pt-1">
            {filtered.map((tx) => (
              <TransactionCard key={tx.id} tx={tx} formatCurrency={formatCurrency} />
            ))}
          </div>
        )}
      </div>

      {/* Export Bottom Sheet */}
      <BottomSheet
        isOpen={showExportSheet}
        onClose={() => setShowExportSheet(false)}
        title={t('export_options')}
      >
        <div className="space-y-2 pb-2">
          {/* Excel CSV */}
          <ExportOption
            icon={<Icons.FileText size={22} />}
            iconBg="bg-green-100 dark:bg-green-900/30 text-green-600"
            title={t('export_excel')}
            subtitle={t('export_excel_desc')}
            onClick={handleExportCSV}
          />
          {/* JSON */}
          <ExportOption
            icon={<Icons.Hash size={22} />}
            iconBg="bg-blue-100 dark:bg-blue-900/30 text-blue-600"
            title={t('export_json')}
            subtitle={t('export_json_desc')}
            onClick={handleExportJSON}
          />
          {/* Copy */}
          <ExportOption
            icon={<Icons.Copy size={22} />}
            iconBg="bg-purple-100 dark:bg-purple-900/30 text-purple-600"
            title={t('copy_transactions')}
            subtitle={t('copy_transactions_desc')}
            onClick={handleCopy}
          />
          {/* Share */}
          <ExportOption
            icon={<Icons.Share size={22} />}
            iconBg="bg-orange-100 dark:bg-orange-900/30 text-orange-600"
            title={t('share_transactions')}
            subtitle={t('share_transactions_desc')}
            onClick={handleShare}
          />
        </div>
      </BottomSheet>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] animate-fade-in-scale">
          <div className="bg-[var(--color-navy-900)] text-white px-5 py-3 rounded-2xl uv-shadow-floating flex items-center gap-2.5 text-sm font-bold">
            <Icons.CheckCircle size={18} className="text-[var(--color-success)]" />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Sub-components ---

const TransactionCard: React.FC<{
  tx: Transaction;
  formatCurrency: (amount: number, ccy?: string) => string;
}> = ({ tx, formatCurrency }) => {
  const style = getCategoryStyle(tx.category);
  const Icon = style.icon;
  const incoming = tx.amount > 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 uv-surface-1 rounded-2xl uv-shadow-soft hover:uv-shadow-elevated transition-all group cursor-pointer">
      {/* Category Icon */}
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${style.bg} ${style.text} group-hover:scale-105 transition-transform`}>
        <Icon size={20} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold uv-text-primary text-sm truncate">
          {tx.title}
        </div>
        <div className="text-xs uv-text-muted flex items-center gap-1.5 mt-0.5">
          <Icons.Clock size={10} />
          <span>{tx.date}</span>
          {tx.category && (
            <>
              <span className="opacity-40">·</span>
              <span className={style.text}>{tx.category}</span>
            </>
          )}
        </div>
      </div>

      {/* Amount */}
      <div className="text-right flex-shrink-0">
        <div className={`font-extrabold text-sm tabular-nums ${incoming ? 'text-[var(--color-success)]' : 'uv-text-primary'}`}>
          {incoming ? '+' : ''}{formatCurrency(tx.amount, tx.ccy)}
        </div>
        <div className={`text-[10px] font-bold mt-0.5 px-1.5 py-0.5 rounded-md inline-block ${
          tx.status === 'completed'
            ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
            : 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
        }`}>
          {tx.status === 'completed' ? '✓' : '⏳'} {tx.status || 'completed'}
        </div>
      </div>
    </div>
  );
};

const ExportOption: React.FC<{
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}> = ({ icon, iconBg, title, subtitle, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-4 p-4 rounded-2xl uv-surface-1 uv-shadow-soft hover:uv-shadow-elevated transition-all active:scale-[0.98] text-left"
  >
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-bold uv-text-primary text-sm">{title}</div>
      <div className="text-xs uv-text-muted mt-0.5">{subtitle}</div>
    </div>
    <Icons.ChevronRight size={16} className="uv-text-muted flex-shrink-0" />
  </button>
);
