import React, { useCallback, useEffect, useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { Icons } from '@/components/Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { getApiLayer } from '@/api';
import type { SolicitudDeEliminacion } from '@/api/repositories/admin.repository';
import type { TranslationKeys } from '@/i18n/translations';
import { fechaYHora } from '@/utils/fechaPlazo';

// La cola de las solicitudes de eliminacion que llegan de la pagina web
// (/eliminar-cuenta) y esperan a una persona: solo las de cuentas bajo revision
// (bloqueadas o suspendidas), con el contacto ya verificado por un codigo; las
// demas empiezan el plazo solas al verificar. Atender una inicia el MISMO plazo
// de 30 dias que la app, con los mismos bloqueos, sin desbloquear la cuenta, y
// deja al administrador en la auditoria.
//
// Vive como pestana de la pantalla de cuentas porque es la misma tarea
// (gestionar una cuenta) y asi no se agrega otra entrada al menu.

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
  const [actuando, setActuando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      const res = await getApiLayer().admin?.listDeletionRequests();
      if (!vigente) return;
      if (!res?.success || !res.data) {
        setFalla(true);
      } else {
        setFalla(false);
        setCola(res.data);
      }
      setCargando(false);
    })();
    return () => {
      vigente = false;
    };
  }, [recarga]);

  const releer = useCallback(() => {
    setCargando(true);
    setRecarga((n) => n + 1);
  }, []);

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
    setAviso(
      res?.success
        ? { tipo: 'ok', texto: t('admin_del_rejected') }
        : { tipo: 'error', texto: t(res?.error?.code === 'NOT_PENDING' ? 'admin_del_already' : 'admin_del_action_failed') },
    );
    releer();
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

      {!cargando && !falla && cola.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-4">
            <Icons.Trash size={26} className="uv-text-muted" aria-hidden="true" />
          </div>
          <p className="font-semibold uv-text-primary">{t('admin_del_empty')}</p>
        </div>
      )}

      {!cargando &&
        cola.map((s) => (
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
                onClick={() => void rechazar(s)}
                disabled={actuando !== null}
                className="flex-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-primary py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--color-border)] dark:hover:bg-[var(--color-border-dark)] transition-colors"
              >
                {t('admin_del_reject')}
              </button>
            </div>
          </article>
        ))}

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
    </div>
  );
};
