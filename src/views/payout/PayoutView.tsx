import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { Payout, PayoutStatus } from '@/api';

const STATUS_COLOR: Record<PayoutStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

// Default rail-typed destination kind. A richer per-rail selector can replace
// this when real rails (bank, SINPE phone, crypto) are wired.
const DESTINATION_TYPE = 'bank_account';

function money(amountMinor: number, currency: string): string {
  const amount = amountMinor / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `pk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export const PayoutView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();

  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [rails, setRails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadTrigger, setLoadTrigger] = useState(0);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [rail, setRail] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [creating, setCreating] = useState(false);

  const [selected, setSelected] = useState<Payout | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const api = getApiLayer();
      const [listRes, railsRes] = await Promise.all([api.payout.list(100), api.payout.rails()]);
      if (cancelled) return;
      if (listRes.success && listRes.data) setPayouts(listRes.data);
      else setError(listRes.error?.message || '');
      if (railsRes.success && railsRes.data) {
        setRails(railsRes.data);
        setRail((prev) => prev || railsRes.data?.[0] || '');
      }
      setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [loadTrigger]);

  const refresh = () => setLoadTrigger((n) => n + 1);

  const api = getApiLayer();

  const create = async () => {
    const value = parseFloat(amount);
    if (!rail || !beneficiary.trim() || !account.trim() || !Number.isFinite(value) || value <= 0) return;
    setCreating(true);
    setError('');
    const res = await api.payout.create({
      rail,
      amountMinor: Math.round(value * 100),
      currency: 'CRC',
      destination: { type: DESTINATION_TYPE, account: account.trim(), name: beneficiary.trim() },
      idempotencyKey: newIdempotencyKey(),
    });
    setCreating(false);
    if (!res.success) {
      setError(res.error?.message || t('payout_action_failed'));
      return;
    }
    setShowCreate(false);
    setBeneficiary('');
    setAccount('');
    setAmount('');
    refresh();
  };

  const runRefresh = async () => {
    if (!selected) return;
    setActing(true);
    setError('');
    const res = await api.payout.refresh(selected.id);
    setActing(false);
    if (!res.success || !res.data) {
      setError(res.error?.message || t('payout_action_failed'));
      return;
    }
    setSelected(res.data);
    refresh();
  };

  const statusBadge = (s: PayoutStatus) => (
    <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${STATUS_COLOR[s]}`}>
      {t(`payout_status_${s}`)}
    </span>
  );

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
        <h1 className="text-lg font-bold">{t('payout_title')}</h1>
        <button
          onClick={() => {
            setShowCreate(true);
            setError('');
          }}
          disabled={rails.length === 0}
          className="p-2 -mr-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors text-[var(--color-primary)] disabled:opacity-40"
          aria-label={t('payout_new')}
        >
          <Icons.Plus size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        <p className="px-4 pt-3 text-xs uv-text-muted">{t('payout_subtitle')}</p>
        {error && <p className="px-4 pt-2 text-red-500 text-sm">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : payouts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-gray-400">
            <div className="w-24 h-24 rounded-3xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center mb-4">
              <Icons.Send size={48} className="opacity-30" />
            </div>
            <p className="text-lg font-bold mb-2 uv-text-primary">{t('payout_empty')}</p>
            <p className="text-sm text-center mb-6">{t('payout_empty_desc')}</p>
            {rails.length === 0 ? (
              <p className="text-sm text-center text-red-400">{t('payout_no_rails')}</p>
            ) : (
              <button
                onClick={() => {
                  setShowCreate(true);
                  setError('');
                }}
                className="px-6 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
              >
                {t('payout_new')}
              </button>
            )}
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            {payouts.map((p, i) => (
              <button
                key={p.id}
                onClick={() => {
                  setSelected(p);
                  setError('');
                }}
                className="w-full text-left uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4 shadow-sm animate-stagger"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="font-bold uv-text-primary text-sm min-w-0 truncate">{p.destination.name}</h3>
                  {statusBadge(p.status)}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-lg font-extrabold uv-text-primary">
                    {money(p.amountMinor, p.currency)}
                  </span>
                  <span className="text-xs text-gray-400 uppercase">{p.rail}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create sheet */}
      <BottomSheet isOpen={showCreate} onClose={() => setShowCreate(false)} title={t('payout_create_title')}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('payout_rail')}</label>
            <select
              value={rail}
              onChange={(e) => setRail(e.target.value)}
              className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
            >
              {rails.map((r) => (
                <option key={r} value={r}>
                  {r.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('payout_beneficiary')}</label>
            <input
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder={t('payout_beneficiary')}
              className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('payout_account')}</label>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="CR00000000000000000000"
              className="w-full font-mono text-sm bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
            />
            <p className="text-xs uv-text-muted mt-1">{t('payout_account_hint')}</p>
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('payout_amount')}</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            onClick={create}
            disabled={creating || !rail || !beneficiary.trim() || !account.trim() || !amount}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 uv-shadow-primary active:scale-[0.98] transition-all"
          >
            {creating ? t('loading') : t('payout_create_btn')}
          </button>
        </div>
      </BottomSheet>

      {/* Detail sheet */}
      <BottomSheet
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.destination.name || t('payout_title')}
      >
        {selected && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-3xl font-extrabold uv-text-primary">
                {money(selected.amountMinor, selected.currency)}
              </p>
              <div className="mt-2">{statusBadge(selected.status)}</div>
            </div>

            <div className="uv-surface-2 rounded-xl p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="uv-text-muted">{t('payout_rail')}</span>
                <span className="uv-text-primary uppercase">{selected.rail}</span>
              </div>
              <div className="flex justify-between">
                <span className="uv-text-muted">{t('payout_destination')}</span>
                <span className="uv-text-primary font-mono">{selected.destination.account}</span>
              </div>
            </div>

            {selected.failureReason && (
              <div className="uv-surface-2 rounded-xl p-3 text-sm">
                <span className="uv-text-muted">{t('payout_failure_reason')}: </span>
                <span className="uv-text-primary">{selected.failureReason}</span>
              </div>
            )}

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            {selected.status === 'processing' && (
              <button
                onClick={runRefresh}
                disabled={acting}
                className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                {acting ? t('loading') : t('payout_refresh')}
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
};
