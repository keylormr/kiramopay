import React, { useState, useEffect } from 'react';
import { Icons } from '../../components/Icons';
import { Button, Card } from '../../components/ui';
import { useAuthStore } from '@/stores/auth.store';
import { biometricService } from '../../services/biometric';
import { useLanguage } from '../../i18n/LanguageContext';
import { User } from '../../types';

interface LoginViewProps {
  onLogin: (user: User) => void;
  onRegister: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, onRegister }) => {
  const { t } = useLanguage();
  const [cedula, setCedula] = useState('');
  const [password, setPassword] = useState('');
  const [showPasswordStage, setShowPasswordStage] = useState(false);
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [lastUser] = useState<{ cedula: string; name: string } | null>(() => {
    const savedCedula = localStorage.getItem('kiramopay_last_cedula');
    const savedName = localStorage.getItem('kiramopay_last_name');
    return savedCedula && savedName ? { cedula: savedCedula, name: savedName } : null;
  });

  useEffect(() => {
    const checkBiometric = async () => {
      const result = await biometricService.checkAvailability();
      setBiometricAvailable(result.isAvailable);
    };
    checkBiometric();
  }, []);

  const handleCedulaSubmit = () => {
    setError('');
    setShowPasswordStage(true);
  };

  const handleLogin = async (userCedula: string, userPassword: string) => {
    setIsLoading(true);
    setError('');

    const res = await useAuthStore.getState().login(userCedula, userPassword);
    if (res.success) {
      const user = useAuthStore.getState().user;
      if (user) {
        localStorage.setItem('kiramopay_last_cedula', userCedula);
        localStorage.setItem('kiramopay_last_name', `${user.firstName} ${user.lastName}`);
        onLogin(user);
      }
    } else {
      setError(res.code === 'RATE_LIMITED' ? t('login_rate_limited') : t('login_wrong_credentials'));
      setPassword('');
    }
    setIsLoading(false);
  };

  const handleBiometricLogin = async () => {
    if (!lastUser) return;

    try {
      const result = await biometricService.authenticate(t('login_biometric_prompt'));
      if (result.success) {
        const credentials = await biometricService.getCredentials('kiramopay');
        if (credentials?.password) {
          handleLogin(lastUser.cedula, credentials.password);
        } else {
          setCedula(lastUser.cedula);
          setShowPasswordStage(true);
        }
      }
    } catch {
      setError(t('login_biometric_failed'));
    }
  };

  const handleQuickLogin = () => {
    if (lastUser) {
      setCedula(lastUser.cedula);
      setShowPasswordStage(true);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col bg-[var(--color-background-dark)]">
      {/* Ambient glow — places focus behind the brand mark */}
      <div
        className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[120%] h-[60%] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(closest-side, rgba(45,123,255,0.28) 0%, rgba(45,123,255,0.06) 50%, transparent 80%)',
          filter: 'blur(20px)',
        }}
      />

      {/* Brand mark */}
      <header className="relative px-6 pt-12 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 uv-gradient-brand rounded-2xl flex items-center justify-center uv-shadow-primary">
            <span className="text-2xl font-black text-white">K</span>
          </div>
          <span className="text-2xl font-black text-white tracking-tight">KiramoPay</span>
        </div>
      </header>

      {/* Main content */}
      <main className="relative flex-1 px-6">
        {!showPasswordStage ? (
          <div className="animate-slide-up">
            <h1 className="text-[2rem] leading-tight font-black text-white mb-2 tracking-tight">
              {t('login_welcome')}
            </h1>
            <p className="text-[var(--color-text-secondary-dark)] mb-8">
              {t('login_enter_cedula')}
            </p>

            {/* Quick login card for returning user */}
            {lastUser && (
              <Card
                elevation={1}
                padding="md"
                variant="default"
                className="mb-6 !bg-[var(--color-surface-2-dark)] !border-[var(--color-border-dark)]"
              >
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted-dark)] mb-3">
                  {t('login_last_access')}
                </p>
                <button
                  onClick={handleQuickLogin}
                  className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-[var(--color-surface-3-dark)] transition-colors text-left"
                >
                  <div className="w-12 h-12 uv-gradient-brand rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0">
                    {lastUser.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold truncate">{lastUser.name}</p>
                    <p className="text-[var(--color-text-muted-dark)] text-sm truncate">
                      {t('cedula')}: {lastUser.cedula}
                    </p>
                  </div>
                  <Icons.ChevronRight size={20} className="text-[var(--color-text-muted-dark)] shrink-0" />
                </button>

                {biometricAvailable && (
                  <Button
                    variant="ghost"
                    fullWidth
                    onClick={handleBiometricLogin}
                    leftIcon={<Icons.Fingerprint size={18} />}
                    className="mt-3 !text-[var(--color-primary-300)] !bg-[var(--color-primary-soft)] hover:!bg-[var(--color-primary-soft)]"
                  >
                    {t('biometric_login')}
                  </Button>
                )}
              </Card>
            )}

            {/* Cedula input */}
            <div className="mb-6">
              <label className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted-dark)] mb-2 block">
                {t('cedula_label')}
              </label>
              <div className="relative">
                <Icons.CardIcon
                  size={20}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted-dark)] pointer-events-none z-10"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  value={cedula}
                  onChange={(e) => {
                    setCedula(e.target.value.replace(/\D/g, '').slice(0, 12));
                    setError('');
                  }}
                  placeholder={t('cedula_placeholder')}
                  className={`w-full h-14 pl-12 pr-4 rounded-xl text-white text-lg font-semibold placeholder:text-[var(--color-text-muted-dark)] placeholder:font-normal bg-[var(--color-surface-2-dark)] border ${
                    error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-dark)]'
                  } focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] outline-none transition-all tabular-nums tracking-wider`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && cedula.length >= 9) handleCedulaSubmit();
                  }}
                />
              </div>
              {error && (
                <p className="text-[var(--color-danger)] text-sm mt-2 flex items-center gap-1 animate-shake">
                  <Icons.AlertCircle size={14} />
                  {error}
                </p>
              )}
            </div>

            {/* Continue button */}
            <Button
              size="lg"
              fullWidth
              onClick={handleCedulaSubmit}
              disabled={cedula.length < 9 || isLoading}
              rightIcon={<Icons.ArrowRight size={20} />}
            >
              {t('continue')}
            </Button>

            {/* Demo credentials hint — DEV builds only; never shipped to production. */}
            {import.meta.env.DEV && (
              <div className="mt-8 p-3.5 rounded-xl bg-white/[0.04] border border-white/10">
                <p className="text-[var(--color-primary-300)] text-xs font-semibold uppercase tracking-wider mb-2">
                  Usuarios de prueba
                </p>
                <div className="space-y-1 text-[11px] text-[var(--color-text-muted-dark)] font-mono">
                  <p>702650930 · Kiramopay2024!</p>
                  <p>700000000 · Admin2024!</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="animate-slide-up">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowPasswordStage(false);
                setPassword('');
                setError('');
              }}
              leftIcon={<Icons.ChevronLeft size={18} />}
              className="mb-6 !text-[var(--color-text-secondary-dark)] hover:!text-white !pl-0"
            >
              {t('login_change_cedula')}
            </Button>

            <h1 className="text-[2rem] leading-tight font-black text-white mb-2 tracking-tight">
              {t('login_password_title')}
            </h1>
            <p className="text-[var(--color-text-secondary-dark)] mb-8 font-mono text-sm">
              {t('cedula')}: <span className="text-white">{cedula}</span>
            </p>

            {/* Password form — a real <form> so browsers/password managers can
                offer autofill and save (and to drop the "field not in a form"
                warning). The cedula rides along as the hidden username. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (password.length > 0 && !isLoading) handleLogin(cedula, password);
              }}
            >
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={cedula}
                readOnly
                hidden
              />
              <div className="mb-6">
                <div className="relative">
                  <Icons.Lock
                    size={20}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted-dark)] pointer-events-none z-10"
                  />
                  <input
                    type={showPasswordText ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder={t('password')}
                    autoFocus
                    className={`w-full h-14 pl-12 pr-12 rounded-xl text-white text-lg font-semibold placeholder:text-[var(--color-text-muted-dark)] placeholder:font-normal bg-[var(--color-surface-2-dark)] border ${
                      error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-dark)]'
                    } focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] outline-none transition-all`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted-dark)] hover:text-white transition-colors"
                    aria-label={showPasswordText ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPasswordText ? <Icons.EyeOff size={20} /> : <Icons.Eye size={20} />}
                  </button>
                </div>
                {error && (
                  <p className="text-[var(--color-danger)] text-sm mt-2 flex items-center gap-1 animate-shake">
                    <Icons.AlertCircle size={14} />
                    {error}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={isLoading}
                disabled={password.length === 0 || isLoading}
              >
                {isLoading ? t('login_verifying') : t('login_enter')}
              </Button>
            </form>

            {biometricAvailable && (
              <Button
                variant="secondary"
                fullWidth
                onClick={handleBiometricLogin}
                disabled={isLoading}
                leftIcon={<Icons.Fingerprint size={20} />}
                className="mt-4 !bg-[var(--color-surface-2-dark)] !text-[var(--color-text-secondary-dark)] !border-[var(--color-border-dark)] hover:!bg-[var(--color-surface-3-dark)]"
              >
                {t('biometric_login')}
              </Button>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative px-6 pb-8 pt-6">
        <div className="text-center">
          <p className="text-[var(--color-text-muted-dark)] text-sm mb-1">{t('login_no_account')}</p>
          <button
            onClick={onRegister}
            className="text-[var(--color-primary-300)] hover:text-[var(--color-primary-200)] font-bold text-lg transition-colors"
          >
            {t('create_account')}
          </button>
        </div>

        <p className="text-[var(--color-text-muted-dark)]/70 text-[11px] text-center mt-6 leading-relaxed">
          {t('login_terms')}
        </p>
      </footer>
    </div>
  );
};
