import React, { useId, useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';

// Grafico de area moderno y reutilizable: curva suavizada (Catmull-Rom a
// Bezier), relleno con degradado que se desvanece, punto final enfatizado y
// lectura por arrastre (dedo o mouse) con guia vertical y burbuja de valor.
// Dibuja en pixeles reales del contenedor (nada de preserveAspectRatio
// estirado que deforma el trazo). Es la voz visual unica de las series de
// la app: home, analitica y cripto la comparten.

interface GraficoAreaProps {
  /** Serie de valores en orden temporal. Con menos de 2 puntos no se dibuja. */
  puntos: number[];
  /** Etiqueta por punto (fecha corta) para la burbuja de lectura. */
  etiquetas?: string[];
  /** Color del trazo y el degradado. Default: el primario de la marca. */
  color?: string;
  alto?: number;
  formato?: (v: number) => string;
  className?: string;
  /** Etiqueta accesible de la serie. */
  titulo?: string;
}

// Catmull-Rom -> segmentos cubicos de Bezier: pasa por todos los puntos con
// tangentes continuas. La tension 6 da curvas calmadas, sin sobregiros.
function trazoSuave(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export const GraficoArea: React.FC<GraficoAreaProps> = ({
  puntos,
  etiquetas,
  color = 'var(--color-primary)',
  alto = 96,
  formato = (v) => String(Math.round(v)),
  className = '',
  titulo,
}) => {
  const gradId = useId();
  const contRef = useRef<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(0);
  const [sel, setSel] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = contRef.current;
    if (!el) return;
    const medir = () => setAncho(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const margen = { arriba: 10, abajo: 6, lado: 4 };

  const geometria = useMemo(() => {
    if (puntos.length < 2 || ancho <= 0) return null;
    const min = Math.min(...puntos);
    const max = Math.max(...puntos);
    const rango = max - min || 1;
    const utilAncho = ancho - margen.lado * 2;
    const utilAlto = alto - margen.arriba - margen.abajo;
    const pts = puntos.map((v, i) => ({
      x: margen.lado + (i / (puntos.length - 1)) * utilAncho,
      y: margen.arriba + (1 - (v - min) / rango) * utilAlto,
    }));
    const linea = trazoSuave(pts);
    const area = `${linea} L ${pts[pts.length - 1].x.toFixed(2)} ${alto} L ${pts[0].x.toFixed(2)} ${alto} Z`;
    return { pts, linea, area };
    // margen es constante; ancho/alto/puntos gobiernan el redibujo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puntos, ancho, alto]);

  const elegirIndice = useCallback(
    (clientX: number) => {
      const el = contRef.current;
      if (!el || puntos.length < 2) return;
      const rect = el.getBoundingClientRect();
      const rel = (clientX - rect.left - margen.lado) / Math.max(1, rect.width - margen.lado * 2);
      const idx = Math.round(Math.min(1, Math.max(0, rel)) * (puntos.length - 1));
      setSel(idx);
    },
    // margen es constante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puntos.length],
  );

  if (!geometria) {
    return <div ref={contRef} style={{ height: alto }} className={className} />;
  }

  const { pts, linea, area } = geometria;
  const ultimo = pts[pts.length - 1];
  const activo = sel !== null ? pts[sel] : null;
  // La burbuja no debe salirse por los bordes.
  const burbujaX = activo ? Math.min(Math.max(activo.x, 44), ancho - 44) : 0;

  return (
    <div
      ref={contRef}
      className={`relative select-none ${className}`}
      style={{ height: alto, touchAction: 'pan-y' }}
      role="img"
      aria-label={titulo}
      onPointerDown={(e) => elegirIndice(e.clientX)}
      onPointerMove={(e) => {
        if (e.buttons > 0 || e.pointerType === 'mouse') elegirIndice(e.clientX);
      }}
      onPointerLeave={() => setSel(null)}
      onPointerUp={() => setSel(null)}
    >
      <svg width={ancho} height={alto} className="block overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path
          d={linea}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Guia de lectura */}
        {activo && (
          <line
            x1={activo.x}
            y1={4}
            x2={activo.x}
            y2={alto - 2}
            stroke={color}
            strokeOpacity={0.35}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {/* Punto final siempre visible; el activo lo reemplaza al leer */}
        <circle
          cx={(activo ?? ultimo).x}
          cy={(activo ?? ultimo).y}
          r={4.5}
          fill={color}
          stroke="var(--color-surface-1, #fff)"
          strokeWidth={2}
        />
      </svg>
      {activo && sel !== null && (
        <div
          className="absolute -top-1 -translate-x-1/2 -translate-y-full rounded-lg px-2 py-1 text-[11px] font-bold text-white shadow-md pointer-events-none whitespace-nowrap"
          style={{ left: burbujaX, backgroundColor: color }}
        >
          {formato(puntos[sel])}
          {etiquetas?.[sel] ? <span className="font-medium opacity-80"> · {etiquetas[sel]}</span> : null}
        </div>
      )}
    </div>
  );
};
