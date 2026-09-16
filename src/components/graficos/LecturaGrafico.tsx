import React from 'react';

/**
 * La burbuja de lectura de todos los graficos: el valor manda, la serie se
 * nombra al lado con un trazo corto de su color (no una caja: a esta densidad
 * una caja pesa como un dato).
 */
export interface FilaLectura {
  etiqueta: string;
  valor: string;
  color?: string;
  fuerte?: boolean;
}

export const LecturaGrafico: React.FC<{ titulo: string; filas: FilaLectura[] }> = ({ titulo, filas }) => (
  <div className="min-w-[10rem] rounded-xl uv-surface-1 px-3 py-2 shadow-[var(--shadow-elevated)] text-xs pointer-events-none">
    <p className="font-semibold uv-text-secondary mb-1.5">{titulo}</p>
    <div className="space-y-1">
      {filas.map((f) => (
        <div key={f.etiqueta} className="flex items-center gap-2">
          {f.color ? (
            <span aria-hidden="true" className="h-0.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
          ) : (
            <span aria-hidden="true" className="w-2.5 shrink-0" />
          )}
          <span className="uv-text-muted flex-1">{f.etiqueta}</span>
          <span className={`tabular-nums uv-text-primary ${f.fuerte ? 'font-bold' : 'font-semibold'}`}>{f.valor}</span>
        </div>
      ))}
    </div>
  </div>
);
