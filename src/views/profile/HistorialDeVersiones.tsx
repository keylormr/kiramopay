import React, { useEffect, useId, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons, IconosLinea } from '@/components/Icons';
import { fechaParaFormato, localeDe } from '@/utils/periodos';
import { fechaSinCortes } from '@/utils/fechaSinCortes';
import { rellenar } from '@/utils/planes';
import {
  cambiosEn,
  cargarNotasTraducidas,
  getAllVersions,
  type NotasTraducidas,
  type VersionInfo,
} from '../../config/version';

// Lo que trajo cada version, en el idioma de la persona. La vigente va primero,
// completa y con la etiqueta "Actual"; las anteriores se pliegan y cada una se
// despliega con su propio boton. Las traducciones se piden solo si el idioma no
// es el espanol, del que sale el changelog; mientras llegan se lee el espanol.

// "6 de noviembre de 2026" en el idioma activo. La fecha del changelog es un dia
// civil (AAAA-MM-DD), asi que se formatea en UTC: con la zona de la persona un
// huso negativo la correria al dia anterior.
export function fechaDeVersion(releaseDate: string, idioma: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return releaseDate;
  try {
    return fechaSinCortes(
      new Intl.DateTimeFormat(localeDe(idioma), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(fechaParaFormato(releaseDate)),
    );
  } catch {
    return releaseDate;
  }
}

const CHIP_ACTUAL =
  'bg-[var(--color-primary-fill)] text-white text-xs font-semibold px-2 py-0.5 rounded-full';

const Cambios: React.FC<{ cambios: string[] }> = ({ cambios }) => (
  <ul className="space-y-2.5">
    {cambios.map((cambio, i) => (
      <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed uv-text-secondary">
        <IconosLinea.Confirmado
          size={18}
          className="mt-0.5 shrink-0 text-[var(--color-primary)] dark:text-[var(--color-primary-light)]"
          aria-hidden="true"
        />
        <span className="min-w-0 break-words">{cambio}</span>
      </li>
    ))}
  </ul>
);

const VersionVigente: React.FC<{ version: VersionInfo; cambios: string[]; fecha: string; actual: string }> = ({
  version,
  cambios,
  fecha,
  actual,
}) => (
  <section
    aria-label={`v${version.version}`}
    className="uv-surface-2 rounded-2xl p-4 border border-[var(--color-primary)]/40 dark:border-[var(--color-primary-light)]/30"
  >
    <div className="flex items-center justify-between gap-3 mb-3.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-lg font-bold uv-text-primary kp-num">v{version.version}</span>
        <span className={CHIP_ACTUAL}>{actual}</span>
      </div>
      <time dateTime={version.releaseDate} className="text-xs uv-text-muted text-right">
        {fecha}
      </time>
    </div>
    <Cambios cambios={cambios} />
  </section>
);

const VersionPlegable: React.FC<{
  version: VersionInfo;
  cambios: string[];
  fecha: string;
  abierta: boolean;
  onAlternar: () => void;
  etiqueta: string;
  cuantos: string;
}> = ({ version, cambios, fecha, abierta, onAlternar, etiqueta, cuantos }) => {
  const idBase = useId();
  const idPanel = `${idBase}-notas`;
  return (
    <section className="uv-surface-2 rounded-2xl overflow-hidden">
      <h3 className="m-0">
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={abierta}
          aria-controls={idPanel}
          aria-label={`${etiqueta}: v${version.version}, ${fecha}, ${cuantos}`}
          className="w-full min-h-14 px-4 py-3 flex items-center gap-3 text-left kp-toque kp-foco"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold uv-text-primary kp-num">v{version.version}</span>
            <span className="block text-xs uv-text-muted">
              {fecha} · {cuantos}
            </span>
          </span>
          <Icons.ChevronRight
            size={18}
            aria-hidden="true"
            className="shrink-0 uv-text-muted"
            style={{
              transform: abierta ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform var(--kp-mov-estado) var(--kp-curva)',
            }}
          />
        </button>
      </h3>
      <div
        id={idPanel}
        role="region"
        aria-label={`v${version.version}`}
        inert={!abierta}
        style={{
          display: 'grid',
          gridTemplateRows: abierta ? '1fr' : '0fr',
          transition: 'grid-template-rows var(--kp-mov-hoja) var(--kp-curva-hoja)',
        }}
      >
        <div className="overflow-hidden min-h-0">
          <div
            className="px-4 pb-4 pt-1"
            style={{
              opacity: abierta ? 1 : 0,
              transition: 'opacity var(--kp-mov-estado) var(--kp-curva)',
            }}
          >
            <Cambios cambios={cambios} />
          </div>
        </div>
      </div>
    </section>
  );
};

export const HistorialDeVersiones: React.FC = () => {
  const { t, language } = useLanguage();
  const [traducidas, setTraducidas] = useState<NotasTraducidas>({});
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (language === 'es') return;
    let vigente = true;
    cargarNotasTraducidas()
      .then((notas) => {
        if (vigente) setTraducidas(notas);
      })
      .catch(() => {
        /* sin el archivo se lee el espanol, que siempre esta */
      });
    return () => {
      vigente = false;
    };
  }, [language]);

  const alternar = (version: string) =>
    setAbiertas((previas) => {
      const siguientes = new Set(previas);
      if (siguientes.has(version)) siguientes.delete(version);
      else siguientes.add(version);
      return siguientes;
    });

  const [vigente, ...anteriores] = getAllVersions();

  const cuantos = (n: number) => rellenar(t(n === 1 ? 'version_changes_one' : 'version_changes_many'), { n });

  return (
    <div className="space-y-3">
      <VersionVigente
        version={vigente}
        cambios={cambiosEn(vigente, language, traducidas)}
        fecha={fechaDeVersion(vigente.releaseDate, language)}
        actual={t('current')}
      />
      {anteriores.length > 0 && (
        <h4 className="pt-2 px-1 text-xs font-semibold uv-text-muted">
          {t('version_previous')}
        </h4>
      )}
      {anteriores.map((version) => {
        const cambios = cambiosEn(version, language, traducidas);
        return (
          <VersionPlegable
            key={version.version}
            version={version}
            cambios={cambios}
            fecha={fechaDeVersion(version.releaseDate, language)}
            abierta={abiertas.has(version.version)}
            onAlternar={() => alternar(version.version)}
            etiqueta={t(abiertas.has(version.version) ? 'version_hide_changes' : 'version_show_changes')}
            cuantos={cuantos(cambios.length)}
          />
        );
      })}
    </div>
  );
};
