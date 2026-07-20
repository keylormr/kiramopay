import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { MerchantLocation } from '@/api/repositories/qrpayment.repository';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
}

/**
 * Locations manager (owner/manager). A location with sales history is
 * deactivated, never deleted, so past sales keep their attribution.
 */
export const BusinessLocationsSheet: React.FC<Props> = ({ isOpen, onClose, merchantId }) => {
  const { t } = useLanguage();
  const [locations, setLocations] = useState<MerchantLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
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
      const res = await api.getLocations(merchantId);
      if (cancelled) return;
      if (res.success && res.data) setLocations(res.data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isOpen, merchantId, nonce]);

  const add = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || saving || !name.trim()) return;
    setSaving(true);
    setError('');
    const res = await api.createLocation(merchantId, name.trim(), address.trim());
    setSaving(false);
    if (res.success) {
      setName('');
      setAddress('');
      setShowAdd(false);
      reload();
    } else {
      setError(res.error?.message || t('assistant_action_failed'));
    }
  };

  const toggle = async (loc: MerchantLocation) => {
    const api = getApiLayer().qrPayments;
    if (!api) return;
    setError('');
    const res = await api.updateLocation(merchantId, loc.id, { active: !loc.active });
    if (res.success) reload();
    else setError(res.error?.message || t('assistant_action_failed'));
  };

  const field = 'w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('business_locations')}>
      <div className="space-y-4">
        {loading && locations.length === 0 ? (
          <p className="text-sm uv-text-muted">{t('loading')}</p>
        ) : locations.length === 0 ? (
          <p className="text-sm uv-text-muted">{t('business_locations_empty')}</p>
        ) : (
          <div className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
            {locations.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${l.active ? 'uv-text-primary' : 'uv-text-muted line-through'}`}>
                    {l.name}
                  </p>
                  {l.address && <p className="text-[11px] uv-text-muted truncate">{l.address}</p>}
                </div>
                <button
                  onClick={() => void toggle(l)}
                  className={`text-[11px] font-bold shrink-0 ${l.active ? 'text-[var(--color-danger)]' : 'text-[var(--color-primary)]'}`}
                >
                  {l.active ? t('business_location_deactivate') : t('business_location_activate')}
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}

        {!showAdd ? (
          <Button onClick={() => setShowAdd(true)} fullWidth leftIcon={<Icons.Plus size={18} />}>
            {t('business_location_add')}
          </Button>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_name')}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
            </div>
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('address')}</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} className={field} />
            </div>
            <Button onClick={add} loading={saving} disabled={saving || !name.trim()} fullWidth>
              {saving ? t('processing') : t('add')}
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
};
