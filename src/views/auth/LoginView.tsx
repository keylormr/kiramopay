import React, { useState, useEffect } from 'react';
import { Icons } from '../../components/Icons';
import { MarcaKiramo } from '../../components/MarcaKiramo';
import { Button, Card } from '../../components/ui';
import { useAuthStore } from '@/stores/auth.store';
import { useSettingsStore } from '@/stores/settings.store';
import { clasificarIdentificador } from '@/utils/identificador';
import { biometricService } from '../../services/biometric';
import { useLanguage } from '../../i18n/LanguageContext';
import { User } from '../../types';
import { RecoverPasswordView } from './RecoverPasswordView';
import { Capacitor } from '@capacitor/core';

// Where the signed Android APK lives. Overridable via env; defaults to the
// GitHub Releases "latest" asset published by the android-apk CI workflow.
const ANDROID_APK_URL =
  import.meta.env.VITE_ANDROID_APK_URL ||
  'https://github.com/keylormr/kiramopay/releases/latest/download/kiramopay.apk';
// Only offer the download on the web — pointless inside the installed app.
const SHOW_APK_DOWNLOAD = !Capacitor.isNativePlatform();

interface LoginViewProps {
  onLogin: (user: User) => void;
  onRegister: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, onRegister }) => {
  const { t } = useLanguage();
  // Expulsion remota: si la sesion anterior se cerro porque un administrador
  // bloqueo la cuenta, esta pantalla lo dice en vez de parecer un logout mudo.
  const logoutReason = useAuthStore((s) => s.logoutReason);
  const clearLogoutReason = useAuthStore((s) => s.clearLogoutReason);
  // Un solo campo de entrada: cedula, correo o telefono. Se clasifica en vivo
  // para habilitar Continuar y mostrar que tipo se detecto.
  const [identificador, setIdentificador] = useState('');
  const [password, setPassword] = useState('');
  const [showPasswordStage, setShowPasswordStage] = useState(false);
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [showRecover, setShowRecover] = useState(false);
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

  const clasificado = clasificarIdentificador(identificador);

  const handleIdentificadorSubmit = () => {
    if (!clasificado) {
      setError(t('login_identifier_invalid'));
      return;
    }
    setError('');
    setShowPasswordStage(true);
  };

  const handleLogin = async (userIdentificador: string, userPassword: string) => {
    setIsLoading(true);
    setError('');

    const res = await useAuthStore.getState().login(userIdentificador, userPassword);
    if (res.success) {
      const user = useAuthStore.getState().user;
      if (user) {
        // Se guarda SIEMPRE la cedula del perfil (no lo tecleado): el
        // quick-login y la biometria releen este valor y la cedula es un
        // identificador que el backend acepta siempre, sin importar si hoy
        // se entro con correo o telefono.
        const cedulaPerfil = user.cedula || userIdentificador;
        localStorage.setItem('kiramopay_last_cedula', cedulaPerfil);
        localStorage.setItem('kiramopay_last_name', `${user.firstName} ${user.lastName}`);
        // Persist credentials to the OS Keychain/Keystore (native only; a no-op
        // on web, never localStorage) so the user can log in with fingerprint /
        // Face ID next time. Retrieved in handleBiometricLogin via getCredentials;
        // cleared when biometrics is disabled (see useApp TOGGLE_BIOMETRIC).
        // Atado a la PREFERENCIA, no solo al hardware: guardar con la
        // biometria desactivada deshacia en silencio el borrado de
        // credenciales que ese apagado acababa de hacer.
        if (biometricAvailable && useSettingsStore.getState().biometricEnabled) {
          void biometricService.setCredentials('kiramopay', cedulaPerfil, userPassword);
        }
        onLogin(user);
      }
    } else {
      setError(
        res.code === 'ACCOUNT_BLOCKED'
          ? t('login_account_blocked')
          : res.code === 'RATE_LIMITED'
            ? t('login_rate_limited')
            : res.code === 'INVALID_IDENTIFIER'
              ? t('login_identifier_invalid')
              : t('login_wrong_credentials'),
      );
      setPassword('');
    }
    setIsLoading(false);
  };

  const handleBiometricLogin = async () => {
    if (isLoading) return;
    if (!lastUser) return;

    try {
      const result = await biometricService.authenticate(t('login_biometric_prompt'));
      if (result.success) {
        const credentials = await biometricService.getCredentials('kiramopay');
        if (credentials?.password) {
          handleLogin(lastUser.cedula, credentials.password);
        } else {
          setIdentificador(lastUser.cedula);
          setShowPasswordStage(true);
        }
      } else {
        // authenticate() resuelve con success:false, nunca lanza: sin esta
        // rama, un sensor que fallaba cerraba el dialogo y la pantalla no
        // decia absolutamente nada.
        setError(t('login_biometric_failed'));
      }
    } catch {
      setError(t('login_biometric_failed'));
    }
  };

  const handleQuickLogin = () => {
    if (lastUser) {
      setIdentificador(lastUser.cedula);
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
            <MarcaKiramo size={30} />
          </div>
          <span className="text-2xl font-black text-white tracking-tight">KiramoPay</span>
        </div>
      </header>

      {/* Aviso de expulsion: la cuenta fue bloqueada por un administrador */}
      {logoutReason === 'blocked' && (
        <div
          role="alert"
          className="relative mx-6 mb-6 flex items-start gap-3 rounded-2xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-4 animate-slide-up"
        >
          <Icons.AlertTriangle size={22} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-white">{t('account_blocked_title')}</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary-dark)]">
              {t('account_blocked_body')}
            </p>
          </div>
          <button
            type="button"
            onClick={clearLogoutReason}
            aria-label={t('close')}
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-[var(--color-text-muted-dark)] hover:text-white hover:bg-white/10 transition-colors"
          >
            <Icons.X size={18} />
          </button>
        </div>
      )}

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
                    loading={isLoading}
                    disabled={isLoading}
                    onClick={handleBiometricLogin}
                    leftIcon={<Icons.Fingerprint size={18} />}
                    className="mt-3 !text-[var(--color-primary-300)] !bg-[var(--color-primary-soft)] hover:!bg-[var(--color-primary-soft)]"
                  >
                    {t('biometric_login')}
                  </Button>
                )}
              </Card>
            )}

            {/* Identifier input: cedula, correo o telefono en un solo campo */}
            <div className="mb-6">
              <label className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted-dark)] mb-2 block">
                {t('login_identifier_label')}
              </label>
              <div className="relative">
                <Icons.CardIcon
                  size={20}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted-dark)] pointer-events-none z-10"
                />
                <input
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  value={identificador}
                  onChange={(e) => {
                    setIdentificador(e.target.value);
                    setError('');
                  }}
                  placeholder={t('login_identifier_placeholder')}
                  className={`w-full h-14 pl-12 pr-4 rounded-xl text-white text-lg font-semibold placeholder:text-[var(--color-text-muted-dark)] placeholder:font-normal bg-[var(--color-surface-2-dark)] border ${
                    error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-dark)]'
                  } focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] outline-none transition-all`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && clasificado) handleIdentificadorSubmit();
                  }}
                />
              </div>
              {/* Tipo detectado en vivo: confirma sin estorbar */}
              {clasificado && !error && (
                <p className="text-[var(--color-text-muted-dark)] text-sm mt-2 flex items-center gap-1">
                  <Icons.Check size={14} className="text-[var(--color-success)]" />
                  {clasificado.tipo === 'cedula' && t('login_detected_cedula')}
                  {clasificado.tipo === 'correo' && t('login_detected_correo')}
                  {clasificado.tipo === 'telefono' && t('login_detected_telefono')}
                </p>
              )}
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
              onClick={handleIdentificadorSubmit}
              disabled={!clasificado || isLoading}
              rightIcon={<Icons.ArrowRight size={20} />}
            >
              {t('continue')}
            </Button>

            {/* Registro a un toque: antes solo existia el enlace del pie, bajo
                el pliegue en pantallas comunes. Quien llega sin cuenta debe
                verlo sin scroll. */}
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onRegister}
              className="mt-3 !bg-[var(--color-surface-2-dark)] !text-[var(--color-primary-300)] !border-[var(--color-border-dark)] hover:!bg-[var(--color-surface-3-dark)]"
            >
              {t('create_account')}
            </Button>

            {/* Demo credentials hint — dev builds only; never shipped to production. */}
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
              <span className="text-white">{identificador}</span>
            </p>

            {/* Password form — a real <form> so browsers/password managers can
                offer autofill and save (and to drop the "field not in a form"
                warning). The cedula rides along as the hidden username. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (password.length > 0 && !isLoading) handleLogin(identificador, password);
              }}
            >
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={clasificado?.canonico ?? identificador}
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
                    aria-label={showPasswordText ? t('hide_password') : t('show_password')}
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

            <button
              type="button"
              onClick={() => setShowRecover(true)}
              className="mt-4 w-full text-center text-[var(--color-primary-300)] hover:text-[var(--color-primary-200)] text-sm font-semibold transition-colors"
            >
              {t('recover_link')}
            </button>

            {/* Sin usuario recordado no hay credenciales que la huella pueda
                abrir: el boton aparecia en instalaciones frescas y no hacia
                nada al tocarlo. */}
            {biometricAvailable && lastUser && (
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

        {SHOW_APK_DOWNLOAD && (
          <a
            href={ANDROID_APK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 mx-auto flex w-fit items-center gap-2 rounded-xl border border-[var(--color-border-dark)] bg-[var(--color-surface-2-dark)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-secondary-dark)] hover:text-white hover:border-[var(--color-primary)] transition-colors"
          >
            <Icons.Download size={16} />
            {t('download_android_app')}
          </a>
        )}

        <p className="text-[var(--color-text-muted-dark)]/70 text-[11px] text-center mt-6 leading-relaxed">
          {t('login_terms')}
        </p>
      </footer>

      {showRecover && (
        <RecoverPasswordView
          // La recuperacion es por cedula; un correo o telefono tecleado aca
          // no debe pre-llenar ese campo.
          initialCedula={clasificado?.tipo === 'cedula' ? clasificado.canonico : ''}
          onClose={() => setShowRecover(false)}
        />
      )}
    </div>
  );
};
