export type MarcaSvg = { tipo: "svg"; url: string };

export type MarcaTexto = {
  tipo: "texto";
  texto: string;
  /** Fuente de canvas con {px} donde va el tamano, por ejemplo '700 {px}px var(--mi-fuente)'. */
  fuente: string;
  color: string;
  /** Espaciado entre letras en em. */
  espaciado?: number;
  /** Color de una barra bajo el texto, si la marca la tiene. */
  barra?: string;
};

export type DestinoErgane = {
  nombre: string;
  area?: string;
  dominio?: string | null;
  marca: MarcaSvg | MarcaTexto;
  /** Fondo, tinta y tinta suave del sitio, en #RRGGBB. */
  fondo: string;
  tinta: string;
  tintaSuave: string;
  /** Familia CSS para el nombre y la linea de abajo (acepta var(--...)). */
  fuente?: string;
};

export type OpcionesIntroErgane = {
  destino: DestinoErgane;
  /** URL del SVG de la Trama (el logo aprobado de Ergane). */
  marcaErgane: string;
  /** Clave en localStorage para recordar que ya se vio. */
  clave?: string;
  /** Mostrarla aunque ya se haya visto. */
  siempre?: boolean;
  /** Mostrarla aunque el equipo pida menos movimiento. */
  forzar?: boolean;
  /** Congela la intro en ese segundo (para capturas). */
  tiempoFijo?: number | null;
  velocidad?: number;
  /** Milisegundos maximos para cargar three y las marcas antes de rendirse. */
  esperaMaxima?: number;
  zIndex?: number;
};

export function mostrarIntroErgane(opciones: OpcionesIntroErgane): Promise<"mostrada" | "omitida">;
