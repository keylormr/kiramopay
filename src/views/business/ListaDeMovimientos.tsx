import React, { useId, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TotalDelDia } from '@/api/repositories/qrpayment.repository';
import { conteoConPlural } from '@/utils/conteo';
import {
  agruparPorDia,
  claveDeDia,
  rotuloDeDia,
  type MovimientoDelComercio,
} from '@/utils/movimientosDelComercio';
import { DetalleDeMovimiento } from './DetalleDeMovimiento';
import { dinero, MovimientoFila } from './MovimientoFila';

interface Props {
  movimientos: MovimientoDelComercio[];
  tzOffsetMin: number;
  /**
   * El total de cada dia, por moneda, tal como lo dio el servidor.
   * - Un arreglo: se escribe el de cada dia (no se suma nada aqui).
   * - null: no se pudo traer, y cada dia lo dice.
   * - sin definir: esta lista no muestra totales.
   */
  totales?: TotalDelDia[] | null;
}

/**
 * Los movimientos agrupados por dia, el mas reciente primero, con el total de
 * cada dia por moneda: nunca se suman colones con dolares. El total sale del
 * servidor y no de las filas cargadas, porque la pagina de abajo puede cortar un
 * dia por la mitad y una suma de lo cargado diria menos de lo vendido.
 */
export const ListaDeMovimientos: React.FC<Props> = ({ movimientos, tzOffsetMin, totales }) => {
  const { t, language } = useLanguage();
  const idBase = useId();
  const [abierto, setAbierto] = useState<MovimientoDelComercio | null>(null);

  const grupos = agruparPorDia(movimientos, tzOffsetMin);
  const hoy = claveDeDia(new Date().toISOString(), tzOffsetMin);

  return (
    <>
      <div className="space-y-5">
        {grupos.map((g) => {
          const { relativo, fecha } = rotuloDeDia(g.clave, hoy, language, t as (clave: string) => string);
          const idTitulo = `${idBase}-${g.clave}`;
          const delDia = (totales ?? []).filter((d) => d.date === g.clave);
          return (
            <section key={g.clave} aria-labelledby={idTitulo}>
              <div className="flex items-start justify-between gap-3 px-1 pb-2">
                <h3 id={idTitulo} className="min-w-0 text-sm">
                  {relativo && <span className="font-bold uv-text-primary">{relativo} </span>}
                  <span className={relativo ? 'uv-text-muted' : 'font-bold uv-text-primary'}>{relativo ? fecha : primeraMayuscula(fecha, language)}</span>
                </h3>
                <div className="shrink-0 text-right text-xs uv-text-muted tabular-nums">
                  {totales === null ? (
                    <p>{t('business_move_day_total_unavailable')}</p>
                  ) : (
                    delDia.map((d) => (
                      <p key={d.currency}>
                        {`${dinero(d.gross, d.currency)} · ${conteoConPlural(t as (clave: string) => string, 'business_charges_count', d.count)}`}
                      </p>
                    ))
                  )}
                </div>
              </div>
              <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
                {g.movimientos.map((m) => (
                  <MovimientoFila key={`${m.tipo}-${m.id}`} movimiento={m} tzOffsetMin={tzOffsetMin} onAbrir={setAbierto} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <DetalleDeMovimiento movimiento={abierto} tzOffsetMin={tzOffsetMin} onClose={() => setAbierto(null)} />
    </>
  );
};

function primeraMayuscula(s: string, idioma: string): string {
  return s.charAt(0).toLocaleUpperCase(idioma) + s.slice(1);
}
