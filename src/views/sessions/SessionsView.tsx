import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { DeviceSession } from '@/api/repositories/sessions.repository';

type Translate = (key: string) => string;

const LOCALE_BY_LANG: Record<string, string> = {
  es: 'es-CR',
  en: 'en-US',
  fr: 'fr-FR',
  pt: 'pt-BR',
  'zh-cn': 'zh-CN',
  ja: 'ja-JP',
  hi: 'hi-IN',
};

// El servidor manda un codigo; la pantalla elige el texto. El mensaje crudo del
// backend no se muestra nunca.
function claveError(code: string | null | undefined, generico = 'sessions_err_generic'): string {
  switch (code) {
    case 'SESSION_NOT_FOUND': return 'sessions_err_gone';
    case 'RATE_LIMITED': return 'sessions_err_rate';
    case 'NETWORK_ERROR': return 'sessions_err_network';
    default: return generico;
  }
}

// El servidor guarda el user agent crudo. Como titulo de la tarjeta no sirve
// para nada ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141" ocupa tres
// renglones y no dice cual aparato es), asi que se reduce a navegador y
// sistema. El orden de las listas importa: Edge y Opera tambien dicen Chrome,
// Chrome tambien dice Safari, y Android tambien dice Linux.
const NAVEGADORES: Array<[RegExp, string]> = [
  [/\bEdg(?:e|iOS|A)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SISTEMAS: Array<[RegExp, string]> = [
  [/\bAndroid\b/, 'Android'],
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'Mac'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

// Lo que no se reconoce se muestra tal cual: inventar un nombre seria peor que
// enseñar el texto del servidor.
function nombreLegible(deviceName: string, plantilla: string): string {
  const nav = NAVEGADORES.find(([re]) => re.test(deviceName))?.[1];
  const so = SISTEMAS.find(([re]) => re.test(deviceName))?.[1];
  if (nav && so) return plantilla.replace('{browser}', nav).replace('{os}', so);
  return nav || so || deviceName;
}

function formatearFecha(iso: string, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

interface SessionCardProps {
  session: DeviceSession;
  busy: boolean;
  locale: string;
  t: Translate;
  onCerrar: (s: DeviceSession) => void;
}

const SessionCard: React.FC<SessionCardProps> = ({ session, busy, locale, t, onCerrar }) => {
  const nombre = nombreLegible(session.deviceName, t('sessions_device_on'));
  return (
    <li
      className={`uv-surface-1 rounded-2xl uv-shadow-soft p-4 ${
        session.current ? 'ring-1 ring-[var(--color-primary)]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            session.current
              ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
              : 'bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-muted'
          }`}
        >
          <Icons.Smartphone size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold uv-text-primary break-words" title={session.deviceName}>{nombre}</p>
          <p className="mt-1 flex items-center gap-1.5 min-w-0 text-xs uv-text-muted">
            <Icons.Globe size={12} className="shrink-0" aria-hidden="true" />
            <span className="truncate tabular-nums">
              {t('sessions_network')}: {session.ipMasked || '—'}
            </span>
          </p>
        </div>
        {session.current && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider uv-chip-success">
            {t('sessions_current_chip')}
          </span>
        )}
      </div>

      <dl className="mt-3 pt-3 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="uv-text-muted">{t('sessions_opened')}</dt>
        <dd className="uv-text-primary tabular-nums">{formatearFecha(session.createdAt, locale)}</dd>
        <dt className="uv-text-muted">{t('sessions_expires')}</dt>
        <dd className="uv-text-primary tabular-nums">{formatearFecha(session.expiresAt, locale)}</dd>
      </dl>

      {session.current ? (
        // La sesion actual no se cierra desde su propia fila: seria echarse a uno
        // mismo de la app sin aviso. Se cierra saliendo de la cuenta.
        <p className="mt-3 text-xs uv-text-muted">{t('sessions_current_hint')}</p>
      ) : (
        <button
          type="button"
          onClick={() => onCerrar(session)}
          disabled={busy}
          aria-label={`${t('sessions_close')}: ${nombre}`}
          className="mt-3 w-full flex items-center justify-center gap-2 border border-[var(--color-danger)] text-[var(--color-danger)] py-2.5 rounded-xl font-bold disabled:opacity-50"
        >
          <Icons.LogOut size={16} aria-hidden="true" />
          {t('sessions_close')}
        </button>
      )}
    </li>
  );
};

export const SessionsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const locale = LOCALE_BY_LANG[language] || 'es-CR';

  const [sesiones, setSesiones] = useState<DeviceSession[]>([]);
  const [cargando, setCargando] = useState(true);
  // Los errores viven en estado como CODIGO y se traducen al pintar, para que
  // los efectos no dependan de t (se recrea en cada render).
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ clave: string; ok: boolean } | null>(null);

  const [cerrando, setCerrando] = useState<DeviceSession | null>(null);
  const [cerrandoDemas, setCerrandoDemas] = useState(false);
  const [enCurso, setEnCurso] = useState(false);
  const enCursoRef = useRef(false);
  const [errorHoja, setErrorHoja] = useState<string | null>(null);

  // Una respuesta que llega despues de cerrar la pantalla no debe tocar estado.
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    const api = getApiLayer();
    if (!api.sessions) {
      setCargando(false);
      setErrorCarga('SESSIONS_FAILED');
      return;
    }
    const res = await api.sessions.listar();
    if (!vivo.current) return;
    if (res.success) setSesiones(res.data ?? []);
    else setErrorCarga(res.error?.code || 'SESSIONS_FAILED');
    setCargando(false);
  }, []);

  useEffect(() => {
    vivo.current = true;
    void cargar();
    return () => { vivo.current = false; };
  }, [cargar]);

  const actual = sesiones.find((s) => s.current) ?? null;
  const otras = sesiones.filter((s) => !s.current);

  const abrirCerrar = (s: DeviceSession) => {
    setErrorHoja(null);
    setAviso(null);
    setCerrando(s);
  };

  const abrirCerrarDemas = () => {
    setErrorHoja(null);
    setAviso(null);
    setCerrandoDemas(true);
  };

  const confirmarCerrar = async () => {
    if (!cerrando || enCursoRef.current) return;
    const id = cerrando.id;
    enCursoRef.current = true;
    setEnCurso(true);
    setErrorHoja(null);
    try {
      const api = getApiLayer();
      if (!api.sessions) return;
      const res = await api.sessions.cerrar(id);
      if (!vivo.current) return;
      // SESSION_NOT_FOUND quiere decir que esa sesion ya no existe: la fila sale
      // igual, porque dejarla mostraria un aparato que ya perdio el acceso.
      const yaNoEsta = res.success || res.error?.code === 'SESSION_NOT_FOUND';
      if (yaNoEsta) {
        setSesiones((lista) => lista.filter((s) => s.id !== id));
        setCerrando(null);
        setAviso({ clave: res.success ? 'sessions_done_one' : 'sessions_err_gone', ok: res.success });
      } else {
        setErrorHoja(res.error?.code || 'SESSIONS_FAILED');
      }
    } catch {
      if (vivo.current) setErrorHoja('SESSIONS_FAILED');
    } finally {
      enCursoRef.current = false;
      if (vivo.current) setEnCurso(false);
    }
  };

  const confirmarCerrarDemas = async () => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setEnCurso(true);
    setErrorHoja(null);
    try {
      const api = getApiLayer();
      if (!api.sessions) return;
      const res = await api.sessions.cerrarLasDemas();
      if (!vivo.current) return;
      if (res.success) {
        setSesiones((lista) => lista.filter((s) => s.current));
        setCerrandoDemas(false);
        setAviso({ clave: 'sessions_done_others', ok: true });
      } else {
        setErrorHoja(res.error?.code || 'SESSIONS_FAILED');
      }
    } catch {
      if (vivo.current) setErrorHoja('SESSIONS_FAILED');
    } finally {
      enCursoRef.current = false;
      if (vivo.current) setEnCurso(false);
    }
  };

  const tituloSeccion = (texto: string) => (
    <h2 className="mb-2 text-xs font-bold uv-text-muted uppercase tracking-wider">{texto}</h2>
  );

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('sessions_title')}</h1>
        <span className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto pb-10">
        {cargando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : errorCarga ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <Icons.AlertCircle size={26} className="text-[var(--color-danger)] mb-3" aria-hidden="true" />
            <p className="font-semibold uv-text-primary" role="alert">
              {t(claveError(errorCarga, 'sessions_err_load'))}
            </p>
            <button
              type="button"
              onClick={() => void cargar()}
              className="mt-4 px-5 py-2.5 rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-bold"
            >
              {t('error_retry')}
            </button>
          </div>
        ) : (
          <>
            <p className="px-4 pt-4 text-sm uv-text-secondary">{t('sessions_intro')}</p>

            {otras.length > 0 && (
              <div className="px-4 pt-4">
                <button
                  type="button"
                  onClick={abrirCerrarDemas}
                  className="w-full flex items-center justify-center gap-2 border border-[var(--color-danger)] text-[var(--color-danger)] py-3 rounded-xl font-bold"
                >
                  <Icons.LogOut size={16} aria-hidden="true" />
                  {t('sessions_close_others')}
                </button>
              </div>
            )}

            {aviso && (
              <div
                role="status"
                aria-live="polite"
                className={`mx-4 mt-4 flex items-start gap-2.5 rounded-xl px-3 py-2.5 ${
                  aviso.ok ? 'uv-chip-success' : 'bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-secondary'
                }`}
              >
                {aviso.ok
                  ? <Icons.Check size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                  : <Icons.Info size={16} className="shrink-0 mt-0.5" aria-hidden="true" />}
                <p className="text-sm font-medium">{t(aviso.clave)}</p>
              </div>
            )}

            {actual && (
              <section className="px-4 pt-6">
                {tituloSeccion(t('sessions_this_device'))}
                <ul className="space-y-3">
                  <SessionCard
                    key={actual.id}
                    session={actual}
                    busy={enCurso}
                    locale={locale}
                    t={t}
                    onCerrar={abrirCerrar}
                  />
                </ul>
              </section>
            )}

            <section className="px-4 pt-6">
              {tituloSeccion(t('sessions_other_devices'))}
              {otras.length === 0 ? (
                <div className="uv-surface-1 rounded-2xl uv-shadow-soft px-4 py-10 flex flex-col items-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-3">
                    <Icons.Smartphone size={24} className="uv-text-muted" aria-hidden="true" />
                  </div>
                  <p className="font-semibold uv-text-primary">{t('sessions_empty')}</p>
                  <p className="mt-1 max-w-xs text-xs uv-text-muted">{t('sessions_empty_hint')}</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {otras.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      busy={enCurso}
                      locale={locale}
                      t={t}
                      onCerrar={abrirCerrar}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <BottomSheet
        isOpen={cerrando !== null}
        onClose={() => { if (!enCurso) setCerrando(null); }}
        title={t('sessions_close_title')}
        dismissable={!enCurso}
      >
        {cerrando && (
          <div className="space-y-4">
            <div>
              <p className="font-bold uv-text-primary break-words">
                {nombreLegible(cerrando.deviceName, t('sessions_device_on'))}
              </p>
              <p className="mt-0.5 text-xs uv-text-muted tabular-nums">{cerrando.ipMasked}</p>
            </div>
            <div className="flex gap-3 rounded-xl bg-[var(--color-danger-soft)] p-3">
              <Icons.AlertTriangle size={18} className="shrink-0 mt-0.5 text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]" aria-hidden="true" />
              <p className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
                {t('sessions_close_warning')}
              </p>
            </div>
            {errorHoja && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{t(claveError(errorHoja))}</p>
            )}
            <button
              type="button"
              onClick={() => void confirmarCerrar()}
              disabled={enCurso}
              className="w-full bg-[var(--color-danger)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50"
            >
              {enCurso ? t('loading') : t('sessions_close_confirm')}
            </button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={cerrandoDemas}
        onClose={() => { if (!enCurso) setCerrandoDemas(false); }}
        title={t('sessions_close_others_title')}
        dismissable={!enCurso}
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl bg-[var(--color-danger-soft)] p-3">
            <Icons.AlertTriangle size={18} className="shrink-0 mt-0.5 text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]" aria-hidden="true" />
            <p className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
              {otras.length === 1
                ? t('sessions_close_others_warning_one')
                : t('sessions_close_others_warning').replace('{count}', String(otras.length))}
            </p>
          </div>
          {errorHoja && (
            <p className="text-sm text-[var(--color-danger)]" role="alert">{t(claveError(errorHoja))}</p>
          )}
          <button
            type="button"
            onClick={() => void confirmarCerrarDemas()}
            disabled={enCurso}
            className="w-full bg-[var(--color-danger)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50"
          >
            {enCurso ? t('loading') : t('sessions_close_others_confirm')}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
};
