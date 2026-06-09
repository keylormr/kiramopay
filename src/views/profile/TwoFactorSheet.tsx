import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { BottomSheet } from '../../components/BottomSheet';
import { Icons } from '../../components/Icons';
import { useLanguage } from '../../i18n/LanguageContext';
import { getApiLayer } from '@/api';

interface TwoFactorSheetProps {
  isOpen: boolean;
  enabled: boolean;
  onClose: () => void;
  onStatusChange: (enabled: boolean) => void;
}

type Step = 'intro' | 'scan' | 'recovery' | 'disable';

/**
 * Authenticator-app (TOTP) enrollment flow. Drives the backend
 * /api/v1/mfa/totp/* endpoints: enroll → confirm → recovery codes, plus disable.
 */
export const TwoFactorSheet: React.FC<TwoFactorSheetProps> = ({
  isOpen,
  enabled,
  onClose,
  onStatusChange,
}) => {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>(enabled ? 'disable' : 'intro');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setStep(enabled ? 'disable' : 'intro');
    setSecret('');
    setOtpauthUrl('');
    setCode('');
    setRecoveryCodes([]);
    setError('');
    setLoading(false);
    setCopied(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const startEnroll = async () => {
    setLoading(true);
    setError('');
    const res = await getApiLayer().mfa.totpEnroll();
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error?.message || t('twofa_invalid_code'));
      return;
    }
    setSecret(res.data.secret);
    setOtpauthUrl(res.data.otpauthUrl);
    setStep('scan');
  };

  const confirmEnroll = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    const res = await getApiLayer().mfa.totpConfirm(code);
    setLoading(false);
    if (!res.success || !res.data) {
      setError(t('twofa_invalid_code'));
      setCode('');
      return;
    }
    setRecoveryCodes(res.data.recoveryCodes);
    setStep('recovery');
  };

  const finishRecovery = () => {
    onStatusChange(true);
    handleClose();
  };

  const disable = async () => {
    if (code.length < 6) return;
    setLoading(true);
    setError('');
    const res = await getApiLayer().mfa.totpDisable(code);
    setLoading(false);
    if (!res.success) {
      setError(t('twofa_invalid_code'));
      setCode('');
      return;
    }
    onStatusChange(false);
    handleClose();
  };

  const copyRecovery = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — codes are still shown on screen */
    }
  };

  const codeInput = (onSubmit: () => void) => (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={9}
      value={code}
      onChange={(e) => {
        setCode(e.target.value.replace(/[^0-9A-Za-z-]/g, ''));
        setError('');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit();
      }}
      className="w-full text-center tracking-[0.3em] text-xl font-bold bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all"
      placeholder="000000"
      aria-label={t('twofa_enter_code')}
    />
  );

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={enabled ? t('twofa_disable_title') : t('two_factor_auth')}
    >
      <div className="space-y-5">
        {step === 'intro' && (
          <>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
                <Icons.Shield size={32} className="text-indigo-600" />
              </div>
              <p className="uv-text-secondary text-sm">{t('twofa_intro_desc')}</p>
            </div>
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <button
              onClick={startEnroll}
              disabled={loading}
              className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold disabled:opacity-50 uv-shadow-primary active:scale-[0.98] transition-all"
            >
              {loading ? t('loading') : t('twofa_enable_btn')}
            </button>
          </>
        )}

        {step === 'scan' && (
          <>
            <p className="uv-text-secondary text-sm text-center">{t('twofa_scan_instruction')}</p>
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-2xl">
                <QRCodeSVG value={otpauthUrl} size={180} />
              </div>
            </div>
            <div>
              <p className="text-xs uv-text-muted mb-1">{t('twofa_manual_key')}</p>
              <p className="font-mono text-sm break-all uv-surface-2 rounded-lg px-3 py-2 uv-text-primary">
                {secret}
              </p>
            </div>
            <div>
              <label className="text-sm text-gray-500 font-medium mb-2 block">
                {t('twofa_enter_code')}
              </label>
              {codeInput(confirmEnroll)}
              {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
            </div>
            <button
              onClick={confirmEnroll}
              disabled={loading || code.length !== 6}
              className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold disabled:opacity-50 uv-shadow-primary active:scale-[0.98] transition-all"
            >
              {loading ? t('loading') : t('twofa_verify')}
            </button>
          </>
        )}

        {step === 'recovery' && (
          <>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-3">
                <Icons.Check size={32} className="text-green-600" />
              </div>
              <h3 className="font-bold uv-text-primary">{t('twofa_recovery_title')}</h3>
              <p className="uv-text-secondary text-sm mt-1">{t('twofa_recovery_desc')}</p>
            </div>
            <div className="uv-surface-2 rounded-xl p-4 grid grid-cols-2 gap-2">
              {recoveryCodes.map((c) => (
                <span key={c} className="font-mono text-sm text-center uv-text-primary tracking-wider">
                  {c}
                </span>
              ))}
            </div>
            <button
              onClick={copyRecovery}
              className="w-full uv-surface-2 hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] uv-text-primary py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {copied ? <Icons.Check size={16} /> : <Icons.Copy size={16} />}
              {copied ? t('twofa_copied') : t('twofa_copy')}
            </button>
            <button
              onClick={finishRecovery}
              className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold uv-shadow-primary active:scale-[0.98] transition-all"
            >
              {t('twofa_recovery_done')}
            </button>
          </>
        )}

        {step === 'disable' && (
          <>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-3">
                <Icons.Shield size={32} className="text-red-600" />
              </div>
              <p className="uv-text-secondary text-sm">{t('twofa_disable_desc')}</p>
            </div>
            {codeInput(disable)}
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <button
              onClick={disable}
              disabled={loading || code.length < 6}
              className="w-full bg-red-500 hover:bg-red-600 text-white py-4 rounded-xl font-bold disabled:opacity-50 active:scale-[0.98] transition-all"
            >
              {loading ? t('loading') : t('twofa_disable_btn')}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
};
