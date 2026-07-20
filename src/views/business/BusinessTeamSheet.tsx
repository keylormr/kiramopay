import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { StaffMember, MerchantLocation } from '@/api/repositories/qrpayment.repository';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
}

/**
 * Owner-only team roster: add employees by the cedula they registered with,
 * switch their role (cashier collects; manager also runs catalog/locations),
 * and revoke access. Revoked people stay listed — re-adding reactivates them.
 */
export const BusinessTeamSheet: React.FC<Props> = ({ isOpen, onClose, merchantId }) => {
  const { t } = useLanguage();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [locations, setLocations] = useState<MerchantLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [cedula, setCedula] = useState('');
  const [role, setRole] = useState<'cashier' | 'manager'>('cashier');
  const [locationId, setLocationId] = useState('');
  const [saving, setSaving] = useState(false);

  // Bumping the nonce refetches after a mutation (same idiom as useBusinessData).
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);

  // Reset transient state on the closed->open transition (the React "adjust
  // state when a prop changes" pattern; effects only run the fetch).
  const [prevOpen, setPrevOpen] = useState(false);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setError('');
      setShowAdd(false);
      setLoading(true);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      const api = getApiLayer().qrPayments;
      if (!api) return;
      const [sRes, lRes] = await Promise.all([api.getStaff(merchantId), api.getLocations(merchantId)]);
      if (cancelled) return;
      if (sRes.success && sRes.data) setStaff(sRes.data);
      if (lRes.success && lRes.data) setLocations(lRes.data.filter((l) => l.active));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isOpen, merchantId, nonce]);

  const add = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || saving || !cedula.trim()) return;
    setSaving(true);
    setError('');
    const res = await api.addStaff(merchantId, cedula.trim(), role, locationId || undefined);
    setSaving(false);
    if (res.success) {
      setCedula('');
      setLocationId('');
      setShowAdd(false);
      reload();
    } else {
      setError(res.error?.message || t('assistant_action_failed'));
    }
  };

  const revoke = async (staffId: string) => {
    const api = getApiLayer().qrPayments;
    if (!api) return;
    setError('');
    const res = await api.revokeStaff(merchantId, staffId);
    if (res.success) reload();
    else setError(res.error?.message || t('assistant_action_failed'));
  };

  const roleLabel = (r: 'cashier' | 'manager') =>
    r === 'manager' ? t('business_role_manager') : t('business_role_cashier');
  const locationName = (id?: string) => locations.find((l) => l.id === id)?.name;
  const field = 'w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('business_team')}>
      <div className="space-y-4">
        {loading && staff.length === 0 ? (
          <p className="text-sm uv-text-muted">{t('loading')}</p>
        ) : staff.length === 0 ? (
          <p className="text-sm uv-text-muted">{t('business_team_empty')}</p>
        ) : (
          <div className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
            {staff.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${s.status === 'revoked' ? 'uv-text-muted line-through' : 'uv-text-primary'}`}>
                    {s.firstName} {s.lastName}
                  </p>
                  <p className="text-[11px] uv-text-muted">
                    {s.status === 'revoked' ? t('business_revoked') : roleLabel(s.role)}
                    {s.status !== 'revoked' && locationName(s.locationId) ? ` · ${locationName(s.locationId)}` : ''}
                  </p>
                </div>
                {s.status === 'active' && (
                  <button
                    onClick={() => void revoke(s.id)}
                    className="text-[11px] font-bold text-[var(--color-danger)] shrink-0"
                  >
                    {t('business_revoke')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}

        {!showAdd ? (
          <Button onClick={() => setShowAdd(true)} fullWidth leftIcon={<Icons.Plus size={18} />}>
            {t('business_team_add')}
          </Button>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_cedula')}</label>
              <input value={cedula} onChange={(e) => setCedula(e.target.value)} className={field} inputMode="numeric" />
              <p className="text-xs uv-text-muted mt-1">{t('business_team_cedula_hint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['cashier', 'manager'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`p-3 rounded-xl border text-left ${
                    role === r
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                      : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
                  }`}
                >
                  <p className="text-sm font-bold uv-text-primary">{roleLabel(r)}</p>
                  <p className="text-[11px] uv-text-muted mt-0.5">
                    {r === 'manager' ? t('business_role_manager_desc') : t('business_role_cashier_desc')}
                  </p>
                </button>
              ))}
            </div>
            {locations.length > 0 && (
              <div>
                <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('business_locations')}</label>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={field}>
                  <option value="">—</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            )}
            <Button onClick={add} loading={saving} disabled={saving || !cedula.trim()} fullWidth>
              {saving ? t('processing') : t('add')}
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
};
