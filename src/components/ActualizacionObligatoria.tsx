import React from 'react';
import { Icons } from './Icons';
import { useLanguage } from '../i18n/LanguageContext';
import { useActualizacion, type FaseInterna } from '../hooks/useActualizacion';
import type { PlataformaApp } from '../api/repositories/appversion.repository';
import { localeDe } from '../utils/periodos';

// Toda version nueva de la app instalada es obligatoria.
//
// Antes era una hoja con "Despues" que se cerraba por 24 horas, y aparecia
// recien dentro de la app, despues del login: la version vieja se seguia usando
// sin problema. Ahora es una barrera que tapa todo, el login incluido. Dice que
// trae la version nueva, que el servidor lee del release.
//
// Dos formas, segun la via que eligio useActualizacion:
//
//   - Por dentro (interna): la barrera misma baja la version nueva y muestra el
//     avance; cuando termina, la app se reinicia sola. No hay boton mientras
//     baja; si no se pudo, uno solo: Reintentar.
//   - Por fuera (externa): un solo boton. En Android baja el .apk y el sistema
//     lo instala encima (misma firma), sin perder datos ni sesion. En iOS no se
//     puede instalar un binario bajado de un link: lleva al canal (TestFlight,
//     App Store o instalador OTA), y por eso cambian el texto y la accion.

export interface EstadoInterno {
  fase: FaseInterna;
  recibidos: number;
  total: number | null;
}

interface Props {
  version: string;
  /** La que corre en el telefono. */
  instalada?: string;
  notas: string[];
  plataforma: PlataformaApp | null;
  onActualizar: () => void;
  /** Presente cuando la version se baja por dentro. */
  interna?: EstadoInterno;
  onReintentar?: () => void;
}

function megas(bytes: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB`;
}

const Avance: React.FC<{ estado: EstadoInterno; onReintentar?: () => void }> = ({ estado, onReintentar }) => {
  const { t, language } = useLanguage();
  const locale = localeDe(language);
  const { fase, recibidos, total } = estado;

  if (fase === 'error') {
    return (
      <div className="mx-auto max-w-sm">
        <p role="alert" className="mb-3 flex items-center justify-center gap-2 text-center text-sm text-amber-200">
          <Icons.AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
          {t('update_internal_error')}
        </p>
        <button
          type="button"
          onClick={onReintentar}
          className="flex w-full items-center justify-center gap-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold active:scale-[0.98] transition-all"
        >
          <Icons.RefreshCw size={18} aria-hidden="true" />
          {t('update_internal_retry')}
        </button>
      </div>
    );
  }

  if (fase === 'sin_red') {
    return (
      <p role="status" className="mx-auto flex max-w-sm items-center justify-center gap-2 text-center text-sm text-gray-300">
        <Icons.Offline size={16} aria-hidden="true" className="shrink-0" />
        {t('update_internal_offline')}
      </p>
    );
  }

  // Al aplicar, la barra queda llena aunque el plugin no haya dicho el total.
  const fraccion =
    fase === 'aplicando' ? 1 : total && total > 0 ? Math.min(1, Math.max(0, recibidos / total)) : null;
  const porcentaje = fraccion === null ? null : Math.round(fraccion * 100);
  const texto =
    fase === 'aplicando'
      ? t('update_internal_applying')
      : fase === 'preparando'
        ? t('update_internal_preparing')
        : t('update_internal_downloading');

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span role="status" className="text-gray-200">
          {texto}
        </span>
        {porcentaje !== null && fase !== 'aplicando' && (
          <span className="font-semibold tabular-nums text-white">
            {new Intl.NumberFormat(locale, { style: 'percent' }).format(porcentaje / 100)}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={t('update_internal_title')}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(porcentaje !== null ? { 'aria-valuenow': porcentaje } : {})}
        className="h-2 w-full overflow-hidden rounded-full bg-white/10"
      >
        {porcentaje === null ? (
          // Sin total todavia: una franja que se mueve, sin inventar un numero.
          <div className="h-full w-1/3 rounded-full bg-[var(--color-primary-300)] animate-pulse" />
        ) : (
          <div
            className="h-full rounded-full bg-[var(--color-primary-300)] transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${porcentaje}%` }}
          />
        )}
      </div>
      {fase === 'descargando' && total !== null && total > 0 && (
        <p className="mt-2 text-right text-xs text-gray-400 tabular-nums">
          {t('update_internal_size').replace('{done}', megas(recibidos, locale)).replace('{total}', megas(total, locale))}
        </p>
      )}
    </div>
  );
};

export const ActualizacionObligatoria: React.FC<Props> = ({
  version,
  instalada,
  notas,
  plataforma,
  onActualizar,
  interna,
  onReintentar,
}) => {
  const { t } = useLanguage();
  const ios = plataforma === 'ios';

  const titulo = interna ? t('update_internal_title') : t('update_title');
  const cuerpo = interna ? t('update_internal_body') : t(ios ? 'update_body_ios' : 'update_body');

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
            {titulo}
          </h1>
          <p id="actualizacion-texto" className="text-gray-300 text-center mb-8">
            {cuerpo.replace('{version}', version)}
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
        {/* Si algo falla, con esto la persona sabe que pedir. */}
        {instalada && (
          <p className="mb-3 text-center text-xs text-gray-400 tabular-nums">
            {t('update_installed').replace('{version}', instalada)}
          </p>
        )}
        {interna ? (
          <Avance estado={interna} onReintentar={onReintentar} />
        ) : (
          <button
            type="button"
            onClick={onActualizar}
            className="mx-auto block w-full max-w-sm bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold active:scale-[0.98] transition-all"
          >
            {t(ios ? 'update_open' : 'update_download')}
          </button>
        )}
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
  const { actualizacion, plataforma, actualizar, reintentar } = useActualizacion();
  if (!actualizacion) return <>{children}</>;
  return (
    <ActualizacionObligatoria
      version={actualizacion.version}
      instalada={actualizacion.instalada}
      notas={actualizacion.notas}
      plataforma={plataforma}
      onActualizar={actualizar}
      interna={
        actualizacion.via === 'interna'
          ? { fase: actualizacion.fase, recibidos: actualizacion.recibidos, total: actualizacion.total }
          : undefined
      }
      onReintentar={reintentar}
    />
  );
};
