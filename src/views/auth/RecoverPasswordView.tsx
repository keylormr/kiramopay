import React, { useEffect, useState } from 'react';
import { Icons } from '../../components/Icons';
import { Button } from '../../components/ui';
import { useLanguage } from '../../i18n/LanguageContext';
import { getApiLayer } from '@/api';

interface RecoverPasswordViewProps {
  onClose: () => void;
  /** Pre-fills the cédula field (e.g. the one already typed on the login screen). */
  initialCedula?: string;
}

type Step = 'request' | 'reset' | 'done';

// Mirrors backend pkg/validator.ValidatePassword so we can fail fast with clear
// guidance instead of round-tripping to learn the password is too weak.
function passwordMeetsPolicy(pwd: string): boolean {
  if (pwd.length < 8) return false;
  return /[A-Z]/.test(pwd) && /[a-z]/.test(pwd) && /\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
}

const inputClass = (invalid: boolean) =>
  `w-full h-14 px-4 rounded-xl text-white text-lg font-semibold placeholder:text-[var(--color-text-muted-dark)] placeholder:font-normal bg-[var(--color-surface-2-dark)] border ${
    invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-dark)]'
  } focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] outline-none transition-all`;

export const RecoverPasswordView: React.FC<RecoverPasswordViewProps> = ({
  onClose,
  initialCedula = '',
}) => {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('request');
  const [cedula, setCedula] = useState(initialCedula.replace(/\D/g, '').slice(0, 12));
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);

  // Escape closes the overlay, mirroring the rest of the app's sheets.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleRequest = async () => {
    if (cedula.length < 9 || isLoading) return;
    setError('');
    setIsLoading(true);
    const res = await getApiLayer().auth.forgotPassword(cedula);
    setIsLoading(false);
    if (!res.success) {
      setError(res.error?.code === 'RATE_LIMITED' ? t('login_rate_limited') : t('recover_error_generic'));
      return;
    }
    // Dev-environment convenience only — the backend never returns this in prod,
    // and we only surface it behind import.meta.env.DEV.
    if (import.meta.env.DEV && res.data?.devToken) {
      setDevToken(res.data.devToken);
      setToken(res.data.devToken);
    }
    // Always advance regardless of whether the account exists (anti-enumeration).
    setStep('reset');
  };

  const handleReset = async () => {
    if (isLoading) return;
    setError('');
    if (!token.trim()) {
      setError(t('recover_invalid_token'));
      return;
    }
    if (!passwordMeetsPolicy(newPassword)) {
      setError(t('reg_password_desc'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('passwords_dont_match'));
      return;
    }
    setIsLoading(true);
    const res = await getApiLayer().auth.resetPassword(token.trim(), newPassword);
    setIsLoading(false);
    if (!res.success) {
      if (res.error?.code === 'VALIDATION_ERROR') setError(t('reg_password_desc'));
      else if (res.error?.code === 'RATE_LIMITED') setError(t('login_rate_limited'));
      else setError(t('recover_invalid_token'));
      return;
    }
    setStep('done');
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[var(--color-background-dark)] animate-fade-in-scale">
      {/* Ambient glow, matching the login screen */}
      <div
        className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[120%] h-[60%] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(closest-side, rgba(45,123,255,0.28) 0%, rgba(45,123,255,0.06) 50%, transparent 80%)',
          filter: 'blur(20px)',
        }}
      />

      <header className="relative px-6 pt-12 pb-2 pt-safe">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-[var(--color-text-secondary-dark)] hover:text-white transition-colors -ml-1"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
          <span className="text-sm font-semibold">{t('back')}</span>
        </button>
      </header>

      <main className="relative flex-1 px-6 pt-6 overflow-y-auto">
        {step === 'request' && (
          <div className="animate-slide-up">
            <div className="w-14 h-14 rounded-2xl uv-gradient-brand flex items-center justify-center uv-shadow-primary mb-6">
              <Icons.Lock size={26} className="text-white" />
            </div>
            <h1 className="text-[1.75rem] leading-tight font-black text-white mb-2 tracking-tight">
              {t('recover_title')}
            </h1>
            <p className="text-[var(--color-text-secondary-dark)] mb-8">{t('recover_subtitle')}</p>

            <label htmlFor="recover-cedula" className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted-dark)] mb-2 block">
              {t('cedula_label')}
            </label>
            <div className="relative mb-2">
              <Icons.CardIcon
                size={20}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted-dark)] pointer-events-none z-10"
              />
              <input
                id="recover-cedula"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={cedula}
                onChange={(e) => {
                  setCedula(e.target.value.replace(/\D/g, '').slice(0, 12));
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cedula.length >= 9) handleRequest();
                }}
                placeholder={t('cedula_placeholder')}
                className={`${inputClass(!!error)} pl-12 tabular-nums tracking-wider`}
              />
            </div>

            {error && (
              <p role="alert" className="text-[var(--color-danger)] text-sm mb-2 flex items-center gap-1 animate-shake">
                <Icons.AlertCircle size={14} />
                {error}
              </p>
            )}

            <Button
              size="lg"
              fullWidth
              onClick={handleRequest}
              loading={isLoading}
              disabled={cedula.length < 9 || isLoading}
              rightIcon={<Icons.ArrowRight size={20} />}
              className="mt-4"
            >
              {isLoading ? t('recover_sending') : t('recover_send')}
            </Button>

            <button
              onClick={() => {
                setError('');
                setStep('reset');
              }}
              className="mt-6 w-full text-center text-[var(--color-primary-300)] hover:text-[var(--color-primary-200)] text-sm font-semibold transition-colors"
            >
              {t('recover_have_code')}
            </button>
          </div>
        )}

        {step === 'reset' && (
          <div className="animate-slide-up">
            <div className="w-14 h-14 rounded-2xl uv-gradient-brand flex items-center justify-center uv-shadow-primary mb-6">
              <Icons.Shield size={26} className="text-white" />
            </div>
            <h1 className="text-[1.75rem] leading-tight font-black text-white mb-2 tracking-tight">
              {t('recover_reset_title')}
            </h1>
            <p className="text-[var(--color-text-secondary-dark)] mb-6">{t('recover_reset_subtitle')}</p>

            <div className="mb-4 p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex items-start gap-2.5">
              <Icons.Mail size={16} className="text-[var(--color-primary-300)] mt-0.5 shrink-0" />
              <p className="text-[13px] text-[var(--color-text-secondary-dark)] leading-relaxed">
                {t('recover_sent_desc')}
              </p>
            </div>

            {devToken && (
              <div className="mb-4 p-3 rounded-xl bg-[var(--color-warning-soft)] border border-[var(--color-warning)]/30">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-warning)] mb-1">
                  {t('recover_dev_hint')}
                </p>
                <p className="text-[11px] font-mono break-all text-[var(--color-text-secondary-dark)]">{devToken}</p>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleReset();
              }}
            >
              <label htmlFor="recover-token" className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted-dark)] mb-2 block">
                {t('recover_token_label')}
              </label>
              <input
                id="recover-token"
                type="text"
                autoComplete="one-time-code"
                autoFocus
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setError('');
                }}
                placeholder={t('recover_token_placeholder')}
                className={`${inputClass(false)} mb-4 font-mono text-base`}
              />

              <label htmlFor="recover-new-password" className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted-dark)] mb-2 block">
                {t('new_password')}
              </label>
              <div className="relative mb-2">
                <input
                  id="recover-new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setError('');
                  }}
                  placeholder={t('password')}
                  className={`${inputClass(false)} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted-dark)] hover:text-white transition-colors"
                  aria-label={showPassword ? t('hide_password') : t('show_password')}
                >
                  {showPassword ? <Icons.EyeOff size={20} /> : <Icons.Eye size={20} />}
                </button>
              </div>
              <p className="text-[11px] text-[var(--color-text-muted-dark)] mb-4">{t('reg_password_desc')}</p>

              <label htmlFor="recover-confirm-password" className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted-dark)] mb-2 block">
                {t('confirm_password')}
              </label>
              <input
                id="recover-confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError('');
                }}
                placeholder={t('confirm_password')}
                className={inputClass(!!confirmPassword && newPassword !== confirmPassword)}
              />

              {error && (
                <p role="alert" className="text-[var(--color-danger)] text-sm mt-3 flex items-center gap-1 animate-shake">
                  <Icons.AlertCircle size={14} />
                  {error}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={isLoading}
                disabled={isLoading || !token.trim() || newPassword.length < 8 || newPassword !== confirmPassword}
                className="mt-5"
              >
                {isLoading ? t('recover_submitting') : t('recover_submit')}
              </Button>
            </form>
          </div>
        )}

        {step === 'done' && (
          <div className="animate-slide-up flex flex-col items-center text-center pt-10">
            <div className="w-20 h-20 rounded-full bg-[var(--color-success-soft)] flex items-center justify-center mb-6">
              <Icons.Check size={40} className="text-[var(--color-success)]" />
            </div>
            <h1 className="text-2xl font-black text-white mb-2 tracking-tight">{t('recover_success_title')}</h1>
            <p className="text-[var(--color-text-secondary-dark)] mb-8 max-w-xs">{t('recover_success_desc')}</p>
            <Button size="lg" fullWidth onClick={onClose}>
              {t('recover_back_to_login')}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
};
