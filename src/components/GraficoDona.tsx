import React, { useId } from 'react';

// Grafico de dona: los segmentos SUMAN el total que se lee en el centro —
// esa es la promesa visual (pedido del dueno: "ingresos y gastos deben dar el
// total"). Dibujado con arcos SVG sobre un anillo, con animacion de barrido
// por stroke-dashoffset y un hueco de 2 grados entre segmentos para que cada
// parte se distinga sin leyenda.

export interface SegmentoDona {
  valor: number;
  color: string;
  etiqueta: string;
}

interface GraficoDonaProps {
  segmentos: SegmentoDona[];
  /** Diametro en px. */
  tamano?: number;
  /** Grosor del anillo. */
  grosor?: number;
  /** Contenido del centro (el total y su etiqueta). */
  children?: React.ReactNode;
  className?: string;
}

export const GraficoDona: React.FC<GraficoDonaProps> = ({
  segmentos,
  tamano = 156,
  grosor = 16,
  children,
  className = '',
}) => {
  const uid = useId();
  const radio = (tamano - grosor) / 2;
  const centro = tamano / 2;
  const circunferencia = 2 * Math.PI * radio;
  const total = segmentos.reduce((s, x) => s + Math.max(0, x.valor), 0);
  const visibles = segmentos.filter((s) => s.valor > 0);
  // Hueco entre segmentos solo cuando hay mas de uno.
  const huecoFrac = visibles.length > 1 ? 2 / 360 : 0;

  // Reduce inmutable: cada arco arranca donde el anterior termino.
  const arcos = visibles.reduce<{ lista: Array<SegmentoDona & { largo: number; offset: number; key: string }>; acumulado: number }>(
    (acc, s, i) => {
      const frac = total > 0 ? s.valor / total : 0;
      const largo = Math.max(0, (frac - huecoFrac) * circunferencia);
      const offset = -(acc.acumulado + (huecoFrac / 2) * circunferencia);
      return {
        lista: [...acc.lista, { ...s, largo, offset, key: `${uid}-${i}` }],
        acumulado: acc.acumulado + frac * circunferencia,
      };
    },
    { lista: [], acumulado: 0 },
  ).lista;

  const descripcion = visibles.map((s) => `${s.etiqueta}: ${s.valor}`).join(', ');

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: tamano, height: tamano }}
      role="img"
      aria-label={descripcion}
    >
      <svg width={tamano} height={tamano} className="-rotate-90" aria-hidden="true">
        {/* Riel de fondo */}
        <circle
          cx={centro}
          cy={centro}
          r={radio}
          fill="none"
          stroke="var(--color-surface-muted)"
          strokeWidth={grosor}
          opacity={0.5}
        />
        {arcos.map((a) => (
          <circle
            key={a.key}
            cx={centro}
            cy={centro}
            r={radio}
            fill="none"
            stroke={a.color}
            strokeWidth={grosor}
            strokeLinecap="round"
            strokeDasharray={`${a.largo} ${circunferencia - a.largo}`}
            strokeDashoffset={a.offset}
            style={{ transition: 'stroke-dasharray 600ms ease-out, stroke-dashoffset 600ms ease-out' }}
          />
        ))}
      </svg>
      {/* Centro: el total que los segmentos componen */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
        {children}
      </div>
    </div>
  );
};
