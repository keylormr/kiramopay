import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons, IconosLinea } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { IconoDeDispositivo } from '@/components/IconoDeDispositivo';
import { getApiLayer } from '@/api';
import type { DeviceSession } from '@/api/repositories/sessions.repository';
import { localeDe } from '@/utils/periodos';
import { nombreDelDispositivo } from '@/utils/dispositivo';
import { fechaSinCortes } from '@/utils/fechaSinCortes';
import { rellenar } from '@/utils/planes';

type Translate = (key: string) => string;

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

function formatearFecha(iso: string, locale: string, conHora = true): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return fechaSinCortes(
    new Intl.DateTimeFormat(locale, conHora ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(d),
  );
}

function nombreDe(s: DeviceSession, t: Translate): string {
  return nombreDelDispositivo(s.deviceName, { navegadorEn: t('sessions_device_on'), appEn: t('sessions_device_app'), desconocido: t('sessions_device_unknown') });
}

const ICONO_TILE =
  'w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-3-dark)]';

interface FilaProps {
  session: DeviceSession;
  busy: boolean;
  locale: string;
  t: Translate;
  onCerrar: (s: DeviceSession) => void;
}

const FilaDeSesion: React.FC<FilaProps> = ({ session, busy, locale, t, onCerrar }) => {
  const nombre = nombreDe(session, t);
  const red = rellenar(t('sessions_network_value'), { red: session.ipMasked || '—' });
  const vence = rellenar(t('sessions_expires_on'), { fecha: formatearFecha(session.expiresAt, locale, false) });
  return (
    <li className="flex items-center gap-3.5 py-3.5 border-b last:border-b-0 border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
      <span className={`${ICONO_TILE} uv-text-secondary`}>
        <IconoDeDispositivo userAgent={session.deviceName} size={24} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold uv-text-primary break-words" title={session.deviceName}>{nombre}</p>
        <p id={`sesion-${session.id}-abierta`} className="mt-0.5 text-xs uv-text-muted kp-num">
          {rellenar(t('sessions_opened_on'), { fecha: formatearFecha(session.createdAt, locale) })}
        </p>
        <p id={`sesion-${session.id}-red`} className="mt-0.5 text-xs uv-text-muted kp-num">{red} · {vence}</p>
      </div>
      {/* La fecha y la red describen el boton: dos "Chrome en Windows" se
          distinguen tambien con lector de pantalla. */}
      <button
        type="button"
        onClick={() => onCerrar(session)}
        disabled={busy}
        aria-label={`${t('sessions_close')}: ${nombre}`}
        aria-describedby={`sesion-${session.id}-abierta sesion-${session.id}-red`}
        className="shrink-0 h-9 px-3.5 rounded-xl bg-[var(--color-danger-soft)] text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)] text-[13px] font-semibold kp-toque kp-foco disabled:opacity-50"
      >
        {t('sessions_close')}
      </button>
    </li>
  );
};

const FilaActual: React.FC<{ session: DeviceSession; locale: string; t: Translate }> = ({ session, locale, t }) => {
  const nombre = nombreDe(session, t);
  const red = rellenar(t('sessions_network_value'), { red: session.ipMasked || '—' });
  const vence = rellenar(t('sessions_expires_on'), { fecha: formatearFecha(session.expiresAt, locale, false) });
  return (
    <li className="flex items-start gap-3.5 py-3.5">
      <span className={`${ICONO_TILE} text-[var(--color-primary-700)] dark:text-[var(--color-primary-tint)]`}>
        <IconoDeDispositivo userAgent={session.deviceName} size={24} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold uv-text-primary break-words" title={session.deviceName}>{nombre}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]">
          <span className="kp-vivo w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" aria-hidden="true" />
          <span>{t('sessions_current_chip')}</span>
        </p>
        <p className="mt-1 text-xs uv-text-muted kp-num">
          {rellenar(t('sessions_opened_on'), { fecha: formatearFecha(session.createdAt, locale) })}
        </p>
        <p className="mt-0.5 text-xs uv-text-muted kp-num">{red} · {vence}</p>
        {/* La sesion actual no se cierra desde su propia fila: seria echarse a
            uno mismo de la app sin aviso. Se cierra saliendo de la cuenta. */}
        <p className="mt-2 text-xs leading-relaxed uv-text-muted">{t('sessions_current_hint')}</p>
      </div>
    </li>
  );
};

export const SessionsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const locale = localeDe(language);

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
    <h2 className="mb-2 px-1 text-[13px] font-semibold uv-text-secondary">{texto}</h2>
  );

  const total = sesiones.length;
  // Sin ninguna sesion en la lista (no deberia pasar: esta es una) no se pinta "0 sesiones".
  const resumen =
    total === 0 ? null : total === 1 ? t('sessions_summary_one') : rellenar(t('sessions_summary_many'), { count: String(total) });

  const pieDeHoja = (confirmar: () => void, textoConfirmar: string, cancelar: () => void) => (
    <div className="flex flex-col gap-2.5 pt-1">
      <button
        type="button"
        onClick={confirmar}
        disabled={enCurso}
        className="w-full h-12 rounded-2xl bg-[var(--color-danger-fill)] text-white text-[15px] font-semibold kp-toque kp-foco disabled:opacity-50"
      >
        {enCurso ? t('loading') : textoConfirmar}
      </button>
      <button
        type="button"
        onClick={cancelar}
        disabled={enCurso}
        className="w-full h-12 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-primary text-[15px] font-semibold kp-toque kp-foco disabled:opacity-50"
      >
        {t('cancel')}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 kp-capa z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col slide-in-from-right">
      <header className="sticky top-0 z-10 flex-shrink-0 bg-[var(--color-background)]/85 dark:bg-[var(--color-background-dark)]/85 backdrop-blur-md">
        <div className="mx-auto w-full max-w-2xl h-14 px-2 sm:px-3 flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-2xl uv-text-secondary hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] kp-toque kp-foco"
            aria-label={t('back')}
          >
            <Icons.ChevronLeft size={22} />
          </button>
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] uv-text-primary">{t('sessions_title')}</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-5 pt-2 pb-10">
          {cargando ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : errorCarga ? (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <Icons.AlertCircle size={26} className="text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)] mb-3" aria-hidden="true" />
              <p className="font-semibold uv-text-primary" role="alert">
                {t(claveError(errorCarga, 'sessions_err_load'))}
              </p>
              <button
                type="button"
                onClick={() => void cargar()}
                className="mt-4 h-11 px-5 rounded-xl bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-semibold kp-toque kp-foco"
              >
                {t('error_retry')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <section className="kp-resumen-sesiones rounded-3xl p-[18px] text-white flex items-start gap-3.5">
                <span className="w-11 h-11 rounded-[15px] bg-white/10 flex items-center justify-center shrink-0 text-[#7EE2B4]">
                  <Icons.Shield size={22} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  {resumen && <p className="mb-1 text-[17px] font-semibold kp-num">{resumen}</p>}
                  <p className="text-[13px] leading-relaxed text-[#C9D4E6]">{t('sessions_intro')}</p>
                </div>
              </section>

              {aviso && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`animate-fade-in flex items-start gap-2.5 rounded-2xl px-4 py-3 ${
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
                <section>
                  {tituloSeccion(t('sessions_this_device'))}
                  <ul className="uv-surface-1 rounded-[20px] px-4 ring-1 ring-inset ring-[var(--color-border)] dark:ring-[var(--color-border-dark)]">
                    <FilaActual key={actual.id} session={actual} locale={locale} t={t} />
                  </ul>
                </section>
              )}

              <section>
                {tituloSeccion(t('sessions_other_devices'))}
                {otras.length === 0 ? (
                  <div className="uv-surface-1 rounded-[20px] ring-1 ring-inset ring-[var(--color-border)] dark:ring-[var(--color-border-dark)] px-5 py-8 flex flex-col items-center text-center">
                    <span className={`${ICONO_TILE} uv-text-muted mb-3`}>
                      <IconosLinea.Dispositivos size={24} />
                    </span>
                    <p className="font-semibold uv-text-primary">{t('sessions_empty')}</p>
                    <p className="mt-1 max-w-xs text-xs leading-relaxed uv-text-muted">{t('sessions_empty_hint')}</p>
                  </div>
                ) : (
                  <ul className="uv-surface-1 rounded-[20px] px-4 ring-1 ring-inset ring-[var(--color-border)] dark:ring-[var(--color-border-dark)]">
                    {otras.map((s) => (
                      <FilaDeSesion key={s.id} session={s} busy={enCurso} locale={locale} t={t} onCerrar={abrirCerrar} />
                    ))}
                  </ul>
                )}
              </section>

              {otras.length > 0 && (
                <button
                  type="button"
                  onClick={abrirCerrarDemas}
                  className="self-stretch sm:self-start h-12 px-5 rounded-2xl ring-1 ring-inset ring-[var(--color-danger)]/40 text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)] text-[15px] font-semibold hover:bg-[var(--color-danger-soft)] kp-toque kp-foco"
                >
                  {t('sessions_close_others')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <BottomSheet
        isOpen={cerrando !== null}
        onClose={() => { if (!enCurso) setCerrando(null); }}
        title={t('sessions_close_title')}
        dismissable={!enCurso}
      >
        {cerrando && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className={`${ICONO_TILE} uv-text-secondary`}>
                <IconoDeDispositivo userAgent={cerrando.deviceName} size={24} />
              </span>
              <div className="min-w-0">
                <p className="font-semibold uv-text-primary break-words">{nombreDe(cerrando, t)}</p>
                <p className="mt-0.5 text-xs uv-text-muted kp-num">
                  {rellenar(t('sessions_network_value'), { red: cerrando.ipMasked || '—' })}
                </p>
              </div>
            </div>
            <p className="text-sm leading-relaxed uv-text-secondary">
              {t('sessions_close_warning')} {t('sessions_money_safe')}
            </p>
            {errorHoja && (
              <p className="text-sm text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]" role="alert">{t(claveError(errorHoja))}</p>
            )}
            {pieDeHoja(() => void confirmarCerrar(), t('sessions_close_confirm'), () => setCerrando(null))}
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
          <p className="text-sm leading-relaxed uv-text-secondary">
            {otras.length === 1
              ? t('sessions_close_others_warning_one')
              : t('sessions_close_others_warning').replace('{count}', String(otras.length))}
          </p>
          <p className="text-sm uv-text-muted">{t('sessions_money_safe')}</p>
          {errorHoja && (
            <p className="text-sm text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]" role="alert">{t(claveError(errorHoja))}</p>
          )}
          {pieDeHoja(() => void confirmarCerrarDemas(), t('sessions_close_others_confirm'), () => setCerrandoDemas(false))}
        </div>
      </BottomSheet>
    </div>
  );
};
