import React, { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { recargarSaltandoCaches } from '../hooks/useGuardiaDeVersion';

// Pantalla que bloquea el uso de una version vieja.
//
// Es a proposito una barrera y no un aviso que se pueda ignorar: un bundle
// desactualizado pide archivos que el despliegue actual ya borro, asi que la
// aplicacion no se puede usar de forma fiable — se rompe al abrir la primera
// pantalla diferida, y lo hace con un "Algo salio mal" que no le dice nada a
// nadie. Antes de eso, se recarga sola.

/** Segundos antes de recargar sin que nadie toque nada. */
export const SEGUNDOS_PARA_RECARGAR = 10;

interface Props {
  /** Solo para mostrar; puede faltar si el servidor no la dijo. */
  version?: string | null;
}

export const AppDesactualizada: React.FC<Props> = ({ version }) => {
  const { t } = useLanguage();
  const [restantes, setRestantes] = useState(SEGUNDOS_PARA_RECARGAR);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRestantes((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (restantes > 0) return;
    void recargarSaltandoCaches();
  }, [restantes]);

  return (
    <div
      role="alertdialog"
      aria-labelledby="app-desactualizada-titulo"
      aria-describedby="app-desactualizada-texto"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 px-6 text-white"
    >
      <div className="w-16 h-16 rounded-2xl bg-[var(--color-primary)]/20 flex items-center justify-center mb-6">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--color-primary-300)] animate-spin"
          style={{ animationDuration: '2.5s' }}
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>

      <h1 id="app-desactualizada-titulo" className="text-2xl font-bold mb-2 text-center">
        {t('update_required_title')}
      </h1>
      <p id="app-desactualizada-texto" className="text-gray-400 text-center mb-2 max-w-sm">
        {t('update_required_body')}
      </p>

      <p className="text-gray-300 text-sm mb-8 tabular-nums" aria-live="polite">
        {t('update_required_countdown')} {restantes}
      </p>

      <button
        type="button"
        onClick={() => void recargarSaltandoCaches()}
        className="w-full max-w-xs bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold active:scale-95 transition-all"
      >
        {t('update_required_now')}
      </button>

      {version && (
        <p className="mt-6 text-xs text-gray-500 tabular-nums">
          {t('update_required_version')} {version}
        </p>
      )}
    </div>
  );
};
