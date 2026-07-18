import React, { useState } from 'react';
import { Icons } from '../../components/Icons';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '@/stores/auth.store';
import { useLanguage } from '../../i18n/LanguageContext';

interface RegisterViewProps {
  onComplete: () => void;
  onBack: () => void;
}

type Step = 'phone' | 'otp' | 'cedula' | 'name' | 'password';

const getPasswordStrength = (pwd: string): { labelKey: string; color: string; textColor: string; width: string } => {
  if (pwd.length === 0) return { labelKey: '', color: '', textColor: '', width: '0%' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 2) return { labelKey: 'password_weak', color: 'bg-red-500', textColor: 'text-red-400', width: '25%' };
  if (score <= 3) return { labelKey: 'password_medium', color: 'bg-yellow-500', textColor: 'text-yellow-400', width: '50%' };
  if (score <= 4) return { labelKey: 'password_good', color: 'bg-blue-500', textColor: 'text-blue-400', width: '75%' };
  return { labelKey: 'password_strong', color: 'bg-green-500', textColor: 'text-green-400', width: '100%' };
};

// Mirrors the backend policy (validator.ValidatePassword): >=8 chars with an
// uppercase, a lowercase, a digit and a special character. The frontend used to
// only require length >= 8, so ordinary passwords passed the UI and were then
// rejected by the server with a raw English 400 ("password must include ...") —
// which surfaced to users as a generic "error al crear la cuenta".
const isPasswordComplex = (pwd: string): boolean =>
  pwd.length >= 8 &&
  /[A-Z]/.test(pwd) &&
  /[a-z]/.test(pwd) &&
  /[0-9]/.test(pwd) &&
  /[^A-Za-z0-9]/.test(pwd);

export const RegisterView: React.FC<RegisterViewProps> = ({ onComplete, onBack }) => {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [cedula, setCedula] = useState({ type: 'nacional', part1: '', part2: '', part3: '' });
  const [name, setName] = useState({ firstName: '', lastName: '' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const register = useAuthStore((s) => s.register);

  const handleNext = () => {
    setIsLoading(true);
    setError('');
    setTimeout(() => {
      setIsLoading(false);
      switch (step) {
        case 'phone':
          setStep('otp');
          break;
        case 'otp':
          setStep('cedula');
          break;
        case 'cedula':
          setStep('name');
          break;
        case 'name':
          setStep('password');
          break;
      }
    }, 1000);
  };

  const handleRegister = async () => {
    if (password !== confirmPassword) {
      setError(t('passwords_dont_match'));
      return;
    }
    if (!isPasswordComplex(password)) {
      setError(t('password_requirements'));
      return;
    }

    setIsLoading(true);
    setError('');

    const fullCedula = `${cedula.part1}${cedula.part2}${cedula.part3}`;
    const result = await register({
      cedula: fullCedula,
      phone: `+506${phone}`,
      firstName: name.firstName,
      lastName: name.lastName,
      password,
    });

    setIsLoading(false);

    if (result.success) {
      onComplete();
    } else {
      setError(result.error || t('reg_error_default'));
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length <= 1) {
      const newOtp = [...otp];
      newOtp[index] = value;
      setOtp(newOtp);
      if (value && index < 5) {
        document.getElementById(`reg-otp-${index + 1}`)?.focus();
      }
    }
  };

  const strength = getPasswordStrength(password);

  const renderStep = () => {
    switch (step) {
      case 'phone':
        return (
          <div className="animate-in fade-in slide-in-from-right duration-300">
            <div className="w-16 h-16 uv-gradient-brand rounded-2xl flex items-center justify-center mb-6">
              <Icons.Phone size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-white mb-2">
              {t('reg_phone_title')}
            </h1>
            <p className="text-[var(--color-text-muted-dark)] mb-6">
              {t('reg_phone_desc')}
            </p>

            <div className="flex gap-3 mb-6">
              <div className="flex items-center gap-2 bg-[var(--color-surface-2-dark)] px-4 py-4 rounded-xl border border-[var(--color-border-dark)]">
                <span className="text-xl">🇨🇷</span>
                <span className="text-white font-medium">+506</span>
              </div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="8888-0000"
                className="flex-1 bg-[var(--color-surface-2-dark)] px-4 py-4 rounded-xl border border-[var(--color-border-dark)] text-white text-lg font-medium placeholder:text-[var(--color-text-muted-dark)] outline-none focus:border-[var(--color-primary)] transition-colors"
                autoFocus
              />
            </div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleNext}
              loading={isLoading}
              disabled={phone.length < 8}
            >
              {t('continue')}
            </Button>
          </div>
        );

      case 'otp':
        return (
          <div className="animate-in fade-in slide-in-from-right duration-300">
            <div className="w-16 h-16 uv-gradient-brand rounded-2xl flex items-center justify-center mb-6">
              <Icons.Shield size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-white mb-2">
              {t('reg_verify_title')}
            </h1>
            <p className="text-[var(--color-text-muted-dark)] mb-6">
              {t('reg_code_sent_to')} +506 {phone}
            </p>

            <div className="flex gap-2 justify-center mb-6">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  id={`reg-otp-${index}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  className="w-11 h-14 bg-[var(--color-surface-2-dark)] border-2 border-[var(--color-border-dark)] rounded-xl text-center text-xl font-bold text-white outline-none focus:border-[var(--color-primary)]"
                />
              ))}
            </div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleNext}
              loading={isLoading}
              disabled={otp.some(d => !d)}
            >
              {t('verify')}
            </Button>
          </div>
        );

      case 'cedula':
        return (
          <div className="animate-in fade-in slide-in-from-right duration-300">
            <div className="w-16 h-16 uv-gradient-brand rounded-2xl flex items-center justify-center mb-6">
              <Icons.User size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-white mb-2">
              {t('reg_cedula_title')}
            </h1>
            <p className="text-[var(--color-text-muted-dark)] mb-6">
              {t('reg_cedula_desc')}
            </p>

            {/* Tipo de cedula */}
            <div className="flex gap-2 mb-4">
              {[
                { id: 'nacional', label: t('reg_cedula_nacional') },
                { id: 'residente', label: t('reg_cedula_residente') },
                { id: 'dimex', label: t('reg_cedula_dimex') },
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => setCedula({ ...cedula, type: type.id })}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                    cedula.type === type.id
                      ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'
                      : 'bg-[var(--color-surface-2-dark)] text-[var(--color-text-muted-dark)]'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>

            {/* Cedula input */}
            <div className="flex gap-2 mb-6">
              <input
                type="text"
                value={cedula.part1}
                onChange={(e) => setCedula({ ...cedula, part1: e.target.value.replace(/\D/g, '').slice(0, 1) })}
                placeholder="1"
                className="w-14 bg-[var(--color-surface-2-dark)] px-4 py-4 rounded-xl border border-[var(--color-border-dark)] text-white text-lg font-medium text-center outline-none focus:border-[var(--color-primary)]"
              />
              <span className="text-[var(--color-text-muted-dark)] self-center text-2xl">-</span>
              <input
                type="text"
                value={cedula.part2}
                onChange={(e) => setCedula({ ...cedula, part2: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                placeholder="1234"
                className="flex-1 bg-[var(--color-surface-2-dark)] px-4 py-4 rounded-xl border border-[var(--color-border-dark)] text-white text-lg font-medium text-center outline-none focus:border-[var(--color-primary)]"
              />
              <span className="text-[var(--color-text-muted-dark)] self-center text-2xl">-</span>
              <input
                type="text"
                value={cedula.part3}
                onChange={(e) => setCedula({ ...cedula, part3: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                placeholder="5678"
                className="flex-1 bg-[var(--color-surface-2-dark)] px-4 py-4 rounded-xl border border-[var(--color-border-dark)] text-white text-lg font-medium text-center outline-none focus:border-[var(--color-primary)]"
              />
            </div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleNext}
              loading={isLoading}
              disabled={!cedula.part1 || cedula.part2.length < 4 || cedula.part3.length < 4}
            >
              {t('continue')}
            </Button>
          </div>
        );

      case 'name':
        return (
          <div className="animate-in fade-in slide-in-from-right duration-300">
            <div className="w-16 h-16 uv-gradient-brand rounded-2xl flex items-center justify-center mb-6">
              <Icons.Edit size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-white mb-2">
              {t('reg_name_title')}
            </h1>
            <p className="text-[var(--color-text-muted-dark)] mb-6">
              {t('reg_name_desc')}
            </p>

            <div className="space-y-4 mb-6">
              <input
                type="text"
                value={name.firstName}
                onChange={(e) => setName({ ...name, firstName: e.target.value })}
                placeholder={t('first_name')}
                className="w-full bg-[var(--color-surface-2-dark)] px-4 py-4 rounded-xl border border-[var(--color-border-dark)] text-white text-lg font-medium placeholder:text-[var(--color-text-muted-dark)] outline-none focus:border-[var(--color-primary)]"
                autoFocus
              />
              <input
                type="text"
                value={name.lastName}
                onChange={(e) => setName({ ...name, lastName: e.target.value })}
                placeholder={t('last_name')}
                className="w-full bg-[var(--color-surface-2-dark)] px-4 py-4 rounded-xl border border-[var(--color-border-dark)] text-white text-lg font-medium placeholder:text-[var(--color-text-muted-dark)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleNext}
              loading={isLoading}
              disabled={!name.firstName || !name.lastName}
            >
              {t('continue')}
            </Button>
          </div>
        );

      case 'password':
        return (
          <div className="animate-in fade-in slide-in-from-right duration-300">
            <div className="w-16 h-16 uv-gradient-brand rounded-2xl flex items-center justify-center mb-6">
              <Icons.Lock size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-white mb-2">
              {t('reg_password_title')}
            </h1>
            <p className="text-[var(--color-text-muted-dark)] mb-6">
              {t('reg_password_desc')}
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="text-sm text-[var(--color-text-muted-dark)] mb-2 block">{t('password')}</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder={t('password')}
                    className="w-full bg-[var(--color-surface-2-dark)] px-4 pr-12 py-4 rounded-xl border border-[var(--color-border-dark)] text-white text-lg font-medium placeholder:text-[var(--color-text-muted-dark)] outline-none focus:border-[var(--color-primary)]"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted-dark)] hover:text-white"
                  >
                    {showPassword ? <Icons.EyeOff size={20} /> : <Icons.Eye size={20} />}
                  </button>
                </div>

                {/* Password strength indicator */}
                {password.length > 0 && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-[var(--color-surface-3-dark)] rounded-full overflow-hidden">
                      <div
                        className={`h-full ${strength.color} transition-all duration-300`}
                        style={{ width: strength.width }}
                      />
                    </div>
                    <p className={`text-xs mt-1 ${strength.textColor}`}>
                      {t(strength.labelKey)}
                    </p>
                  </div>
                )}
                {/* Show the exact policy so users don't hit the backend 400 */}
                {password.length > 0 && !isPasswordComplex(password) && (
                  <p className="text-xs mt-1.5 text-[var(--color-text-muted-dark)]">
                    {t('password_requirements')}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm text-[var(--color-text-muted-dark)] mb-2 block">{t('confirm_password')}</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setError('');
                    }}
                    placeholder={t('confirm_password')}
                    className={`w-full bg-[var(--color-surface-2-dark)] px-4 pr-12 py-4 rounded-xl border text-white text-lg font-medium placeholder:text-[var(--color-text-muted-dark)] outline-none transition-colors ${
                      confirmPassword && password !== confirmPassword ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-dark)] focus:border-[var(--color-primary)]'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted-dark)] hover:text-white"
                  >
                    {showConfirmPassword ? <Icons.EyeOff size={20} /> : <Icons.Eye size={20} />}
                  </button>
                </div>
              </div>

              {confirmPassword && password !== confirmPassword && (
                <p className="text-[var(--color-danger)] text-sm">{t('passwords_dont_match')}</p>
              )}
              {error && (
                <p className="text-[var(--color-danger)] text-sm flex items-center gap-1">
                  <Icons.AlertCircle size={14} />
                  {error}
                </p>
              )}
            </div>

            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleRegister}
              loading={isLoading}
              disabled={!isPasswordComplex(password) || password !== confirmPassword}
              rightIcon={<Icons.Check size={20} />}
            >
              {t('create_account')}
            </Button>
          </div>
        );
    }
  };

  const getProgress = () => {
    const steps: Step[] = ['phone', 'otp', 'cedula', 'name', 'password'];
    return ((steps.indexOf(step) + 1) / steps.length) * 100;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[var(--color-background-dark)] to-[var(--color-surface-1-dark)] flex flex-col">
      {/* Header */}
      <div className="p-4 pt-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={step === 'phone' ? onBack : () => {
              const steps: Step[] = ['phone', 'otp', 'cedula', 'name', 'password'];
              const currentIndex = steps.indexOf(step);
              if (currentIndex > 0) setStep(steps[currentIndex - 1]);
            }}
            className="p-2 -ml-2 text-[var(--color-text-muted-dark)] hover:text-white transition-colors"
          >
            <Icons.ChevronLeft size={24} />
          </button>
          <span className="text-[var(--color-text-muted-dark)] text-sm">{t('create_account')}</span>
          <div className="w-8" />
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-[var(--color-surface-3-dark)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
            style={{ width: `${getProgress()}%` }}
          />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 px-6 pt-8">
        {renderStep()}
      </div>

      {/* Security note */}
      <div className="p-6 pb-8">
        <div className="flex items-center gap-3 bg-[var(--color-surface-2-dark)]/50 p-4 rounded-xl">
          <Icons.Shield size={20} className="text-green-500" />
          <p className="text-[var(--color-text-muted-dark)] text-xs">
            {t('reg_security_note')}
          </p>
        </div>
      </div>
    </div>
  );
};
