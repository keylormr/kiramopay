import React, { useState, useEffect } from 'react';
import { BottomSheet } from '../../components/BottomSheet';
import { Icons } from '../../components/Icons';
import { useLanguage } from '../../i18n/LanguageContext';
import { getApiLayer } from '@/api';
import { B2B_SCOPES, type ApiKey } from '@/api';

interface ApiKeysSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'list' | 'create' | 'reveal';

/**
 * Merchant API-key management. Drives /api/v1/b2b/keys: list, create (the full
 * key is shown exactly once, like TOTP recovery codes), and revoke.
 */
export const ApiKeysSheet: React.FC<ApiKeysSheetProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('list');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([...B2B_SCOPES]);
  const [fullKey, setFullKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  // Manual refresh used by button handlers (create/revoke). Calling setState
  // here is fine — it is outside an effect body.
  const load = async () => {
    setLoading(true);
    setError('');
    const res = await getApiLayer().b2b.listKeys();
    setLoading(false);
    if (res.success && res.data) setKeys(res.data);
    else setError(res.error?.message || '');
  };

  // Reset + initial load when the sheet opens. All setState lives inside the
  // async function (not the effect body) to avoid cascading-render warnings.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const run = async () => {
      setStep('list');
      setConfirmRevoke(null);
      setLoading(true);
      setError('');
      const res = await getApiLayer().b2b.listKeys();
      if (cancelled) return;
      setLoading(false);
      if (res.success && res.data) setKeys(res.data);
      else setError(res.error?.message || '');
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleClose = () => {
    setStep('list');
    setName('');
    setScopes([...B2B_SCOPES]);
    setFullKey('');
    setError('');
    setConfirmRevoke(null);
    onClose();
  };

  const create = async () => {
    if (!name.trim() || scopes.length === 0) return;
    setLoading(true);
    setError('');
    const res = await getApiLayer().b2b.createKey(name.trim(), scopes.join(','));
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error?.message || t('escrow_action_failed'));
      return;
    }
    setFullKey(res.data.full);
    setName('');
    setStep('reveal');
  };

  const revoke = async (id: string) => {
    setConfirmRevoke(null);
    const res = await getApiLayer().b2b.revokeKey(id);
    if (res.success) load();
    else setError(res.error?.message || '');
  };

  const copyFull = async () => {
    try {
      await navigator.clipboard.writeText(fullKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the key is still shown on screen */
    }
  };

  const toggleScope = (s: string) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title={t('apikeys_title')}>
      <div className="space-y-4">
        {step === 'list' && (
          <>
            <p className="uv-text-secondary text-sm">{t('apikeys_desc')}</p>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            {loading && <p className="uv-text-muted text-sm text-center">{t('loading')}</p>}

            {!loading && keys.length === 0 && (
              <div className="text-center py-6 uv-text-muted text-sm">{t('apikeys_empty')}</div>
            )}

            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="uv-surface-2 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold uv-text-primary text-sm truncate">{k.name}</p>
                      <p className="font-mono text-xs uv-text-muted truncate">{k.prefix}…</p>
                    </div>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                        k.status === 'active'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {k.status === 'active' ? t('apikeys_active') : t('apikeys_revoked')}
                    </span>
                  </div>
                  <p className="text-[11px] uv-text-muted mt-1 font-mono break-all">{k.scopes}</p>
                  {k.status === 'active' &&
                    (confirmRevoke === k.id ? (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => revoke(k.id)}
                          className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg text-xs font-semibold"
                        >
                          {t('apikeys_revoke')}
                        </button>
                        <button
                          onClick={() => setConfirmRevoke(null)}
                          className="flex-1 uv-surface-2 uv-text-primary py-2 rounded-lg text-xs font-semibold"
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRevoke(k.id)}
                        className="text-red-500 text-xs font-semibold mt-2"
                      >
                        {t('apikeys_revoke')}
                      </button>
                    ))}
                </div>
              ))}
            </div>

            <button
              onClick={() => setStep('create')}
              className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 uv-shadow-primary active:scale-[0.98] transition-all"
            >
              <Icons.Plus size={18} />
              {t('apikeys_new')}
            </button>
          </>
        )}

        {step === 'create' && (
          <>
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">
                {t('apikeys_name')}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('apikeys_name_hint')}
                className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">
                {t('apikeys_scopes')}
              </label>
              <div className="space-y-1.5">
                {B2B_SCOPES.map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleScope(s)}
                    className="w-full flex items-center justify-between uv-surface-2 rounded-lg px-3 py-2.5"
                  >
                    <span className="font-mono text-sm uv-text-primary">{s}</span>
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center ${
                        scopes.includes(s)
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'border border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
                      }`}
                    >
                      {scopes.includes(s) && <Icons.Check size={14} />}
                    </span>
                  </button>
                ))}
              </div>
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
                disabled={loading || !name.trim() || scopes.length === 0}
                className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                {loading ? t('loading') : t('apikeys_create_btn')}
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
              <h3 className="font-bold uv-text-primary">{t('apikeys_full_title')}</h3>
              <p className="uv-text-secondary text-sm mt-1">{t('apikeys_full_desc')}</p>
            </div>
            <p className="font-mono text-sm break-all uv-surface-2 rounded-xl px-3 py-3 uv-text-primary">
              {fullKey}
            </p>
            <button
              onClick={copyFull}
              className="w-full uv-surface-2 hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] uv-text-primary py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {copied ? <Icons.Check size={16} /> : <Icons.Copy size={16} />}
              {copied ? t('apikeys_copied') : t('apikeys_copy')}
            </button>
            <button
              onClick={() => {
                setFullKey('');
                setStep('list');
                load();
              }}
              className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold uv-shadow-primary active:scale-[0.98] transition-all"
            >
              {t('apikeys_done')}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
};
