import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { Icons } from '@/components/Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { getApiLayer } from '@/api';
import type {
  ContactoDeRespuesta,
  RespuestaEnviadaSinConfirmar,
  RespuestaPorEntregar,
  SolicitudDeEliminacion,
} from '@/api/repositories/admin.repository';
import type { TranslationKeys } from '@/i18n/translations';
import { fechaYHora } from '@/utils/fechaPlazo';
import { fechaLarga } from '@/utils/planes';

// La cola de las solicitudes de eliminacion que llegan de la pagina web
// (/eliminar-cuenta) y esperan a una persona: solo las de cuentas bajo revision
// (bloqueadas o suspendidas), con el contacto ya verificado por un codigo; las
// demas empiezan el plazo solas al verificar. Atender una inicia el MISMO plazo
// de 30 dias que la app, con los mismos bloqueos, sin desbloquear la cuenta, y
// deja al administrador en la auditoria.
//
// Vive como pestana de la pantalla de cuentas porque es la misma tarea
// (gestionar una cuenta) y asi no se agrega otra entrada al menu.
//
// Arriba, las respuestas escritas (Ley 8968) que no pudieron salir solas por
// correo: la persona del equipo la entrega por otro medio antes del plazo legal
// y deja constancia de como. Sin ninguna pendiente, la seccion no aparece.
//
// Para entregarla puede ver el contacto completo de cada una: lo pide al
// servidor, que deja la vista en la auditoria, y nunca viene en la lista.
//
// Al final, solo para leer, las que ya salieron en los ultimos 30 dias a un correo
// que la persona dio solo para la respuesta y nadie confirmo: que salieran no
// prueba que le llegaron.

// La nota de la entrega; el servidor guarda hasta 500 caracteres.
const NOTA_MAX = 500;

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

// Lo que decia una respuesta que ya salio.
const LO_QUE_DECIA: Record<RespuestaEnviadaSinConfirmar['tipo'], keyof TranslationKeys> = {
  scheduled: 'admin_sent_kind_scheduled',
  blocked: 'admin_sent_kind_blocked',
  rejected: 'admin_sent_kind_rejected',
};

// Por que no se pudo rechazar.
const CLAVE_DEL_RECHAZO: Record<string, keyof TranslationKeys> = {
  NOT_PENDING: 'admin_del_already',
  ALREADY_SCHEDULED: 'admin_del_reject_in_term',
};

type Aviso =
  | { tipo: 'ok'; texto: string }
  | { tipo: 'error'; texto: string }
  | { tipo: 'bloqueada'; bloqueos: string[] };

export const SolicitudesDeEliminacion: React.FC = () => {
  const { t, language } = useLanguage();
  const [cola, setCola] = useState<SolicitudDeEliminacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [falla, setFalla] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [confirmando, setConfirmando] = useState<SolicitudDeEliminacion | null>(null);
  const [rechazando, setRechazando] = useState<SolicitudDeEliminacion | null>(null);
  const [actuando, setActuando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [respuestas, setRespuestas] = useState<RespuestaPorEntregar[]>([]);
  const [fallaRespuestas, setFallaRespuestas] = useState(false);
  const [enviadas, setEnviadas] = useState<RespuestaEnviadaSinConfirmar[]>([]);
  const [fallaEnviadas, setFallaEnviadas] = useState(false);
  const [entregando, setEntregando] = useState<RespuestaPorEntregar | null>(null);
  const [nota, setNota] = useState('');
  const [errorNota, setErrorNota] = useState<string | null>(null);
  // El contacto completo de las que se pidio ver, o 'falla' si no se pudo leer.
  const [contactos, setContactos] = useState<Record<string, ContactoDeRespuesta | 'falla'>>({});
  const [viendo, setViendo] = useState<string | null>(null);
  // Cuenta las relecturas: un contacto que llega despues de releer es de una
  // lista que ya no esta en pantalla, y no se pinta.
  const lectura = useRef(0);
  // El contacto recien llegado recibe el foco: el boton que se pulso desaparece.
  const porEnfocar = useRef<string | null>(null);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      const api = getApiLayer().admin;
      const [res, resp, env] = await Promise.all([
        api?.listDeletionRequests(),
        api?.listDeletionResponses(),
        api?.listSentUnconfirmedDeletionResponses(),
      ]);
      if (!vigente) return;
      // Lo que se veia antes no queda en pantalla junto al aviso de la falla.
      if (!res?.success || !res.data) {
        setFalla(true);
        setCola([]);
      } else {
        setFalla(false);
        setCola(res.data);
      }
      // Una lista que no se pudo leer no es una lista vacia: se dice.
      if (!resp?.success || !resp.data) {
        setFallaRespuestas(true);
        setRespuestas([]);
      } else {
        setFallaRespuestas(false);
        setRespuestas(resp.data);
      }
      if (!env?.success || !env.data) {
        setFallaEnviadas(true);
        setEnviadas([]);
      } else {
        setFallaEnviadas(false);
        setEnviadas(env.data);
      }
      setCargando(false);
    })();
    return () => {
      vigente = false;
    };
  }, [recarga]);

  const releer = useCallback(() => {
    setCargando(true);
    // Lo que se vio no queda en pantalla mas de lo necesario.
    setContactos({});
    lectura.current += 1;
    setRecarga((n) => n + 1);
  }, []);

  const verContacto = async (r: RespuestaPorEntregar) => {
    setViendo(r.id);
    const deLaLectura = lectura.current;
    const res = await getApiLayer().admin?.viewDeletionResponseContact(r.id);
    setViendo(null);
    if (deLaLectura !== lectura.current) return;
    if (res?.success && res.data) porEnfocar.current = r.id;
    setContactos((antes) => ({ ...antes, [r.id]: res?.success && res.data ? res.data : 'falla' }));
  };

  const procesar = async (s: SolicitudDeEliminacion) => {
    setActuando(s.id);
    setAviso(null);
    const res = await getApiLayer().admin?.processDeletionRequest(s.id);
    setActuando(null);
    setConfirmando(null);
    if (!res?.success || !res.data) {
      setAviso({ tipo: 'error', texto: t(res?.error?.code === 'NOT_PENDING' ? 'admin_del_already' : 'admin_del_action_failed') });
    } else if (res.data.status === 'scheduled') {
      // El plazo de 30 dias empezo; la cuenta sigue bloqueada mientras tanto.
      setAviso({ tipo: 'ok', texto: t('admin_del_done') });
    } else if (res.data.status === 'blocked') {
      setAviso({ tipo: 'bloqueada', bloqueos: res.data.blockers });
    } else {
      setAviso({ tipo: 'ok', texto: t('admin_del_rejected') });
    }
    releer();
  };

  const rechazar = async (s: SolicitudDeEliminacion) => {
    setActuando(s.id);
    setAviso(null);
    const res = await getApiLayer().admin?.rejectDeletionRequest(s.id);
    setActuando(null);
    setRechazando(null);
    setAviso(
      res?.success
        ? { tipo: 'ok', texto: t('admin_del_rejected') }
        : { tipo: 'error', texto: t(CLAVE_DEL_RECHAZO[res?.error?.code ?? ''] ?? 'admin_del_action_failed') },
    );
    releer();
  };

  const abrirEntrega = (r: RespuestaPorEntregar) => {
    setNota('');
    setErrorNota(null);
    setEntregando(r);
  };

  const marcarEntregada = async (r: RespuestaPorEntregar) => {
    setActuando(r.id);
    setErrorNota(null);
    const res = await getApiLayer().admin?.markDeletionResponseDelivered(r.id, nota.trim());
    setActuando(null);
    if (res?.success) {
      setEntregando(null);
      setAviso({ tipo: 'ok', texto: t('admin_resp_done') });
      releer();
      return;
    }
    const codigo = res?.error?.code;
    if (codigo === 'NOTE_REQUIRED' || codigo === 'NOTE_TOO_LONG') {
      // La nota queda escrita para corregirla.
      setErrorNota(t(codigo === 'NOTE_REQUIRED' ? 'admin_resp_note_required' : 'admin_resp_note_too_long'));
      return;
    }
    setEntregando(null);
    setAviso({ tipo: 'error', texto: t(codigo === 'NOT_PENDING' ? 'admin_resp_already' : 'admin_del_action_failed') });
    releer();
  };

  // Lo que hay que decirle a la persona: las fechas, que resolver, o que no se
  // atiende por esta via.
  const loQueHayQueDecir = (r: RespuestaPorEntregar) =>
    r.tipo === 'rejected' ? (
      <p className="text-sm uv-text-secondary leading-relaxed">{t('admin_resp_rejected')}</p>
    ) : r.tipo === 'scheduled' ? (
      <p className="text-sm uv-text-secondary leading-relaxed">
        {t('admin_resp_scheduled')
          .replace('{date}', fechaLarga(r.seEliminaEl, language))
          .replace('{until}', fechaLarga(r.conservaHasta, language))}
      </p>
    ) : (
      <div className="space-y-1">
        <p className="text-sm uv-text-secondary">{t('admin_resp_blocked')}</p>
        <ul className="list-disc pl-5 space-y-0.5">
          {(r.bloqueos.length > 0 ? r.bloqueos : ['']).map((c) => (
            <li key={c} className="text-sm uv-text-secondary">{t(CLAVE_DEL_BLOQUEO[c] ?? 'del_block_unknown')}</li>
          ))}
        </ul>
      </div>
    );

  const persona = (cuenta: SolicitudDeEliminacion['account'], r?: { cuentaCerrada: boolean; userId: string }) =>
    cuenta ? (
      <div>
        <p className="font-bold uv-text-primary">{`${cuenta.firstName} ${cuenta.lastName}`.trim()}</p>
        <p className="text-xs uv-text-muted tabular-nums mt-0.5">
          {[cuenta.cedulaMasked, cuenta.phoneMasked, cuenta.emailMasked].filter(Boolean).join(' · ')}
        </p>
      </div>
    ) : (
      <div>
        <p className="text-sm uv-text-muted">{t(r?.cuentaCerrada ? 'admin_resp_closed_account' : 'admin_resp_no_account')}</p>
        {r?.userId && (
          <p className="text-xs uv-text-muted tabular-nums mt-0.5">{t('admin_resp_account_id').replace('{id}', r.userId)}</p>
        )}
      </div>
    );

  // El contacto completo, solo despues de pedirlo: el boton avisa que la vista
  // queda registrada.
  const contacto = (r: RespuestaPorEntregar) => {
    // De una cuenta cerrada ya no hay contacto guardado que ver.
    if (r.cuentaCerrada) {
      return <p className="text-sm uv-text-muted">{t('admin_resp_contact_none')}</p>;
    }
    const c = contactos[r.id];
    if (c && c !== 'falla') {
      const lineas = [
        c.telefono && t('admin_resp_contact_phone').replace('{v}', c.telefono),
        c.correo && t('admin_resp_contact_email').replace('{v}', c.correo),
        c.correoParaRespuesta && t('admin_resp_contact_response_email').replace('{v}', c.correoParaRespuesta),
      ].filter((l): l is string => !!l);
      return (
        <div
          role="status"
          tabIndex={-1}
          ref={(el) => {
            if (el && porEnfocar.current === r.id) {
              porEnfocar.current = null;
              el.focus();
            }
          }}
          className="rounded-xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-3 py-2 space-y-0.5 outline-none"
        >
          {lineas.length > 0 ? (
            lineas.map((l) => <p key={l} className="text-sm uv-text-primary break-all">{l}</p>)
          ) : (
            <p className="text-sm uv-text-muted">{t('admin_resp_contact_none')}</p>
          )}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => void verContacto(r)}
          disabled={viendo !== null || actuando !== null}
          className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-primary py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--color-border)] dark:hover:bg-[var(--color-border-dark)] transition-colors"
        >
          {t('admin_resp_view_contact')}
        </button>
        {c === 'falla' ? (
          <p role="alert" className="text-xs text-[var(--color-danger)]">{t('admin_resp_contact_failed')}</p>
        ) : (
          <p className="text-xs uv-text-muted">{t('admin_resp_contact_hint')}</p>
        )}
      </div>
    );
  };

  return (
    <div className="px-4 py-4 space-y-3">
      {aviso?.tipo === 'ok' && (
        <p role="status" className="flex items-center gap-2 rounded-xl uv-chip-success px-3 py-2 text-sm font-medium">
          <Icons.Check size={16} className="shrink-0" aria-hidden="true" />
          {aviso.texto}
        </p>
      )}
      {aviso?.tipo === 'error' && (
        <p role="alert" className="text-[var(--color-danger)] text-sm">{aviso.texto}</p>
      )}
      {aviso?.tipo === 'bloqueada' && (
        <div role="alert" className="rounded-xl bg-[var(--color-danger-soft)] p-3 space-y-1.5">
          <p className="text-sm font-semibold text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
            {t('admin_del_blocked')}
          </p>
          <ul className="space-y-1">
            {aviso.bloqueos.map((c) => (
              <li key={c} className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
                {t(CLAVE_DEL_BLOQUEO[c] ?? 'del_block_unknown')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {cargando && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!cargando && falla && (
        <p role="alert" className="text-[var(--color-danger)] text-sm">{t('admin_del_load_failed')}</p>
      )}

      {!cargando && fallaRespuestas && (
        <p role="alert" className="text-[var(--color-danger)] text-sm">{t('admin_resp_load_failed')}</p>
      )}

      {!cargando && fallaEnviadas && (
        <p role="alert" className="text-[var(--color-danger)] text-sm">{t('admin_sent_load_failed')}</p>
      )}

      {!cargando && respuestas.length > 0 && (
        <section aria-labelledby="admin-resp-titulo" className="space-y-3 pb-2">
          <div>
            <h2 id="admin-resp-titulo" className="font-bold uv-text-primary">{t('admin_resp_title')}</h2>
            <p className="text-xs uv-text-muted mt-0.5">{t('admin_resp_intro')}</p>
          </div>
          {respuestas.map((r) => (
            <article key={r.id} className="uv-surface-1 rounded-2xl uv-shadow-soft p-4 space-y-3">
              {persona(r.account, r)}
              {r.correoSinConfirmar && (
                <div>
                  <p className="inline-block rounded-full uv-chip-warning px-2 py-0.5 text-[11px] font-bold">
                    {t('admin_resp_unconfirmed')}
                  </p>
                  <p className="text-xs uv-text-muted mt-1">{t('admin_resp_unconfirmed_hint')}</p>
                </div>
              )}
              <p className="text-xs font-semibold text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
                {r.motivo === 'send_failed'
                  ? t('admin_resp_send_failed').replace('{n}', String(r.intentos))
                  : t('admin_resp_no_channel')}
                {' · '}
                {t('admin_resp_due').replace('{date}', fechaLarga(r.responderAntesDe, language))}
              </p>
              {loQueHayQueDecir(r)}
              {contacto(r)}
              <button
                type="button"
                onClick={() => abrirEntrega(r)}
                disabled={actuando !== null}
                className="w-full bg-[var(--color-primary)] text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
              >
                {t('admin_resp_mark')}
              </button>
            </article>
          ))}
        </section>
      )}

      {!cargando && !falla && cola.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-4">
            <Icons.Trash size={26} className="uv-text-muted" aria-hidden="true" />
          </div>
          <p className="font-semibold uv-text-primary">{t('admin_del_empty')}</p>
        </div>
      )}

      {!cargando && cola.length > 0 && (
        <section aria-labelledby="admin-del-titulo" className="space-y-3">
          <h2 id="admin-del-titulo" className="font-bold uv-text-primary">{t('admin_del_queue_title')}</h2>
          {cola.map((s) => (
            <article key={s.id} className="uv-surface-1 rounded-2xl uv-shadow-soft p-4 space-y-3">
              {s.account ? (
                <div>
                  <p className="font-bold uv-text-primary">{`${s.account.firstName} ${s.account.lastName}`.trim()}</p>
                  <p className="text-xs uv-text-muted tabular-nums mt-0.5">
                    {[s.account.cedulaMasked, s.account.phoneMasked, s.account.emailMasked].filter(Boolean).join(' · ')}
                  </p>
                  {s.account.status === 'blocked' && (
                    <p className="mt-1.5 inline-block rounded-full bg-[var(--color-danger-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
                      {t('admin_users_status_blocked')}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm uv-text-muted">{t('admin_del_no_account')}</p>
              )}
              <p className="text-xs uv-text-muted">
                {t(s.contactKind === 'phone' ? 'admin_del_via_phone' : 'admin_del_via_email')}
                {' · '}
                {t('admin_del_verified_at').replace('{when}', fechaYHora(s.verifiedAt ?? s.createdAt, language))}
              </p>
              {s.responderAntesDe && (
                <p className="text-xs font-semibold uv-text-secondary">
                  {t('admin_resp_due').replace('{date}', fechaLarga(s.responderAntesDe, language))}
                </p>
              )}
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmando(s)}
                  disabled={actuando !== null}
                  className="flex-1 bg-[var(--color-danger)] text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
                >
                  {t('admin_del_process')}
                </button>
                <button
                  type="button"
                  onClick={() => setRechazando(s)}
                  disabled={actuando !== null}
                  className="flex-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-primary py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--color-border)] dark:hover:bg-[var(--color-border-dark)] transition-colors"
                >
                  {t('admin_del_reject')}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {!cargando && enviadas.length > 0 && (
        <section aria-labelledby="admin-sent-titulo" className="space-y-3 pt-4">
          <div>
            <h2 id="admin-sent-titulo" className="font-bold uv-text-primary">{t('admin_sent_title')}</h2>
            <p className="text-xs uv-text-muted mt-0.5">{t('admin_sent_intro')}</p>
          </div>
          {enviadas.map((e) => (
            <article key={e.id} className="uv-surface-1 rounded-2xl uv-shadow-soft p-4 space-y-2">
              {persona(e.account, e)}
              <p className="inline-block rounded-full uv-chip-warning px-2 py-0.5 text-[11px] font-bold">
                {t('admin_resp_unconfirmed')}
              </p>
              <p className="text-xs font-semibold uv-text-secondary">
                {t('admin_sent_at').replace('{date}', fechaLarga(e.entregadaEn, language))}
              </p>
              <p className="text-sm uv-text-secondary leading-relaxed">{t(LO_QUE_DECIA[e.tipo])}</p>
            </article>
          ))}
        </section>
      )}

      <BottomSheet
        isOpen={confirmando !== null}
        onClose={() => { if (actuando === null) setConfirmando(null); }}
        title={t('admin_del_confirm_title')}
        dismissable={actuando === null}
      >
        {confirmando && (
          <div className="space-y-4">
            {confirmando.account && (
              <div>
                <p className="font-bold uv-text-primary">{`${confirmando.account.firstName} ${confirmando.account.lastName}`.trim()}</p>
                <p className="text-xs uv-text-muted tabular-nums mt-0.5">{confirmando.account.cedulaMasked}</p>
              </div>
            )}
            <div className="flex gap-3 rounded-xl bg-[var(--color-danger-soft)] p-3">
              <Icons.AlertTriangle size={18} className="shrink-0 mt-0.5 text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]" aria-hidden="true" />
              <p className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">{t('admin_del_confirm_body')}</p>
            </div>
            <button
              type="button"
              onClick={() => void procesar(confirmando)}
              disabled={actuando !== null}
              className="w-full bg-[var(--color-danger)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {actuando ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                t('admin_del_confirm_button')
              )}
            </button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={rechazando !== null}
        onClose={() => { if (actuando === null) setRechazando(null); }}
        title={t('admin_del_reject_title')}
        dismissable={actuando === null}
      >
        {rechazando && (
          <div className="space-y-4">
            {rechazando.account && (
              <div>
                <p className="font-bold uv-text-primary">{`${rechazando.account.firstName} ${rechazando.account.lastName}`.trim()}</p>
                <p className="text-xs uv-text-muted tabular-nums mt-0.5">{rechazando.account.cedulaMasked}</p>
              </div>
            )}
            <p className="text-sm uv-text-secondary leading-relaxed">{t('admin_del_reject_body')}</p>
            <button
              type="button"
              onClick={() => void rechazar(rechazando)}
              disabled={actuando !== null}
              className="w-full bg-[var(--color-primary)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {actuando ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                t('admin_del_reject_button')
              )}
            </button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={entregando !== null}
        onClose={() => { if (actuando === null) setEntregando(null); }}
        title={t('admin_resp_mark_title')}
        dismissable={actuando === null}
      >
        {entregando && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (nota.trim() && actuando === null) void marcarEntregada(entregando);
            }}
          >
            {persona(entregando.account, entregando)}
            {loQueHayQueDecir(entregando)}
            <div>
              <label htmlFor="admin-resp-nota" className="text-sm font-medium uv-text-secondary mb-1.5 block">
                {t('admin_resp_note_label')}
              </label>
              <textarea
                id="admin-resp-nota"
                value={nota}
                onChange={(e) => { setNota(e.target.value); setErrorNota(null); }}
                rows={3}
                maxLength={NOTA_MAX}
                autoFocus
                disabled={actuando !== null}
                aria-invalid={errorNota ? true : undefined}
                aria-describedby="admin-resp-nota-ayuda"
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)] resize-none"
              />
              <div className="flex justify-between gap-3 mt-1 text-xs uv-text-muted">
                <span id="admin-resp-nota-ayuda">{t('admin_resp_note_hint')}</span>
                <span className="tabular-nums shrink-0">{nota.length}/{NOTA_MAX}</span>
              </div>
            </div>
            {errorNota && <p className="text-sm text-[var(--color-danger)]" role="alert">{errorNota}</p>}
            <button
              type="submit"
              disabled={actuando !== null || nota.trim() === ''}
              className="w-full bg-[var(--color-primary)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {actuando ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                t('admin_resp_confirm')
              )}
            </button>
          </form>
        )}
      </BottomSheet>
    </div>
  );
};
