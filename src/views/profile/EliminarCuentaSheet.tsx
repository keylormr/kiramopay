import React, { useEffect, useId, useState } from 'react';
import { BottomSheet } from '../../components/BottomSheet';
import { Icons } from '../../components/Icons';
import { useLanguage } from '../../i18n/LanguageContext';
import { getApiLayer } from '@/api';
import { useAuthStore } from '@/stores/auth.store';
import { abrirPublico, RUTA_ELIMINAR_CUENTA, RUTA_PRIVACIDAD } from '@/utils/enlacesLegales';
import type { MotivoDeEliminacion } from '@/api/repositories/auth.repository';
import type { TranslationKeys } from '@/i18n/translations';

interface EliminarCuentaSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

// Una sola fase a la vez. 'resumen' y 'confirmar' son el camino feliz; las demas
// son las razones por las que no se llega a eliminar.
type Fase =
  | { tipo: 'cargando' }
  | { tipo: 'falla' }
  | { tipo: 'noElegible'; motivo: MotivoDeEliminacion }
  | { tipo: 'bloqueada'; bloqueos: string[] }
  | { tipo: 'resumen'; pideTotp: boolean; pideCorreo: boolean }
  | { tipo: 'confirmar'; pideTotp: boolean; pideCorreo: boolean };

// Codigo del servidor -> clave de texto. Un codigo que esta version de la app no
// conoce cae en del_block_unknown: nunca se muestra el texto del servidor.
const CLAVE_DEL_BLOQUEO: Record<string, keyof TranslationKeys> = {
  BALANCE_POSITIVE: 'del_block_BALANCE_POSITIVE',
  SAVINGS_BALANCE: 'del_block_SAVINGS_BALANCE',
  CRYPTO_BALANCE: 'del_block_CRYPTO_BALANCE',
  STAKING_ACTIVE: 'del_block_STAKING_ACTIVE',
  REGIONAL_BALANCE: 'del_block_REGIONAL_BALANCE',
  MERCHANT_BALANCE: 'del_block_MERCHANT_BALANCE',
  MERCHANT_PENDING_CHARGES: 'del_block_MERCHANT_PENDING_CHARGES',
  TX_PENDING: 'del_block_TX_PENDING',
  ESCROW_OPEN: 'del_block_ESCROW_OPEN',
  PAYOUT_PENDING: 'del_block_PAYOUT_PENDING',
  CROSS_BORDER_PENDING: 'del_block_CROSS_BORDER_PENDING',
  MARKETPLACE_IN_PROGRESS: 'del_block_MARKETPLACE_IN_PROGRESS',
};

const CLAVE_DEL_MOTIVO: Record<MotivoDeEliminacion, keyof TranslationKeys> = {
  DEMO_ACCOUNT: 'del_reason_demo',
  ADMIN_ACCOUNT: 'del_reason_admin',
  ACCOUNT_NOT_ELIGIBLE: 'del_reason_restricted',
};

// Los codigos de rechazo del POST que se explican en el mismo formulario.
const CLAVE_DEL_RECHAZO: Record<string, keyof TranslationKeys> = {
  CURRENT_PASSWORD_INVALID: 'del_err_password',
  TOTP_REQUIRED: 'del_err_totp',
  TOTP_INVALID: 'del_err_totp',
  DELETION_LOCKED: 'del_err_locked',
  TERMS_NOT_ACCEPTED: 'del_err_terms',
  RESPONSE_EMAIL_REQUIRED: 'del_err_response_email_required',
  RESPONSE_EMAIL_INVALID: 'del_err_response_email_invalid',
};

// La misma forma que valida el servidor (pkg/validator): uno que pase aqui y
// no alla habilitaria el envio para recibir RESPONSE_EMAIL_INVALID.
const CORREO_VALIDO = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const CAMPO =
  'w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-danger)] focus:ring-[3px] focus:ring-[var(--color-danger)]/20 transition-all';

const BOTON_PELIGRO =
  'w-full bg-[var(--color-danger)] hover:brightness-95 text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2';

const BOTON_SECUNDARIO =
  'w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-primary py-3.5 rounded-xl font-semibold hover:bg-[var(--color-border)] dark:hover:bg-[var(--color-border-dark)] transition-colors';

/** Los codigos de DELETION_BLOCKED viajan en error.details.blockers como [{code}]. */
function bloqueosDelError(details: Record<string, unknown> | undefined): string[] {
  const lista = details?.blockers;
  if (!Array.isArray(lista)) return [];
  return lista
    .map((b) => (b && typeof b === 'object' ? (b as { code?: unknown }).code : undefined))
    .filter((c): c is string => typeof c === 'string');
}

/**
 * Pedir la eliminacion de la cuenta desde la app. Va en tres pasos: el plazo
 * (la cuenta queda bloqueada desde hoy y se elimina en 30 dias, salvo que la
 * persona la reactive), lo que se borra ese dia y lo que se conserva por ley; lo
 * que hay que resolver antes (si hay algo); y una confirmacion que pide la
 * palabra, la contrasena, la aceptacion expresa del plazo y, si lo tiene
 * encendido, el codigo del autenticador. El servidor reautentica: nada de esto
 * vale sin su respuesta.
 */
interface ContenidoProps {
  onClose: () => void;
  /** Avisa a la hoja que hay una operacion en vuelo: mientras dura no se cierra. */
  onEnviando: (enviando: boolean) => void;
}

const Contenido: React.FC<ContenidoProps> = ({ onClose, onEnviando }) => {
  const { t } = useLanguage();
  const idPalabra = useId();
  const idClave = useId();
  const idTotp = useId();
  const idError = useId();
  const idPlazo = useId();
  const idCorreo = useId();

  const [fase, setFase] = useState<Fase>({ tipo: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [palabra, setPalabra] = useState('');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [totp, setTotp] = useState('');
  const [aceptaPlazo, setAceptaPlazo] = useState(false);
  const [correo, setCorreo] = useState('');
  const [enviando, setEnviandoLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setEnviando = (valor: boolean) => {
    setEnviandoLocal(valor);
    onEnviando(valor);
  };

  // Este componente se monta de nuevo en cada apertura de la hoja (ver la clave
  // que le pone EliminarCuentaSheet), de modo que el estado nace limpio y la
  // revision se hace otra vez: el saldo o un movimiento pendiente pudieron
  // cambiar desde la ultima vez, y mostrar una revision vieja seria afirmar algo
  // que ya no es cierto.
  useEffect(() => {
    let vigente = true;
    void (async () => {
      const res = await getApiLayer().auth.deletionPreflight();
      if (!vigente) return;
      if (!res.success || !res.data) {
        setFase({ tipo: 'falla' });
        return;
      }
      const d = res.data;
      if (d.motivo) setFase({ tipo: 'noElegible', motivo: d.motivo });
      else if (d.bloqueos.length > 0) setFase({ tipo: 'bloqueada', bloqueos: d.bloqueos });
      else setFase({ tipo: 'resumen', pideTotp: d.pideSegundoFactor, pideCorreo: d.pideCorreoParaRespuesta });
    })();
    return () => {
      vigente = false;
    };
  }, [intento]);

  const palabraEsperada = t('del_word');
  const palabraCorrecta = palabra.trim().toLocaleUpperCase() === palabraEsperada.toLocaleUpperCase();
  const pideTotp = fase.tipo === 'confirmar' && fase.pideTotp;
  const pideCorreo = fase.tipo === 'confirmar' && fase.pideCorreo;
  const puedeEnviar =
    palabraCorrecta &&
    clave.length > 0 &&
    aceptaPlazo &&
    (!pideTotp || totp.length === 6) &&
    (!pideCorreo || CORREO_VALIDO.test(correo.trim())) &&
    !enviando;

  const eliminar = async () => {
    if (!puedeEnviar || fase.tipo !== 'confirmar') return;
    setEnviando(true);
    setError(null);
    const res = await getApiLayer().auth.deleteAccount({
      password: clave,
      totpCode: fase.pideTotp ? totp : undefined,
      acceptTerms: aceptaPlazo,
      // Solo una cuenta sin correo da uno, y solo para la respuesta escrita.
      ...(fase.pideCorreo ? { responseEmail: correo.trim() } : {}),
    });
    if (res.success) {
      // La sesion ya esta revocada en el servidor: se suelta todo lo local sin
      // pedirle nada mas. El login que sigue dice cuando se elimina la cuenta y
      // que hasta entonces se puede reactivar.
      useAuthStore.getState().cuentaEliminada(res.data?.seEliminaEl);
      onClose();
      return;
    }
    setEnviando(false);
    const codigo = res.error?.code ?? '';
    if (codigo === 'DELETION_BLOCKED') {
      // Algo cambio entre la revision y la confirmacion: se explica ya.
      setFase({ tipo: 'bloqueada', bloqueos: bloqueosDelError(res.error?.details) });
      return;
    }
    if (codigo === 'DEMO_ACCOUNT' || codigo === 'ADMIN_ACCOUNT' || codigo === 'ACCOUNT_NOT_ELIGIBLE') {
      setFase({ tipo: 'noElegible', motivo: codigo });
      return;
    }
    if (codigo === 'CURRENT_PASSWORD_INVALID') setClave('');
    if (codigo === 'TOTP_REQUIRED' || codigo === 'TOTP_INVALID') setTotp('');
    setError(t(CLAVE_DEL_RECHAZO[codigo] ?? 'del_err_generic'));
  };

  const enlaceDePolitica = (
    <button
      type="button"
      onClick={() => abrirPublico(RUTA_PRIVACIDAD)}
      className="text-sm font-semibold text-[var(--color-primary)] hover:underline inline-flex items-center gap-1.5"
    >
      <Icons.FileText size={15} aria-hidden="true" />
      {t('del_policy_link')}
    </button>
  );

  const cabecera = (titulo: string, subtitulo?: string) => (
    <div className="flex items-start gap-3">
      <div className="w-11 h-11 shrink-0 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center">
        <Icons.AlertTriangle size={22} className="text-[var(--color-danger)]" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="font-bold uv-text-primary text-lg leading-snug">{titulo}</p>
        {subtitulo && <p className="text-sm uv-text-muted mt-1 leading-relaxed">{subtitulo}</p>}
      </div>
    </div>
  );

  const lista = (items: string[]) => (
    <ul className="space-y-2">
      {items.map((x) => (
        <li key={x} className="text-sm uv-text-secondary leading-relaxed flex gap-2">
          <span aria-hidden="true" className="mt-2 w-1 h-1 rounded-full bg-current shrink-0 opacity-60" />
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <div className="space-y-5">
        {fase.tipo === 'cargando' && (
          <div role="status" className="flex items-center gap-3 py-8 justify-center uv-text-muted">
            <div className="w-5 h-5 border-2 border-[var(--color-border-strong)] border-t-[var(--color-primary)] rounded-full animate-spin" />
            <span className="text-sm">{t('del_checking')}</span>
          </div>
        )}

        {fase.tipo === 'falla' && (
          <>
            <p role="alert" className="text-sm text-[var(--color-danger)]">{t('del_check_failed')}</p>
            <button
              type="button"
              onClick={() => {
                setFase({ tipo: 'cargando' });
                setIntento((n) => n + 1);
              }}
              className={BOTON_SECUNDARIO}
            >
              {t('error_retry')}
            </button>
          </>
        )}

        {fase.tipo === 'noElegible' && (
          <>
            {cabecera(t('delete_account'), t(CLAVE_DEL_MOTIVO[fase.motivo]))}
            {fase.motivo === 'ACCOUNT_NOT_ELIGIBLE' && (
              <button
                type="button"
                onClick={() => abrirPublico(RUTA_ELIMINAR_CUENTA)}
                className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
              >
                {t('del_web_link')}
              </button>
            )}
            <button type="button" onClick={onClose} className={BOTON_SECUNDARIO}>{t('close')}</button>
          </>
        )}

        {fase.tipo === 'bloqueada' && (
          <>
            {cabecera(t('del_blocked_title'), t('del_blocked_intro'))}
            {lista(
              fase.bloqueos.length > 0
                ? fase.bloqueos.map((c) => t(CLAVE_DEL_BLOQUEO[c] ?? 'del_block_unknown'))
                : [t('del_block_unknown')],
            )}
            <button type="button" onClick={onClose} className={BOTON_SECUNDARIO}>{t('close')}</button>
          </>
        )}

        {fase.tipo === 'resumen' && (
          <>
            {cabecera(t('del_heading'), t('del_timeline'))}
            <section aria-labelledby={`${idError}-borra`} className="uv-surface-2 rounded-xl p-4 space-y-2.5">
              <h3 id={`${idError}-borra`} className="text-xs font-bold uv-text-muted uppercase tracking-wider">
                {t('del_erased_title')}
              </h3>
              {lista([t('del_erased_1'), t('del_erased_2'), t('del_erased_3')])}
            </section>
            <section aria-labelledby={`${idError}-conserva`} className="uv-surface-2 rounded-xl p-4 space-y-2.5">
              <h3 id={`${idError}-conserva`} className="text-xs font-bold uv-text-muted uppercase tracking-wider">
                {t('del_kept_title')}
              </h3>
              {lista([t('del_kept_1'), t(fase.pideCorreo ? 'del_kept_2_no_email' : 'del_kept_2')])}
            </section>
            {enlaceDePolitica}
            <div className="space-y-2.5">
              <button type="button" onClick={() => setFase({ tipo: 'confirmar', pideTotp: fase.pideTotp, pideCorreo: fase.pideCorreo })} className={BOTON_PELIGRO}>
                {t('continue')}
              </button>
              <button type="button" onClick={onClose} className={BOTON_SECUNDARIO}>{t('cancel')}</button>
            </div>
          </>
        )}

        {fase.tipo === 'confirmar' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void eliminar();
            }}
          >
            {cabecera(t('del_confirm_title'), t('del_confirm_intro'))}

            <div>
              <label htmlFor={idPalabra} className="text-sm text-gray-500 font-medium mb-2 block">
                {t('del_word_label').replace('{word}', palabraEsperada)}
              </label>
              <input
                id={idPalabra}
                value={palabra}
                onChange={(e) => { setPalabra(e.target.value); setError(null); }}
                autoFocus
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className={CAMPO}
              />
            </div>

            <div>
              <label htmlFor={idClave} className="text-sm text-gray-500 font-medium mb-2 block">
                {t('current_password')}
              </label>
              <div className="relative">
                <input
                  id={idClave}
                  type={verClave ? 'text' : 'password'}
                  value={clave}
                  onChange={(e) => { setClave(e.target.value); setError(null); }}
                  autoComplete="current-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? idError : undefined}
                  className={`${CAMPO} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setVerClave(!verClave)}
                  aria-label={t(verClave ? 'hide_password' : 'show_password')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 uv-text-muted hover:uv-text-primary"
                >
                  {verClave ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-3 uv-surface-2 rounded-xl p-3.5">
              <input
                id={idPlazo}
                type="checkbox"
                checked={aceptaPlazo}
                onChange={(e) => { setAceptaPlazo(e.target.checked); setError(null); }}
                className="mt-0.5 w-5 h-5 shrink-0 accent-[var(--color-danger)] cursor-pointer"
              />
              <label htmlFor={idPlazo} className="text-sm uv-text-secondary leading-relaxed cursor-pointer">
                {t('del_accept_terms')}
              </label>
            </div>

            {pideTotp && (
              <div>
                <label htmlFor={idTotp} className="text-sm text-gray-500 font-medium mb-2 block">
                  {t('del_totp_label')}
                </label>
                <input
                  id={idTotp}
                  value={totp}
                  onChange={(e) => { setTotp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className={`${CAMPO} tracking-[0.4em] text-center font-mono`}
                />
              </div>
            )}

            {pideCorreo && (
              <div>
                <label htmlFor={idCorreo} className="text-sm text-gray-500 font-medium mb-2 block">
                  {t('del_response_email_label')}
                </label>
                <input
                  id={idCorreo}
                  type="email"
                  value={correo}
                  onChange={(e) => { setCorreo(e.target.value); setError(null); }}
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-describedby={`${idCorreo}-ayuda`}
                  className={CAMPO}
                />
                <p id={`${idCorreo}-ayuda`} className="mt-1.5 text-xs uv-text-muted leading-relaxed">
                  {t('del_response_email_hint')}
                </p>
              </div>
            )}

            {error && <p id={idError} role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}

            <div className="space-y-2.5 pt-1">
              <button type="submit" disabled={!puedeEnviar} className={BOTON_PELIGRO}>
                {enviando ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('processing')}
                  </>
                ) : (
                  <>
                    <Icons.Trash size={18} aria-hidden="true" />
                    {t('del_confirm_button')}
                  </>
                )}
              </button>
              <button type="button" onClick={onClose} disabled={enviando} className={BOTON_SECUNDARIO}>
                {t('cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
};

export const EliminarCuentaSheet: React.FC<EliminarCuentaSheetProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [enviando, setEnviando] = useState(false);
  // Una generacion nueva por apertura: la clave de Contenido cambia y su estado
  // nace limpio. Se ajusta durante el render (como hace BottomSheet con
  // `visible`) en vez de en un efecto, para no renderizar dos veces con la
  // revision anterior a la vista.
  const [generacion, setGeneracion] = useState(0);
  const [estabaAbierta, setEstabaAbierta] = useState(isOpen);
  if (isOpen !== estabaAbierta) {
    setEstabaAbierta(isOpen);
    if (isOpen) {
      setGeneracion((g) => g + 1);
      setEnviando(false);
    }
  }
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('delete_account')} dismissable={!enviando}>
      <Contenido key={generacion} onClose={onClose} onEnviando={setEnviando} />
    </BottomSheet>
  );
};
