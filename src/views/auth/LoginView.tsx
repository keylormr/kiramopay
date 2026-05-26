import React, { useState, useEffect } from 'react';
import { Icons } from '../../components/Icons';
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

    const success = await useAuthStore.getState().login(userCedula, userPassword);
    if (success) {
      const user = useAuthStore.getState().user;
      if (user) {
        localStorage.setItem('kiramopay_last_cedula', userCedula);
        localStorage.setItem('kiramopay_last_name', `${user.firstName} ${user.lastName}`);
        onLogin(user);
      }
    } else {
      setError(t('login_wrong_credentials'));
      setPassword('');
    }
    setIsLoading(false);
  };

  const handleBiometricLogin = async () => {
    if (!lastUser) return;

    try {
      const result = await biometricService.authenticate(t('login_biometric_prompt'));
      if (result.success) {
        // Obtener credenciales guardadas
        const credentials = await biometricService.getCredentials('kiramopay');
        if (credentials?.password) {
          // Login con PIN guardado
          handleLogin(lastUser.cedula, credentials.password);
        } else {
          // Fallback: mostrar password
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
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col">
      {/* Header */}
      <div className="p-6 pt-12">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center shadow-lg shadow-accent/20">
            <span className="text-2xl font-black text-white">K</span>
          </div>
          <span className="text-2xl font-black text-white">KiramoPay</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 px-6 pt-8">
        {!showPasswordStage ? (
          <div className="animate-in fade-in slide-in-from-right duration-300">
            <h1 className="text-3xl font-black text-white mb-2">
              {t('login_welcome')}
            </h1>
            <p className="text-gray-400 mb-8">
              {t('login_enter_cedula')}
            </p>

            {/* Quick login para usuario anterior */}
            {lastUser && (
              <div className="mb-6 p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
                <p className="text-gray-400 text-sm mb-3">{t('login_last_access')}</p>
                <button
                  onClick={handleQuickLogin}
                  className="w-full flex items-center gap-4 p-3 bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors"
                >
                  <div className="w-12 h-12 bg-gradient-to-br from-primary to-accent rounded-full flex items-center justify-center text-white font-bold text-lg">
                    {lastUser.name.charAt(0)}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-white font-semibold">{lastUser.name}</p>
                    <p className="text-gray-500 text-sm">{t('cedula')}: {lastUser.cedula}</p>
                  </div>
                  <Icons.ChevronRight size={20} className="text-gray-500" />
                </button>

                {biometricAvailable && (
                  <button
                    onClick={handleBiometricLogin}
                    className="w-full mt-3 flex items-center justify-center gap-2 py-3 bg-primary/20 text-primary rounded-xl hover:bg-primary/30 transition-colors"
                  >
                    <Icons.Fingerprint size={20} />
                    {t('biometric_login')}
                  </button>
                )}
              </div>
            )}

            {/* Cedula input */}
            <div className="mb-6">
              <label className="text-sm text-gray-400 font-medium mb-2 block">
                {t('cedula_label')}
              </label>
              <div className="relative">
                <Icons.CardIcon size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={cedula}
                  onChange={(e) => {
                    setCedula(e.target.value.replace(/\D/g, '').slice(0, 12));
                    setError('');
                  }}
                  placeholder={t('cedula_placeholder')}
                  className="w-full bg-slate-800 pl-12 pr-4 py-4 rounded-xl border border-slate-700 text-white text-lg font-medium placeholder-gray-500 outline-none focus:border-primary transition-colors"
                />
              </div>
              {error && (
                <p className="text-red-400 text-sm mt-2 flex items-center gap-1">
                  <Icons.AlertCircle size={14} />
                  {error}
                </p>
              )}
            </div>

            {/* Continue button */}
            <button
              onClick={handleCedulaSubmit}
              disabled={cedula.length < 9 || isLoading}
              className="w-full bg-gradient-to-r from-primary to-blue-600 text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-95 transition-all"
            >
              {t('continue')}
              <Icons.ArrowRight size={20} />
            </button>

            {/* Demo info */}
            <div className="mt-6 p-4 bg-blue-900/20 border border-blue-800/50 rounded-xl">
              <p className="text-blue-400 text-sm font-medium mb-2">Usuarios de prueba:</p>
              <div className="space-y-1 text-xs text-blue-300/80">
                <p>Cedula: 702650930 | Contrasena: Kiramopay2024!</p>
                <p>Cedula: 700000000 | Contrasena: Admin2024!</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-right duration-300">
            <button
              onClick={() => {
                setShowPasswordStage(false);
                setPassword('');
                setError('');
              }}
              className="flex items-center gap-2 text-gray-400 mb-6 hover:text-white transition-colors"
            >
              <Icons.ChevronLeft size={20} />
              {t('login_change_cedula')}
            </button>

            <h1 className="text-3xl font-black text-white mb-2">
              {t('login_password_title')}
            </h1>
            <p className="text-gray-400 mb-8">
              {t('cedula')}: {cedula}
            </p>

            {/* Password input */}
            <div className="mb-6">
              <div className="relative">
                <Icons.Lock size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPasswordText ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && password.length > 0) {
                      handleLogin(cedula, password);
                    }
                  }}
                  placeholder={t('password')}
                  autoFocus
                  className="w-full bg-slate-800 pl-12 pr-12 py-4 rounded-xl border border-slate-700 text-white text-lg font-medium placeholder-gray-500 outline-none focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordText(!showPasswordText)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPasswordText ? <Icons.EyeOff size={20} /> : <Icons.Eye size={20} />}
                </button>
              </div>
              {error && (
                <p className="text-red-400 text-sm mt-2 flex items-center gap-1">
                  <Icons.AlertCircle size={14} />
                  {error}
                </p>
              )}
            </div>

            {/* Login button */}
            <button
              onClick={() => handleLogin(cedula, password)}
              disabled={password.length === 0 || isLoading}
              className="w-full bg-gradient-to-r from-primary to-blue-600 text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-primary/20 active:scale-95 transition-all"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('login_verifying')}
                </>
              ) : (
                t('login_enter')
              )}
            </button>

            {/* Biometric login button */}
            {biometricAvailable && (
              <button
                onClick={handleBiometricLogin}
                disabled={isLoading}
                className="w-full mt-4 flex items-center justify-center gap-2 py-3 bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                <Icons.Fingerprint size={20} />
                {t('biometric_login')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-6 pb-8">
        <div className="text-center">
          <p className="text-gray-500 text-sm mb-2">{t('login_no_account')}</p>
          <button
            onClick={onRegister}
            className="text-primary font-bold text-lg"
          >
            {t('create_account')}
          </button>
        </div>

        <p className="text-gray-600 text-xs text-center mt-6">
          {t('login_terms')}
        </p>
      </div>
    </div>
  );
};
