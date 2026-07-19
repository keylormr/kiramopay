import React from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import type { QRMerchant, MerchantVerificationStatus } from '@/api/repositories/qrpayment.repository';

const STATUS_COLOR: Record<MerchantVerificationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  verified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  merchants: QRMerchant[];
  activeMerchantId: string | null;
  onSelect: (merchantId: string | null) => void;
  onCreate: () => void;
}

/**
 * Switches the app between the personal wallet and any of the owner's
 * businesses. Same login, several profiles — no second account or password.
 */
export const ProfileSwitcherSheet: React.FC<Props> = ({
  isOpen, onClose, merchants, activeMerchantId, onSelect, onCreate,
}) => {
  const { t } = useLanguage();

  const row = (selected: boolean) =>
    `w-full flex items-center gap-3 p-4 rounded-2xl border text-left transition-colors ${
      selected
        ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
        : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)] hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]'
    }`;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('business_switch')}>
      <div className="space-y-2.5">
        <button onClick={() => { onSelect(null); onClose(); }} className={row(activeMerchantId === null)}>
          <div className="w-10 h-10 rounded-full uv-gradient-brand flex items-center justify-center text-white shrink-0">
            <Icons.User size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold uv-text-primary">{t('profile_personal')}</p>
            <p className="text-xs uv-text-muted">{t('business_personal_desc')}</p>
          </div>
          {activeMerchantId === null && <Icons.Check size={18} className="text-[var(--color-primary)] shrink-0" />}
        </button>

        {merchants.map((m) => (
          <button key={m.id} onClick={() => { onSelect(m.id); onClose(); }} className={row(activeMerchantId === m.id)}>
            <div className="w-10 h-10 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center shrink-0">
              <Icons.ShoppingCart size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold uv-text-primary truncate">{m.name}</p>
              <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md mt-0.5 ${STATUS_COLOR[m.verificationStatus]}`}>
                {t(`merchant_status_${m.verificationStatus}` as Parameters<typeof t>[0])}
              </span>
            </div>
            {activeMerchantId === m.id && <Icons.Check size={18} className="text-[var(--color-primary)] shrink-0" />}
          </button>
        ))}

        <button
          onClick={() => { onClose(); onCreate(); }}
          className="w-full flex items-center gap-3 p-4 rounded-2xl border border-dashed border-[var(--color-border-strong)] dark:border-[var(--color-border-dark)] text-left hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
        >
          <div className="w-10 h-10 rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center shrink-0">
            <Icons.Plus size={18} className="uv-text-muted" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold uv-text-primary">{t('business_create')}</p>
            <p className="text-xs uv-text-muted">{t('business_create_desc')}</p>
          </div>
        </button>
      </div>
    </BottomSheet>
  );
};
