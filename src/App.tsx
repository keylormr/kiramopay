
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useApp } from '@/hooks/useApp';
import { useSettingsStore } from '@/stores/settings.store';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { LanguageSheet } from './components/LanguageSheet';
import { OverlayShell } from './components/OverlayShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView } from './views/auth/LoginView';
import { Icons } from './components/Icons';
import type { LucideIcon } from 'lucide-react';
import { biometricService } from './services/biometric';
import { SplashScreen } from '@capacitor/splash-screen';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { User } from './types';
import { isLockPinSet, setLockPin, verifyLockPin, MAX_PIN_FAILS } from './services/lockKdf';
import { useAuthStore } from './stores/auth.store';
import { useBusinessStore } from './stores/business.store';
import { useBusinessData } from './hooks/useBusinessData';
import { ProfileSwitcherSheet } from './views/business/ProfileSwitcherSheet';
import { BusinessOnboardingSheet } from './views/business/BusinessOnboardingSheet';

// Lazy-loaded views (code splitting)
const HomeView = React.lazy(() => import('./views/home/HomeView').then(m => ({ default: m.HomeView })));
const ProfileView = React.lazy(() => import('./views/profile/ProfileView').then(m => ({ default: m.ProfileView })));
const SinpeView = React.lazy(() => import('./views/sinpe/SinpeView').then(m => ({ default: m.SinpeView })));
const ServicesView = React.lazy(() => import('./views/services/ServicesView').then(m => ({ default: m.ServicesView })));
const CryptoView = React.lazy(() => import('./views/crypto/CryptoView').then(m => ({ default: m.CryptoView })));
const NotificationsView = React.lazy(() => import('./views/shared/NotificationsView').then(m => ({ default: m.NotificationsView })));
const FAQView = React.lazy(() => import('./views/shared/FAQView').then(m => ({ default: m.FAQView })));
const RegisterView = React.lazy(() => import('./views/auth/RegisterView').then(m => ({ default: m.RegisterView })));
const BudgetView = React.lazy(() => import('./views/budget/BudgetView').then(m => ({ default: m.BudgetView })));
const RecurringView = React.lazy(() => import('./views/services/RecurringView').then(m => ({ default: m.RecurringView })));
const TransactionsView = React.lazy(() => import('./views/home/TransactionsView').then(m => ({ default: m.TransactionsView })));
const AnalyticsView = React.lazy(() => import('./views/analytics/AnalyticsView').then(m => ({ default: m.AnalyticsView })));
const SavingsView = React.lazy(() => import('./views/savings/SavingsView').then(m => ({ default: m.SavingsView })));
const OnboardingView = React.lazy(() => import('./views/onboarding/OnboardingView').then(m => ({ default: m.OnboardingView })));
const SplitPayView = React.lazy(() => import('./views/splitpay/SplitPayView').then(m => ({ default: m.SplitPayView })));
const LoyaltyView = React.lazy(() => import('./views/loyalty/LoyaltyView').then(m => ({ default: m.LoyaltyView })));
const EscrowView = React.lazy(() => import('./views/escrow/EscrowView').then(m => ({ default: m.EscrowView })));
const PayoutView = React.lazy(() => import('./views/payout/PayoutView').then(m => ({ default: m.PayoutView })));
const MerchantView = React.lazy(() => import('./views/merchant/MerchantView').then(m => ({ default: m.MerchantView })));
const AdminMerchantsView = React.lazy(() => import('./views/merchant/AdminMerchantsView').then(m => ({ default: m.AdminMerchantsView })));
const AssistantView = React.lazy(() => import('./views/assistant/AssistantView').then(m => ({ default: m.AssistantView })));
const MarketplaceView = React.lazy(() => import('./views/marketplace/MarketplaceView').then(m => ({ default: m.MarketplaceView })));
const CardsView = React.lazy(() => import('./views/cards/CardsView').then(m => ({ default: m.CardsView })));
const BusinessHomeView = React.lazy(() => import('./views/business/BusinessHomeView').then(m => ({ default: m.BusinessHomeView })));
const BusinessMovementsView = React.lazy(() => import('./views/business/BusinessMovementsView').then(m => ({ default: m.BusinessMovementsView })));
const BusinessSettingsView = React.lazy(() => import('./views/business/BusinessSettingsView').then(m => ({ default: m.BusinessSettingsView })));

// Lock Screen Component — PIN entry for returning users.
//
// Security: The PIN is NOT the user's password. It is a 4-6 digit unlock
// code derived through PBKDF2 (see services/lockKdf.ts). After
// MAX_PIN_FAILS failed attempts the user is forcibly logged out and must
// re-enter their full password (online auth round-trip).
const LockScreen = () => {
  const { state, dispatch } = useApp();
  const { t } = useLanguage();
  const logout = useAuthStore((s) => s.logout);
  const [pin, setPin] = useState('');
  const [showPinText, setShowPinText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [setupMode, setSetupMode] = useState(!isLockPinSet());

  const handleBiometric = useCallback(async () => {
    try {
      const result = await biometricService.authenticate(t('unlock_biometric_prompt'));
      if (result.success) {
        dispatch({ type: 'TOGGLE_LOCK', payload: false });
      }
    } catch {
      // Biometric auth failed or cancelled
    }
  }, [dispatch, t]);

  useEffect(() => {
    const checkBiometric = async () => {
      const available = await biometricService.checkAvailability();
      setBiometricAvailable(available && state.settings.biometricEnabled);
      if (available && state.settings.biometricEnabled) {
        handleBiometric();
      }
    };
    checkBiometric();
  }, [handleBiometric, state.settings.biometricEnabled]);

  const handleSubmit = async () => {
    setError(null);
    if (!/^\d{4,6}$/.test(pin)) {
      setError(t('incorrect_password') || 'PIN must be 4-6 digits');
      return;
    }
    if (setupMode) {
      try {
        await setLockPin(pin);
        setSetupMode(false);
        dispatch({ type: 'TOGGLE_LOCK', payload: false });
        setPin('');
      } catch {
        setError('Failed to set PIN');
      }
      return;
    }
    const result = await verifyLockPin(pin);
    if (result.ok) {
      dispatch({ type: 'TOGGLE_LOCK', payload: false });
      setPin('');
      return;
    }
    if (result.exhausted) {
      // Force full re-auth: clear local state, drop to login screen.
      logout();
      dispatch({ type: 'LOGOUT' });
      return;
    }
    setError(`Incorrect PIN (${result.failCount}/${MAX_PIN_FAILS})`);
    setTimeout(() => {
      setPin('');
      setError(null);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[var(--color-background-dark)] flex flex-col items-center justify-center text-white animate-fade-in-scale overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[120%] h-[60%] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(closest-side, rgba(45,123,255,0.28) 0%, rgba(45,123,255,0.06) 50%, transparent 80%)',
          filter: 'blur(20px)',
        }}
      />
      <div className="relative mb-8 flex flex-col items-center">
        <div className="w-20 h-20 uv-gradient-brand rounded-3xl mb-6 flex items-center justify-center uv-shadow-primary">
          <span className="text-3xl font-black">K</span>
        </div>
        <h1 className="text-2xl font-bold mb-2 tracking-tight">{t('welcome')}</h1>
        <p className="text-[var(--color-text-secondary-dark)] text-sm">
          {state.user?.firstName ? `${t('hello')}, ${state.user.firstName}` : (setupMode ? 'Set your unlock PIN (4-6 digits)' : 'Enter your PIN')}
        </p>
      </div>

      <div className="relative w-72 space-y-4">
        <div className="relative">
          <input
            type={showPinText ? 'text' : 'password'}
            value={pin}
            inputMode="numeric"
            pattern="\d{4,6}"
            maxLength={6}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
              setPin(digits);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pin.length >= 4) {
                handleSubmit();
              }
            }}
            placeholder={setupMode ? 'Choose PIN' : 'Enter PIN'}
            autoFocus
            className={`w-full bg-[var(--color-surface-2-dark)] pl-4 pr-12 py-4 rounded-xl border text-white text-2xl font-mono tracking-[0.5em] text-center placeholder:text-[var(--color-text-muted-dark)] outline-none transition-all focus:ring-[3px] focus:ring-[var(--color-primary-soft)] ${
              error ? 'border-[var(--color-danger)] animate-shake' : 'border-[var(--color-border-dark)] focus:border-[var(--color-primary)]'
            }`}
            aria-label={setupMode ? 'Set unlock PIN' : 'Enter unlock PIN'}
          />
          <button
            type="button"
            onClick={() => setShowPinText(!showPinText)}
            aria-label={showPinText ? t('hide_password') : t('show_password')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted-dark)] hover:text-white transition-colors"
          >
            {showPinText ? <Icons.EyeOff size={20} /> : <Icons.Eye size={20} />}
          </button>
        </div>

        {error && (
          <p aria-live="polite" className="text-[var(--color-danger)] text-sm text-center animate-shake">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={pin.length < 4}
          className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all uv-shadow-primary"
        >
          {setupMode ? 'Set PIN' : t('unlock')}
        </button>

        {!setupMode && (
          <button
            onClick={() => {
              logout();
              dispatch({ type: 'LOGOUT' });
            }}
            className="w-full py-3 text-sm text-[var(--color-text-muted-dark)] hover:text-white transition-colors"
          >
            Forgot PIN? Log in with password
          </button>
        )}

        {biometricAvailable && (
          <button
            onClick={handleBiometric}
            className="w-full flex items-center justify-center gap-2 py-3 text-[var(--color-primary-300)] hover:bg-[var(--color-surface-2-dark)] rounded-xl transition-colors"
          >
            <Icons.Fingerprint size={24} />
            <span className="text-sm font-medium">{t('biometric_login')}</span>
          </button>
        )}
      </div>
    </div>
  );
};

// Tab definitions
type TabId = 'home' | 'sinpe' | 'crypto' | 'services' | 'profile';
type OverlayView = 'notifications' | 'faq' | 'budget' | 'recurring' | 'transactions' | 'analytics' | 'savings' | 'splitpay' | 'loyalty' | 'escrow' | 'payout' | 'merchant' | 'adminMerchants' | 'assistant' | 'marketplace' | 'cards' | null;

// Main Layout Component
const Layout = () => {
  const [activeTab, setActiveTab] = useState<TabId>('home');
  // Which SINPE sub-tab to open when navigating there from Home's quick actions.
  const [sinpeTab, setSinpeTab] = useState<'send' | 'receive' | 'history'>('send');
  const [overlayView, setOverlayView] = useState<OverlayView>(null);
  const [showLanguage, setShowLanguage] = useState(false);
  const { state } = useApp();
  const { t, currentLanguage } = useLanguage();

  // ── Business mode ────────────────────────────────────────────────────────
  // Same login, several profiles: personal wallet or any of the owner's shops.
  const activeMerchantId = useBusinessStore((s) => s.activeMerchantId);
  const setActiveMerchant = useBusinessStore((s) => s.setActiveMerchant);
  const { merchants, active: activeMerchant, payments: bizPayments, loading: bizLoading, reload: reloadBiz } = useBusinessData();
  const [bizTab, setBizTab] = useState<'home' | 'movements' | 'settings'>('home');
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const businessMode = activeMerchantId !== null;

  // Self-heal: the stored id may point at a shop that no longer exists.
  useEffect(() => {
    if (businessMode && !bizLoading && !activeMerchant) setActiveMerchant(null);
  }, [businessMode, bizLoading, activeMerchant, setActiveMerchant]);

  // Android hardware back: close an open overlay first, else return to Home,
  // else exit the app. Without this the WebView has a single history entry, so
  // Back quits the app from any screen. No-op on web (no hardware back).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapApp.addListener('backButton', () => {
      if (overlayView !== null) {
        setOverlayView(null);
      } else if (activeTab !== 'home') {
        setActiveTab('home');
      } else {
        void CapApp.exitApp();
      }
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [overlayView, activeTab]);

  const TABS: { id: TabId; icon: LucideIcon; label: string; }[] = [
    { id: 'home', icon: Icons.Home, label: t('nav_home') },
    { id: 'sinpe', icon: Icons.Smartphone, label: t('nav_sinpe') },
    { id: 'crypto', icon: Icons.Bitcoin, label: t('nav_crypto') },
    { id: 'services', icon: Icons.FileText, label: t('nav_services') },
    { id: 'profile', icon: Icons.Profile, label: t('nav_profile') },
  ];

  // In business mode the bottom bar swaps to the shop's own tabs.
  const BUSINESS_NAV: { id: string; icon: LucideIcon; label: string }[] = [
    { id: 'home', icon: Icons.Home, label: t('nav_home') },
    { id: 'movements', icon: Icons.Receipt, label: t('business_movements') },
    { id: 'settings', icon: Icons.Settings, label: t('business_settings') },
  ];
  const NAV_ITEMS: { id: string; icon: LucideIcon; label: string }[] = businessMode ? BUSINESS_NAV : TABS;
  const currentNavId: string = businessMode ? bizTab : activeTab;
  const onNavSelect = (id: string) => {
    if (businessMode) setBizTab(id as 'home' | 'movements' | 'settings');
    else setActiveTab(id as TabId);
  };

  const notifications = state.notifications || [];
  const unreadCount = notifications.filter(n => !n.read).length;

  // Show lock screen if locked
  if (state.settings.isLocked && state.isAuthenticated) {
    return <LockScreen />;
  }

  const renderContent = () => {
    // Business mode replaces the personal tabs entirely: the owner is acting as
    // the shop, so the wallet/crypto/services surfaces do not apply.
    if (businessMode) {
      if (!activeMerchant) return <LoadingSkeleton />;
      switch (bizTab) {
        case 'movements':
          return <BusinessMovementsView payments={bizPayments} />;
        case 'settings':
          return (
            <BusinessSettingsView
              merchant={activeMerchant}
              onSwitchProfile={() => setShowSwitcher(true)}
              onBackToPersonal={() => setActiveMerchant(null)}
              onUpdated={reloadBiz}
            />
          );
        default:
          return <BusinessHomeView merchant={activeMerchant} payments={bizPayments} onReload={reloadBiz} />;
      }
    }
    switch (activeTab) {
      case 'home': return <HomeView onViewAllTransactions={() => setOverlayView('transactions')} onOpenAnalytics={() => setOverlayView('analytics')} onOpenSavings={() => setOverlayView('savings')} onOpenSplitPay={() => setOverlayView('splitpay')} onOpenLoyalty={() => setOverlayView('loyalty')} onOpenAssistant={() => setOverlayView('assistant')} onOpenMarketplace={() => setOverlayView('marketplace')} onOpenCards={() => setOverlayView('cards')} onNavigateToSinpe={(tab) => { setSinpeTab(tab ?? 'send'); setActiveTab('sinpe'); }} />;
      case 'sinpe': return <SinpeView initialTab={sinpeTab} />;
      case 'crypto': return <CryptoView />;
      case 'services': return <ServicesView />;
      case 'profile': return <ProfileView onOpenFAQ={() => setOverlayView('faq')} onOpenEscrow={() => setOverlayView('escrow')} onOpenPayout={() => setOverlayView('payout')} onOpenMerchant={() => setOverlayView('merchant')} onOpenAdminMerchants={() => setOverlayView('adminMerchants')} />;
      default: return <HomeView onViewAllTransactions={() => setOverlayView('transactions')} onOpenAnalytics={() => setOverlayView('analytics')} onOpenSavings={() => setOverlayView('savings')} />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] uv-text-primary font-sans">
      {/* Top Bar */}
      <div className="sticky top-0 z-30 bg-white/75 dark:bg-[#121E3A]/75 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 min-h-14 pt-safe flex items-center justify-between">
        <button
          onClick={() => setShowSwitcher(true)}
          aria-label={t('business_switch')}
          className="flex items-center gap-2 rounded-lg px-1 -mx-1 py-1 hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors"
        >
          {businessMode && activeMerchant ? (
            <>
              <div className="w-8 h-8 bg-[var(--color-accent-soft)] text-[var(--color-accent)] rounded-lg flex items-center justify-center uv-shadow-soft">
                <Icons.ShoppingCart size={16} />
              </div>
              <span className="font-bold text-lg tracking-tight uv-text-primary max-w-[45vw] truncate">
                {activeMerchant.name}
              </span>
            </>
          ) : (
            <>
              <div className="w-8 h-8 uv-gradient-brand rounded-lg flex items-center justify-center text-white font-black text-sm uv-shadow-soft">
                K
              </div>
              <span className="font-bold text-lg tracking-tight uv-text-primary">KiramoPay</span>
            </>
          )}
          <Icons.ChevronRight size={16} className="uv-text-muted shrink-0" />
        </button>
        <div className="flex items-center gap-2">
          {state.settings.offlineMode && (
            <span aria-live="polite" className="px-2 py-0.5 uv-chip-danger text-[10px] font-bold uppercase tracking-wider rounded-md">
              Offline
            </span>
          )}
          <button
            onClick={() => setShowLanguage(true)}
            aria-label={t('language')}
            title={currentLanguage.nativeName}
            className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-text-secondary"
          >
            <Icons.Globe size={20} />
          </button>
          <button
            onClick={() => setOverlayView('notifications')}
            aria-label={t('notifications_setting')}
            className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors relative uv-text-secondary"
          >
            <Icons.Bell size={20} />
            {unreadCount > 0 && (
              <span aria-label={`${unreadCount} ${t('notif_unread')}`} className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[var(--color-danger)] rounded-full border-2 border-[var(--color-surface-1)] dark:border-[var(--color-surface-1-dark)] flex items-center justify-center text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <main className="flex-1 relative max-w-2xl mx-auto w-full overflow-x-hidden">
        <Suspense fallback={<LoadingSkeleton />}>
          {renderContent()}
        </Suspense>
      </main>

      {/* Bottom Navigation */}
      <nav role="navigation" aria-label="Main navigation" className="fixed bottom-0 left-0 right-0 z-40 uv-surface-1/95 backdrop-blur-lg border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] pb-safe">
        <div className="max-w-2xl mx-auto flex justify-around items-center h-16 px-1">
          {NAV_ITEMS.map((item) => {
            const active = currentNavId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavSelect(item.id)}
                aria-current={active ? 'page' : undefined}
                className="flex flex-col items-center justify-center w-16 h-full gap-1 relative group"
              >
                {/* Active indicator pill */}
                <span
                  className={`absolute top-2 w-9 h-1 rounded-full transition-all ${
                    active ? 'bg-[var(--color-primary)]' : 'bg-transparent'
                  }`}
                />
                <item.icon
                  size={22}
                  strokeWidth={active ? 2.5 : 2}
                  className={`mt-1 transition-colors ${
                    active ? 'text-[var(--color-primary)]' : 'uv-text-muted group-hover:uv-text-secondary'
                  }`}
                />
                <span
                  className={`text-[10px] font-semibold transition-colors ${
                    active ? 'text-[var(--color-primary)]' : 'uv-text-muted group-hover:uv-text-secondary'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Overlay Views */}
      <Suspense fallback={<LoadingSkeleton />}>
        {overlayView === 'notifications' && (
          <NotificationsView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'faq' && (
          <FAQView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'budget' && (
          <BudgetView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'recurring' && (
          <RecurringView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'transactions' && (
          <TransactionsView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'analytics' && (
          <AnalyticsView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'savings' && (
          <SavingsView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'splitpay' && (
          <SplitPayView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'loyalty' && (
          <LoyaltyView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'escrow' && (
          <EscrowView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'payout' && (
          <PayoutView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'merchant' && (
          <MerchantView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'adminMerchants' && (
          <AdminMerchantsView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'assistant' && (
          <AssistantView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'marketplace' && (
          <OverlayShell title={t('home_marketplace')} onClose={() => setOverlayView(null)}>
            <MarketplaceView />
          </OverlayShell>
        )}
        {overlayView === 'cards' && (
          <OverlayShell title={t('home_cards')} onClose={() => setOverlayView(null)}>
            <CardsView />
          </OverlayShell>
        )}
      </Suspense>

      {/* Global language picker, reachable from every tab via the top bar */}
      <LanguageSheet isOpen={showLanguage} onClose={() => setShowLanguage(false)} />

      <ProfileSwitcherSheet
        isOpen={showSwitcher}
        onClose={() => setShowSwitcher(false)}
        merchants={merchants}
        activeMerchantId={activeMerchantId}
        onSelect={(id) => { setActiveMerchant(id); setBizTab('home'); }}
        onCreate={() => setShowOnboarding(true)}
      />

      <BusinessOnboardingSheet
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onCreated={(m) => {
          setShowOnboarding(false);
          reloadBiz();
          setActiveMerchant(m.id);
          setBizTab('home');
        }}
      />
    </div>
  );
};

// Auth Screen Component - handles login/register flow
const AuthScreen = () => {
  const { dispatch } = useApp();
  const [showRegister, setShowRegister] = useState(false);

  const handleLogin = (user: User) => {
    dispatch({ type: 'LOGIN', payload: user });
  };

  if (showRegister) {
    return (
      <Suspense fallback={<LoadingSkeleton />}>
        <RegisterView
          onComplete={() => setShowRegister(false)}
          onBack={() => setShowRegister(false)}
        />
      </Suspense>
    );
  }

  return (
    <LoginView
      onLogin={handleLogin}
      onRegister={() => setShowRegister(true)}
    />
  );
};

// When a backend is configured the session lives in an HttpOnly cookie, so on
// cold start we must ask the backend to restore it rather than trust a persisted
// flag. In mock mode there is no cookie and nothing to restore.
const hasBackend = !!import.meta.env.VITE_API_URL;

// App Container - manages auth state
const AppContainer = () => {
  const { state } = useApp();
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('kiramopay_onboarded');
  });
  // Only attempt the cookie-based session restore when there is a hint a session
  // ever existed (a persisted user). A never-logged-in visitor skips the refresh
  // call entirely — going straight to login — so boot doesn't spend an /auth/*
  // request (which counts against the auth rate limit). Block the first paint
  // only while that restore is in flight.
  const [booting, setBooting] = useState(() => hasBackend && useAuthStore.getState().sessionHint);

  useEffect(() => {
    if (!hasBackend || !useAuthStore.getState().sessionHint) return;
    let cancelled = false;
    useAuthStore
      .getState()
      .bootstrap()
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync data from backend when app mounts with an authenticated user
  useEffect(() => {
    if (state.isAuthenticated) {
      import('@/services/dataSync').then(({ syncAllData }) => {
        syncAllData().catch(() => {});
      });
    }
  }, [state.isAuthenticated]);

  if (booting) {
    return <LoadingSkeleton />;
  }

  // If not authenticated, show login
  if (!state.isAuthenticated) {
    return <AuthScreen />;
  }

  // Show onboarding for first-time users after login
  if (showOnboarding) {
    return (
      <Suspense fallback={<LoadingSkeleton />}>
        <OnboardingView onComplete={() => setShowOnboarding(false)} />
      </Suspense>
    );
  }

  // If authenticated, show main app (Layout handles lock screen)
  return <Layout />;
};

// Sync dark mode and initialize users
const AppInit = () => {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const themeSchedule = useSettingsStore((s) => s.themeSchedule);
  const themeScheduleStart = useSettingsStore((s) => s.themeScheduleStart);
  const themeScheduleEnd = useSettingsStore((s) => s.themeScheduleEnd);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);

  useEffect(() => {
    // Hide native splash screen after app is ready
    SplashScreen.hide().catch(() => {
      // Not running in Capacitor native context — ignore
    });
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Theme auto-scheduling: check every minute and toggle dark mode based on time
  useEffect(() => {
    if (themeSchedule === 'off') return;

    const checkSchedule = () => {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      let startMinutes: number, endMinutes: number;
      if (themeSchedule === 'sunrise-sunset') {
        startMinutes = 17 * 60 + 30; // 17:30
        endMinutes = 5 * 60 + 30;    // 05:30
      } else {
        const [sh, sm] = themeScheduleStart.split(':').map(Number);
        const [eh, em] = themeScheduleEnd.split(':').map(Number);
        startMinutes = sh * 60 + sm;
        endMinutes = eh * 60 + em;
      }

      let shouldBeDark: boolean;
      if (startMinutes > endMinutes) {
        // Overnight range (e.g., 18:00 to 06:00)
        shouldBeDark = currentMinutes >= startMinutes || currentMinutes < endMinutes;
      } else {
        shouldBeDark = currentMinutes >= startMinutes && currentMinutes < endMinutes;
      }

      if (shouldBeDark !== darkMode) {
        toggleDarkMode();
      }
    };

    checkSchedule();
    const interval = setInterval(checkSchedule, 60000);
    return () => clearInterval(interval);
  }, [themeSchedule, themeScheduleStart, themeScheduleEnd, darkMode, toggleDarkMode]);

  return <AppContainer />;
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AppInit />
      </LanguageProvider>
    </ErrorBoundary>
  );
};

export default App;
