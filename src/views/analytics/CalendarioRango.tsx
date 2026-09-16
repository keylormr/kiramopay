import React, { useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { enUS, es, fr, hi, ja, ptBR, zhCN } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { useLanguage } from '@/i18n/LanguageContext';
import { MAX_DIAS_RANGO, diasEntre, nombreDeRango, sumarDias, type FechaCivil, type Rango } from '@/utils/periodos';

/**
 * Calendario para elegir un rango de dias. Vive en su propio modulo porque
 * react-day-picker y sus idiomas solo hacen falta cuando alguien abre esta
 * pestana: SelectorPeriodo lo carga en diferido.
 */

const LOCALES_CALENDARIO = { es, en: enUS, fr, pt: ptBR, ja, hi, 'zh-cn': zhCN } as const;

// El calendario trabaja con fechas locales del dispositivo y el resto de la
// pantalla con fechas civiles de Costa Rica escritas como texto. Solo se cruzan
// aqui, por ano, mes y dia, sin pasar por ninguna zona horaria.
const civilALocal = (f: FechaCivil) => {
  const [y, m, d] = f.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const localACivil = (d: Date): FechaCivil =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const CalendarioRango: React.FC<{ rango: Rango; hoy: FechaCivil; idioma: string; onElegir: (r: Rango) => void }> = ({
  rango,
  hoy,
  idioma,
  onElegir,
}) => {
  const { t } = useLanguage();
  const ultimoDelRango = sumarDias(rango.hasta, -1);
  const tope = hoy < ultimoDelRango ? hoy : ultimoDelRango;
  // La seleccion arranca con el periodo visible, marcada como completa: el
  // siguiente toque empieza un rango nuevo en vez de estirar el anterior.
  const [seleccion, setSeleccion] = useState<{ desde: FechaCivil; hasta: FechaCivil | null }>({
    desde: rango.desde,
    hasta: tope >= rango.desde ? tope : rango.desde,
  });
  const [recortado, setRecortado] = useState(false);

  const alTocar = (dia: Date) => {
    const f = localACivil(dia);
    setRecortado(false);
    if (seleccion.hasta !== null) {
      setSeleccion({ desde: f, hasta: null });
      return;
    }
    let desde = seleccion.desde;
    let hasta = f;
    if (hasta < desde) [desde, hasta] = [hasta, desde];
    if (diasEntre(desde, hasta) + 1 > MAX_DIAS_RANGO) {
      hasta = sumarDias(desde, MAX_DIAS_RANGO - 1);
      setRecortado(true);
    }
    setSeleccion({ desde, hasta });
  };

  const hastaEfectivo = seleccion.hasta ?? seleccion.desde;
  const elegido: Rango = { desde: seleccion.desde, hasta: sumarDias(hastaEfectivo, 1) };
  const seleccionado: DateRange = {
    from: civilALocal(seleccion.desde),
    to: seleccion.hasta ? civilALocal(seleccion.hasta) : undefined,
  };
  const dias = diasEntre(elegido.desde, elegido.hasta);

  return (
    <div>
      <div className="kp-calendario">
        <DayPicker
          mode="range"
          selected={seleccionado}
          onSelect={(_, dia) => alTocar(dia)}
          locale={LOCALES_CALENDARIO[idioma as keyof typeof LOCALES_CALENDARIO] ?? es}
          defaultMonth={civilALocal(hastaEfectivo)}
          endMonth={civilALocal(hoy)}
          disabled={{ after: civilALocal(hoy) }}
          showOutsideDays={false}
          fixedWeeks
        />
      </div>
      <div className="mt-3 min-h-[2.75rem] text-center" aria-live="polite">
        {seleccion.hasta === null ? (
          <p className="text-sm uv-text-muted">{t('analytics_range_hint')}</p>
        ) : (
          <>
            <p className="text-sm font-bold uv-text-primary">{nombreDeRango(elegido, idioma)}</p>
            <p className="text-xs uv-text-muted mt-0.5">
              {t('analytics_range_days').replace('{n}', String(dias))}
              {recortado && ` · ${t('analytics_range_max').replace('{n}', String(MAX_DIAS_RANGO))}`}
            </p>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => onElegir(elegido)}
        disabled={seleccion.hasta === null}
        className="mt-3 w-full h-12 rounded-xl bg-[var(--color-primary)] text-white font-bold hover:bg-[var(--color-primary-hover)] active:scale-[0.99] transition uv-focus-ring disabled:opacity-40 disabled:pointer-events-none"
      >
        {t('analytics_range_apply')}
      </button>
    </div>
  );
};
