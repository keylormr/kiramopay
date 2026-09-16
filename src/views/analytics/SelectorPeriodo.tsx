import React, { Suspense, useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { Icons } from '@/components/Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { lazyConRecarga } from '@/utils/lazyConRecarga';
import {
  PRESETS,
  desplazar,
  esMesCompleto,
  localeDe,
  mesCompleto,
  mismosRangos,
  nombreDeRango,
  rangoPreset,
  type FechaCivil,
  type Preset,
  type Rango,
} from '@/utils/periodos';
import { botonRedondo } from './estilosPeriodo';

// El calendario (react-day-picker y sus idiomas) solo se descarga cuando alguien
// abre la pestana de rango: la mayoria usa los atajos.
const CalendarioRango = lazyConRecarga(() => import('./CalendarioRango').then((m) => ({ default: m.CalendarioRango })));

/**
 * Filtro de periodo de la pantalla de analisis.
 *
 * Atajos a un toque para lo que se pide casi siempre, y "Otro periodo" para
 * elegir un mes puntual o un rango en el calendario. Los atajos bajan de linea
 * en vez de deslizarse: en un telefono angosto, "Otro periodo" quedaba fuera de
 * la pantalla. Las flechas mueven el periodo visible un paso, del mismo tamano
 * que el periodo.
 */

const CLAVE_PRESET: Record<Preset, string> = {
  este_mes: 'analytics_preset_this_month',
  mes_pasado: 'analytics_preset_last_month',
  ultimos_30: 'analytics_preset_30d',
  este_ano: 'analytics_preset_this_year',
};

const chip =
  'shrink-0 h-10 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors duration-150 uv-focus-ring';
const chipActivo = 'bg-[var(--color-primary)] text-white';
const chipInactivo =
  'uv-surface-1 uv-text-secondary hover:border-[var(--color-border-strong)] dark:hover:border-[var(--color-border-strong-dark)]';

interface SelectorPeriodoProps {
  rango: Rango;
  hoy: FechaCivil;
  onCambiar: (r: Rango) => void;
}

export const SelectorPeriodo: React.FC<SelectorPeriodoProps> = ({ rango, hoy, onCambiar }) => {
  const { t, language } = useLanguage();
  const [hojaAbierta, setHojaAbierta] = useState(false);

  const presetActivo = PRESETS.find((p) => mismosRangos(rangoPreset(p, hoy), rango));
  const anterior = desplazar(rango, -1, hoy);
  const siguiente = desplazar(rango, 1, hoy);

  return (
    <div>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t('analytics_pick_title')}
      >
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={presetActivo === p}
            onClick={() => onCambiar(rangoPreset(p, hoy))}
            className={`${chip} ${presetActivo === p ? chipActivo : chipInactivo}`}
          >
            {t(CLAVE_PRESET[p])}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={!presetActivo}
          aria-haspopup="dialog"
          onClick={() => setHojaAbierta(true)}
          className={`${chip} inline-flex items-center gap-1.5 ${!presetActivo ? chipActivo : chipInactivo}`}
        >
          <Icons.Calendar size={16} aria-hidden="true" />
          {t('analytics_preset_other')}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-1">
        <button
          type="button"
          className={botonRedondo}
          onClick={() => anterior && onCambiar(anterior)}
          disabled={!anterior}
          aria-label={t('analytics_period_prev')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <button
          type="button"
          onClick={() => setHojaAbierta(true)}
          className="flex-1 min-w-0 h-10 rounded-full px-2 flex items-center justify-center gap-2 text-base font-bold uv-text-primary hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-focus-ring"
          aria-haspopup="dialog"
        >
          <span className="truncate" aria-live="polite">{nombreDeRango(rango, language)}</span>
        </button>
        <button
          type="button"
          className={botonRedondo}
          onClick={() => siguiente && onCambiar(siguiente)}
          disabled={!siguiente}
          aria-label={t('analytics_period_next')}
        >
          <Icons.ChevronRight size={20} />
        </button>
      </div>

      <BottomSheet isOpen={hojaAbierta} onClose={() => setHojaAbierta(false)} title={t('analytics_pick_title')}>
        {hojaAbierta && (
          <HojaPeriodo
            rango={rango}
            hoy={hoy}
            onElegir={(r) => {
              onCambiar(r);
              setHojaAbierta(false);
            }}
          />
        )}
      </BottomSheet>
    </div>
  );
};

type Pestana = 'mes' | 'rango';

const HojaPeriodo: React.FC<{ rango: Rango; hoy: FechaCivil; onElegir: (r: Rango) => void }> = ({
  rango,
  hoy,
  onElegir,
}) => {
  const { t, language } = useLanguage();
  const [pestana, setPestana] = useState<Pestana>(esMesCompleto(rango) ? 'mes' : 'rango');

  return (
    <div>
      <div role="tablist" className="flex p-1 mb-4 rounded-xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]">
        {(['mes', 'rango'] as Pestana[]).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pestana === p}
            onClick={() => setPestana(p)}
            className={`flex-1 h-10 rounded-lg text-sm font-bold transition-colors uv-focus-ring ${
              pestana === p ? 'uv-surface-1 uv-text-primary shadow-[var(--shadow-soft)]' : 'border border-transparent uv-text-muted'
            }`}
          >
            {t(p === 'mes' ? 'analytics_pick_month' : 'analytics_pick_range')}
          </button>
        ))}
      </div>
      {pestana === 'mes' ? (
        <ElegirMes rango={rango} hoy={hoy} idioma={language} onElegir={onElegir} />
      ) : (
        <Suspense fallback={<div className="h-[26rem] rounded-2xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] animate-pulse" aria-hidden="true" />}>
          <CalendarioRango rango={rango} hoy={hoy} idioma={language} onElegir={onElegir} />
        </Suspense>
      )}
    </div>
  );
};

const ElegirMes: React.FC<{ rango: Rango; hoy: FechaCivil; idioma: string; onElegir: (r: Rango) => void }> = ({
  rango,
  hoy,
  idioma,
  onElegir,
}) => {
  const { t } = useLanguage();
  const anioHoy = Number(hoy.slice(0, 4));
  const mesHoy = Number(hoy.slice(5, 7));
  const [anio, setAnio] = useState(Number(rango.desde.slice(0, 4)));
  const fmt = new Intl.DateTimeFormat(localeDe(idioma), { month: 'short', timeZone: 'UTC' });
  const elegido = esMesCompleto(rango) ? rango.desde : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          className={botonRedondo}
          onClick={() => setAnio((a) => a - 1)}
          disabled={anio <= anioHoy - 10}
          aria-label={t('analytics_pick_year_prev')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <span className="text-lg font-bold uv-text-primary tabular-nums" aria-live="polite">{anio}</span>
        <button
          type="button"
          className={botonRedondo}
          onClick={() => setAnio((a) => a + 1)}
          disabled={anio >= anioHoy}
          aria-label={t('analytics_pick_year_next')}
        >
          <Icons.ChevronRight size={20} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 12 }, (_, i) => {
          const r = mesCompleto(anio, i + 1);
          const futuro = anio > anioHoy || (anio === anioHoy && i + 1 > mesHoy);
          const activo = elegido === r.desde;
          const nombre = fmt.format(new Date(Date.UTC(anio, i, 1))).replace('.', '');
          return (
            <button
              key={i}
              type="button"
              disabled={futuro}
              aria-pressed={activo}
              aria-label={nombreDeRango(r, idioma)}
              onClick={() => onElegir(r)}
              className={`h-12 rounded-xl text-sm font-semibold capitalize transition-colors uv-focus-ring disabled:opacity-35 disabled:pointer-events-none ${
                activo
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'uv-surface-2 uv-text-primary hover:border-[var(--color-primary-300)]'
              }`}
            >
              {nombre}
            </button>
          );
        })}
      </div>
    </div>
  );
};
