/**
 * Logica pura detras de CampoMonto (src/components/CampoMonto.tsx).
 *
 * Separada del componente para poder probarla sin montar React: recibe texto
 * crudo (lo que el navegador ya escribio en el input, comas y todo) mas la
 * posicion del cursor, y devuelve el numero limpio (sin separadores, listo
 * para parseFloat/Number) junto con donde debe quedar el cursor.
 */

/** Agrupa digitos de miles con coma: "1234567" -> "1,234,567". */
export function groupThousands(intDigits: string): string {
  if (intDigits.length <= 3) return intDigits;
  const parts: string[] = [];
  let s = intDigits;
  while (s.length > 3) {
    parts.unshift(s.slice(-3));
    s = s.slice(0, -3);
  }
  parts.unshift(s);
  return parts.join(',');
}

export interface SanitizeResult {
  /** Numero limpio: solo digitos y a lo sumo un punto decimal, sin signo. */
  clean: string;
  /** Posicion del cursor dentro de `clean` (no de la version formateada). */
  cursor: number;
}

/**
 * Limpia texto crudo de un input de monto: descarta todo lo que no sea
 * digito o punto decimal (asi tolera pegar "₡252,200.50" o texto suelto),
 * permite un unico punto, recorta decimales sobrantes segun `decimals`, y
 * quita ceros a la izquierda (pero conserva "0.5"). Nunca deja signos
 * negativos: no hay rama que los preserve.
 *
 * `cursor` es la posicion del cursor en `raw` (ya con la edicion aplicada,
 * como lo entrega el input tras el evento). Se devuelve la posicion
 * equivalente dentro de `clean`, para poder ubicarla luego en el texto
 * formateado con mapCursorToDisplay.
 */
export function sanitizeAmountInput(raw: string, cursor: number, decimals: number): SanitizeResult {
  let out = '';
  let cleanCursor = 0;
  let seenDot = false;
  let decCount = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    let keep = false;

    if (ch >= '0' && ch <= '9') {
      if (!seenDot) {
        keep = true;
      } else if (decCount < decimals) {
        keep = true;
        decCount++;
      }
    } else if (ch === '.' && !seenDot) {
      // Marcar seenDot SIEMPRE que aparece el primer punto, incluso con
      // decimals=0: si no, los digitos que vienen despues se cuelan como
      // parte entera (multiplicando el monto por 10^n) en vez de
      // descartarse. Solo se conserva el caracter '.' en la salida cuando
      // el campo admite decimales.
      seenDot = true;
      if (decimals > 0) keep = true;
    }

    if (keep) out += ch;
    if (i < cursor && keep) cleanCursor++;
  }

  // Ceros a la izquierda: "007" -> "7", pero "0.5" se respeta (el cero antes
  // del punto es significativo).
  let stripped = 0;
  while (out.length > stripped + 1 && out[stripped] === '0' && out[stripped + 1] !== '.') {
    stripped++;
  }
  const clean = out.slice(stripped);
  const shift = Math.min(stripped, cleanCursor);

  return { clean, cursor: cleanCursor - shift };
}

/** Formatea el numero limpio para mostrarlo: agrupa miles si `thousands`. */
export function formatAmountDisplay(clean: string, thousands: boolean): string {
  if (!thousands || clean === '') return clean;
  const dotIndex = clean.indexOf('.');
  const intPart = dotIndex === -1 ? clean : clean.slice(0, dotIndex);
  const decPart = dotIndex === -1 ? null : clean.slice(dotIndex + 1);
  const groupedInt = groupThousands(intPart);
  return decPart === null ? groupedInt : `${groupedInt}.${decPart}`;
}

/**
 * Traduce una posicion de cursor en el numero limpio (sin comas) a la
 * posicion equivalente en el texto ya formateado con miles.
 */
export function mapCursorToDisplay(clean: string, cursor: number, thousands: boolean): number {
  if (!thousands) return cursor;

  const dotIndex = clean.indexOf('.');
  const intPart = dotIndex === -1 ? clean : clean.slice(0, dotIndex);
  const groupedInt = groupThousands(intPart);

  if (cursor <= intPart.length) {
    if (cursor <= 0) return 0;
    let seen = 0;
    for (let i = 0; i < groupedInt.length; i++) {
      if (groupedInt[i] !== ',') {
        seen++;
        if (seen === cursor) return i + 1;
      }
    }
    return groupedInt.length;
  }

  // Cursor dentro de la parte decimal (o justo en el punto): los decimales
  // no se agrupan, asi que el corrimiento es 1:1 respecto al fin del entero
  // agrupado.
  return groupedInt.length + (cursor - intPart.length);
}
