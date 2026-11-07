import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { IconoDeDispositivo } from '@/components/IconoDeDispositivo';
import { getApiLayer } from '@/api';
import type { AdminUser } from '@/api/repositories/admin.repository';
import type { DeviceSession } from '@/api/repositories/sessions.repository';
import type { PlanPersonal } from '@/api/repositories/plans.repository';
import { PLANES_PERSONALES, rellenar } from '@/utils/planes';
import { localeDe } from '@/utils/periodos';
import { useClaseDeVentana } from '@/navegacion/NavegacionAdaptable';
import { useCapa } from '@/navegacion/pilaDeCapas';
import { useAuthStore } from '@/stores/auth.store';
import { SolicitudesDeEliminacion } from './SolicitudesDeEliminacion';
import { ListaDeCuentas } from './usuarios/ListaDeCuentas';
import { DetalleDeCuenta, type Aviso } from './usuarios/DetalleDeCuenta';
import { useDetalleDeCuenta } from './usuarios/useDetalleDeCuenta';
import { BOTON, TARJETA, errorKey, fullName, nombreDeSesion, toInputValue, type ModoDeLista } from './usuarios/formato';

type Tab = 'search' | 'blocked' | 'deletions';

const MIN_TERM = 3;
const REASON_MAX = 500;
const PRESET_DAYS = [1, 7, 30];

// Cada cuanto avanza el reloj de la vista. El barrido del servidor corre cada
// minuto, asi que medio minuto alcanza para que la pantalla no se quede atras.
const RELOJ_MS = 30000;

/**
 * Gestion de usuarios del panel de administracion.
 *
 * En telefono (< 600 px) la lista va en filas y tocar una abre el detalle a
 * pantalla completa (Atras vuelve a la lista). En tablet y escritorio la lista
 * es una tabla y el detalle va al lado (o debajo, si no hay ancho): datos,
 * sesiones abiertas con "Cerrar" por dispositivo, bloqueo e historial.
 */
export const AdminUsersView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const locale = localeDe(language);
  const modo: ModoDeLista = useClaseDeVentana() === 'compacta' ? 'filas' : 'tabla';
  const miId = useAuthStore((s) => s.user?.id ?? null);

  const [tab, setTab] = useState<Tab>('search');

  const [query, setQuery] = useState('');
  const [shortTerm, setShortTerm] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<AdminUser[]>([]);
  // Error codes live in state and are translated at render time so the effects
  // never depend on t (it is recreated on every render).
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  const [blocked, setBlocked] = useState<AdminUser[]>([]);
  const [blockedLoaded, setBlockedLoaded] = useState(false);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [blockedError, setBlockedError] = useState<string | null>(null);

  // La cuenta elegida. null deja que mande la eleccion automatica (el unico
  // resultado de la lista).
  const [seleccion, setSeleccion] = useState<string | null>(null);
  // En telefono, Atras desde el detalle de un resultado unico vuelve a la
  // lista: sin esto la eleccion automatica lo volveria a abrir.
  const [volvioALista, setVolvioALista] = useState(false);
  const [aviso, setAviso] = useState<(Aviso & { userId: string }) | null>(null);

  // Reloj de la vista. Vive en estado y no se lee durante el render (regla de
  // pureza de React). Avanza por su cuenta: si solo se refrescara al cambiar la
  // lista, una ficha abierta seguiria diciendo que la cuenta no ha vencido
  // mucho despues de que el barrido del servidor la cerrara.
  const [ahora, setAhora] = useState(0);

  const [acting, setActing] = useState<string | null>(null);
  const actingRef = useRef(false);
  const [blocking, setBlocking] = useState<AdminUser | null>(null);
  const [unblocking, setUnblocking] = useState<AdminUser | null>(null);
  const [expiring, setExpiring] = useState<AdminUser | null>(null);
  const [expiryValue, setExpiryValue] = useState('');
  const [reason, setReason] = useState('');
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [cambiandoPlan, setCambiandoPlan] = useState<AdminUser | null>(null);
  const [planElegido, setPlanElegido] = useState<PlanPersonal>('free');
  const [cerrandoSesion, setCerrandoSesion] = useState<DeviceSession | null>(null);
  const [cerrandoTodas, setCerrandoTodas] = useState(false);

  const desplazable = useRef<HTMLDivElement>(null);
  const detalleRef = useRef<HTMLDivElement>(null);
  // La fila desde la que se abrio la ficha en telefono: al volver, el foco
  // regresa a ella y no al principio del documento.
  const volverA = useRef<string | null>(null);

  useEffect(() => {
    setAhora(Date.now());
    const id = window.setInterval(() => setAhora(Date.now()), RELOJ_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (tab !== 'blocked') return;
    let cancelled = false;
    const run = async () => {
      setLoadingBlocked(true);
      setBlockedError(null);
      const api = getApiLayer();
      if (!api.admin) { if (!cancelled) setLoadingBlocked(false); return; }
      try {
        const res = await api.admin.listBlockedUsers();
        if (cancelled) return;
        if (res.success) { setBlocked(res.data ?? []); setBlockedLoaded(true); }
        else setBlockedError(res.error?.code || 'ADMIN_ACTION_FAILED');
      } catch {
        if (!cancelled) setBlockedError('ADMIN_ACTION_FAILED');
      } finally {
        if (!cancelled) setLoadingBlocked(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [tab]);

  // ── La cuenta que se mira ──────────────────────────────────────────────────
  // Mientras se recarga Bloqueadas, la lista vieja no alimenta la eleccion:
  // pediria sesiones e historial de una cuenta que quiza ya no esta.
  const lista = tab === 'search' ? results : tab === 'blocked' && !loadingBlocked ? blocked : [];
  // Solo se abre sola la ficha de un resultado unico. Con varios, se elige:
  // no se piden sesiones ni historial de una cuenta que nadie toco.
  const auto =
    lista.length === 1 && (modo === 'tabla' || (tab === 'search' && !volvioALista)) ? lista[0].id : null;
  const elegidoId = seleccion !== null && lista.some((u) => u.id === seleccion) ? seleccion : auto;
  const elegido = lista.find((u) => u.id === elegidoId) ?? null;
  const detalle = useDetalleDeCuenta(tab === 'deletions' ? null : elegidoId);
  const detalleAPantallaCompleta = modo === 'filas' && elegido !== null;

  const volverALista = () => {
    volverA.current = elegidoId;
    setSeleccion(null);
    setVolvioALista(true);
    setAviso(null);
  };
  // En telefono el detalle es una pantalla: Atras (o Escape) vuelve a la lista.
  useCapa(detalleAPantallaCompleta, 'pantalla', volverALista);

  useEffect(() => {
    if (detalleAPantallaCompleta || volverA.current === null) return;
    const id = volverA.current;
    volverA.current = null;
    const fila = Array.from(desplazable.current?.querySelectorAll<HTMLElement>('[data-cuenta]') ?? [])
      .find((el) => el.dataset.cuenta === id);
    fila?.focus();
  }, [detalleAPantallaCompleta]);

  const elegir = (id: string) => {
    setSeleccion(id);
    setAviso(null);
    requestAnimationFrame(() => {
      if (modo === 'filas') {
        desplazable.current?.scrollTo?.({ top: 0 });
        return;
      }
      // Con la tabla y el detalle apilados (tablet), el detalle queda debajo:
      // se trae a la vista si no se alcanza a ver.
      const el = detalleRef.current;
      if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) {
        const reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView?.({ block: 'start', behavior: reducido ? 'auto' : 'smooth' });
      }
    });
  };

  const cambiarTab = (nueva: Tab) => {
    setTab(nueva);
    setSeleccion(null);
    setAviso(null);
  };

  const avisar = (userId: string, texto: string, ok = true) => setAviso({ userId, texto, ok });

  const runSearch = async () => {
    const term = query.trim();
    if (term.length < MIN_TERM) { setShortTerm(true); return; }
    setShortTerm(false);
    setSearchError(null);
    setSearching(true);
    const seq = ++searchSeq.current;
    try {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.searchUsers(term);
      // A newer search superseded this one: its answer must not land.
      if (seq !== searchSeq.current) return;
      if (res.success) {
        setResults(res.data ?? []);
        setSearched(true);
        setSeleccion(null);
        setVolvioALista(false);
        setAviso(null);
      } else setSearchError(res.error?.code || 'ADMIN_ACTION_FAILED');
    } catch {
      if (seq === searchSeq.current) setSearchError('ADMIN_ACTION_FAILED');
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const applyUpdate = (u: AdminUser) => {
    setResults((list) => list.map((x) => (x.id === u.id ? u : x)));
    // Una cuenta recien bloqueada entra a Bloqueadas (y a su cuenta) sin
    // esperar a volver a la pestana. Una desbloqueada se queda en la lista,
    // ya como activa, hasta la proxima carga: si saliera, su ficha y el aviso
    // de lo que se hizo desaparecerian de golpe.
    setBlocked((list) =>
      list.some((x) => x.id === u.id)
        ? list.map((x) => (x.id === u.id ? u : x))
        : u.status === 'blocked' ? [u, ...list] : list,
    );
  };

  // ── Acciones ───────────────────────────────────────────────────────────────
  const openBlock = (u: AdminUser) => { setReason(''); setSheetError(null); setBlocking(u); };
  const openUnblock = (u: AdminUser) => { setSheetError(null); setUnblocking(u); };
  const openExpiry = (u: AdminUser) => {
    const actual = u.expiresAt ? new Date(u.expiresAt) : null;
    setExpiryValue(actual && !Number.isNaN(actual.getTime()) ? toInputValue(actual) : '');
    setSheetError(null);
    setExpiring(u);
  };
  const openPlan = (u: AdminUser) => {
    setPlanElegido(u.plan);
    setSheetError(null);
    setCambiandoPlan(u);
  };

  /**
   * La guarda de doble envio compartida por todas las acciones: un segundo
   * toque antes de que React vuelva a pintar no manda otra peticion.
   */
  const conGuarda = async (id: string, accion: () => Promise<void>) => {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(id);
    setSheetError(null);
    try {
      await accion();
    } catch {
      setSheetError('ADMIN_ACTION_FAILED');
    } finally {
      actingRef.current = false;
      setActing(null);
    }
  };

  const confirmBlock = async () => {
    if (!blocking || actingRef.current) return;
    const why = reason.trim();
    if (!why) { setSheetError('REASON_REQUIRED'); return; }
    const objetivo = blocking;
    await conGuarda(objetivo.id, async () => {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.blockUser(objetivo.id, why);
      if (res.success && res.data) {
        applyUpdate(res.data);
        setBlocking(null);
        setReason('');
        // El bloqueo revoca todas las sesiones en la misma transaccion.
        detalle.vaciarSesiones(objetivo.id);
        avisar(objetivo.id, t('admin_users_blocked_done'));
        detalle.recargarHistorialLuego(objetivo.id);
      } else {
        setSheetError(res.error?.code || 'ADMIN_ACTION_FAILED');
      }
    });
  };

  const confirmUnblock = async () => {
    if (!unblocking) return;
    const objetivo = unblocking;
    await conGuarda(objetivo.id, async () => {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.unblockUser(objetivo.id);
      if (res.success && res.data) {
        applyUpdate(res.data);
        setUnblocking(null);
        avisar(objetivo.id, t('admin_users_unblocked_done'));
        detalle.recargarHistorialLuego(objetivo.id);
      } else {
        setSheetError(res.error?.code || 'ADMIN_ACTION_FAILED');
      }
    });
  };

  // clear=true quita el vencimiento; si no, se manda la fecha del campo.
  const confirmExpiry = async (clear: boolean) => {
    if (!expiring || actingRef.current) return;
    let iso: string | null = null;
    if (!clear) {
      const d = new Date(expiryValue);
      if (!expiryValue || Number.isNaN(d.getTime())) { setSheetError('INVALID_EXPIRY'); return; }
      iso = d.toISOString();
    }
    const objetivo = expiring;
    await conGuarda(objetivo.id, async () => {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.setUserExpiry(objetivo.id, iso);
      if (res.success && res.data) {
        applyUpdate(res.data);
        setExpiring(null);
        avisar(objetivo.id, t('admin_users_expiry_done'));
        detalle.recargarHistorialLuego(objetivo.id);
      } else {
        setSheetError(res.error?.code || 'ADMIN_ACTION_FAILED');
      }
    });
  };

  // Sin cobro todavia, el plan de un piloto se asigna a mano. El servidor
  // audita cada cambio.
  const confirmPlan = async () => {
    if (!cambiandoPlan || planElegido === cambiandoPlan.plan) return;
    const id = cambiandoPlan.id;
    const elegidoPlan = planElegido;
    await conGuarda(id, async () => {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.setUserPlan(id, elegidoPlan);
      if (res.success && res.data) {
        const nuevo = res.data.plan;
        setResults((list) => list.map((x) => (x.id === id ? { ...x, plan: nuevo } : x)));
        setBlocked((list) => list.map((x) => (x.id === id ? { ...x, plan: nuevo } : x)));
        avisar(id, rellenar(t('admin_users_plan_done'), {
          antes: t(`plans_name_${res.data.planAnterior}`),
          ahora: t(`plans_name_${nuevo}`),
        }));
        setCambiandoPlan(null);
        detalle.recargarHistorialLuego(id);
      } else {
        setSheetError(res.error?.code || 'ADMIN_ACTION_FAILED');
      }
    });
  };

  const openCerrarSesion = (s: DeviceSession) => { setSheetError(null); setCerrandoSesion(s); };
  const openCerrarTodas = () => { setSheetError(null); setCerrandoTodas(true); };

  const confirmarCerrarSesion = async () => {
    if (!cerrandoSesion || !elegido) return;
    const uid = elegido.id;
    const s = cerrandoSesion;
    const nombre = nombreDeSesion(s, t);
    await conGuarda(uid, async () => {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.revokeUserSession(uid, s.id);
      // SESSION_NOT_FOUND: ese aparato ya no tiene sesion. La fila sale igual,
      // porque dejarla mostraria un acceso que ya no existe.
      if (res.success || res.error?.code === 'SESSION_NOT_FOUND') {
        detalle.quitarSesion(uid, s.id);
        setCerrandoSesion(null);
        if (res.success) {
          avisar(uid, rellenar(t('admin_users_session_closed'), { device: nombre }));
          detalle.recargarHistorialLuego(uid);
        } else {
          avisar(uid, t('sessions_err_gone'), false);
        }
      } else {
        setSheetError(res.error?.code || 'ADMIN_ACTION_FAILED');
      }
    });
  };

  const confirmarCerrarTodas = async () => {
    if (!elegido) return;
    const uid = elegido.id;
    await conGuarda(uid, async () => {
      const api = getApiLayer();
      if (!api.admin) return;
      const res = await api.admin.revokeAllUserSessions(uid);
      if (res.success) {
        detalle.vaciarSesiones(uid);
        setCerrandoTodas(false);
        avisar(uid, rellenar(t('admin_users_sessions_closed_all'), { count: res.data ?? 0 }));
        detalle.recargarHistorialLuego(uid);
      } else {
        setSheetError(res.error?.code || 'ADMIN_ACTION_FAILED');
      }
    });
  };

  // ── Piezas ─────────────────────────────────────────────────────────────────
  const spinner = (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const emptyState = (icon: React.ReactNode, text: string, hint?: string) => (
    <div className={`${TARJETA} flex flex-col items-center justify-center py-14 px-6 text-center`}>
      <div className="w-12 h-12 rounded-[14px] bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-3 uv-text-muted">
        {icon}
      </div>
      <p className="font-semibold uv-text-primary">{text}</p>
      {hint && <p className="mt-1 max-w-sm text-[13px] leading-relaxed uv-text-muted">{hint}</p>}
    </div>
  );

  const errorTexto = (code: string) => (
    <p className="mb-3 text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]" role="alert">{t(errorKey(code))}</p>
  );

  const sheetPerson = (u: AdminUser) => (
    <div>
      <p className="font-semibold uv-text-primary">{fullName(u)}</p>
      <p className="text-xs uv-text-muted kp-num mt-0.5">{u.cedulaMasked}</p>
    </div>
  );

  const sheetErrorLine = sheetError && (
    <p className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]" role="alert">{t(errorKey(sheetError))}</p>
  );

  const botonesDeHoja = (confirmar: () => void, texto: string, cancelar: () => void, peligro: boolean, deshabilitado = false) => (
    <div className="flex flex-col gap-2.5 pt-1">
      <button
        type="button"
        onClick={confirmar}
        disabled={acting !== null || deshabilitado}
        className={`w-full h-12 rounded-2xl text-white text-[15px] font-semibold kp-toque kp-foco disabled:opacity-50 ${
          peligro ? 'bg-[var(--color-danger-fill)]' : 'bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)]'
        }`}
      >
        {acting ? t('loading') : texto}
      </button>
      <button
        type="button"
        onClick={cancelar}
        disabled={acting !== null}
        className="w-full h-12 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-primary text-[15px] font-semibold kp-toque kp-foco disabled:opacity-50"
      >
        {t('cancel')}
      </button>
    </div>
  );

  const tabs: Array<{ id: Tab; etiqueta: string; cuenta?: number }> = [
    { id: 'search', etiqueta: t('admin_users_tab_search') },
    { id: 'blocked', etiqueta: t('admin_users_tab_blocked'), cuenta: blockedLoaded ? blocked.filter((u) => u.status === 'blocked').length : undefined },
    { id: 'deletions', etiqueta: t('admin_del_tab') },
  ];

  // Flechas, Inicio y Fin mueven entre pestanas; Tab entra al contenido.
  const alTecladoEnPestana = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const destino =
      e.key === 'ArrowRight' ? (i + 1) % n
        : e.key === 'ArrowLeft' ? (i - 1 + n) % n
          : e.key === 'Home' ? 0
            : e.key === 'End' ? n - 1
              : -1;
    if (destino < 0) return;
    e.preventDefault();
    const nueva = tabs[destino].id;
    cambiarTab(nueva);
    document.getElementById(`admin-usuarios-tab-${nueva}`)?.focus();
  };

  const detalleDe = (u: AdminUser) => (
    <DetalleDeCuenta
      user={u}
      ahora={ahora}
      locale={locale}
      t={t}
      modo={modo}
      sesiones={detalle.sesiones}
      historial={detalle.historial}
      ocupado={acting !== null}
      aviso={aviso && aviso.userId === u.id ? aviso : null}
      esMiCuenta={miId !== null && u.id === miId}
      enfocar={modo === 'filas'}
      onBloquear={() => openBlock(u)}
      onDesbloquear={() => openUnblock(u)}
      onVencimiento={() => openExpiry(u)}
      onPlan={() => openPlan(u)}
      onCerrarSesion={openCerrarSesion}
      onCerrarTodas={openCerrarTodas}
      onReintentarSesiones={detalle.reintentarSesiones}
      onReintentarHistorial={detalle.reintentarHistorial}
    />
  );

  const cuerpoDeLista = () => {
    const cargando = tab === 'search' ? searching : loadingBlocked;
    if (cargando) return spinner;
    if (tab === 'search' && !searched) {
      return emptyState(<Icons.Search size={22} />, t('admin_users_search_intro'), t('admin_users_search_intro_hint'));
    }
    if (lista.length === 0) {
      return tab === 'search'
        ? emptyState(<Icons.Search size={22} />, t('admin_users_empty'))
        : emptyState(<Icons.Unlock size={22} />, t('admin_users_no_blocked'));
    }
    const etiqueta = tab === 'search' ? t('admin_users_results') : t('admin_users_tab_blocked');
    if (modo === 'filas') {
      return (
        <ListaDeCuentas cuentas={lista} elegida={elegidoId} onElegir={elegir} variante={tab === 'search' ? 'buscar' : 'bloqueadas'} modo="filas" locale={locale} t={t} etiqueta={etiqueta} />
      );
    }
    return (
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @4xl:items-start">
        {/* Al lado del detalle, la lista se queda a la vista mientras se baja
            por la ficha; si es larga, se desplaza por dentro. */}
        <div className="min-w-0 @4xl:sticky @4xl:top-4 @4xl:max-h-[calc(100dvh-9rem)] @4xl:overflow-y-auto @4xl:rounded-[20px]">
          <ListaDeCuentas cuentas={lista} elegida={elegidoId} onElegir={elegir} variante={tab === 'search' ? 'buscar' : 'bloqueadas'} modo="tabla" locale={locale} t={t} etiqueta={etiqueta} />
        </div>
        <div ref={detalleRef} className="scroll-mt-4 min-w-0">
          {elegido
            ? detalleDe(elegido)
            : emptyState(<Icons.User size={22} />, t('admin_users_select_hint'))}
        </div>
      </div>
    );
  };

  const fechaPasada = expiryValue !== '' && !Number.isNaN(new Date(expiryValue).getTime()) && new Date(expiryValue).getTime() <= ahora;

  return (
    // data-ancho="libre": la lista y el detalle van lado a lado y necesitan el
    // ancho entero, no la columna de lectura de las demas capas.
    <div data-ancho="libre" className="fixed inset-0 kp-capa z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col slide-in-from-right">
      <header className="sticky top-0 z-10 flex-shrink-0 bg-[var(--color-background)]/85 dark:bg-[var(--color-background-dark)]/85 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
        <div className="mx-auto w-full max-w-[1200px] px-2 sm:px-4 lg:px-6 pt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={detalleAPantallaCompleta ? volverALista : onClose}
            className="w-11 h-11 flex items-center justify-center rounded-2xl uv-text-secondary hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] kp-toque kp-foco"
            aria-label={detalleAPantallaCompleta ? t('admin_users_back_to_list') : t('back')}
          >
            <Icons.ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] uv-text-primary truncate">{t('admin_users_title')}</h1>
            <p className="hidden sm:block text-xs uv-text-muted text-pretty">{t('admin_users_subtitle')}</p>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1200px] px-3 sm:px-5 lg:px-7">
          {/* Sin truncar: si no caben, la fila se desplaza de lado. */}
          <div role="tablist" aria-label={t('admin_users_title')} className="flex gap-1 overflow-x-auto no-scrollbar">
            {tabs.map(({ id, etiqueta, cuenta }, i) => {
              const sel = tab === id;
              return (
                <button
                  key={id}
                  id={`admin-usuarios-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  aria-controls="admin-usuarios-panel"
                  tabIndex={sel ? 0 : -1}
                  onClick={() => cambiarTab(id)}
                  onKeyDown={(e) => alTecladoEnPestana(e, i)}
                  className={`relative shrink-0 h-11 px-3 flex items-center gap-2 text-sm whitespace-nowrap kp-foco rounded-t-lg ${
                    sel ? 'font-semibold uv-text-primary' : 'font-medium uv-text-muted hover:text-[var(--color-text-secondary)] dark:hover:text-[var(--color-text-secondary-dark)]'
                  }`}
                >
                  <span>{etiqueta}</span>
                  {cuenta !== undefined && (
                    <span className={`kp-num rounded-md px-1.5 py-px text-xs font-semibold ${sel ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary-700)] dark:text-[var(--color-primary-tint)]' : 'bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-muted'}`}>
                      {cuenta}
                    </span>
                  )}
                  {sel && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--color-primary)]" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div ref={desplazable} id="admin-usuarios-panel" role="tabpanel" aria-labelledby={`admin-usuarios-tab-${tab}`} className="flex-1 overflow-y-auto">
        {tab === 'deletions' ? (
          <div className="mx-auto w-full max-w-3xl pb-8">
            <SolicitudesDeEliminacion />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[1200px] px-4 lg:px-6 pt-4 pb-10 @container">
            {detalleAPantallaCompleta && elegido ? (
              detalleDe(elegido)
            ) : (
              <>
                {tab === 'search' && (
                  <form role="search" onSubmit={(e) => { e.preventDefault(); void runSearch(); }} className="mb-4">
                    <div className="flex flex-wrap gap-2">
                      <div className="relative flex-1 min-w-0 basis-full min-[480px]:basis-0">
                        <Icons.Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 uv-text-muted pointer-events-none" aria-hidden="true" />
                        <input
                          type="text"
                          value={query}
                          onChange={(e) => { setQuery(e.target.value); if (shortTerm) setShortTerm(false); }}
                          placeholder={t('admin_users_search_placeholder')}
                          aria-label={t('admin_users_search_placeholder')}
                          aria-invalid={shortTerm || undefined}
                          aria-describedby="admin-users-search-hint"
                          enterKeyHint="search"
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          className="w-full h-11 pl-10 pr-3 rounded-xl uv-surface-1 ring-1 ring-inset ring-[var(--color-border-strong)] dark:ring-[var(--color-border-control-dark)] outline-none focus:ring-2 focus:ring-[var(--color-primary)] uv-text-primary placeholder:text-[var(--color-text-muted)] dark:placeholder:text-[var(--color-text-muted-dark)]"
                        />
                      </div>
                      <button type="submit" disabled={searching} className={`${BOTON.primario} h-11 basis-full min-[480px]:basis-auto`}>
                        {t('admin_users_search_action')}
                      </button>
                    </div>
                    <p id="admin-users-search-hint" className={`mt-1.5 text-xs ${shortTerm ? 'text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]' : 'uv-text-muted'}`} aria-live="polite">
                      {t('admin_users_search_hint')}
                    </p>
                  </form>
                )}
                {tab === 'search' && searchError && errorTexto(searchError)}
                {tab === 'blocked' && blockedError && errorTexto(blockedError)}
                {cuerpoDeLista()}
              </>
            )}
          </div>
        )}
      </div>

      <BottomSheet isOpen={blocking !== null} onClose={() => { if (!acting) setBlocking(null); }} title={t('admin_users_block_title')} dismissable={acting === null}>
        {blocking && (
          <div className="space-y-4">
            {sheetPerson(blocking)}
            <div className="flex gap-3 rounded-xl bg-[var(--color-danger-soft)] p-3">
              <Icons.AlertTriangle size={18} className="shrink-0 mt-0.5 text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]" aria-hidden="true" />
              <p className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
                {t('admin_users_block_warning')}
                {blocking.id === elegidoId && !detalle.sesiones.cargando && !detalle.sesiones.error && (
                  <> {rellenar(t('admin_users_block_sessions_note'), { count: detalle.sesiones.datos.length })}</>
                )}
              </p>
            </div>
            <div>
              <label htmlFor="admin-users-block-reason" className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('admin_users_block_reason')}</label>
              <textarea
                id="admin-users-block-reason"
                value={reason}
                onChange={(e) => { setReason(e.target.value); if (sheetError) setSheetError(null); }}
                rows={3}
                maxLength={REASON_MAX}
                autoFocus
                placeholder={t('admin_users_block_reason_placeholder')}
                disabled={acting !== null}
                aria-invalid={sheetError === 'REASON_REQUIRED' || undefined}
                aria-describedby="admin-users-block-reason-hint"
                className="w-full px-3 py-2.5 rounded-xl bg-transparent ring-1 ring-inset ring-[var(--color-border-strong)] dark:ring-[var(--color-border-control-dark)] outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
              />
              <div className="flex justify-between gap-3 mt-1 text-xs uv-text-muted">
                <span id="admin-users-block-reason-hint">{t('admin_users_block_reason_hint')}</span>
                <span className="kp-num shrink-0">{reason.length}/{REASON_MAX}</span>
              </div>
            </div>
            {sheetErrorLine}
            {botonesDeHoja(() => void confirmBlock(), t('admin_users_block_confirm'), () => setBlocking(null), true)}
          </div>
        )}
      </BottomSheet>

      <BottomSheet isOpen={expiring !== null} onClose={() => { if (!acting) setExpiring(null); }} title={t('admin_users_expiry_title')} dismissable={acting === null}>
        {expiring && (
          <div className="space-y-4">
            {sheetPerson(expiring)}
            <p className="text-sm uv-text-secondary">{t('admin_users_expiry_hint')}</p>

            <div className="flex gap-2">
              {PRESET_DAYS.map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={acting !== null}
                  onClick={() => {
                    setExpiryValue(toInputValue(new Date(Date.now() + days * 86400000)));
                    if (sheetError) setSheetError(null);
                  }}
                  className="flex-1 h-9 rounded-xl ring-1 ring-inset ring-[var(--color-border-strong)] dark:ring-[var(--color-border-strong-dark)] text-xs font-semibold uv-text-secondary kp-toque kp-foco disabled:opacity-50"
                >
                  {t(`admin_users_expiry_in_${days}d`)}
                </button>
              ))}
            </div>

            <div>
              <label htmlFor="admin-users-expiry-at" className="text-sm font-medium uv-text-secondary mb-1.5 block">
                {t('admin_users_expires_at')}
              </label>
              <input
                id="admin-users-expiry-at"
                type="datetime-local"
                value={expiryValue}
                onChange={(e) => { setExpiryValue(e.target.value); if (sheetError) setSheetError(null); }}
                disabled={acting !== null}
                aria-invalid={sheetError === 'INVALID_EXPIRY' || sheetError === 'EXPIRY_REQUIRED' || undefined}
                className="w-full h-11 px-3 rounded-xl bg-transparent ring-1 ring-inset ring-[var(--color-border-strong)] dark:ring-[var(--color-border-control-dark)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
              {fechaPasada && (
                <p className="mt-1.5 text-xs text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">{t('admin_users_expiry_past')}</p>
              )}
            </div>

            {sheetErrorLine}

            <button
              type="button"
              onClick={() => void confirmExpiry(false)}
              disabled={acting !== null}
              className="w-full h-12 rounded-2xl bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white text-[15px] font-semibold kp-toque kp-foco disabled:opacity-50"
            >
              {acting ? t('loading') : t('admin_users_expiry_save')}
            </button>
            {expiring.expiresAt && (
              <button
                type="button"
                onClick={() => void confirmExpiry(true)}
                disabled={acting !== null}
                className="w-full h-12 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-primary text-[15px] font-semibold kp-toque kp-foco disabled:opacity-50"
              >
                {t('admin_users_expiry_clear')}
              </button>
            )}
          </div>
        )}
      </BottomSheet>

      <BottomSheet isOpen={cambiandoPlan !== null} onClose={() => { if (!acting) setCambiandoPlan(null); }} title={t('admin_users_plan_title')} dismissable={acting === null}>
        {cambiandoPlan && (
          <div className="space-y-4">
            {sheetPerson(cambiandoPlan)}
            <p className="text-sm uv-text-secondary">{t('admin_users_plan_hint')}</p>
            <fieldset>
              <legend className="sr-only">{t('admin_users_plan_title')}</legend>
              <div className="grid grid-cols-3 gap-2">
                {PLANES_PERSONALES.map((p) => {
                  const marcado = planElegido === p;
                  return (
                    <label
                      key={p}
                      className={`cursor-pointer rounded-xl border-2 px-2 py-3 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)] ${
                        marcado
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                          : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="plan-persona"
                        value={p}
                        checked={marcado}
                        disabled={acting !== null}
                        onChange={() => { setPlanElegido(p); if (sheetError) setSheetError(null); }}
                        className="sr-only"
                      />
                      <span className="block font-semibold uv-text-primary">{t(`plans_name_${p}`)}</span>
                      {cambiandoPlan.plan === p && (
                        <span className="mt-0.5 block text-[11px] font-semibold uv-text-muted">{t('admin_users_plan_current')}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {PLANES_PERSONALES.indexOf(planElegido) < PLANES_PERSONALES.indexOf(cambiandoPlan.plan) && (
              <p className="text-xs leading-relaxed uv-text-secondary">{t('admin_users_plan_lower_note')}</p>
            )}
            {sheetErrorLine}
            <button
              type="button"
              onClick={() => void confirmPlan()}
              disabled={acting !== null || planElegido === cambiandoPlan.plan}
              className="w-full h-12 rounded-2xl bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white text-[15px] font-semibold kp-toque kp-foco disabled:opacity-50"
            >
              {acting ? t('loading') : rellenar(t('admin_users_plan_confirm'), { plan: t(`plans_name_${planElegido}`) })}
            </button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet isOpen={unblocking !== null} onClose={() => { if (!acting) setUnblocking(null); }} title={t('admin_users_unblock_title')} dismissable={acting === null}>
        {unblocking && (
          <div className="space-y-4">
            {sheetPerson(unblocking)}
            <p className="text-sm uv-text-secondary">{t('admin_users_unblock_warning')}</p>
            {sheetErrorLine}
            {botonesDeHoja(() => void confirmUnblock(), t('admin_users_unblock_confirm'), () => setUnblocking(null), false)}
          </div>
        )}
      </BottomSheet>

      <BottomSheet isOpen={cerrandoSesion !== null && elegido !== null} onClose={() => { if (!acting) setCerrandoSesion(null); }} title={t('admin_users_session_close_title')} dismissable={acting === null}>
        {cerrandoSesion && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-[14px] shrink-0 flex items-center justify-center bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-3-dark)] uv-text-secondary">
                <IconoDeDispositivo userAgent={cerrandoSesion.deviceName} size={24} />
              </span>
              <div className="min-w-0">
                <p className="font-semibold uv-text-primary break-words">{nombreDeSesion(cerrandoSesion, t)}</p>
                <p className="mt-0.5 text-xs uv-text-muted kp-num">
                  {elegido ? `${fullName(elegido)} · ` : ''}{rellenar(t('sessions_network_value'), { red: cerrandoSesion.ipMasked || '—' })}
                </p>
              </div>
            </div>
            <p className="text-sm leading-relaxed uv-text-secondary">{t('admin_users_session_close_warning')}</p>
            {sheetErrorLine}
            {botonesDeHoja(() => void confirmarCerrarSesion(), t('sessions_close_confirm'), () => setCerrandoSesion(null), true)}
          </div>
        )}
      </BottomSheet>

      <BottomSheet isOpen={cerrandoTodas && elegido !== null} onClose={() => { if (!acting) setCerrandoTodas(false); }} title={t('admin_users_sessions_close_all_title')} dismissable={acting === null}>
        <div className="space-y-4">
          {elegido && sheetPerson(elegido)}
          <p className="text-sm leading-relaxed uv-text-secondary">
            {rellenar(t('admin_users_sessions_close_all_warning'), { count: detalle.sesiones.datos.length })}
          </p>
          {sheetErrorLine}
          {botonesDeHoja(() => void confirmarCerrarTodas(), t('admin_users_sessions_close_all_confirm'), () => setCerrandoTodas(false), true)}
        </div>
      </BottomSheet>
    </div>
  );
};
