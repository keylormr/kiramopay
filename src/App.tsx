
import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { lazyConRecarga } from './utils/lazyConRecarga';
import { useNotificationsWs } from './hooks/useNotificationsWs';
import { sincronizarAvisos } from './utils/avisosPush';
import { useDeepLinks, publishDeepLink, subscribeDeepLink } from './hooks/useDeepLinks';
import { campanaPendiente, marcarCampanaVista, type Campana } from './campanas';
import { useApp } from '@/hooks/useApp';
import { useSettingsStore } from '@/stores/settings.store';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import { MarcaKiramo } from './components/MarcaKiramo';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { LanguageSheet } from './components/LanguageSheet';
import { OverlayShell } from './components/OverlayShell';
import { HelpButton } from './components/HelpSheet';
import { BottomSheet } from './components/BottomSheet';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppDesactualizada } from './components/AppDesactualizada';
import { BarreraDeActualizacion } from './components/ActualizacionObligatoria';
import { useGuardiaDeVersion, useRecargaAutomaticaDeVersion } from './hooks/useGuardiaDeVersion';
import { asegurarArranque } from './hooks/useActualizacion';
import { useSemillasDeLaDemo } from './hooks/useSemillasDeLaDemo';
import { useBarrasDelSistema, useSuperficieOscura } from './hooks/useBarrasDelSistema';
import { LoginView } from './views/auth/LoginView';
import { Icons, IconosLinea } from './components/Icons';
import { biometricService } from './services/biometric';
import { SplashScreen } from '@capacitor/splash-screen';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { User } from './types';
import { isLockPinSet, setLockPin, verifyLockPin, MAX_PIN_FAILS } from './services/lockKdf';
import { takeResetToken } from './utils/resetToken';
import { takeReferralCode } from './utils/referralCode';
import { enlaceInvitacion, compartirEnlace } from './utils/compartir';
import { useAuthStore } from './stores/auth.store';
import { useIdiomaEnElServidor } from './hooks/useIdiomaEnElServidor';
import { useActividadDeSesion } from './hooks/useActividadDeSesion';
import { useBusinessStore } from './stores/business.store';
import { useBusinessData } from './hooks/useBusinessData';
import { ProfileSwitcherSheet } from './views/business/ProfileSwitcherSheet';
import { BusinessOnboardingSheet } from './views/business/BusinessOnboardingSheet';
import { NegocioSinCargar } from './views/business/NegocioSinCargar';
import { OfflineBanner } from './components/OfflineBanner';
import { alTerminarLaIntro, decidirIntro, introEnCurso } from './components/intro/arranqueDeLaIntro';
// Sin carga diferida a proposito: la capa tiene que salir en el mismo primer
// cuadro que la app para tapar el relevo del splash. En la web no se monta.
import IntroDeLaK from './components/intro/IntroDeLaK';
import { instalarNavegacionPorCapas, retroceder, useCapa } from './navegacion/pilaDeCapas';
import {
  BarraInferior,
  MenuModal,
  NavegacionLateral,
  useAtajoDelMenu,
  useClaseDeVentana,
  type ElementoDeNavegacion,
  type PieDeNavegacion,
} from './navegacion/NavegacionAdaptable';

// Lazy-loaded views (code splitting)
const HomeView = lazyConRecarga(() => import('./views/home/HomeView').then(m => ({ default: m.HomeView })));
const ProfileView = lazyConRecarga(() => import('./views/profile/ProfileView').then(m => ({ default: m.ProfileView })));
const SinpeView = lazyConRecarga(() => import('./views/sinpe/SinpeView').then(m => ({ default: m.SinpeView })));
const ServicesView = lazyConRecarga(() => import('./views/services/ServicesView').then(m => ({ default: m.ServicesView })));
const CryptoView = lazyConRecarga(() => import('./views/crypto/CryptoView').then(m => ({ default: m.CryptoView })));
const NotificationsView = lazyConRecarga(() => import('./views/shared/NotificationsView').then(m => ({ default: m.NotificationsView })));
const FAQView = lazyConRecarga(() => import('./views/shared/FAQView').then(m => ({ default: m.FAQView })));
const RegisterView = lazyConRecarga(() => import('./views/auth/RegisterView').then(m => ({ default: m.RegisterView })));
const RecoverPasswordView = lazyConRecarga(() => import('./views/auth/RecoverPasswordView').then(m => ({ default: m.RecoverPasswordView })));
const BudgetView = lazyConRecarga(() => import('./views/budget/BudgetView').then(m => ({ default: m.BudgetView })));
const RecurringView = lazyConRecarga(() => import('./views/services/RecurringView').then(m => ({ default: m.RecurringView })));
const TransactionsView = lazyConRecarga(() => import('./views/home/TransactionsView').then(m => ({ default: m.TransactionsView })));
const AnalyticsView = lazyConRecarga(() => import('./views/analytics/AnalyticsView').then(m => ({ default: m.AnalyticsView })));
const SavingsView = lazyConRecarga(() => import('./views/savings/SavingsView').then(m => ({ default: m.SavingsView })));
const OnboardingView = lazyConRecarga(() => import('./views/onboarding/OnboardingView').then(m => ({ default: m.OnboardingView })));
const SplitPayView = lazyConRecarga(() => import('./views/splitpay/SplitPayView').then(m => ({ default: m.SplitPayView })));
const LoyaltyView = lazyConRecarga(() => import('./views/loyalty/LoyaltyView').then(m => ({ default: m.LoyaltyView })));
const EscrowView = lazyConRecarga(() => import('./views/escrow/EscrowView').then(m => ({ default: m.EscrowView })));
const PayoutView = lazyConRecarga(() => import('./views/payout/PayoutView').then(m => ({ default: m.PayoutView })));
const AdminMerchantsView = lazyConRecarga(() => import('./views/merchant/AdminMerchantsView').then(m => ({ default: m.AdminMerchantsView })));
const ClosedMerchantsView = lazyConRecarga(() => import('./views/business/ClosedMerchantsView').then(m => ({ default: m.ClosedMerchantsView })));
const AdminUsersView = lazyConRecarga(() => import('./views/admin/AdminUsersView').then(m => ({ default: m.AdminUsersView })));
const AdminDisputasView = lazyConRecarga(() => import('./views/admin/AdminDisputasView').then(m => ({ default: m.AdminDisputasView })));
const AdminPromocionesView = lazyConRecarga(() => import('./views/admin/AdminPromocionesView').then(m => ({ default: m.AdminPromocionesView })));
const AdminCapitalView = lazyConRecarga(() => import('./views/admin/AdminCapitalView').then(m => ({ default: m.AdminCapitalView })));
const PlansView = lazyConRecarga(() => import('./views/plans/PlansView').then(m => ({ default: m.PlansView })));
const SessionsView = lazyConRecarga(() => import('./views/sessions/SessionsView').then(m => ({ default: m.SessionsView })));
const AssistantView = lazyConRecarga(() => import('./views/assistant/AssistantView').then(m => ({ default: m.AssistantView })));
const MarketplaceView = lazyConRecarga(() => import('./views/marketplace/MarketplaceView').then(m => ({ default: m.MarketplaceView })));
const CardsView = lazyConRecarga(() => import('./views/cards/CardsView').then(m => ({ default: m.CardsView })));
const BusinessHomeView = lazyConRecarga(() => import('./views/business/BusinessHomeView').then(m => ({ default: m.BusinessHomeView })));
const BusinessReportsView = lazyConRecarga(() => import('./views/business/BusinessReportsView').then(m => ({ default: m.BusinessReportsView })));
const BusinessMovementsView = lazyConRecarga(() => import('./views/business/BusinessMovementsView').then(m => ({ default: m.BusinessMovementsView })));
const BusinessSettingsView = lazyConRecarga(() => import('./views/business/BusinessSettingsView').then(m => ({ default: m.BusinessSettingsView })));

// Lock Screen Component — PIN entry for returning users.
//
// Security: The PIN is NOT the user's password. It is a 4-6 digit unlock
// code derived through PBKDF2 (see services/lockKdf.ts). After
// MAX_PIN_FAILS failed attempts the user is forcibly logged out and must
// re-enter their full password (online auth round-trip).
const LockScreen = () => {
  // Oscura con cualquier tema: las barras del sistema tambien.
  useSuperficieOscura();
  const { state, dispatch } = useApp();
  const { t } = useLanguage();
  const logout = useAuthStore((s) => s.logout);
  const [pin, setPin] = useState('');
  const [showPinText, setShowPinText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [setupMode, setSetupMode] = useState(!isLockPinSet());
  // The PBKDF2 derivation is heavy: without this guard a repeated tap/Enter
  // kicks off several derivations at once.
  const [busy, setBusy] = useState(false);

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
      const disponibilidad = await biometricService.checkAvailability();
      // Se lee isAvailable, no el objeto: `objeto && boolean` siempre tomaba
      // el boolean y el candado auto-disparaba biometria en dispositivos sin
      // sensor enrolado (fallo silencioso en cada apertura).
      const puede = disponibilidad.isAvailable && state.settings.biometricEnabled;
      setBiometricAvailable(puede);
      if (puede) {
        handleBiometric();
      }
    };
    checkBiometric();
  }, [handleBiometric, state.settings.biometricEnabled]);

  const handleSubmit = async () => {
    if (busy) return;
    setError(null);
    if (!/^\d{4,6}$/.test(pin)) {
      setError(t('incorrect_password') || 'PIN must be 4-6 digits');
      return;
    }
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
    }
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
          <MarcaKiramo size={50} />
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
              if (e.key === 'Enter' && pin.length >= 4 && !busy) {
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
          <p aria-live="polite" className="text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)] text-sm text-center animate-shake">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={pin.length < 4 || busy}
          className="w-full bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all uv-shadow-primary flex items-center justify-center gap-2"
        >
          {busy ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t('processing')}
            </>
          ) : (
            setupMode ? 'Set PIN' : t('unlock')
          )}
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

// Pestanas que en la clase expandida usan la columna de 76rem (ver anchoDeColumna).
const PESTANAS_ANCHAS: ReadonlySet<TabId> = new Set<TabId>(['home', 'sinpe', 'crypto', 'services', 'profile']);
type OverlayView = 'notifications' | 'faq' | 'budget' | 'recurring' | 'transactions' | 'analytics' | 'savings' | 'splitpay' | 'loyalty' | 'escrow' | 'payout' | 'adminMerchants' | 'closedMerchants' | 'adminUsers' | 'adminDisputas' | 'adminPromociones' | 'adminCapital' | 'plans' | 'sessions' | 'assistant' | 'marketplace' | 'cards' | null;

// Keyed by TabId on purpose: adding a tab without deciding whether deep links
// may reach it becomes a compile error instead of a silently dead route.
const TAB_IDS: Record<TabId, true> = { home: true, sinpe: true, crypto: true, services: true, profile: true };
const isTabId = (value: string): value is TabId => Object.prototype.hasOwnProperty.call(TAB_IDS, value);

// Main Layout Component
const Layout = () => {
  // Notificaciones en vivo por WebSocket. El hook existia desde el diseño de
  // julio pero nadie lo montaba: el canal se arreglo en el backend (PR #103) y
  // aun asi `websocket_clients` seguia en 0 porque la app nunca conectaba. Se
  // autogestiona: solo conecta autenticado y reintenta solo.
  useNotificationsWs();
  const [activeTab, setActiveTab] = useState<TabId>('home');
  // Which SINPE sub-tab to open when navigating there from Home's quick actions.
  const [sinpeTab, setSinpeTab] = useState<'send' | 'receive' | 'history'>('send');
  const [overlayView, setOverlayView] = useState<OverlayView>(null);
  // Planes tambien se abre desde ahorro, tarjetas y lealtad (al llegar al tope
  // del plan): al cerrarlo se vuelve a esa pantalla, no al inicio.
  const [volverDePlanes, setVolverDePlanes] = useState<OverlayView>(null);
  const abrirPlanesDesde = (origen: OverlayView) => {
    setVolverDePlanes(origen);
    setOverlayView('plans');
  };
  const cerrarPlanes = () => {
    setOverlayView(volverDePlanes);
    setVolverDePlanes(null);
  };
  const [showLanguage, setShowLanguage] = useState(false);
  const { state, dispatch } = useApp();
  const { t, currentLanguage } = useLanguage();

  // Avisos del sistema: si esta cuenta los habia activado en este dispositivo,
  // se rehace la suscripcion al entrar. La recarga de emergencia de version
  // desregistra el service worker y con el se iba la suscripcion, en silencio.
  const idUsuario = state.user?.id;
  useEffect(() => {
    if (idUsuario) void sincronizarAvisos(idUsuario);
  }, [idUsuario]);

  // Campana promocional vigente. Espera a que no haya otra hoja encima (la
  // oferta biometrica): un solo pop-up a la vez o es spam. La actualizacion ya
  // no compite: es obligatoria y tapa la app entera (BarreraDeActualizacion).
  const [campana, setCampana] = useState<Campana | null>(null);
  const [campanaCopiada, setCampanaCopiada] = useState(false);
  const cerrarCampana = () => {
    if (campana) marcarCampanaVista(campana.id);
    setCampana(null);
  };
  const compartirCampana = async () => {
    if (!campana) return;
    // El enlace lleva el codigo de invitacion del usuario: asi el invitado
    // queda atribuido y el bono en puntos se paga de verdad.
    const resultado = await compartirEnlace(
      t('promo_share_text'),
      enlaceInvitacion(state.user?.referralCode),
    );
    if (resultado === 'compartido') {
      cerrarCampana();
      return;
    }
    if (resultado === 'copiado') {
      setCampanaCopiada(true);
      setTimeout(() => { setCampanaCopiada(false); cerrarCampana(); }, 1500);
    }
    // 'nada': sin portapapeles, el usuario cierra manualmente
  };

  // En el APK, ofrecer la huella al primer ingreso: si queda activada desde el
  // dia uno, los siguientes ingresos son un toque. Se ofrece UNA vez; "Ahora
  // no" queda registrado y no se vuelve a molestar (siempre esta en Perfil).
  const [showBioOffer, setShowBioOffer] = useState(false);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (state.settings.biometricEnabled) return;
    try {
      if (localStorage.getItem('kiramopay-biometria-ofrecida')) return;
    } catch {
      return;
    }
    let vivo = true;
    biometricService.checkAvailability().then((disp) => {
      if (vivo && disp.isAvailable) setShowBioOffer(true);
    });
    return () => { vivo = false; };
  }, [state.settings.biometricEnabled]);

  // La campana espera su turno: sin oferta biometrica en pantalla, y con un
  // respiro para no recibir al usuario con un pop-up.
  useEffect(() => {
    if (showBioOffer || campana) return;
    const timer = setTimeout(() => {
      setCampana(campanaPendiente());
    }, 2500);
    return () => clearTimeout(timer);
  }, [showBioOffer, campana]);

  const cerrarOfertaBio = async (activar: boolean) => {
    try {
      localStorage.setItem('kiramopay-biometria-ofrecida', '1');
    } catch { /* sin storage, simplemente no se persiste la negativa */ }
    if (activar) {
      // Confirmar que el sensor responde ANTES de prender la preferencia:
      // activar una biometria que el dispositivo no puede completar dejaria
      // el candado y el login peleando con un dialogo que siempre falla.
      const res = await biometricService.authenticate(t('bio_offer_title'));
      if (res.success) dispatch({ type: 'TOGGLE_BIOMETRIC' });
    }
    setShowBioOffer(false);
  };

  // ── Business mode ────────────────────────────────────────────────────────
  // Same login, several profiles: personal wallet or any of the owner's shops.
  const activeMerchantId = useBusinessStore((s) => s.activeMerchantId);
  const setActiveMerchant = useBusinessStore((s) => s.setActiveMerchant);
  const {
    merchants,
    active: activeMerchant,
    payments: bizPayments,
    loading: bizLoading,
    paymentsFailed: bizPaymentsFailed,
    merchantsFailed: bizMerchantsFailed,
    retrying: bizRetrying,
    reload: reloadBiz,
  } = useBusinessData();
  const [bizTab, setBizTab] = useState<'home' | 'reports' | 'movements' | 'settings'>('home');
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const businessMode = activeMerchantId !== null;

  // Self-heal: the stored id may point at a shop that no longer exists. Solo con
  // la lista de comercios traida DE VERDAD: si la consulta fallo, que el id no
  // aparezca no prueba nada, y expulsar al perfil personal por un 429 o un
  // corte de red sacaba al cajero del negocio sin decir por que.
  useEffect(() => {
    if (businessMode && !bizLoading && !bizMerchantsFailed && !activeMerchant) setActiveMerchant(null);
  }, [businessMode, bizLoading, bizMerchantsFailed, activeMerchant, setActiveMerchant]);

  // Atras. Una pantalla completa abierta, una pestana distinta de Inicio y una
  // pestana del negocio distinta de su Inicio son capas de navegacion/pilaDeCapas,
  // que las refleja en el historial del navegador: Atras cierra la de arriba
  // (primero las hojas, luego la pantalla, luego vuelve a Inicio) y, sin nada
  // abierto, sale como siempre. Escape cierra hojas y pantallas, no pestanas.
  useCapa(overlayView !== null, 'pantalla', () => {
    setOverlayView(null);
    setVolverDePlanes(null);
  });
  // Planes abierto desde ahorro, tarjetas o lealtad queda encima de esa
  // pantalla: Atras y Escape vuelven a ella, igual que la flecha de Planes.
  useCapa(overlayView === 'plans' && volverDePlanes !== null, 'pantalla', cerrarPlanes);
  useCapa(!businessMode && activeTab !== 'home', 'seccion', () => setActiveTab('home'));
  useCapa(businessMode && bizTab !== 'home', 'seccion', () => setBizTab('home'));

  // Boton fisico de Android: se le pide el retroceso a la misma pila, que ahora
  // conoce tambien las hojas de cada vista (antes una hoja abierta en SINPE se
  // perdia saltando a Inicio). Sin nada abierto, sale de la app.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapApp.addListener('backButton', () => {
      if (!retroceder()) void CapApp.exitApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);

  // Apply deep link targets. The listener itself lives above the auth gate, so
  // this only subscribes for the resolved destination; a target that resolved
  // before this shell mounted (link tapped on the login screen) is replayed on
  // subscribe. Any overlay is dismissed first, otherwise the new tab would
  // render behind a full-screen sheet and the link would look dead.
  // Business mode is deliberately left alone: the deep-linked destinations are
  // personal-wallet surfaces, but silently dropping a cashier out of the shop
  // profile is a product decision, not a routing one.
  useEffect(() => subscribeDeepLink((target) => {
    if (!isTabId(target.tab)) return;
    setOverlayView(null);
    // Mirror Home's quick actions: a payment link means "send".
    if (target.tab === 'sinpe') setSinpeTab('send');
    setActiveTab(target.tab);
  }), []);

  const TABS: (ElementoDeNavegacion & { id: TabId })[] = [
    { id: 'home', Icono: IconosLinea.Inicio, etiqueta: t('nav_home') },
    { id: 'sinpe', Icono: IconosLinea.Sinpe, etiqueta: t('nav_sinpe') },
    { id: 'crypto', Icono: IconosLinea.Cripto, etiqueta: t('nav_crypto') },
    { id: 'services', Icono: IconosLinea.Servicios, etiqueta: t('nav_services') },
    { id: 'profile', Icono: IconosLinea.Perfil, etiqueta: t('nav_profile') },
  ];

  // In business mode the bottom bar swaps to the shop's own tabs. Reports are
  // the business's numbers, so a cashier does not get that tab.
  const canSeeReports = activeMerchant != null && activeMerchant.role !== 'cashier';
  const BUSINESS_NAV: ElementoDeNavegacion[] = [
    { id: 'home', Icono: IconosLinea.Inicio, etiqueta: t('nav_home') },
    ...(canSeeReports ? [{ id: 'reports', Icono: IconosLinea.Reportes, etiqueta: t('business_reports') }] : []),
    { id: 'movements', Icono: IconosLinea.Movimientos, etiqueta: t('business_movements') },
    { id: 'settings', Icono: IconosLinea.Ajustes, etiqueta: t('business_settings') },
  ];
  const NAV_ITEMS: ElementoDeNavegacion[] = businessMode ? BUSINESS_NAV : TABS;
  // Accesos que solo caben en el menu lateral (ventana expandida): abren la
  // misma pantalla que el mosaico de Inicio o la fila de Perfil.
  const ATAJOS: (ElementoDeNavegacion & { id: 'savings' | 'cards' | 'sessions' })[] = businessMode ? [] : [
    // "Metas" y no "Ahorro": decision del dueno (2026-11-06).
    { id: 'savings', Icono: IconosLinea.Metas, etiqueta: t('nav_goals') },
    { id: 'cards', Icono: IconosLinea.Tarjeta, etiqueta: t('home_cards') },
    { id: 'sessions', Icono: IconosLinea.Dispositivos, etiqueta: t('sessions_title') },
  ];
  const claseDeVentana = useClaseDeVentana();
  // Menu lateral: en expandida se pliega a riel y la eleccion queda en el
  // dispositivo (settings); en mediana el mismo boton abre el menu completo como
  // cajon modal, que se cierra solo si la ventana deja de ser mediana.
  const menuPlegado = useSettingsStore((s) => s.menuLateralPlegado);
  const alternarMenuLateral = useSettingsStore((s) => s.alternarMenuLateral);
  const [menuModalAbierto, setMenuModalAbierto] = useState(false);
  const [claseDelMenuModal, setClaseDelMenuModal] = useState(claseDeVentana);
  if (claseDelMenuModal !== claseDeVentana) {
    setClaseDelMenuModal(claseDeVentana);
    setMenuModalAbierto(false);
  }
  const botonDelMenuRef = useRef<HTMLButtonElement>(null);
  const alternarMenu = useCallback(() => {
    if (claseDeVentana === 'expandida') alternarMenuLateral();
    else if (claseDeVentana === 'mediana') setMenuModalAbierto((abierto) => !abierto);
  }, [claseDeVentana, alternarMenuLateral]);
  const cerrarMenuModal = useCallback(() => setMenuModalAbierto(false), []);
  useAtajoDelMenu(claseDeVentana !== 'compacta', alternarMenu);
  const atajoAbierto = ATAJOS.find((a) => a.id === overlayView)?.id;
  const currentNavId: string = atajoAbierto ?? (businessMode ? bizTab : activeTab);
  const onNavSelect = (id: string) => {
    const atajo = ATAJOS.find((a) => a.id === id);
    if (atajo) {
      setVolverDePlanes(null);
      setOverlayView(atajo.id);
      return;
    }
    // En riel o menu lateral la navegacion sigue visible con una pantalla
    // abierta: elegir una pestana la cierra, como volver y tocar la pestana.
    if (overlayView !== null) {
      setOverlayView(null);
      setVolverDePlanes(null);
    }
    if (businessMode) setBizTab(id as 'home' | 'reports' | 'movements' | 'settings');
    else setActiveTab(id as TabId);
  };
  const tituloDeSeccion = [...NAV_ITEMS, ...ATAJOS].find((e) => e.id === currentNavId)?.etiqueta ?? t('app_name');
  const iniciales = [state.user?.firstName, state.user?.lastName]
    .map((parte) => parte?.trim().charAt(0) ?? '')
    .join('')
    .toUpperCase();
  const nombreCompleto = [state.user?.firstName, state.user?.lastName].filter(Boolean).join(' ');
  // Pie del riel y del menu lateral: la cuenta activa; tocarla cambia de perfil
  // (personal o comercio), igual que el selector de la barra superior.
  const pieDeNavegacion: PieDeNavegacion = {
    avatar: (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-muted)] text-[13px] font-semibold uv-text-primary dark:bg-[var(--color-surface-2-dark)] dark:shadow-[inset_0_0_0_1px_var(--color-border-strong-dark)]">
        {businessMode && activeMerchant ? <Icons.ShoppingCart size={18} aria-hidden="true" /> : (iniciales || <IconosLinea.Perfil size={20} aria-hidden="true" />)}
      </span>
    ),
    titulo: businessMode && activeMerchant ? activeMerchant.name : (nombreCompleto || t('app_name')),
    subtitulo: t('business_switch'),
    ariaLabel: t('business_switch'),
    onElegir: () => setShowSwitcher(true),
  };

  const notifications = state.notifications || [];
  const unreadCount = notifications.filter(n => !n.read).length;

  // Show lock screen if locked
  if (state.settings.isLocked && state.isAuthenticated) {
    return <LockScreen />;
  }

  // La columna del contenido: 42rem para todo, salvo las pestanas personales
  // que en pantalla ancha se abren en columnas (Inicio: saldo y acciones a un
  // lado, actividad al otro; SINPE, Cripto, Servicios y Perfil: ver cada vista)
  // y necesitan hasta 76rem. Cada una decide sus columnas con una consulta de
  // contenedor, asi que con el menu abierto o plegado se acomodan solas. La
  // barra superior va en la misma columna para que el titulo y la campana
  // queden sobre los bordes del contenido.
  const anchoDeColumna =
    claseDeVentana === 'expandida' && !businessMode && PESTANAS_ANCHAS.has(activeTab) ? 'max-w-[76rem]' : 'max-w-2xl';

  const renderContent = () => {
    // Business mode replaces the personal tabs entirely: the owner is acting as
    // the shop, so the wallet/crypto/services surfaces do not apply.
    if (businessMode) {
      if (!activeMerchant) {
        return bizMerchantsFailed ? (
          <NegocioSinCargar
            reintentando={bizRetrying}
            onReintentar={reloadBiz}
            onVolverAPersonal={() => setActiveMerchant(null)}
          />
        ) : (
          <LoadingSkeleton />
        );
      }
      switch (bizTab) {
        case 'reports':
          // Role may have changed under a persisted tab; fall back to home.
          return canSeeReports
            ? <BusinessReportsView merchant={activeMerchant} />
            : <BusinessHomeView key={activeMerchant.id} merchant={activeMerchant} payments={bizPayments} paymentsFailed={bizPaymentsFailed} onReload={reloadBiz} />;
        case 'movements':
          return <BusinessMovementsView key={activeMerchant.id} merchant={activeMerchant} />;
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
          // key por comercio: el rotulo, el cobro, la sede y el saldo en pantalla
          // son del comercio anterior hasta que llega la respuesta del nuevo.
          return <BusinessHomeView key={activeMerchant.id} merchant={activeMerchant} payments={bizPayments} paymentsFailed={bizPaymentsFailed} onReload={reloadBiz} />;
      }
    }
    switch (activeTab) {
      case 'home': return <HomeView onViewAllTransactions={() => setOverlayView('transactions')} onOpenAnalytics={() => setOverlayView('analytics')} onOpenSavings={() => setOverlayView('savings')} onOpenSplitPay={() => setOverlayView('splitpay')} onOpenLoyalty={() => setOverlayView('loyalty')} onOpenAssistant={() => setOverlayView('assistant')} onOpenMarketplace={() => setOverlayView('marketplace')} onOpenCards={() => setOverlayView('cards')} onOpenPlans={() => setOverlayView('plans')} onOpenCrypto={() => setActiveTab('crypto')} onNavigateToSinpe={(tab) => { setSinpeTab(tab ?? 'send'); setActiveTab('sinpe'); }} />;
      case 'sinpe': return <SinpeView initialTab={sinpeTab} />;
      case 'crypto': return <CryptoView />;
      case 'services': return <ServicesView />;
      case 'profile': return <ProfileView onOpenFAQ={() => setOverlayView('faq')} onOpenEscrow={() => setOverlayView('escrow')} onOpenPayout={() => setOverlayView('payout')} onOpenBusiness={() => setShowSwitcher(true)} onOpenAdminMerchants={() => setOverlayView('adminMerchants')} onOpenClosedMerchants={() => setOverlayView('closedMerchants')} onOpenAdminUsers={() => setOverlayView('adminUsers')} onOpenAdminDisputas={() => setOverlayView('adminDisputas')} onOpenAdminPromociones={() => setOverlayView('adminPromociones')} onOpenAdminCapital={() => setOverlayView('adminCapital')} onOpenPlans={() => setOverlayView('plans')} onOpenSessions={() => setOverlayView('sessions')} onOpenBudget={() => setOverlayView('budget')} onOpenRecurring={() => setOverlayView('recurring')} />;
      default: return <HomeView onViewAllTransactions={() => setOverlayView('transactions')} onOpenAnalytics={() => setOverlayView('analytics')} onOpenSavings={() => setOverlayView('savings')} />;
    }
  };

  return (
    <div
      data-menu={claseDeVentana === 'expandida' && menuPlegado ? 'plegado' : 'abierto'}
      className="kp-marco min-h-screen flex bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] uv-text-primary font-sans"
    >
      {/* Riel (600-839 px) o menu lateral fijo, abierto o plegado (840 px o
          mas). En telefono, la barra inferior de mas abajo. */}
      {claseDeVentana !== 'compacta' && (
        <NavegacionLateral
          clase={claseDeVentana}
          plegado={menuPlegado}
          elementos={NAV_ITEMS}
          atajos={ATAJOS}
          actual={currentNavId}
          onElegir={onNavSelect}
          ariaLabel={t('nav_main_aria')}
          nombreDeLaApp={t('app_name')}
          pie={pieDeNavegacion}
          control={{
            modalAbierto: menuModalAbierto,
            onAlternar: alternarMenu,
            etiquetas: { plegar: t('nav_menu_collapse'), desplegar: t('nav_menu_expand'), abrir: t('nav_menu_open') },
          }}
          refDelBoton={botonDelMenuRef}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
      {/* Top Bar */}
      <div className="sticky top-0 z-30 bg-white/75 dark:bg-[var(--color-background-dark)]/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
      {/* En riel o menu, la fila va en la misma columna que el contenido: el
          boton y el titulo arriba del borde izquierdo de la pantalla y la campana
          arriba del derecho, no en las puntas de la ventana. pt-safe va en la
          misma caja que min-h-14, como antes: con muesca la barra mide
          max(56, margen + 44) y no margen + 56. */}
      <div className={`flex min-h-14 items-center justify-between gap-2 px-4 pt-safe ${claseDeVentana !== 'compacta' ? `mx-auto w-full ${anchoDeColumna}` : ''}`}>
        {claseDeVentana !== 'compacta' ? (
          // Con riel o menu lateral, la marca, el boton del menu y el cambio de
          // perfil ya estan en la navegacion: la barra dice donde esta la persona.
          <span className="min-w-0 text-lg font-semibold tracking-[-0.01em] uv-text-primary truncate">{tituloDeSeccion}</span>
        ) : (
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
              <div className="w-8 h-8 uv-gradient-brand rounded-lg flex items-center justify-center uv-shadow-soft">
                <MarcaKiramo size={18} />
              </div>
              <span className="font-semibold text-lg tracking-[-0.01em] uv-text-primary">KiramoPay</span>
            </>
          )}
          <Icons.ChevronRight size={16} className="uv-text-muted shrink-0" />
        </button>
        )}
        <div className="flex items-center gap-2">
          {state.settings.offlineMode && (
            <span aria-live="polite" className="px-2 py-0.5 uv-chip-danger text-[10px] font-semibold rounded-md">
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
              <span aria-label={`${unreadCount} ${t('notif_unread')}`} className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[var(--color-accent)] rounded-full border-2 border-[var(--color-surface-1)] dark:border-[var(--color-background-dark)] flex items-center justify-center text-[10px] font-bold text-[var(--color-navy-950)] kp-num">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>
      </div>

      {/* Content Area. En plegables a medio abrir, kp-contenido-segmentado
          deja el contenido de un lado del pliegue (index.css). */}
      <main className={`kp-contenido-segmentado flex-1 relative ${anchoDeColumna} mx-auto w-full overflow-x-hidden`}>
        <Suspense fallback={<LoadingSkeleton />}>
          {renderContent()}
        </Suspense>
      </main>
      </div>

      {/* Barra inferior, solo en telefono (clase compacta). Va opaca: al 95 %
          con desenfoque se adivinaba el texto de la lista que pasa por detras
          ("-₡1.00" bajo "Inicio"). */}
      {claseDeVentana === 'compacta' && (
        <BarraInferior elementos={NAV_ITEMS} actual={currentNavId} onElegir={onNavSelect} ariaLabel={t('nav_main_aria')} />
      )}

      {/* Menu completo como cajon modal sobre el riel (600-839 px). */}
      {claseDeVentana === 'mediana' && (
        <MenuModal
          abierto={menuModalAbierto}
          onCerrar={cerrarMenuModal}
          elementos={NAV_ITEMS}
          atajos={ATAJOS}
          actual={currentNavId}
          onElegir={onNavSelect}
          ariaLabel={t('nav_main_aria')}
          nombreDeLaApp={t('app_name')}
          pie={pieDeNavegacion}
          etiquetaCerrar={t('nav_menu_close')}
          devolverFocoA={botonDelMenuRef}
        />
      )}

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
          <SavingsView onClose={() => setOverlayView(null)} onOpenPlans={() => abrirPlanesDesde('savings')} />
        )}
        {overlayView === 'splitpay' && (
          <SplitPayView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'loyalty' && (
          <LoyaltyView onClose={() => setOverlayView(null)} onOpenPlans={() => abrirPlanesDesde('loyalty')} />
        )}
        {overlayView === 'escrow' && (
          <EscrowView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'payout' && (
          <PayoutView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'adminMerchants' && (
          <AdminMerchantsView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'closedMerchants' && (
          <ClosedMerchantsView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'adminUsers' && (
          <AdminUsersView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'adminDisputas' && (
          <AdminDisputasView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'adminPromociones' && (
          <AdminPromocionesView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'adminCapital' && (
          <AdminCapitalView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'plans' && (
          <PlansView onClose={cerrarPlanes} />
        )}
        {overlayView === 'sessions' && (
          <SessionsView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'assistant' && (
          <AssistantView onClose={() => setOverlayView(null)} />
        )}
        {overlayView === 'marketplace' && (
          <OverlayShell title={t('home_marketplace')} onClose={() => setOverlayView(null)} columna="64rem">
            <MarketplaceView />
          </OverlayShell>
        )}
        {overlayView === 'cards' && (
          <OverlayShell title={t('home_cards')} onClose={() => setOverlayView(null)} accessory={<HelpButton topic="cards" />}>
            <CardsView onOpenPlans={() => abrirPlanesDesde('cards')} />
          </OverlayShell>
        )}
      </Suspense>

      {/* Global language picker, reachable from every tab via the top bar */}
      <LanguageSheet isOpen={showLanguage} onClose={() => setShowLanguage(false)} />

      {/* Oferta de huella al primer ingreso en el APK (una sola vez). */}
      <BottomSheet isOpen={showBioOffer} onClose={() => cerrarOfertaBio(false)} title="">
        <div className="text-center py-4 px-2">
          <div className="w-20 h-20 rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)] dark:text-[var(--color-primary-light)] flex items-center justify-center mx-auto mb-4">
            <Icons.Fingerprint size={40} />
          </div>
          <h3 className="text-xl font-black uv-text-primary mb-2">{t('bio_offer_title')}</h3>
          <p className="text-sm uv-text-secondary mb-6">{t('bio_offer_desc')}</p>
          <div className="flex gap-3">
            <button
              onClick={() => cerrarOfertaBio(false)}
              className="flex-1 py-3.5 rounded-xl border-2 border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary font-bold"
            >
              {t('bio_offer_later')}
            </button>
            <button
              onClick={() => cerrarOfertaBio(true)}
              className="flex-1 bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold active:scale-[0.98] transition-all"
            >
              {t('bio_offer_accept')}
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Campana promocional vigente (una sola vez por dispositivo). */}
      <BottomSheet
        isOpen={campana !== null}
        onClose={cerrarCampana}
        title=""
      >
        {campana && (
          <div className="text-center py-4 px-2">
            <div className="w-20 h-20 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center mx-auto mb-4">
              {campana.icono === 'Gift' ? <Icons.Gift size={36} /> : campana.icono === 'Share' ? <Icons.Share size={36} /> : <Icons.TrendingUp size={36} />}
            </div>
            <h3 className="text-xl font-black uv-text-primary mb-2">{t(campana.tituloKey)}</h3>
            <p className="text-sm uv-text-secondary mb-6">{t(campana.cuerpoKey)}</p>
            <div className="flex gap-3">
              <button
                onClick={cerrarCampana}
                className="flex-1 py-3.5 rounded-xl border-2 border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary font-bold"
              >
                {t('promo_dismiss')}
              </button>
              <button
                onClick={compartirCampana}
                className="flex-1 bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold active:scale-[0.98] transition-all"
              >
                {campanaCopiada ? t('promo_copied') : t(campana.ctaKey)}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

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
  // Read once on mount: the URL is cleaned immediately, so a later render must
  // not try to read it again and come up empty.
  const [resetToken, setResetToken] = useState(takeResetToken);
  // Same deal for the invitation code (?ref=): read once here; it survives a
  // reload in sessionStorage. Only applies to new accounts, so a logged-in
  // user never mounts this screen and the parameter is ignored.
  const [referralCode] = useState(takeReferralCode);

  const handleLogin = (user: User) => {
    dispatch({ type: 'LOGIN', payload: user });
  };

  // Arriving from the email link opens the reset step directly, with the token
  // already filled in.
  if (resetToken) {
    return (
      <Suspense fallback={<LoadingSkeleton />}>
        <RecoverPasswordView initialToken={resetToken} onClose={() => setResetToken('')} />
      </Suspense>
    );
  }

  if (showRegister) {
    return (
      <Suspense fallback={<LoadingSkeleton />}>
        <RegisterView
          referralCode={referralCode}
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
  const { t } = useLanguage();
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('kiramopay_onboarded');
  });
  // Only attempt the cookie-based session restore when there is a hint a session
  // ever existed (a persisted user). A never-logged-in visitor skips the refresh
  // call entirely — going straight to login — so boot doesn't spend an /auth/*
  // request (which counts against the auth rate limit). Block the first paint
  // only while that restore is in flight.
  const [booting, setBooting] = useState(() => hasBackend && useAuthStore.getState().sessionHint);
  // La pantalla de arranque es oscura con cualquier tema.
  useSuperficieOscura(booting);
  // Pasados unos segundos de espera, la pantalla de arranque explica que el
  // servidor esta despertando (Render Free tarda 30-90s en frio) en vez de
  // dejar un esqueleto mudo que parece una app rota.
  const [bootLento, setBootLento] = useState(false);
  // Si el primer intento fallo por algo pasajero (sin red, 429), el arranque
  // lo dice mientras reintenta en vez de parecer colgado.
  const restauracion = useAuthStore((s) => s.restauracion);

  useEffect(() => {
    if (!hasBackend || !useAuthStore.getState().sessionHint) return;
    let cancelled = false;
    // Cota dura del arranque: si el restore no resolvio en 25s (dos intentos
    // del cliente HTTP no alcanzan; uno si), se cae al login en vez de dejar
    // al usuario rehen del esqueleto. Si bootstrap termina tarde CON exito,
    // isAuthenticated cambia y la UI transiciona sola del login al home.
    const tope = setTimeout(() => {
      if (!cancelled) setBooting(false);
    }, 25000);
    const avisoLento = setTimeout(() => {
      if (!cancelled) setBootLento(true);
    }, 5000);
    useAuthStore
      .getState()
      .bootstrap()
      .finally(() => {
        clearTimeout(tope);
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(tope);
      clearTimeout(avisoLento);
    };
  }, []);

  // Deep links (kiramopay:// and https://app.kiramopay.com). Mounted here, above
  // the auth gate, so a link that arrives on the login screen is parked by the
  // hook and replayed once the session exists; Layout only applies the target.
  const navigateTo = useCallback((tab: string, params?: Record<string, string>) => {
    publishDeepLink({ tab, params: params ?? {} });
  }, []);
  useDeepLinks({ navigateTo, isAuthenticated: state.isAuthenticated });

  // El cierre por inactividad del servidor cuenta desde la ultima ACCION de la
  // persona: este gancho se lo avisa (a lo sumo una vez por minuto, y solo ante
  // un toque, una tecla o la rueda; nunca por temporizador ni por una peticion
  // de fondo como los precios o el sondeo de un pedido).
  useActividadDeSesion(state.isAuthenticated);

  // Sync data from backend when app mounts with an authenticated user
  useEffect(() => {
    if (state.isAuthenticated) {
      import('@/services/dataSync').then(({ syncAllData }) => {
        syncAllData().catch(() => {});
      });
    }
  }, [state.isAuthenticated]);

  if (booting) {
    // Arranque con marca y estado, no un esqueleto mudo: el usuario del APK
    // mataba el proceso creyendo que la app estaba rota mientras el backend
    // gratuito despertaba.
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--color-background-dark)]">
        <div className="w-16 h-16 uv-gradient-brand rounded-2xl flex items-center justify-center uv-shadow-primary">
          <MarcaKiramo size={40} />
        </div>
        <div className="w-6 h-6 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden="true" />
        <p role="status" aria-live="polite" className="text-sm text-[var(--color-text-secondary-dark)] px-8 text-center">
          {restauracion === 'reintentando'
            ? t('boot_retrying')
            : bootLento
              ? t('boot_waking')
              : t('boot_connecting')}
        </p>
      </div>
    );
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
  // Sin servidor: los datos de ejemplo pasan al idioma de la app cuando carga.
  useSemillasDeLaDemo();

  // El servidor escribe los avisos y los push en el idioma de la persona.
  useIdiomaEnElServidor();

  useEffect(() => {
    // Hide native splash screen after app is ready
    const soltarSplash = () =>
      SplashScreen.hide().catch(() => {
        // Not running in Capacitor native context — ignore
      });
    // Con la intro de la K el splash lo quita la intro, cuando ya tiene su
    // primer cuadro (la misma K) listo para tomar el relevo. Si la intro se va
    // sin haberlo quitado (fallo al armarse), se quita aca.
    if (introEnCurso()) return alTerminarLaIntro(soltarSplash);
    soltarSplash();
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Barras del sistema y theme-color con el tema de la app, no el del telefono.
  useBarrasDelSistema(darkMode);

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

// Envoltura que corta el paso cuando el bundle que corre ya no es el
// desplegado. Va DENTRO de LanguageProvider (la pantalla de respaldo habla el
// idioma de la persona) y por encima de todo lo demas: seguir usando una
// version vieja termina en un error incomprensible en cuanto se abre una
// pantalla diferida.
//
// En la web la recarga es automatica: nadie tiene que ver una pantalla ni
// tocar un boton, igual que cuando el navegador refresca una pagina. Mientras
// esta en curso no hay nada que pintar. Solo si esta pestana ya se quedo sin
// intentos (useRecargaAutomaticaDeVersion, por una cache intermedia que nunca
// suelta la version vieja) se cae a la pantalla con el boton manual — esa
// pantalla sigue teniendo su propia cuenta regresiva y recarga sola cada 10s
// si nadie toca el boton; a proposito, para no depender de que la persona
// este mirando en ese momento, pero ya de forma visible y no silenciosa.
const AppConGuardia: React.FC = () => {
  const { desactualizada, versionDesplegada } = useGuardiaDeVersion();
  // La capa web que corre ya se pinto: se le confirma al plugin de la
  // actualizacion interna. Va aca, dentro del ErrorBoundary, y no antes de
  // montar React: un paquete nuevo que revienta al pintar no llega a este
  // efecto, y el plugin vuelve solo al paquete del binario.
  useEffect(() => {
    void asegurarArranque();
  }, []);
  const agotada = useRecargaAutomaticaDeVersion(desactualizada);
  if (desactualizada) {
    return agotada ? <AppDesactualizada version={versionDesplegada} /> : null;
  }
  // En la app instalada, una version nueva publicada se exige antes del login.
  return (
    <BarreraDeActualizacion>
      <AppInit />
    </BarreraDeActualizacion>
  );
};

const App: React.FC = () => {
  // Atras del navegador y Escape. Se instala al montar, antes de cualquier capa:
  // una recarga con pantallas abiertas deja entradas de historial de la carga
  // anterior, y hay que limpiarlas aunque se caiga en el login.
  useEffect(() => {
    instalarNavegacionPorCapas();
  }, []);
  // Solo en la app instalada y una vez por arranque.
  const [intro] = useState(decidirIntro);

  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AppConGuardia />
        {/* Sin conexion: visible sobre el login, la app y cualquier hoja. */}
        <OfflineBanner />
      </LanguageProvider>
      {intro && <IntroDeLaK concepto={intro.concepto} />}
    </ErrorBoundary>
  );
};

export default App;
