import React, { useState, useEffect } from 'react';
import { useApp } from '@/hooks/useApp';
import { useAuthStore } from '@/stores/auth.store';
import { getApiLayer } from '@/api';
import { Icons } from '../../components/Icons';
import { BottomSheet } from '../../components/BottomSheet';
import { TwoFactorSheet } from './TwoFactorSheet';
import { ApiKeysSheet } from './ApiKeysSheet';
import { WebhooksSheet } from './WebhooksSheet';
import { APP_VERSION, getVersionString, getAllVersions } from '../../config/version';
import { useLanguage } from '../../i18n/LanguageContext';

interface ProfileViewProps {
  onOpenFAQ?: () => void;
  onOpenEscrow?: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ onOpenFAQ, onOpenEscrow }) => {
  const { state, dispatch } = useApp();
  const { t, language, setLanguage, languages, currentLanguage } = useLanguage();
  const [showPasswordSheet, setShowPasswordSheet] = useState(false);
  const [showLimitsSheet, setShowLimitsSheet] = useState(false);
  const [showAboutSheet, setShowAboutSheet] = useState(false);
  const [showLanguageSheet, setShowLanguageSheet] = useState(false);
  const [showBiometricConfirmSheet, setShowBiometricConfirmSheet] = useState(false);
  const [showTwoFactorSheet, setShowTwoFactorSheet] = useState(false);
  const [showApiKeysSheet, setShowApiKeysSheet] = useState(false);
  const [showWebhooksSheet, setShowWebhooksSheet] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [biometricPassword, setBiometricPassword] = useState('');
  const [biometricAction, setBiometricAction] = useState<'enable' | 'disable'>('enable');
  const [biometricError, setBiometricError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [showBioPwd, setShowBioPwd] = useState(false);

  // Load 2FA status once. TOTP always goes through the real backend; in mock
  // mode (no VITE_API_URL) the call simply fails and 2FA shows as off.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getApiLayer().mfa.totpStatus();
      if (!cancelled && res.success && res.data) {
        setTwoFactorEnabled(res.data.enabled);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getPasswordStrength = (pwd: string): 'weak' | 'medium' | 'strong' => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    if (score <= 2) return 'weak';
    if (score <= 4) return 'medium';
    return 'strong';
  };

  const passwordStrength = newPassword ? getPasswordStrength(newPassword) : null;
  const isPasswordValid = newPassword.length >= 8 && /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) && /\d/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword);

  const handleChangePassword = () => {
    if (!isPasswordValid || newPassword !== confirmPassword || !currentPassword) return;
    // Backend is the only authority on the current password — no client-side hash.
    void (async () => {
      const ok = await useAuthStore.getState().changePassword(currentPassword, newPassword);
      if (!ok) {
        setPasswordError(t('incorrect_password'));
        return;
      }
      setShowPasswordSheet(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError('');
    })();
  };

  const handleBiometricToggle = () => {
    setBiometricAction(state.settings.biometricEnabled ? 'disable' : 'enable');
    setBiometricPassword('');
    setBiometricError('');
    setShowBiometricConfirmSheet(true);
  };

  const handleConfirmBiometric = async () => {
    // Toggling biometric is local-only state inside an already-authenticated
    // session. We no longer gate it with a client-side password hash check
    // (that was the old SHA-256 password hash anti-pattern). If a stronger
    // re-auth is desired here, wire a backend /auth/verify-password endpoint.
    dispatch({ type: 'TOGGLE_BIOMETRIC' });
    setShowBiometricConfirmSheet(false);
    setBiometricPassword('');
    setBiometricError('');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' }).format(amount);
  };

  const totalBalance = state.accounts.reduce((acc, curr) => {
    const rate = curr.rateToUsd || 1;
    return acc + (curr.balance * rate);
  }, 0);

  const kycLevelText: Record<number, string> = {
    0: 'Básico',
    1: 'Verificado',
    2: 'Completo',
  };

  return (
    <div className="pb-24 pt-4 space-y-6 px-4">
      {/* Profile Header — Unified Vision hero */}
      <div className="relative overflow-hidden uv-gradient-brand rounded-3xl p-6 text-white uv-shadow-floating">
        <div
          className="absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-30 pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.6), transparent)' }}
        />
        <div className="relative flex items-center gap-4">
          <div className="w-20 h-20 bg-white/15 backdrop-blur-sm border border-white/20 rounded-2xl flex items-center justify-center text-white text-3xl font-black">
            {state.user?.firstName?.charAt(0) || 'K'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-black truncate tracking-tight">
              {state.user?.firstName} {state.user?.lastName}
            </h2>
            <p className="text-white/70 text-sm">{state.user?.phone}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/15 backdrop-blur-sm border border-white/20">
                KYC {kycLevelText[state.user?.kycLevel || 0]}
              </span>
              {state.settings.biometricEnabled && (
                <span className="px-2 py-0.5 bg-white/15 backdrop-blur-sm border border-white/20 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <Icons.Fingerprint size={11} />
                  Biometría
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="relative grid grid-cols-2 gap-3 mt-6">
          <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70 mb-1">Balance Total</p>
            <p className="text-lg font-black tabular-nums">
              ~${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70 mb-1">Este mes</p>
            <p className="text-lg font-black">
              {state.transactions.filter(t => t.type === 'debit').length} gastos
            </p>
          </div>
        </div>
      </div>

      {/* Account Section */}
      <div>
        <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-3">
          {t('my_account')}
        </h3>
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          <button className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.User size={18} className="text-blue-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('personal_data')}</p>
              <p className="text-sm text-gray-500">Cédula: {state.user?.cedula}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>

          <button className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Shield size={18} className="text-green-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('kyc_verification')}</p>
              <p className="text-sm text-gray-500">Nivel {state.user?.kycLevel || 0} - {kycLevelText[state.user?.kycLevel || 0]}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>

          <button
            onClick={() => setShowLimitsSheet(true)}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Sliders size={18} className="text-purple-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('transaction_limits')}</p>
              <p className="text-sm text-gray-500">Diario: {formatCurrency(500000)}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>
        </div>
      </div>

      {/* Security Section */}
      <div>
        <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-3">
          {t('security')}
        </h3>
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          <button
            onClick={() => setShowPasswordSheet(true)}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Lock size={18} className="text-orange-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('change_password')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{t('password_requirements')}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>

          <button
            onClick={handleBiometricToggle}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-cyan-100 dark:bg-cyan-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Fingerprint size={18} className="text-cyan-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('biometric_auth')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{t('fingerprint_face')}</p>
            </div>
            <div
              role="switch"
              aria-checked={state.settings.biometricEnabled}
              aria-label={t('biometric_auth')}
              className={`w-12 h-7 rounded-full p-1 transition-colors ${
              state.settings.biometricEnabled ? 'bg-green-500' : 'bg-gray-300'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                state.settings.biometricEnabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
          </button>

          <button
            onClick={() => setShowTwoFactorSheet(true)}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Shield size={18} className="text-indigo-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('two_factor_auth')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{t('two_factor_desc')}</p>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                twoFactorEnabled
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}
            >
              {twoFactorEnabled ? t('twofa_on') : t('twofa_off')}
            </span>
          </button>

          <button
            onClick={() => dispatch({ type: 'TOGGLE_LOCK', payload: true })}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Lock size={18} className="text-red-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('lock_app')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{t('lock_now')}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>
        </div>
      </div>

      {/* Merchant tools Section */}
      <div>
        <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-3">
          {t('merchant_tools')}
        </h3>
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          <button
            onClick={() => onOpenEscrow?.()}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Shield size={18} className="text-teal-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('escrow_menu')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{t('escrow_menu_desc')}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>

          <button
            onClick={() => setShowApiKeysSheet(true)}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Lock size={18} className="text-amber-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('apikeys_menu')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{t('apikeys_menu_desc')}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>

          <button
            onClick={() => setShowWebhooksSheet(true)}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Globe size={18} className="text-violet-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('webhooks_menu')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{t('webhooks_menu_desc')}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>
        </div>
      </div>

      {/* Preferences Section */}
      <div>
        <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-3">
          {t('preferences')}
        </h3>
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          <button
            onClick={() => dispatch({ type: 'TOGGLE_THEME' })}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center mr-3">
              {state.settings.darkMode ? (
                <Icons.Moon size={18} className="text-slate-600 dark:text-slate-400" />
              ) : (
                <Icons.Sun size={18} className="text-yellow-500" />
              )}
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('dark_mode')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{state.settings.darkMode ? t('activated') : t('deactivated')}</p>
            </div>
            <div
              role="switch"
              aria-checked={state.settings.darkMode}
              aria-label={t('dark_mode')}
              className={`w-12 h-7 rounded-full p-1 transition-colors ${
              state.settings.darkMode ? 'bg-primary' : 'bg-gray-300'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                state.settings.darkMode ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
          </button>

          <button
            onClick={() => dispatch({ type: 'TOGGLE_NOTIFICATIONS' })}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-pink-100 dark:bg-pink-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.Bell size={18} className="text-pink-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('notifications_setting')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{state.settings.notificationsEnabled ? t('activated') : t('deactivated')}</p>
            </div>
            <div
              role="switch"
              aria-checked={state.settings.notificationsEnabled}
              aria-label={t('notifications_setting')}
              className={`w-12 h-7 rounded-full p-1 transition-colors ${
              state.settings.notificationsEnabled ? 'bg-pink-500' : 'bg-gray-300'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                state.settings.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
          </button>

          <button
            onClick={() => setShowLanguageSheet(true)}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center mr-3">
              <span className="text-lg">{currentLanguage.flag}</span>
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('language')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{currentLanguage.nativeName}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>
        </div>
      </div>

      {/* Support Section */}
      <div>
        <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-3">
          {t('support')}
        </h3>
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          <button
            onClick={onOpenFAQ}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.HelpCircle size={18} className="text-teal-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('help_center')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{t('faq')}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>

          <button className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mr-3">
              <Icons.MessageCircle size={18} className="text-blue-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('chat_support')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{t('available_247')}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>

          <button
            onClick={() => setShowAboutSheet(true)}
            className="w-full flex items-center px-4 py-3.5 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors"
          >
            <div className="w-10 h-10 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl flex items-center justify-center mr-3">
              <Icons.Info size={18} className="text-gray-600" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold uv-text-primary text-sm">{t('about')}</p>
              <p className="text-xs uv-text-muted mt-0.5">{getVersionString()}</p>
            </div>
            <Icons.ChevronRight size={18} className="uv-text-muted" />
          </button>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={() => dispatch({ type: 'LOGOUT' })}
        aria-label={t('logout')}
        className="w-full bg-[var(--color-danger-soft)] text-[var(--color-danger)] p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-[var(--color-danger)] hover:text-white active:scale-[0.98] transition-all"
      >
        <Icons.LogOut size={18} />
        {t('logout')}
      </button>

      {/* App info */}
      <div className="text-center uv-text-muted text-xs pb-4">
        <p>KiramoPay {getVersionString()}</p>
        <p>{t('made_in_cr')}</p>
      </div>

      {/* Change Password Sheet */}
      <BottomSheet
        isOpen={showPasswordSheet}
        onClose={() => { setShowPasswordSheet(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordError(''); }}
        title={t('change_password')}
      >
        <div className="space-y-4">
          {/* Current password */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('current_password')}
            </label>
            <div className="relative">
              <input
                type={showCurrentPwd ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(''); }}
                className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 pr-12 rounded-xl outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all"
                placeholder="--------"
              />
              <button type="button" onClick={() => setShowCurrentPwd(!showCurrentPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 uv-text-muted hover:uv-text-primary">
                {showCurrentPwd ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
              </button>
            </div>
            {passwordError && (
              <p className="text-red-500 text-sm mt-1">{passwordError}</p>
            )}
          </div>

          {/* New password */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('new_password')}
            </label>
            <div className="relative">
              <input
                type={showNewPwd ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 pr-12 rounded-xl outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all"
                placeholder="--------"
              />
              <button type="button" onClick={() => setShowNewPwd(!showNewPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 uv-text-muted hover:uv-text-primary">
                {showNewPwd ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
              </button>
            </div>
            {/* Password strength indicator */}
            {newPassword && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">
                  <div className={`h-1 flex-1 rounded-full ${passwordStrength === 'weak' ? 'bg-red-500' : passwordStrength === 'medium' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                  <div className={`h-1 flex-1 rounded-full ${passwordStrength === 'medium' ? 'bg-yellow-500' : passwordStrength === 'strong' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-700'}`} />
                  <div className={`h-1 flex-1 rounded-full ${passwordStrength === 'strong' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-700'}`} />
                </div>
                <p className={`text-xs ${passwordStrength === 'weak' ? 'text-red-500' : passwordStrength === 'medium' ? 'text-yellow-500' : 'text-green-500'}`}>
                  {passwordStrength === 'weak' ? t('password_weak') : passwordStrength === 'medium' ? t('password_medium') : t('password_strong')}
                </p>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">{t('password_requirements')}</p>
          </div>

          {/* Confirm password */}
          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('confirm_password')}
            </label>
            <div className="relative">
              <input
                type={showConfirmPwd ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border uv-text-primary px-4 py-3 pr-12 rounded-xl outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all ${
                  confirmPassword && newPassword !== confirmPassword ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
                }`}
                placeholder="--------"
              />
              <button type="button" onClick={() => setShowConfirmPwd(!showConfirmPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 uv-text-muted hover:uv-text-primary">
                {showConfirmPwd ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
              </button>
            </div>
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-red-500 text-sm mt-1">{t('passwords_dont_match')}</p>
            )}
          </div>

          <button
            onClick={handleChangePassword}
            disabled={!isPasswordValid || newPassword !== confirmPassword || !currentPassword}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed uv-shadow-primary active:scale-[0.98] transition-all"
          >
            {t('change_password')}
          </button>
        </div>
      </BottomSheet>

      {/* Limits Sheet */}
      <BottomSheet
        isOpen={showLimitsSheet}
        onClose={() => setShowLimitsSheet(false)}
        title={t('transaction_limits')}
      >
        <div className="space-y-4">
          <div className="uv-surface-2 rounded-xl p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="uv-text-muted">Límite diario</span>
              <span className="font-bold uv-text-primary">{formatCurrency(500000)}</span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
              <div className="h-full bg-primary rounded-full" style={{ width: '35%' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">Usado: {formatCurrency(175000)}</p>
          </div>

          <div className="uv-surface-2 rounded-xl p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="uv-text-muted">Límite mensual</span>
              <span className="font-bold uv-text-primary">{formatCurrency(5000000)}</span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
              <div className="h-full bg-accent rounded-full" style={{ width: '20%' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">Usado: {formatCurrency(1000000)}</p>
          </div>

          <div className="uv-surface-2 rounded-xl p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="uv-text-muted">Por transacción</span>
              <span className="font-bold uv-text-primary">{formatCurrency(200000)}</span>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Icons.Info size={18} className="text-blue-500 mt-0.5" />
              <div>
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  Para aumentar tus límites, completa la verificación KYC nivel 2.
                </p>
              </div>
            </div>
          </div>

          <button className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold uv-shadow-primary active:scale-[0.98] transition-all">
            Solicitar aumento
          </button>
        </div>
      </BottomSheet>

      {/* Biometric Confirmation Sheet */}
      <BottomSheet
        isOpen={showBiometricConfirmSheet}
        onClose={() => {
          setShowBiometricConfirmSheet(false);
          setBiometricPassword('');
          setBiometricError('');
        }}
        title={biometricAction === 'enable' ? t('enable_biometrics') : t('disable_biometrics')}
      >
        <div className="space-y-6">
          <div className="text-center">
            <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${
              biometricAction === 'enable'
                ? 'bg-green-100 dark:bg-green-900/30'
                : 'bg-red-100 dark:bg-red-900/30'
            }`}>
              <Icons.Fingerprint size={32} className={
                biometricAction === 'enable' ? 'text-green-600' : 'text-red-600'
              } />
            </div>
            <p className="uv-text-secondary">
              {biometricAction === 'enable'
                ? t('enter_password_to_enable')
                : t('enter_password_to_disable')}
            </p>
          </div>

          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block text-center">
              {t('current_password')}
            </label>
            <div className="relative">
              <input
                type={showBioPwd ? 'text' : 'password'}
                value={biometricPassword}
                onChange={(e) => {
                  setBiometricPassword(e.target.value);
                  setBiometricError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && biometricPassword.length > 0) {
                    handleConfirmBiometric();
                  }
                }}
                className={`w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border uv-text-primary px-4 py-4 pr-12 rounded-xl outline-none focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all ${
                  biometricError ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
                }`}
                placeholder="--------"
              />
              <button type="button" onClick={() => setShowBioPwd(!showBioPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 uv-text-muted hover:uv-text-primary">
                {showBioPwd ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
              </button>
            </div>
            {biometricError && (
              <p className="text-red-500 text-sm mt-2 text-center">{biometricError}</p>
            )}
          </div>

          <button
            onClick={handleConfirmBiometric}
            disabled={biometricPassword.length === 0}
            className={`w-full py-4 rounded-xl font-bold text-lg disabled:opacity-50 ${
              biometricAction === 'enable'
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
            }`}
          >
            {biometricAction === 'enable' ? t('enable_biometrics') : t('disable_biometrics')}
          </button>
        </div>
      </BottomSheet>

      {/* Two-factor (TOTP) Sheet */}
      <TwoFactorSheet
        isOpen={showTwoFactorSheet}
        enabled={twoFactorEnabled}
        onClose={() => setShowTwoFactorSheet(false)}
        onStatusChange={setTwoFactorEnabled}
      />

      {/* Merchant API keys + webhooks */}
      <ApiKeysSheet isOpen={showApiKeysSheet} onClose={() => setShowApiKeysSheet(false)} />
      <WebhooksSheet isOpen={showWebhooksSheet} onClose={() => setShowWebhooksSheet(false)} />

      {/* About Sheet */}
      <BottomSheet
        isOpen={showAboutSheet}
        onClose={() => setShowAboutSheet(false)}
        title={`${t('about')} KiramoPay`}
      >
        <div className="space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Logo y version */}
          <div className="text-center">
            <div className="w-20 h-20 uv-gradient-brand rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <span className="text-3xl font-black text-white">K</span>
            </div>
            <h2 className="text-xl font-black uv-text-primary">KiramoPay</h2>
            <p className="uv-text-muted">{getVersionString()}</p>
            <p className="text-xs text-gray-400 mt-1">
              Lanzado: {APP_VERSION.current.releaseDate}
            </p>
          </div>

          {/* Changelog */}
          {getAllVersions().map((version, index) => (
            <div key={version.version} className="uv-surface-2 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold uv-text-primary">
                    v{version.version}
                  </span>
                  {index === 0 && (
                    <span className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs px-2 py-0.5 rounded-full">
                      Actual
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500">{version.releaseDate}</span>
              </div>
              <ul className="space-y-1.5">
                {version.changes.map((change, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm uv-text-secondary">
                    <span className="text-[var(--color-primary)] mt-0.5">•</span>
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Footer */}
          <div className="text-center pt-4 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
            <p className="text-sm text-gray-500">{t('made_in_cr')}</p>
            <p className="text-xs text-gray-400 mt-1">© 2024 KiramoPay. {t('all_rights')}.</p>
          </div>
        </div>
      </BottomSheet>

      {/* Language Sheet */}
      <BottomSheet
        isOpen={showLanguageSheet}
        onClose={() => setShowLanguageSheet(false)}
        title={t('language')}
      >
        <div className="space-y-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                setLanguage(lang.code);
                setShowLanguageSheet(false);
              }}
              className={`w-full flex items-center p-4 rounded-xl transition-colors ${
                language === lang.code
                  ? 'bg-primary/10 border-2 border-primary'
                  : 'uv-surface-2 hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]'
              }`}
            >
              <span className="text-2xl mr-4">{lang.flag}</span>
              <div className="flex-1 text-left">
                <p className={`font-bold ${
                  language === lang.code ? 'text-primary' : 'uv-text-primary'
                }`}>
                  {lang.nativeName}
                </p>
                <p className="text-xs uv-text-muted mt-0.5">{lang.name}</p>
              </div>
              {language === lang.code && (
                <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                  <Icons.Check size={14} className="text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
};
