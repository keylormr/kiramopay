import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { EscrowAgreement, AdminUser } from '@/api';
import { formatMoney, type CurrencyCode } from '@/utils/money';
import { fechaYHora } from '@/utils/fechaPlazo';

// La cola de disputas del escrow.
//
// Una disputa congela la plata en SYSTEM:ESCROW y solo sale por la resolucion
// del administrador (o porque una de las partes cede). Hasta el #183 el
// arbitro ni siquiera podia LISTAR los casos: habia un boton para resolver una
// disputa que nadie podia encontrar. Esta pantalla es la cola: la disputa mas
// vieja primero, con el monto, el motivo y quien es quien.

type Veredicto = 'released' | 'refunded';

export const AdminDisputasView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const [casos, setCasos] = useState<EscrowAgreement[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState('');
  const [recarga, setRecarga] = useState(0);
  // Nombres de las partes: el servidor identifica por id, y un arbitro no
  // decide sobre dos UUID.
  const [personas, setPersonas] = useState<Record<string, AdminUser>>({});

  const [confirmando, setConfirmando] = useState<{ caso: EscrowAgreement; veredicto: Veredicto } | null>(null);
  const [resolviendo, setResolviendo] = useState(false);
  const [errorResolver, setErrorResolver] = useState('');

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      const api = getApiLayer();
      const res = await api.escrow.adminList();
      if (cancelado) return;
      if (!res.success || !res.data) {
        setErrorLista(res.error?.message || 'ERROR');
        setCargando(false);
        return;
      }
      setErrorLista('');
      setCasos(res.data.agreements);
      setTotal(res.data.total);
      setCargando(false);

      // Los nombres llegan despues; si alguno falla, el caso se muestra igual
      // con su id, que es lo que el arbitro puede buscar a mano.
      const ids = [...new Set(res.data.agreements.flatMap((a) => [a.buyerId, a.sellerId]))];
      const encontrados: Record<string, AdminUser> = {};
      await Promise.all(
        ids.map(async (id) => {
          const u = await api.admin?.getUser(id);
          if (u?.success && u.data) encontrados[id] = u.data;
        }),
      );
      if (!cancelado) setPersonas(encontrados);
    })();
    return () => {
      cancelado = true;
    };
  }, [recarga]);

  const nombre = (id: string) => {
    const p = personas[id];
    if (!p) return id.slice(0, 8);
    const completo = `${p.firstName} ${p.lastName}`.trim();
    return p.phoneMasked ? `${completo} · ${p.phoneMasked}` : completo;
  };

  const monto = (a: EscrowAgreement) => formatMoney(a.amountMinor / 100, a.currency as CurrencyCode, { decimals: 2 });

  const resolver = async () => {
    if (!confirmando) return;
    setResolviendo(true);
    setErrorResolver('');
    const res = await getApiLayer().escrow.adminResolve(confirmando.caso.id, confirmando.veredicto);
    setResolviendo(false);
    if (!res.success) {
      setErrorResolver(res.error?.message || t('admin_disputes_failed'));
      return;
    }
    setConfirmando(null);
    setRecarga((n) => n + 1);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]" aria-label={t('back')}>
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('admin_disputes_title')}</h1>
        <span className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        {cargando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : errorLista ? (
          // Una cola que no cargo NO es una cola vacia: se dice.
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <p className="text-sm text-[var(--color-danger)] mb-4" aria-live="polite">
              {errorLista === 'ERROR' ? t('admin_disputes_failed') : errorLista}
            </p>
            <button onClick={() => setRecarga((n) => n + 1)} className="px-6 py-3 uv-surface-2 uv-text-primary rounded-xl font-bold text-sm">
              {t('error_retry')}
            </button>
          </div>
        ) : casos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-4">
              <Icons.Check size={26} className="uv-text-muted" />
            </div>
            <p className="font-semibold uv-text-primary">{t('admin_disputes_empty')}</p>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            <p className="text-xs font-semibold uv-text-muted uppercase tracking-wider">
              {t('admin_disputes_total').replace('{n}', String(total))}
            </p>
            {casos.map((a) => (
              <div key={a.id} className="uv-surface-1 rounded-2xl uv-shadow-soft p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-bold uv-text-primary min-w-0 truncate">{a.description}</p>
                  <p className="font-extrabold uv-text-primary tabular-nums shrink-0">{monto(a)}</p>
                </div>
                {a.disputedAt && (
                  <p className="text-xs uv-text-muted">
                    {t('admin_disputes_opened').replace('{fecha}', fechaYHora(a.disputedAt, language))}
                  </p>
                )}
                <dl className="text-sm space-y-1">
                  <div className="flex gap-2">
                    <dt className="uv-text-muted shrink-0">{t('admin_disputes_buyer')}:</dt>
                    <dd className="uv-text-primary min-w-0 truncate">{nombre(a.buyerId)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="uv-text-muted shrink-0">{t('admin_disputes_seller')}:</dt>
                    <dd className="uv-text-primary min-w-0 truncate">{nombre(a.sellerId)}</dd>
                  </div>
                </dl>
                {a.disputeReason && (
                  <div className="uv-surface-2 rounded-xl p-3 text-sm">
                    <span className="uv-text-muted">{t('admin_disputes_reason')}: </span>
                    <span className="uv-text-primary">{a.disputeReason}</span>
                  </div>
                )}
                {a.deliveredAt && (
                  <p className="text-xs uv-text-muted">
                    {t('admin_disputes_delivered').replace('{fecha}', fechaYHora(a.deliveredAt, language))}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setErrorResolver(''); setConfirmando({ caso: a, veredicto: 'refunded' }); }}
                    className="flex-1 border border-[var(--color-border-strong)] dark:border-[var(--color-border-dark)] uv-text-primary py-2.5 rounded-xl font-bold text-sm"
                  >
                    {t('admin_disputes_to_buyer')}
                  </button>
                  <button
                    onClick={() => { setErrorResolver(''); setConfirmando({ caso: a, veredicto: 'released' }); }}
                    className="flex-1 border border-[var(--color-border-strong)] dark:border-[var(--color-border-dark)] uv-text-primary py-2.5 rounded-xl font-bold text-sm"
                  >
                    {t('admin_disputes_to_seller')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mover plata ajena no se hace con un solo toque: se confirma diciendo
          cuanto y a quien. */}
      <BottomSheet
        isOpen={confirmando !== null}
        onClose={() => setConfirmando(null)}
        title={confirmando?.caso.description || t('admin_disputes_title')}
      >
        {confirmando && (
          <div className="space-y-4">
            <p className="text-sm uv-text-primary">
              {(confirmando.veredicto === 'released' ? t('admin_disputes_confirm_seller') : t('admin_disputes_confirm_buyer'))
                .replace('{monto}', monto(confirmando.caso))
                .replace('{nombre}', nombre(confirmando.veredicto === 'released' ? confirmando.caso.sellerId : confirmando.caso.buyerId))}
            </p>
            {errorResolver && <p className="text-sm text-[var(--color-danger)]" aria-live="polite">{errorResolver}</p>}
            <div className="flex gap-2">
              <button onClick={() => setConfirmando(null)} className="flex-1 uv-surface-2 uv-text-primary py-3 rounded-xl font-bold">
                {t('cancel')}
              </button>
              <button
                onClick={resolver}
                disabled={resolviendo}
                className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-xl font-bold disabled:opacity-50"
              >
                {resolviendo ? t('loading') : t('admin_disputes_confirm')}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
};
