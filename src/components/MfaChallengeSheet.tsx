import React, { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { getApiLayer } from '@/api';

interface MfaChallengeSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a TOTP code is successfully verified. The caller retries the action. */
  onVerified: () => void;
  /** MFA challenge purpose; defaults to the high-value-money gate. */
  purpose?: string;
}

/**
 * Shared TOTP challenge for high-value money actions. When an action returns
 * MFA_REQUIRED, the caller opens this sheet; on a verified code it records a
 * verified challenge server-side (purpose `high_value_tx`) and the caller
 * retries the original action, which now passes the backend MFA gate.
 */
export const MfaChallengeSheet: React.FC<MfaChallengeSheetProps> = ({
  isOpen,
  onClose,
  onVerified,
  purpose = 'high_value_tx',
}) => {
  const { t } = useLanguage();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setCode('');
    setError('');
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const verify = async () => {
    if (code.length < 6) return;
    setLoading(true);
    setError('');
    const res = await getApiLayer().mfa.totpVerify(code, purpose);
    setLoading(false);
    if (!res.success) {
      setError(res.error?.message || t('twofa_invalid_code'));
      setCode('');
      return;
    }
    reset();
    onVerified();
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title={t('mfa_challenge_title')}>
      <div className="space-y-5">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
            <Icons.Lock size={32} className="text-amber-600" />
          </div>
          <p className="uv-text-secondary text-sm">{t('mfa_challenge_desc')}</p>
        </div>
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
            if (e.key === 'Enter') verify();
          }}
          className="w-full text-center tracking-[0.3em] text-xl font-bold bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all"
          placeholder="000000"
          aria-label={t('twofa_enter_code')}
        />
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        <button
          onClick={verify}
          disabled={loading || code.length < 6}
          className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold disabled:opacity-50 uv-shadow-primary active:scale-[0.98] transition-all"
        >
          {loading ? t('loading') : t('twofa_verify')}
        </button>
      </div>
    </BottomSheet>
  );
};
