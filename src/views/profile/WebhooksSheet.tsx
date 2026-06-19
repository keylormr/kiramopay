import React, { useState, useEffect } from 'react';
import { BottomSheet } from '../../components/BottomSheet';
import { Icons } from '../../components/Icons';
import { useLanguage } from '../../i18n/LanguageContext';
import { getApiLayer } from '@/api';
import type { WebhookEndpoint, WebhookDelivery } from '@/api';

interface WebhooksSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'list' | 'create' | 'reveal' | 'deliveries';

/**
 * Merchant webhook management. Drives /api/v1/b2b/webhooks: list, register (the
 * signing secret is shown exactly once), delete, and view recent deliveries.
 */
export const WebhooksSheet: React.FC<WebhooksSheetProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('list');
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('*');
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Manual refresh used by button handlers (create/delete). Calling setState
  // here is fine — it is outside an effect body.
  const load = async () => {
    setLoading(true);
    setError('');
    const res = await getApiLayer().b2b.listWebhooks();
    setLoading(false);
    if (res.success && res.data) setEndpoints(res.data);
    else setError(res.error?.message || '');
  };

  // Reset + initial load when the sheet opens. All setState lives inside the
  // async function (not the effect body) to avoid cascading-render warnings.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const run = async () => {
      setStep('list');
      setConfirmDelete(null);
      setLoading(true);
      setError('');
      const res = await getApiLayer().b2b.listWebhooks();
      if (cancelled) return;
      setLoading(false);
      if (res.success && res.data) setEndpoints(res.data);
      else setError(res.error?.message || '');
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleClose = () => {
    setStep('list');
    setUrl('');
    setEvents('*');
    setSecret('');
    setError('');
    setConfirmDelete(null);
    onClose();
  };

  const create = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    const res = await getApiLayer().b2b.createWebhook(url.trim(), events.trim() || '*');
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error?.message || t('escrow_action_failed'));
      return;
    }
    setSecret(res.data.secret);
    setUrl('');
    setEvents('*');
    setStep('reveal');
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    const res = await getApiLayer().b2b.deleteWebhook(id);
    if (res.success) load();
    else setError(res.error?.message || '');
  };

  const openDeliveries = async (id: string) => {
    setStep('deliveries');
    setLoading(true);
    const res = await getApiLayer().b2b.listDeliveries(id);
    setLoading(false);
    setDeliveries(res.success && res.data ? res.data : []);
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the secret is still shown on screen */
    }
  };

  const deliveryColor = (status: string) =>
    status === 'delivered'
      ? 'text-green-600'
      : status === 'failed'
        ? 'text-red-500'
        : 'uv-text-muted';

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title={t('webhooks_title')}>
      <div className="space-y-4">
        {step === 'list' && (
          <>
            <p className="uv-text-secondary text-sm">{t('webhooks_desc')}</p>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            {loading && <p className="uv-text-muted text-sm text-center">{t('loading')}</p>}

            {!loading && endpoints.length === 0 && (
              <div className="text-center py-6 uv-text-muted text-sm">{t('webhooks_empty')}</div>
            )}

            <div className="space-y-2">
              {endpoints.map((e) => (
                <div key={e.id} className="uv-surface-2 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs uv-text-primary truncate min-w-0">{e.url}</p>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                        e.status === 'active'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {e.status === 'active' ? t('webhooks_active') : t('webhooks_disabled')}
                    </span>
                  </div>
                  <p className="text-[11px] uv-text-muted mt-1 font-mono">{e.events}</p>
                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={() => openDeliveries(e.id)}
                      className="text-[var(--color-primary)] text-xs font-semibold"
                    >
                      {t('webhooks_deliveries')}
                    </button>
                    {confirmDelete === e.id ? (
                      <>
                        <button onClick={() => remove(e.id)} className="text-red-500 text-xs font-semibold">
                          {t('webhooks_delete')}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="uv-text-muted text-xs font-semibold"
                        >
                          {t('cancel')}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(e.id)}
                        className="text-red-500 text-xs font-semibold"
                      >
                        {t('webhooks_delete')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setStep('create')}
              className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 uv-shadow-primary active:scale-[0.98] transition-all"
            >
              <Icons.Plus size={18} />
              {t('webhooks_new')}
            </button>
          </>
        )}

        {step === 'create' && (
          <>
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">
                {t('webhooks_url')}
              </label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                inputMode="url"
                className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">
                {t('webhooks_events')}
              </label>
              <input
                value={events}
                onChange={(e) => setEvents(e.target.value)}
                placeholder="*"
                className="w-full font-mono bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
              />
              <p className="text-xs uv-text-muted mt-1">{t('webhooks_events_hint')}</p>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setStep('list')}
                className="flex-1 uv-surface-2 uv-text-primary py-3.5 rounded-xl font-bold"
              >
                {t('cancel')}
              </button>
              <button
                onClick={create}
                disabled={loading || !url.trim()}
                className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                {loading ? t('loading') : t('webhooks_create_btn')}
              </button>
            </div>
          </>
        )}

        {step === 'reveal' && (
          <>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
                <Icons.Lock size={32} className="text-amber-600" />
              </div>
              <h3 className="font-bold uv-text-primary">{t('webhooks_secret_title')}</h3>
              <p className="uv-text-secondary text-sm mt-1">{t('webhooks_secret_desc')}</p>
            </div>
            <p className="font-mono text-sm break-all uv-surface-2 rounded-xl px-3 py-3 uv-text-primary">
              {secret}
            </p>
            <button
              onClick={copySecret}
              className="w-full uv-surface-2 hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] uv-text-primary py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {copied ? <Icons.Check size={16} /> : <Icons.Copy size={16} />}
              {copied ? t('apikeys_copied') : t('apikeys_copy')}
            </button>
            <button
              onClick={() => {
                setSecret('');
                setStep('list');
                load();
              }}
              className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold uv-shadow-primary active:scale-[0.98] transition-all"
            >
              {t('apikeys_done')}
            </button>
          </>
        )}

        {step === 'deliveries' && (
          <>
            <button
              onClick={() => setStep('list')}
              className="text-[var(--color-primary)] text-sm font-semibold flex items-center gap-1"
            >
              <Icons.ChevronLeft size={16} />
              {t('webhooks_title')}
            </button>
            <h3 className="font-bold uv-text-primary text-sm">{t('webhooks_deliveries')}</h3>
            {loading && <p className="uv-text-muted text-sm text-center">{t('loading')}</p>}
            {!loading && deliveries.length === 0 && (
              <div className="text-center py-6 uv-text-muted text-sm">{t('webhooks_no_deliveries')}</div>
            )}
            <div className="space-y-2">
              {deliveries.map((d) => (
                <div key={d.id} className="uv-surface-2 rounded-lg p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs uv-text-primary truncate">{d.eventType}</p>
                    <p className="text-[11px] uv-text-muted">
                      {d.attempts}×{d.responseCode ? ` · ${d.responseCode}` : ''}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold shrink-0 ${deliveryColor(d.status)}`}>
                    {d.status}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
};
