import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import { formatMoney } from '@/utils/money';

// El fondo de promociones del que sale el cashback de puntos.
//
// Cada canje de cashback sale de aca y se rechaza si no alcanza: nunca se
// regala plata que no existe. Registrar un fondeo SUBE LA RESERVA PUBLICADA en
// la prueba de reservas, asi que solo se hace con un deposito real, y la
// pantalla lo dice antes de confirmar.

function nuevaLlave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const AdminPromocionesView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [saldo, setSaldo] = useState<number | null>(null);
  const [errorSaldo, setErrorSaldo] = useState('');
  const [recarga, setRecarga] = useState(0);

  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorFondeo, setErrorFondeo] = useState('');
  const [hecho, setHecho] = useState('');
  // Una llave por INTENTO de fondeo: un doble toque o un reintento de red no
  // fondea dos veces. Se renueva solo cuando el servidor respondio.
  const llave = useRef(nuevaLlave());

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const res = await getApiLayer().admin?.saldoPromociones();
      if (cancelado) return;
      if (res?.success && res.data) {
        setSaldo(res.data.saldoMinor);
        setErrorSaldo('');
      } else {
        setSaldo(null);
        setErrorSaldo(res?.error?.message || 'ERROR');
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [recarga]);

  const valor = parseFloat(monto);
  const montoMinor = Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) : 0;
  const puedeFondear = montoMinor > 0 && referencia.trim().length >= 3;

  const fondear = async () => {
    const api = getApiLayer();
    if (!api.admin || !puedeFondear) return;
    setGuardando(true);
    setErrorFondeo('');
    const res = await api.admin.fondearPromociones(montoMinor, referencia.trim(), llave.current);
    setGuardando(false);
    if (!res.success || !res.data) {
      setErrorFondeo(res.error?.message || t('admin_promo_failed'));
      return;
    }
    llave.current = nuevaLlave();
    setSaldo(res.data.saldoMinor);
    setHecho(t('admin_promo_done').replace('{monto}', formatMoney(montoMinor / 100, 'CRC', { decimals: 2 })));
    setConfirmando(false);
    setMonto('');
    setReferencia('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]" aria-label={t('back')}>
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('admin_promo_title')}</h1>
        <span className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-8">
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft p-5">
          <p className="text-xs font-semibold uv-text-muted uppercase tracking-wider">{t('admin_promo_balance')}</p>
          {errorSaldo ? (
            // Un saldo que no se pudo leer no es un saldo en cero: se dice.
            <div className="mt-2">
              <p className="text-sm text-[var(--color-danger)]" aria-live="polite">
                {errorSaldo === 'ERROR' ? t('admin_promo_failed') : errorSaldo}
              </p>
              <button onClick={() => setRecarga((n) => n + 1)} className="mt-2 text-sm font-bold text-[var(--color-primary)]">
                {t('error_retry')}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-3xl font-extrabold uv-text-primary tabular-nums">
              {saldo === null ? '—' : formatMoney(saldo / 100, 'CRC', { decimals: 2 })}
            </p>
          )}
          <p className="mt-2 text-xs uv-text-muted">{t('admin_promo_explain')}</p>
        </div>

        {hecho && <p className="text-sm font-semibold text-[var(--color-success)]" aria-live="polite">{hecho}</p>}

        <div className="uv-surface-1 rounded-2xl uv-shadow-soft p-5 space-y-3">
          <p className="font-bold uv-text-primary">{t('admin_promo_fund_title')}</p>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('admin_promo_amount')}</label>
            <input
              value={monto}
              onChange={(e) => setMonto(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('admin_promo_reference')}</label>
            <input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder={t('admin_promo_reference_hint')}
              className="w-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary px-4 py-3 rounded-xl outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <button
            onClick={() => { setErrorFondeo(''); setHecho(''); setConfirmando(true); }}
            disabled={!puedeFondear}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50"
          >
            {t('admin_promo_fund_btn')}
          </button>
        </div>
      </div>

      <BottomSheet isOpen={confirmando} onClose={() => setConfirmando(false)} title={t('admin_promo_fund_title')}>
        <div className="space-y-4">
          <p className="text-sm uv-text-primary">
            {t('admin_promo_confirm')
              .replace('{monto}', formatMoney(montoMinor / 100, 'CRC', { decimals: 2 }))
              .replace('{referencia}', referencia.trim())}
          </p>
          <p className="text-sm rounded-xl px-3 py-2 bg-[var(--color-warning-soft)] text-[var(--color-warning)]">
            {t('admin_promo_warning')}
          </p>
          {errorFondeo && <p className="text-sm text-[var(--color-danger)]" aria-live="polite">{errorFondeo}</p>}
          <div className="flex gap-2">
            <button onClick={() => setConfirmando(false)} className="flex-1 uv-surface-2 uv-text-primary py-3 rounded-xl font-bold">
              {t('cancel')}
            </button>
            <button
              onClick={fondear}
              disabled={guardando}
              className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-xl font-bold disabled:opacity-50"
            >
              {guardando ? t('loading') : t('confirm')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};
