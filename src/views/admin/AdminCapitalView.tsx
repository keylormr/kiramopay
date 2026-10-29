import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { getApiLayer } from '@/api';
import type { CapitalPorMoneda } from '@/api/repositories/admin.repository';
import { formatMoney, type CurrencyCode } from '@/utils/money';
import { mensajeDeRechazo } from '@/i18n/mensajesDeError';

// El capital propio de la empresa, por moneda.
//
// Es el dinero de KiramoPay aparte de lo que se les debe a los usuarios (la
// reserva es exactamente igual a eso). La compra y la venta de cripto mueven
// plata entre la reserva y el capital, las comisiones entran y las promociones
// salen, y la cuenta no tiene piso: puede quedar en negativo sin frenar ninguna
// operacion (decision del dueno: "Permitir y avisar"). Esta pantalla es el aviso:
// dice cuanto falta, en rojo, para saber cuanto habria que depositar con dinero
// real.
//
// El dato sale del libro contable. La pantalla NO lo calcula: muestra lo que
// responde el servidor, y si no responde lo dice. Un cero seria una afirmacion
// ("no falta nada"); lo que hay en ese caso es "no se sabe".

const SIN_CLAVES_PROPIAS: Readonly<Record<string, string>> = {};

const dinero = (minor: number, moneda: string) =>
  formatMoney(minor / 100, moneda as CurrencyCode, { decimals: 2 });

export const AdminCapitalView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [monedas, setMonedas] = useState<CapitalPorMoneda[] | null>(null);
  // El fallo se guarda crudo y el texto se arma al pintar: asi sigue al idioma.
  const [fallo, setFallo] = useState<{ code?: string; message?: string } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      setFallo(null);
      let res;
      try {
        res = await getApiLayer().admin?.capitalPropio();
      } catch {
        res = undefined;
      }
      if (cancelado) return;
      if (res?.success && res.data) {
        setMonedas(res.data);
      } else {
        setMonedas(null);
        setFallo(res?.error ?? {});
      }
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [recarga]);

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]" aria-label={t('back')}>
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('admin_capital_title')}</h1>
        <span className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-8">
        <p className="text-sm uv-text-muted">{t('admin_capital_explain')}</p>

        {cargando && <p className="text-sm uv-text-muted" aria-live="polite">{t('loading')}</p>}

        {!cargando && fallo && (
          // Un dato que no cargo no es un cero: se dice, y se deja reintentar.
          <div className="uv-surface-1 rounded-2xl uv-shadow-soft p-5">
            <p className="text-sm text-[var(--color-danger)]" aria-live="polite">
              {mensajeDeRechazo(fallo, SIN_CLAVES_PROPIAS, 'admin_capital_failed', t)}
            </p>
            <button onClick={() => setRecarga((n) => n + 1)} className="mt-2 text-sm font-bold text-[var(--color-primary)]">
              {t('error_retry')}
            </button>
          </div>
        )}

        {!cargando && !fallo && monedas && monedas.length === 0 && (
          <p className="text-sm uv-text-muted" role="status">{t('admin_capital_empty')}</p>
        )}

        {!cargando && !fallo && monedas?.map((m) => (
          <section key={m.moneda} aria-label={m.moneda} className="uv-surface-1 rounded-2xl uv-shadow-soft p-5">
            <p className="text-xs font-semibold uv-text-muted uppercase tracking-wider">{m.moneda}</p>
            <p
              className={`mt-1 text-3xl font-extrabold tabular-nums ${m.enNegativo ? 'text-[var(--color-danger)]' : 'uv-text-primary'}`}
            >
              {dinero(m.saldoMinor, m.moneda)}
            </p>
            {m.enNegativo ? (
              <p role="status" className="mt-3 rounded-xl px-3 py-2 text-sm font-semibold bg-[var(--color-danger-soft)] text-[var(--color-danger)]">
                {t('admin_capital_shortfall').replace('{monto}', dinero(m.faltanteMinor, m.moneda))}
              </p>
            ) : (
              <p className="mt-3 text-sm uv-text-muted">{t('admin_capital_ok')}</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
};
