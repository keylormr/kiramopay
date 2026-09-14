import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { sanitizeAmountInput, formatAmountDisplay, mapCursorToDisplay } from '@/utils/campoMonto';

export interface CampoMontoProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Numero limpio (sin comas ni simbolos) que la pantalla guarda y manda a la API. */
  value: string;
  /** Recibe el numero limpio en cada cambio — listo para parseFloat/Number, tal como antes. */
  onChange: (value: string) => void;
  /** Maximo de decimales. Colones/dolares: 2 (default). Cantidades cripto: hasta 8. */
  decimals?: number;
  /** Agrupar la parte entera con comas de miles. Desactivar para cantidades de un activo cripto. */
  thousands?: boolean;
  /**
   * Ancho en `ch` derivado del texto ya formateado (comas incluidas) en vez
   * de una clase de ancho fijo (w-48, etc). Usar en las pantallas de "monto
   * grande centrado" (SINPE, cripto): un ancho fijo en px/rem no preve el
   * ancho que agrega el separador de miles y el texto termina recortado
   * para montos grandes. No usar en un input de formulario normal (ahi el
   * ancho lo da el layout, con w-full).
   */
  autoWidth?: boolean;
}

/**
 * Input de monto compartido por toda la app: sin flechas de spinner (es
 * type="text", no type="number"), separador de miles mientras se escribe,
 * tope de decimales, sin negativos, cursor estable y pegado tolerante
 * (limpia simbolos de moneda y comas de lo que se pegue).
 *
 * Sigue siendo un input controlado normal: `value`/`onChange` reciben y
 * entregan el numero limpio, igual que el `e.target.value` que reemplaza —
 * los handlers de las pantallas no cambian su forma de leer el monto.
 */
export function CampoMonto({
  value,
  onChange,
  decimals = 2,
  thousands = true,
  inputMode = 'decimal',
  autoWidth = false,
  placeholder,
  style,
  ...rest
}: CampoMontoProps) {
  const display = formatAmountDisplay(value, thousands);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const rawCursor = e.target.selectionStart ?? raw.length;
    const { clean, cursor } = sanitizeAmountInput(raw, rawCursor, decimals);
    const nextDisplay = formatAmountDisplay(clean, thousands);
    const nextCursor = mapCursorToDisplay(clean, cursor, thousands);

    // El navegador ya escribio la edicion cruda en el DOM (comas, un
    // simbolo pegado, un decimal de mas). Se corrige aca mismo: si el valor
    // limpio no cambio (el usuario tecleo algo que se rechaza entero), React
    // no vuelve a renderizar y nadie mas dejaria el texto bien.
    e.target.value = nextDisplay;
    e.target.setSelectionRange(nextCursor, nextCursor);

    if (clean !== value) onChange(clean);
  };

  // El ancho crece caracter a caracter con el texto YA formateado (comas de
  // miles incluidas), asi el separador nunca deja el valor mas ancho que la
  // caja. +1ch de holgura para el caret al final mientras se escribe.
  const chars = Math.max(display.length, String(placeholder ?? '').length, 1);
  const autoWidthStyle = autoWidth ? { width: `${chars + 1}ch` } : undefined;

  return (
    <input
      type="text"
      inputMode={inputMode}
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      style={{ ...autoWidthStyle, ...style }}
      {...rest}
    />
  );
}
