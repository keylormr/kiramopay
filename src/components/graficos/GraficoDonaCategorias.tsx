import React, { useState } from 'react';
import { colorDeCategoria } from './tokens';

/**
 * Dona de parte-del-todo: las porciones SUMAN la cifra del centro. Solo tiene
 * sentido cuando las partes son de la misma naturaleza (gastos por categoria);
 * nunca para sumar ingresos con gastos, que no son partes de nada.
 *
 * La dona es la lectura de un vistazo; el detalle exacto va en la lista que la
 * acompana, que ademas es la codificacion secundaria del color. Al pasar el
 * cursor o tocar una porcion, el centro dice cual es y cuanto pesa.
 */
export interface PorcionDona {
  categoria: string;
  nombre: string;
  monto: number;
  porcentaje: number;
}

interface GraficoDonaCategoriasProps {
  porciones: PorcionDona[];
  formatoMonto: (n: number) => string;
  tamano?: number;
  grosor?: number;
  /** Lo que se lee en el centro: rotulo y total. */
  children?: React.ReactNode;
  etiquetaAccesible: string;
}

/** Separacion entre porciones, en pixeles sobre el radio medio. */
const HUECO = 2;

const punto = (c: number, r: number, angulo: number) => [c + r * Math.sin(angulo), c - r * Math.cos(angulo)] as const;

/** Sector de anillo entre dos angulos (0 arriba, sentido horario). */
function sector(c: number, exterior: number, interior: number, desde: number, hasta: number): string {
  const grande = hasta - desde > Math.PI ? 1 : 0;
  const [x0, y0] = punto(c, exterior, desde);
  const [x1, y1] = punto(c, exterior, hasta);
  const [x2, y2] = punto(c, interior, hasta);
  const [x3, y3] = punto(c, interior, desde);
  return `M${x0},${y0} A${exterior},${exterior} 0 ${grande} 1 ${x1},${y1} L${x2},${y2} A${interior},${interior} 0 ${grande} 0 ${x3},${y3} Z`;
}

/** Anillo completo: una sola porcion no tiene angulos que la corten. */
function anillo(c: number, exterior: number, interior: number): string {
  return [
    `M${c - exterior},${c} a${exterior},${exterior} 0 1 0 ${exterior * 2},0 a${exterior},${exterior} 0 1 0 ${-exterior * 2},0`,
    `M${c - interior},${c} a${interior},${interior} 0 1 1 ${interior * 2},0 a${interior},${interior} 0 1 1 ${-interior * 2},0`,
  ].join(' ');
}

export const GraficoDonaCategorias: React.FC<GraficoDonaCategoriasProps> = ({
  porciones,
  formatoMonto,
  tamano = 184,
  grosor = 20,
  children,
  etiquetaAccesible,
}) => {
  const [activa, setActiva] = useState<string | null>(null);
  const c = tamano / 2;
  const exterior = c - 2;
  const interior = exterior - grosor;
  const total = porciones.reduce((s, p) => s + Math.max(0, p.monto), 0);
  const visibles = porciones.filter((p) => p.monto > 0);
  const media = (exterior + interior) / 2;
  const holgura = visibles.length > 1 ? HUECO / media / 2 : 0;

  // Donde empieza y termina cada porcion, como suma acumulada.
  const limites = visibles.reduce<number[]>((acc, p) => [...acc, acc[acc.length - 1] + p.monto], [0]);
  const trazos = visibles.map((p, i) => {
    const desde = (limites[i] / total) * Math.PI * 2;
    const hasta = (limites[i + 1] / total) * Math.PI * 2;
    // Una porcion minuscula igual se ve: nunca menos de un grado.
    const inicio = desde + holgura;
    const fin = Math.max(hasta - holgura, inicio + Math.PI / 180);
    return { p, d: visibles.length === 1 ? anillo(c, exterior, interior) : sector(c, exterior, interior, inicio, fin) };
  });

  const seleccion = visibles.find((p) => p.categoria === activa) ?? null;

  return (
    <div className="relative shrink-0" style={{ width: tamano, height: tamano }} role="img" aria-label={etiquetaAccesible}>
      <svg
        width={tamano}
        height={tamano}
        aria-hidden="true"
        className="block kp-aparecer"
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActiva(null)}
      >
        {trazos.map(({ p, d }) => (
          <path
            key={p.categoria}
            d={d}
            fillRule="evenodd"
            fill={colorDeCategoria(p.categoria)}
            opacity={activa && activa !== p.categoria ? 0.35 : 1}
            style={{ transition: 'opacity 150ms ease-out' }}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setActiva(p.categoria)}
            onPointerDown={(e) => {
              if (e.pointerType === 'mouse') return;
              setActiva((previa) => (previa === p.categoria ? null : p.categoria));
            }}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-8">
        {seleccion ? (
          <>
            <p className="text-xs uv-text-muted truncate max-w-full">{seleccion.nombre}</p>
            <p className="text-base font-extrabold uv-text-primary leading-tight">{formatoMonto(seleccion.monto)}</p>
            <p className="text-xs uv-text-muted tabular-nums">{seleccion.porcentaje.toFixed(1)}%</p>
          </>
        ) : (
          children
        )}
      </div>
    </div>
  );
};
