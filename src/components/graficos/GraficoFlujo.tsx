import React, { useId, useState } from 'react';
import { COLOR } from './tokens';
import { escalaDivergente } from './escala';
import { LecturaGrafico } from './LecturaGrafico';
import { useAnchoContenedor } from './useAnchoContenedor';

/**
 * Barras divergentes de flujo de dinero: los ingresos crecen hacia arriba y los
 * gastos hacia abajo desde una misma linea base. La posicion separa las dos
 * series ademas del color, asi que se leen igual con daltonismo.
 *
 * SVG propio, dibujado en pixeles reales del contenedor. La lectura de cada
 * tramo aparece con el cursor, con un toque o con las flechas del teclado, y
 * todos los valores estan ademas en una tabla para lectores de pantalla.
 *
 * Reutilizable: recibe tramos ya agrupados (por dia, semana o mes) y los
 * formateadores de la pantalla que lo usa.
 */
export interface TramoFlujo {
  clave: string;
  /** Rotulo corto del eje ("12", "8 sep", "sep"). */
  etiqueta: string;
  /** Rotulo completo para la lectura ("Semana del 8 sep"). */
  etiquetaLarga: string;
  ingresos: number;
  gastos: number;
}

interface GraficoFlujoProps {
  tramos: TramoFlujo[];
  formatoEje: (n: number) => string;
  formatoMonto: (n: number) => string;
  rotulos: { ingresos: string; gastos: string; neto: string; tabla: string; ayuda: string };
  alto?: number;
}

const EJE_Y = 52;
const MARGEN_ARRIBA = 8;
const EJE_X = 24;
const MARGEN_DERECHO = 4;
const RADIO = 4;
/** Un monto que existe nunca se dibuja mas bajo que esto. */
const MINIMO_VISIBLE = 2;
/** Media separacion entre la barra de ingreso y la de gasto sobre el cero. */
const MEDIA_HOLGURA = 1;

/** Barra con el extremo redondeado y la base recta sobre el cero. */
function trazoBarra(x: number, base: number, fin: number, ancho: number): string {
  const alto = Math.abs(fin - base);
  if (alto <= 0) return '';
  const r = Math.min(RADIO, alto, ancho / 2);
  const s = fin < base ? 1 : -1; // hacia arriba: el redondeo baja desde el extremo
  return [
    `M${x},${base}`,
    `V${fin + s * r}`,
    `Q${x},${fin} ${x + r},${fin}`,
    `H${x + ancho - r}`,
    `Q${x + ancho},${fin} ${x + ancho},${fin + s * r}`,
    `V${base}`,
    'Z',
  ].join(' ');
}

export const GraficoFlujo: React.FC<GraficoFlujoProps> = ({
  tramos,
  formatoEje,
  formatoMonto,
  rotulos,
  alto = 220,
}) => {
  const { ref, ancho } = useAnchoContenedor<HTMLDivElement>();
  const [activo, setActivo] = useState<number | null>(null);
  const idAyuda = useId();

  const altoPlot = alto - MARGEN_ARRIBA - EJE_X;
  const anchoPlot = Math.max(0, ancho - EJE_Y - MARGEN_DERECHO);
  const escala = escalaDivergente(
    Math.max(0, ...tramos.map((t) => t.ingresos)),
    Math.max(0, ...tramos.map((t) => t.gastos)),
  );
  const total = escala.arriba + escala.abajo || 1;
  const y = (v: number) => MARGEN_ARRIBA + ((escala.arriba - v) / total) * altoPlot;
  const cero = y(0);
  const banda = tramos.length > 0 ? anchoPlot / tramos.length : 0;
  const anchoBarra = Math.max(2, Math.min(24, banda * (tramos.length > 16 ? 0.68 : 0.56)));

  // Rotulos del eje X: solo los que caben sin pisarse. El ultimo siempre va, y
  // el regular que le quedaria pegado se omite.
  const largoEtiqueta = Math.max(1, ...tramos.map((t) => t.etiqueta.length));
  const cada = Math.max(1, Math.ceil((largoEtiqueta * 6.6 + 10) / Math.max(banda, 1)));
  const ultimo = tramos.length - 1;
  const conEtiqueta = (i: number) => i === ultimo || (i % cada === 0 && ultimo - i >= cada);

  const indiceEn = (clientX: number, caja: DOMRect) => {
    const i = Math.floor((clientX - caja.left - EJE_Y) / Math.max(banda, 1));
    return i >= 0 && i < tramos.length ? i : null;
  };

  const alMover = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'mouse') return;
    setActivo(indiceEn(e.clientX, e.currentTarget.getBoundingClientRect()));
  };
  const alTocar = (e: React.PointerEvent<SVGSVGElement>) => {
    const i = indiceEn(e.clientX, e.currentTarget.getBoundingClientRect());
    setActivo((previo) => (e.pointerType !== 'mouse' && previo === i ? null : i));
  };
  const alTeclear = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (tramos.length === 0) return;
    let siguiente: number | null | undefined;
    if (e.key === 'ArrowRight') siguiente = activo === null ? 0 : Math.min(ultimo, activo + 1);
    else if (e.key === 'ArrowLeft') siguiente = activo === null ? ultimo : Math.max(0, activo - 1);
    else if (e.key === 'Home') siguiente = 0;
    else if (e.key === 'End') siguiente = ultimo;
    else if (e.key === 'Escape') siguiente = null;
    if (siguiente === undefined) return;
    e.preventDefault();
    setActivo(siguiente);
  };

  const tramoActivo = activo !== null ? tramos[activo] : null;
  const centroActivo = activo !== null ? EJE_Y + (activo + 0.5) * banda : 0;
  // La lectura se centra en el tramo sin salirse del grafico (mide ~11rem).
  const izquierdaLectura = Math.min(Math.max(centroActivo, 92), Math.max(92, ancho - 92));
  const netoActivo = tramoActivo ? tramoActivo.ingresos - tramoActivo.gastos : 0;
  // Cambiar los datos vuelve a correr la animacion de crecimiento.
  const firma = tramos.map((t) => `${t.clave}:${t.ingresos}:${t.gastos}`).join('|');

  return (
    <div
      ref={ref}
      className="relative w-full rounded-xl uv-focus-ring outline-none"
      style={{ minHeight: alto }}
      tabIndex={tramos.length > 0 ? 0 : -1}
      role="group"
      aria-label={rotulos.tabla}
      aria-describedby={idAyuda}
      onKeyDown={alTeclear}
      onBlur={() => setActivo(null)}
    >
      <span id={idAyuda} className="sr-only">
        {rotulos.ayuda}
      </span>
      {ancho > 0 && (
        <svg
          width={ancho}
          height={alto}
          aria-hidden="true"
          className="block touch-pan-y select-none"
          onPointerMove={alMover}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActivo(null)}
          onPointerDown={alTocar}
        >
          {escala.marcas.map((m) => (
            <g key={m}>
              <line
                x1={EJE_Y}
                x2={EJE_Y + anchoPlot}
                y1={y(m)}
                y2={y(m)}
                stroke={m === 0 ? COLOR.eje : COLOR.rejilla}
                strokeOpacity={m === 0 ? 0.45 : 1}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text x={EJE_Y - 8} y={y(m)} textAnchor="end" dominantBaseline="middle" fill={COLOR.eje} fontSize={11}>
                {formatoEje(Math.abs(m))}
              </text>
            </g>
          ))}

          {activo !== null && (
            <rect x={EJE_Y + activo * banda} y={MARGEN_ARRIBA} width={banda} height={altoPlot} rx={4} fill={COLOR.cursor} />
          )}

          <g key={firma} className="kp-crecer-barras" style={{ transformOrigin: `0px ${cero}px` }}>
            {tramos.map((t, i) => {
              const x = EJE_Y + i * banda + (banda - anchoBarra) / 2;
              const finIngreso = t.ingresos > 0 ? Math.min(y(t.ingresos), cero - MEDIA_HOLGURA - MINIMO_VISIBLE) : null;
              const finGasto = t.gastos > 0 ? Math.max(y(-t.gastos), cero + MEDIA_HOLGURA + MINIMO_VISIBLE) : null;
              const atenuado = activo !== null && activo !== i;
              return (
                <g key={t.clave} opacity={atenuado ? 0.45 : 1} style={{ transition: 'opacity 150ms ease-out' }}>
                  {finIngreso !== null && (
                    <path d={trazoBarra(x, cero - MEDIA_HOLGURA, finIngreso, anchoBarra)} fill={COLOR.ingreso} />
                  )}
                  {finGasto !== null && <path d={trazoBarra(x, cero + MEDIA_HOLGURA, finGasto, anchoBarra)} fill={COLOR.gasto} />}
                </g>
              );
            })}
          </g>

          {tramos.map((t, i) =>
            conEtiqueta(i) ? (
              <text
                key={t.clave}
                x={EJE_Y + (i + 0.5) * banda}
                y={MARGEN_ARRIBA + altoPlot + 16}
                textAnchor="middle"
                fill={activo === i ? 'var(--grafico-texto)' : COLOR.eje}
                fontSize={11}
                fontWeight={activo === i ? 600 : 400}
              >
                {t.etiqueta}
              </text>
            ) : null,
          )}
        </svg>
      )}

      {tramoActivo && (
        <div
          className="absolute top-0 z-10 -translate-x-1/2 pointer-events-none"
          style={{ left: izquierdaLectura }}
          aria-live="polite"
        >
          <LecturaGrafico
            titulo={tramoActivo.etiquetaLarga}
            filas={[
              { etiqueta: rotulos.ingresos, valor: formatoMonto(tramoActivo.ingresos), color: COLOR.ingreso },
              { etiqueta: rotulos.gastos, valor: formatoMonto(tramoActivo.gastos), color: COLOR.gasto },
              {
                etiqueta: rotulos.neto,
                valor: `${netoActivo >= 0 ? '+' : '-'}${formatoMonto(Math.abs(netoActivo))}`,
                fuerte: true,
              },
            ]}
          />
        </div>
      )}

      {/* Gemelo accesible: cada valor del grafico, legible sin tocarlo. */}
      <table className="sr-only">
        <caption>{rotulos.tabla}</caption>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">{rotulos.ingresos}</th>
            <th scope="col">{rotulos.gastos}</th>
          </tr>
        </thead>
        <tbody>
          {tramos.map((t) => (
            <tr key={t.clave}>
              <th scope="row">{t.etiquetaLarga}</th>
              <td>{formatoMonto(t.ingresos)}</td>
              <td>{formatoMonto(t.gastos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
