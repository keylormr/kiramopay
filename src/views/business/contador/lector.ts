import { detectarColumnas } from './columnas';
import { detectarFormato, leerHtml, leerTexto, leerXlsx } from './formatos';
import { extraerIngresos } from './ingresos';
import {
  ErrorDeLectura,
  LIMITE_BYTES,
  type Deteccion,
  type MapaDeColumnas,
  type ResultadoDeIngresos,
  type Tabla,
} from './tipos';

export interface Archivo {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface Lectura {
  tabla: Tabla;
  deteccion: Deteccion;
}

/** Lee el archivo en memoria. Nada sale del telefono ni se guarda. */
export async function leerEstadoDeCuenta(archivo: Archivo): Promise<Lectura> {
  if (archivo.size > LIMITE_BYTES) throw new ErrorDeLectura('GRANDE');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await archivo.arrayBuffer());
  } catch {
    throw new ErrorDeLectura('ILEGIBLE');
  }
  if (bytes.length > LIMITE_BYTES) throw new ErrorDeLectura('GRANDE');
  try {
    const { formato, texto } = detectarFormato(bytes);
    const tabla =
      formato === 'xlsx' ? await leerXlsx(bytes) : formato === 'html' ? leerHtml(texto ?? '') : leerTexto(texto ?? '');
    if (tabla.length === 0) throw new ErrorDeLectura('ILEGIBLE');
    return { tabla, deteccion: detectarColumnas(tabla) };
  } catch (e) {
    if (e instanceof ErrorDeLectura) throw e;
    throw new ErrorDeLectura('ILEGIBLE');
  }
}

/** Con las columnas ya confirmadas: los ingresos, o SIN_COBROS si no hay ninguno. */
export function leerIngresos(lectura: Lectura, columnas: MapaDeColumnas): ResultadoDeIngresos {
  const r = extraerIngresos(lectura.tabla, columnas, lectura.deteccion.filaEncabezado);
  if (r.ingresos.length === 0) throw new ErrorDeLectura('SIN_COBROS');
  return r;
}
