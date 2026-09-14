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
import { fechaLarga, porcentajeDeBps, rellenar } from '@/utils/planes';

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
  const { t, language } = useLanguage();
  const { state } = useApp();
  const ccy = (state.accounts.find((a) => a.ccy === state.baseCurrency) || state.accounts[0])?.ccy ?? 'CRC';
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
  const [idCopiado, setIdCopiado] = useState(false);
  // El instante con el que se compara el fin de la promocion, tomado una vez al
  // montar: leer el reloj en cada render rompe la regla de pureza de React.
  const [ahora] = useState(() => Date.now());

  // Lo que se cobra HOY lo decide el servidor (promocion incluida): esta
  // pantalla no recalcula la comision, la muestra.
  const efectivaBps = merchant.comisionEfectivaBps ?? merchant.commissionBps;
  const finPromo = merchant.promoHasta ? new Date(merchant.promoHasta).getTime() : Number.NaN;
  const promoVigente = Number.isFinite(finPromo) && finPromo > ahora && efectivaBps < merchant.commissionBps;
  const promoTerminada = Number.isFinite(finPromo) && finPromo <= ahora;

  const copiarId = async () => {
    try {
      await navigator.clipboard.writeText(merchant.id);
      setIdCopiado(true);
      setTimeout(() => setIdCopiado(false), 2000);
    } catch {
      // Sin portapapeles el identificador sigue a la vista para copiarlo a mano.
    }
  };

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
        <Row label={t('business_commission_today')} value={porcentajeDeBps(efectivaBps)} />
        <Row
          label={t('business_plan_label')}
          value={t(merchant.plan === 'analitica' ? 'business_plan_analitica' : 'business_plan_base')}
        />
        {merchant.description && <Row label={t('merchant_desc')} value={merchant.description} />}
      </div>

      {promoVigente && (
        <div className="flex gap-3 rounded-2xl bg-[var(--color-success-soft)] p-4">
          <Icons.Percent
            size={18}
            className="mt-0.5 shrink-0 text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold leading-relaxed text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]">
            {rellenar(t('business_promo_until'), {
              pct: porcentajeDeBps(efectivaBps),
              fecha: fechaLarga(merchant.promoHasta, language),
              std: porcentajeDeBps(merchant.commissionBps),
            })}
          </p>
        </div>
      )}
      {promoTerminada && (
        <p className="text-xs uv-text-muted px-1">
          {rellenar(t('business_promo_ended'), { fecha: fechaLarga(merchant.promoHasta, language) })}
        </p>
      )}

      <p className="text-xs uv-text-muted px-1">{t('business_commission_note')}</p>

      {/* Para un piloto el administrador asigna el plan por este identificador. */}
      {isOwner && (
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm uv-text-muted">{t('business_merchant_id')}</p>
              <p className="mt-0.5 font-mono text-xs uv-text-primary break-all">{merchant.id}</p>
            </div>
            <button
              type="button"
              onClick={() => void copiarId()}
              aria-label={`${t('copy')} ${t('business_merchant_id')}`}
              className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center uv-text-secondary hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] uv-focus-ring"
            >
              {idCopiado ? <Icons.Check size={18} /> : <Icons.Copy size={18} />}
            </button>
          </div>
          <p className="mt-1.5 text-xs uv-text-muted" aria-live="polite">
            {idCopiado ? t('business_merchant_id_copied') : t('business_merchant_id_hint')}
          </p>
        </div>
      )}

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
      <BusinessCatalogSheet isOpen={showCatalog} onClose={() => setShowCatalog(false)} merchantId={merchant.id} currencyCode={ccy} />

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
