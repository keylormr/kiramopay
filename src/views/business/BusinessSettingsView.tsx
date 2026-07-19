import React from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import type { QRMerchant, MerchantVerificationStatus } from '@/api/repositories/qrpayment.repository';

const STATUS_COLOR: Record<MerchantVerificationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  verified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-3 px-4 py-3">
    <span className="text-sm uv-text-muted shrink-0">{label}</span>
    <span className="text-sm font-semibold uv-text-primary text-right truncate">{value}</span>
  </div>
);

interface Props {
  merchant: QRMerchant;
  onSwitchProfile: () => void;
  onBackToPersonal: () => void;
}

export const BusinessSettingsView: React.FC<Props> = ({ merchant, onSwitchProfile, onBackToPersonal }) => {
  const { t } = useLanguage();
  const cat = t(`merchant_cat_${merchant.category}` as Parameters<typeof t>[0]);

  return (
    <div className="pb-24 pt-4 px-4 space-y-5">
      {/* Identity */}
      <div className="uv-surface-1 rounded-2xl p-5 uv-shadow-soft text-center">
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center mx-auto mb-3">
          <Icons.ShoppingCart size={28} />
        </div>
        <h2 className="text-lg font-bold uv-text-primary">{merchant.name}</h2>
        <p className="text-sm uv-text-muted">{cat}</p>
        <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md mt-2 ${STATUS_COLOR[merchant.verificationStatus]}`}>
          {t(`merchant_status_${merchant.verificationStatus}` as Parameters<typeof t>[0])}
        </span>
        {merchant.verificationStatus === 'rejected' && merchant.rejectionReason && (
          <p className="text-xs text-[var(--color-danger)] mt-2">{merchant.rejectionReason}</p>
        )}
      </div>

      {/* Business data */}
      <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
        <Row label={t('merchant_legal_name')} value={merchant.legalName} />
        <Row
          label={t('merchant_cedula')}
          value={`${merchant.cedula} · ${merchant.cedulaType === 'juridica' ? t('merchant_cedula_juridica') : t('merchant_cedula_fisica')}`}
        />
        <Row label={t('merchant_commission')} value={`${(merchant.commissionBps / 100).toFixed(2)}%`} />
        {merchant.description && <Row label={t('merchant_desc')} value={merchant.description} />}
      </div>

      <p className="text-xs uv-text-muted px-1">{t('business_commission_note')}</p>

      <div className="space-y-2.5">
        <Button variant="secondary" onClick={onSwitchProfile} fullWidth leftIcon={<Icons.Users size={18} />}>
          {t('business_switch')}
        </Button>
        <Button variant="secondary" onClick={onBackToPersonal} fullWidth leftIcon={<Icons.User size={18} />}>
          {t('business_back_to_personal')}
        </Button>
      </div>
    </div>
  );
};
