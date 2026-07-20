import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { CatalogItem } from '@/api/repositories/qrpayment.repository';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
  currencySymbol: string;
}

/**
 * Catalog manager (owner/manager): the shop's price list. Charges are composed
 * from these items in the charge sheet; history only stores totals + a note,
 * so items can be freely renamed or deleted.
 */
export const BusinessCatalogSheet: React.FC<Props> = ({ isOpen, onClose, merchantId, currencySymbol }) => {
  const { t } = useLanguage();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
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
      const res = await api.getCatalog(merchantId);
      if (cancelled) return;
      if (res.success && res.data) setItems(res.data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isOpen, merchantId, nonce]);

  const add = async () => {
    const api = getApiLayer().qrPayments;
    const val = parseFloat(price);
    if (!api || saving || !name.trim() || !(val > 0)) return;
    setSaving(true);
    setError('');
    const res = await api.createCatalogItem(merchantId, { name: name.trim(), price: val });
    setSaving(false);
    if (res.success) {
      setName('');
      setPrice('');
      setShowAdd(false);
      reload();
    } else {
      setError(res.error?.message || t('assistant_action_failed'));
    }
  };

  const toggle = async (item: CatalogItem) => {
    const api = getApiLayer().qrPayments;
    if (!api) return;
    setError('');
    const res = await api.updateCatalogItem(merchantId, item.id, { active: !item.active });
    if (res.success) reload();
    else setError(res.error?.message || t('assistant_action_failed'));
  };

  const remove = async (item: CatalogItem) => {
    const api = getApiLayer().qrPayments;
    if (!api) return;
    setError('');
    const res = await api.deleteCatalogItem(merchantId, item.id);
    if (res.success) reload();
    else setError(res.error?.message || t('assistant_action_failed'));
  };

  const money = (v: number) => `${currencySymbol}${v.toFixed(2)}`;
  const field = 'w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('business_catalog')}>
      <div className="space-y-4">
        {loading && items.length === 0 ? (
          <p className="text-sm uv-text-muted">{t('loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm uv-text-muted">{t('business_catalog_empty')}</p>
        ) : (
          <div className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
            {items.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${c.active ? 'uv-text-primary' : 'uv-text-muted line-through'}`}>
                    {c.name}
                  </p>
                  <p className="text-[11px] uv-text-muted tabular-nums">{money(c.price)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => void toggle(c)}
                    className={`text-[11px] font-bold ${c.active ? 'uv-text-muted' : 'text-[var(--color-primary)]'}`}
                  >
                    {c.active ? t('business_location_deactivate') : t('business_location_activate')}
                  </button>
                  <button onClick={() => void remove(c)} aria-label={t('business_catalog_delete')}>
                    <Icons.X size={15} className="text-[var(--color-danger)]" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}

        {!showAdd ? (
          <Button onClick={() => setShowAdd(true)} fullWidth leftIcon={<Icons.Plus size={18} />}>
            {t('business_catalog_add')}
          </Button>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_name')}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
            </div>
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('business_catalog_price')}</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} className={field} type="number" inputMode="decimal" placeholder="0.00" />
            </div>
            <Button onClick={add} loading={saving} disabled={saving || !name.trim() || !(parseFloat(price) > 0)} fullWidth>
              {saving ? t('processing') : t('add')}
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
};
