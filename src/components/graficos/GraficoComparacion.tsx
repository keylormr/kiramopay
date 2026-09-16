import React from 'react';
import { COLOR } from './tokens';

/**
 * Un valor de este periodo contra el mismo valor del periodo anterior: dos
 * barras horizontales rotuladas, la actual en el color de la serie y la
 * anterior en gris, con el monto escrito al final de cada una.
 *
 * El dominio lo fija quien lo usa (`maximo`), para que dos comparaciones
 * puestas una debajo de otra compartan escala y los largos se puedan comparar
 * entre si. Es HTML y no SVG: todo el contenido es texto legible.
 */
interface GraficoComparacionProps {
  actual: number;
  anterior: number;
  maximo: number;
  color: string;
  rotulos: { actual: string; anterior: string };
  formato: (n: number) => string;
}

/** Lo que se reserva a la derecha de la barra para escribir el monto. */
const ESPACIO_MONTO = '4.75rem';

export const GraficoComparacion: React.FC<GraficoComparacionProps> = ({
  actual,
  anterior,
  maximo,
  color,
  rotulos,
  formato,
}) => {
  const filas = [
    { clave: 'actual', rotulo: rotulos.actual, valor: actual, fondo: color },
    { clave: 'anterior', rotulo: rotulos.anterior, valor: anterior, fondo: COLOR.anterior },
  ];
  const tope = Math.max(maximo, 0.01);
  return (
    <dl className="space-y-1.5">
      {filas.map((f) => {
        const fraccion = Math.min(1, Math.max(0, f.valor / tope));
        return (
          <div key={f.clave} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3">
            <dt className="text-xs uv-text-muted text-right truncate">{f.rotulo}</dt>
            <dd className="flex items-center gap-2 min-w-0">
              <span
                aria-hidden="true"
                className="h-4 shrink-0 rounded-r-[4px] transition-[width] duration-500 ease-out"
                style={{
                  width: f.valor > 0 ? `max(2px, calc((100% - ${ESPACIO_MONTO}) * ${fraccion}))` : 0,
                  backgroundColor: f.fondo,
                }}
              />
              <span className="text-xs font-semibold tabular-nums uv-text-primary whitespace-nowrap">{formato(f.valor)}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
};
