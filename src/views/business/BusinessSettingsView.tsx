import React, { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useApp } from '@/hooks/useApp';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import { BusinessTeamSheet } from './BusinessTeamSheet';
import { BusinessLocationsSheet } from './BusinessLocationsSheet';
import { BusinessCatalogSheet } from './BusinessCatalogSheet';
import type { QRMerchant, MerchantVerificationStatus } from '@/api/repositories/qrpayment.repository';

const STATUS_COLOR: Record<MerchantVerificationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  verified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const CATEGORIES = ['restaurant', 'retail', 'services', 'food_truck', 'market'] as const;

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
  onUpdated: () => void;
}

export const BusinessSettingsView: React.FC<Props> = ({ merchant, onSwitchProfile, onBackToPersonal, onUpdated }) => {
  const { t } = useLanguage();
  const { state } = useApp();
  const symbol = (state.accounts.find((a) => a.ccy === state.baseCurrency) || state.accounts[0])?.symbol ?? '₡';
  const cat = t(`merchant_cat_${merchant.category}` as Parameters<typeof t>[0]);
  // What this screen offers depends on the caller's role: the owner manages
  // everything; a manager runs locations/catalog; a cashier only reads.
  const isOwner = merchant.role === 'owner';
  const canManage = isOwner || merchant.role === 'manager';

  const [showTeam, setShowTeam] = useState(false);
  const [showLocations, setShowLocations] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [name, setName] = useState(merchant.name);
  const [category, setCategory] = useState<string>(merchant.category);
  const [description, setDescription] = useState(merchant.description);
  const [cedula, setCedula] = useState(merchant.cedula);
  const [legalName, setLegalName] = useState(merchant.legalName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const openEdit = () => {
    setName(merchant.name);
    setCategory(merchant.category);
    setDescription(merchant.description);
    setCedula(merchant.cedula);
    setLegalName(merchant.legalName);
    setError('');
    setShowEdit(true);
  };

  const save = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || saving) return;
    setSaving(true);
    setError('');
    const res = await api.updateMerchant(merchant.id, {
      name: name.trim(),
      description: description.trim(),
      category,
      cedula: cedula.trim(),
      cedulaType: merchant.cedulaType,
      legalName: legalName.trim(),
    });
    setSaving(false);
    if (res.success) {
      setShowEdit(false);
      onUpdated();
    } else {
      setError(res.error?.message || t('assistant_action_failed'));
    }
  };

  const identityChanged = cedula.trim() !== merchant.cedula || legalName.trim() !== merchant.legalName;
  const field = 'w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]';
  const label = 'text-sm font-medium uv-text-secondary mb-1.5 block';

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
        {isOwner && (
          <Button onClick={openEdit} fullWidth leftIcon={<Icons.Edit size={18} />}>
            {t('business_edit')}
          </Button>
        )}
        {isOwner && (
          <Button variant="secondary" onClick={() => setShowTeam(true)} fullWidth leftIcon={<Icons.Users size={18} />}>
            {t('business_team')}
          </Button>
        )}
        {canManage && (
          <Button variant="secondary" onClick={() => setShowLocations(true)} fullWidth leftIcon={<Icons.MapPin size={18} />}>
            {t('business_locations')}
          </Button>
        )}
        {canManage && (
          <Button variant="secondary" onClick={() => setShowCatalog(true)} fullWidth leftIcon={<Icons.Tag size={18} />}>
            {t('business_catalog')}
          </Button>
        )}
        <Button variant="secondary" onClick={onSwitchProfile} fullWidth leftIcon={<Icons.RefreshCw size={18} />}>
          {t('business_switch')}
        </Button>
        <Button variant="secondary" onClick={onBackToPersonal} fullWidth leftIcon={<Icons.User size={18} />}>
          {t('business_back_to_personal')}
        </Button>
      </div>

      <BusinessTeamSheet isOpen={showTeam} onClose={() => setShowTeam(false)} merchantId={merchant.id} />
      <BusinessLocationsSheet isOpen={showLocations} onClose={() => setShowLocations(false)} merchantId={merchant.id} />
      <BusinessCatalogSheet isOpen={showCatalog} onClose={() => setShowCatalog(false)} merchantId={merchant.id} currencySymbol={symbol} />

      {/* Edit sheet */}
      <BottomSheet isOpen={showEdit} onClose={() => setShowEdit(false)} title={t('business_edit')}>
        <div className="space-y-4">
          <div>
            <label className={label}>{t('merchant_name')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>{t('merchant_category')}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`merchant_cat_${c}` as Parameters<typeof t>[0])}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>{t('merchant_desc')}</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>{t('merchant_cedula')}</label>
            <input value={cedula} onChange={(e) => setCedula(e.target.value)} className={field} inputMode="numeric" />
          </div>
          <div>
            <label className={label}>{t('merchant_legal_name')}</label>
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={field} />
          </div>

          {/* Editing the legal identity is not silent: it returns the shop to review. */}
          {identityChanged && merchant.verificationStatus === 'verified' && (
            <p className="text-xs text-[var(--color-warning)]">{t('business_edit_identity_note')}</p>
          )}
          {error && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}

          <Button
            onClick={save}
            loading={saving}
            disabled={!name.trim() || !cedula.trim() || !legalName.trim() || saving}
            size="lg"
            fullWidth
          >
            {saving ? t('processing') : t('save')}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
};
