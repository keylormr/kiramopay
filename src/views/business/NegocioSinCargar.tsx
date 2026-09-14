import React from 'react';
import { Icons } from '@/components/Icons';
import { useLanguage } from '@/i18n/LanguageContext';

interface NegocioSinCargarProps {
  /** Hay un reintento automatico en camino. */
  reintentando: boolean;
  onReintentar: () => void;
  onVolverAPersonal: () => void;
}

/**
 * El perfil de negocio esta elegido pero su comercio no se pudo cargar.
 *
 * Antes este caso no existia: la lista vacia por un fallo se leia como "ese
 * comercio ya no es tuyo" y la app devolvia al perfil personal sin avisar. Ahora
 * se dice lo que paso, el perfil se conserva y la salida a la billetera personal
 * es una decision de la persona, no un rebote.
 */
export const NegocioSinCargar: React.FC<NegocioSinCargarProps> = ({ reintentando, onReintentar, onVolverAPersonal }) => {
  const { t } = useLanguage();
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl uv-chip-warning">
        <Icons.Offline size={28} aria-hidden="true" />
      </div>
      <h2 className="text-lg font-bold tracking-tight uv-text-primary">{t('business_load_failed_title')}</h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed uv-text-secondary">
        {reintentando ? t('business_load_failed_retrying') : t('business_load_failed_desc')}
      </p>
      <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          onClick={onReintentar}
          className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] py-3.5 font-bold text-white transition-all hover:bg-[var(--color-primary-hover)] active:scale-[0.98] uv-focus-ring"
        >
          <Icons.RefreshCw size={18} aria-hidden="true" />
          {t('error_retry')}
        </button>
        <button
          type="button"
          onClick={onVolverAPersonal}
          className="rounded-xl py-3 text-sm font-semibold uv-text-secondary transition-colors hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] uv-focus-ring"
        >
          {t('business_back_to_personal')}
        </button>
      </div>
    </div>
  );
};
