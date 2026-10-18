import React from 'react';
import { Icons } from './Icons';
import { useLanguage } from '../i18n/LanguageContext';
import { useActualizacion } from '../hooks/useActualizacion';
import type { PlataformaApp } from '../api/repositories/appversion.repository';

// Toda version nueva de la app instalada es obligatoria.
//
// Antes era una hoja con "Despues" que se cerraba por 24 horas, y aparecia
// recien dentro de la app, despues del login: la version vieja se seguia usando
// sin problema. Ahora es una barrera que tapa todo, el login incluido, con un
// solo boton. Dice que trae la version nueva, que el servidor lee del release.
//
// En Android el boton baja el .apk y el sistema lo instala encima (misma firma),
// sin perder datos ni sesion. En iOS no se puede instalar un binario bajado de
// un link: el boton lleva al canal (TestFlight, App Store o instalador OTA), y
// por eso cambian el texto y la accion.

interface Props {
  version: string;
  notas: string[];
  plataforma: PlataformaApp | null;
  onActualizar: () => void;
}

export const ActualizacionObligatoria: React.FC<Props> = ({ version, notas, plataforma, onActualizar }) => {
  const { t } = useLanguage();
  const ios = plataforma === 'ios';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="actualizacion-titulo"
      aria-describedby="actualizacion-texto"
      className="fixed inset-0 z-[100] flex flex-col bg-gradient-to-b from-slate-900 to-slate-800 text-white"
    >
      <div className="flex-1 overflow-y-auto px-6 pt-16 pb-6">
        <div className="mx-auto max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-primary)]/20 text-[var(--color-primary-300)] flex items-center justify-center mx-auto mb-6">
            <Icons.Download size={32} aria-hidden="true" />
          </div>

          <h1 id="actualizacion-titulo" className="text-2xl font-bold mb-2 text-center">
            {t('update_title')}
          </h1>
          <p id="actualizacion-texto" className="text-gray-300 text-center mb-8">
            {t(ios ? 'update_body_ios' : 'update_body').replace('{version}', version)}
          </p>

          {notas.length > 0 && (
            <section aria-labelledby="actualizacion-novedades">
              <h2 id="actualizacion-novedades" className="text-sm font-bold uppercase tracking-wide text-gray-400 mb-3">
                {t('update_whats_new').replace('{version}', version)}
              </h2>
              <ul className="space-y-2.5">
                {notas.map((nota, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-gray-200">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary-300)]" />
                    <span>{nota}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <div className="px-6 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] border-t border-white/10">
        <button
          type="button"
          onClick={onActualizar}
          className="mx-auto block w-full max-w-sm bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold active:scale-[0.98] transition-all"
        >
          {t(ios ? 'update_open' : 'update_download')}
        </button>
      </div>
    </div>
  );
};

/**
 * Envuelve la app entera: con una version nueva publicada, muestra la barrera
 * en lugar de la app. Va por encima del login, para que nadie entre con la
 * version vieja.
 */
export const BarreraDeActualizacion: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { actualizacion, plataforma, actualizar } = useActualizacion();
  if (!actualizacion) return <>{children}</>;
  return (
    <ActualizacionObligatoria
      version={actualizacion.version}
      notas={actualizacion.notas}
      plataforma={plataforma}
      onActualizar={actualizar}
    />
  );
};
