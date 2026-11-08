/** Una celda leida: los numeros de Excel llegan como numero, el resto como texto. */
export type Celda = string | number;
export type Tabla = Celda[][];

export const LIMITE_BYTES = 5 * 1024 * 1024;
export const LIMITE_FILAS = 20000;

export type CodigoError =
  | 'PDF'
  | 'XLS_VIEJO'
  | 'GRANDE'
  | 'MUCHAS_FILAS'
  | 'SIN_COBROS'
  | 'ILEGIBLE';

/** Error del lector con un codigo propio: la pantalla dice que hacer segun el. */
export class ErrorDeLectura extends Error {
  readonly codigo: CodigoError;
  constructor(codigo: CodigoError) {
    super(codigo);
    this.name = 'ErrorDeLectura';
    this.codigo = codigo;
  }
}

export interface MapaDeColumnas {
  fecha: number | null;
  descripcion: number | null;
  credito: number | null;
  debito: number | null;
  monto: number | null;
  moneda: number | null;
}

export interface Deteccion {
  /** Indice de la fila de encabezados dentro de la tabla. */
  filaEncabezado: number;
  columnas: MapaDeColumnas;
  confiable: boolean;
}

export interface Ingreso {
  id: string;
  /** AAAA-MM-DD */
  fecha: string;
  /** AAAA-MM */
  mes: string;
  descripcion: string;
  /** Centimos enteros: el dinero nunca se suma en flotantes. */
  centimos: number;
  moneda: string;
  esSinpe: boolean;
}

export interface ResultadoDeIngresos {
  ingresos: Ingreso[];
  /** Filas con ingreso cuya fecha o monto no se pudo leer. */
  omitidas: number;
}
