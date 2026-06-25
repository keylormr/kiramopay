import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { MfaChallengeSheet } from '@/components/MfaChallengeSheet';
import { getApiLayer, MFA_REQUIRED } from '@/api';
import { refreshAccounts } from '@/services/dataSync';
import { useAuthStore } from '@/stores/auth.store';
import type { EscrowAgreement, EscrowStatus } from '@/api';

type EscrowActionResult = { success: boolean; data?: EscrowAgreement; error?: { code?: string; message: string } };

const STATUS_COLOR: Record<EscrowStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  funded: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  released: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  refunded: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  disputed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

function money(amountMinor: number, currency: string): string {
  const amount = amountMinor / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export const EscrowView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [agreements, setAgreements] = useState<EscrowAgreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadTrigger, setLoadTrigger] = useState(0);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [sellerId, setSellerId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [selected, setSelected] = useState<EscrowAgreement | null>(null);
  const [acting, setActing] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  // The money action (e.g. fund) that returned MFA_REQUIRED, retried after verify.
  const pendingActionRef = useRef<((id: string) => Promise<EscrowActionResult>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const res = await getApiLayer().escrow.list(100);
      if (!cancelled) {
        if (res.success && res.data) setAgreements(res.data);
        else setError(res.error?.message || '');
        setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [loadTrigger]);

  const refresh = () => setLoadTrigger((n) => n + 1);

  const create = async () => {
    const value = parseFloat(amount);
    if (!sellerId.trim() || !description.trim() || !Number.isFinite(value) || value <= 0) return;
    setCreating(true);
    setError('');
    const res = await getApiLayer().escrow.create({
      sellerId: sellerId.trim(),
      amountMinor: Math.round(value * 100),
      currency: 'CRC',
      description: description.trim(),
    });
    setCreating(false);
    if (!res.success) {
      setError(res.error?.message || t('escrow_action_failed'));
      return;
    }
    setShowCreate(false);
    setSellerId('');
    setAmount('');
    setDescription('');
    refresh();
  };

  // run a money-moving action against the selected agreement.
  const runAction = async (fn: (id: string) => Promise<EscrowActionResult>) => {
    if (!selected) return;
    setActing(true);
    setError('');
    const res = await fn(selected.id);
    setActing(false);
    if (!res.success || !res.data) {
      // High-value funding: prompt for a TOTP code, then retry this same action.
      if (res.error?.code === MFA_REQUIRED) {
        pendingActionRef.current = fn;
        setShowMfa(true);
        return;
      }
      setError(res.error?.message || t('escrow_action_failed'));
      return;
    }
    setSelected(res.data);
    refresh();
    // Funds moved on the ledger (fund/release/refund): refetch the global
    // wallet balance so the home balance is not left stale.
    refreshAccounts().catch(() => {});
  };

  const api = getApiLayer();

  const submitDispute = async () => {
    if (!selected || !disputeReason.trim()) return;
    setActing(true);
    setError('');
    const res = await api.escrow.dispute(selected.id, disputeReason.trim());
    setActing(false);
    if (!res.success || !res.data) {
      setError(res.error?.message || t('escrow_action_failed'));
      return;
    }
    setSelected(res.data);
    setDisputing(false);
    setDisputeReason('');
    refresh();
    // Dispute does not move funds today, but refetch keeps the home balance
    // uniformly fresh across every escrow transition.
    refreshAccounts().catch(() => {});
  };

  const isBuyer = selected && currentUserId === selected.buyerId;
  const isSeller = selected && currentUserId === selected.sellerId;

  const statusBadge = (s: EscrowStatus) => (
    <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${STATUS_COLOR[s]}`}>
      {t(`escrow_status_${s}`)}
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
        <h1 className="text-lg font-bold">{t('escrow_title')}</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="p-2 -mr-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors text-[var(--color-primary)]"
          aria-label={t('escrow_new')}
        >
          <Icons.Plus size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        <p className="px-4 pt-3 text-xs uv-text-muted">{t('escrow_subtitle')}</p>
        {error && <p className="px-4 pt-2 text-red-500 text-sm">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : agreements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-gray-400">
            <div className="w-24 h-24 rounded-3xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center mb-4">
              <Icons.Shield size={48} className="opacity-30" />
            </div>
            <p className="text-lg font-bold mb-2 uv-text-primary">{t('escrow_empty')}</p>
            <p className="text-sm text-center mb-6">{t('escrow_empty_desc')}</p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-6 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
            >
              {t('escrow_new')}
            </button>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            {agreements.map((a, i) => (
              <button
                key={a.id}
                onClick={() => {
                  setSelected(a);
                  setDisputing(false);
                  setError('');
                }}
                className="w-full text-left uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4 shadow-sm animate-stagger"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="font-bold uv-text-primary text-sm min-w-0 truncate">{a.description}</h3>
                  {statusBadge(a.status)}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-lg font-extrabold uv-text-primary">
                    {money(a.amountMinor, a.currency)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {currentUserId === a.buyerId ? t('escrow_role_buyer') : t('escrow_role_seller')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create sheet */}
      <BottomSheet isOpen={showCreate} onClose={() => setShowCreate(false)} title={t('escrow_create_title')}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('escrow_seller')}</label>
            <input
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="w-full font-mono text-sm bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
            />
            <p className="text-xs uv-text-muted mt-1">{t('escrow_seller_hint')}</p>
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('escrow_amount')}</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('escrow_desc_label')}</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('escrow_desc_hint')}
              className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            onClick={create}
            disabled={creating || !sellerId.trim() || !description.trim() || !amount}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 uv-shadow-primary active:scale-[0.98] transition-all"
          >
            {creating ? t('loading') : t('escrow_create_btn')}
          </button>
        </div>
      </BottomSheet>

      {/* Detail / actions sheet */}
      <BottomSheet
        isOpen={selected !== null}
        onClose={() => {
          setSelected(null);
          setDisputing(false);
        }}
        title={selected?.description || t('escrow_title')}
      >
        {selected && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-3xl font-extrabold uv-text-primary">
                {money(selected.amountMinor, selected.currency)}
              </p>
              <div className="mt-2">{statusBadge(selected.status)}</div>
              <p className="text-xs uv-text-muted mt-2">
                {isBuyer ? t('escrow_you_buyer') : isSeller ? t('escrow_you_seller') : ''}
              </p>
            </div>

            {selected.disputeReason && (
              <div className="uv-surface-2 rounded-xl p-3 text-sm">
                <span className="uv-text-muted">{t('escrow_dispute_reason')}: </span>
                <span className="uv-text-primary">{selected.disputeReason}</span>
              </div>
            )}

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            {disputing ? (
              <div className="space-y-3">
                <input
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder={t('escrow_dispute_reason')}
                  className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setDisputing(false)}
                    className="flex-1 uv-surface-2 uv-text-primary py-3 rounded-xl font-bold"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={submitDispute}
                    disabled={acting || !disputeReason.trim()}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl font-bold disabled:opacity-50"
                  >
                    {t('escrow_dispute_submit')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {selected.status === 'pending' && isBuyer && (
                  <button
                    onClick={() => runAction((id) => api.escrow.fund(id))}
                    disabled={acting}
                    className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 active:scale-[0.98] transition-all"
                  >
                    {acting ? t('loading') : t('escrow_fund')}
                  </button>
                )}
                {selected.status === 'funded' && isBuyer && (
                  <button
                    onClick={() => runAction((id) => api.escrow.release(id))}
                    disabled={acting}
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-3.5 rounded-xl font-bold disabled:opacity-50 active:scale-[0.98] transition-all"
                  >
                    {acting ? t('loading') : t('escrow_release')}
                  </button>
                )}
                {selected.status === 'funded' && isSeller && (
                  <button
                    onClick={() => runAction((id) => api.escrow.refund(id))}
                    disabled={acting}
                    className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 active:scale-[0.98] transition-all"
                  >
                    {acting ? t('loading') : t('escrow_refund')}
                  </button>
                )}
                {selected.status === 'funded' && (isBuyer || isSeller) && (
                  <button
                    onClick={() => {
                      setDisputing(true);
                      setError('');
                    }}
                    className="w-full uv-surface-2 text-red-500 py-3 rounded-xl font-semibold"
                  >
                    {t('escrow_dispute')}
                  </button>
                )}
                {selected.status === 'pending' && (isBuyer || isSeller) && (
                  <button
                    onClick={() => runAction((id) => api.escrow.cancel(id))}
                    disabled={acting}
                    className="w-full uv-surface-2 uv-text-secondary py-3 rounded-xl font-semibold disabled:opacity-50"
                  >
                    {t('escrow_cancel_agreement')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {/* High-value MFA challenge → on verify, retry the pending action (fund) */}
      <MfaChallengeSheet
        isOpen={showMfa}
        onClose={() => setShowMfa(false)}
        onVerified={() => {
          setShowMfa(false);
          const fn = pendingActionRef.current;
          pendingActionRef.current = null;
          if (fn) runAction(fn);
        }}
      />
    </div>
  );
};
