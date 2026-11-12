// La K de la marca (icono-final.svg, en su lienzo de 512 unidades) y donde
// queda en la pantalla de carga nativa de cada sistema. La intro arranca con la
// K en ese mismo lugar y del mismo tamano: el paso de una a otra no se nota.

export type Punto = readonly [number, number];
export type Figura = readonly Punto[];

export const FIGURAS = {
  // La cinta entera, con la zona de la punta: es la que dibuja el splash.
  cinta: [[178.5, 256], [322.3, 112.3], [371.7, 161.7], [277.5, 256], [371.7, 350.3], [322.3, 399.7]],
  // La cinta sin la punta: el cuerpo que se separa en las animaciones.
  cuerpo: [[178.5, 256], [261.4, 173.1], [310.9, 222.6], [277.5, 256], [371.7, 350.3], [322.3, 399.7]],
  punta: [[261.4, 173.1], [322.3, 112.3], [371.7, 161.7], [310.9, 222.6]],
  pliegue: [[220, 214.5], [236, 198.5], [236, 313.5], [220, 297.5]],
  asta: [[150, 137], [220, 137], [220, 375], [150, 375]],
  // El contorno de toda la K.
  silueta: [
    [150, 137], [220, 137], [220, 214.5], [322.3, 112.3], [371.7, 161.7], [277.5, 256],
    [371.7, 350.3], [322.3, 399.7], [220, 297.5], [220, 375], [150, 375],
  ],
} as const satisfies Record<string, Figura>;

export type NombreDeFigura = keyof typeof FIGURAS;

/** El centro del asta, desde donde se abre la ventana. */
export const CENTRO_DEL_ASTA: Punto = [185, 256];
/** El centro de la caja de la K: el eje del giro y el punto que iOS centra. */
export const CENTRO_DE_LA_K: Punto = [(150 + 371.7) / 2, (112.3 + 399.7) / 2];

// Android 12+ (drawable/splash_marca.xml): lienzo de 288 dp con el frente a
// escala 0,658 alrededor de (256, 256), centrado en la ventana. Un dp es un px
// de CSS en el WebView.
export const KPX_ANDROID = (288 / 512) * 0.658;
// iOS (LaunchScreen.storyboard): la imagen cuadrada de 2732 con la K de
// round(2732 * 0,115) px de alto centrada por su caja, en scaleAspectFill. El
// cuadrado se ajusta al lado mayor de la pantalla.
const FRACCION_IOS = Math.round(2732 * 0.115) / 2732;
const ALTO_DE_LA_K = 399.7 - 112.3;

export interface Pose {
  ancho: number;
  alto: number;
  /** Pixeles de CSS por unidad del lienzo de 512. */
  kpx: number;
  /** Escala respecto de la caja de Android, que mide 288 px. */
  escala: number;
  /** Donde cae en pantalla la unidad (256, 256) del lienzo. */
  x0: number;
  y0: number;
}

export function poseDeArranque(plataforma: string, ancho: number, alto: number): Pose {
  if (plataforma === 'ios') {
    const kpx = (FRACCION_IOS * Math.max(ancho, alto)) / ALTO_DE_LA_K;
    return {
      ancho,
      alto,
      kpx,
      escala: kpx / KPX_ANDROID,
      // iOS centra la caja de la K, no el centro del lienzo.
      x0: ancho / 2 - (CENTRO_DE_LA_K[0] - 256) * kpx,
      y0: alto / 2 - (CENTRO_DE_LA_K[1] - 256) * kpx,
    };
  }
  return { ancho, alto, kpx: KPX_ANDROID, escala: 1, x0: ancho / 2, y0: alto / 2 };
}

/** Un punto del lienzo, en pixeles de la pantalla. */
export function enPantalla(pose: Pose, [u, v]: Punto): Punto {
  return [pose.x0 + (u - 256) * pose.kpx, pose.y0 + (v - 256) * pose.kpx];
}

/** Un punto del lienzo, en pixeles de la caja de 288 (escalada) donde va la K. */
export function enCaja(pose: Pose, [u, v]: Punto): Punto {
  return [144 * pose.escala + (u - 256) * pose.kpx, 144 * pose.escala + (v - 256) * pose.kpx];
}

/** La esquina de la caja de 288 (escalada) en la pantalla. */
export function origenDeCaja(pose: Pose): Punto {
  return [pose.x0 - 144 * pose.escala, pose.y0 - 144 * pose.escala];
}

export const puntos = (f: Figura): string => f.map(([x, y]) => `${x},${y}`).join(' ');

/**
 * Cuanto tiene que crecer la ventana para que el asta tape toda la pantalla.
 * Nunca menos de 44, que es el ritmo que se eligio en el prototipo; en una
 * tableta ancha hace falta mas.
 */
export function escalaFinalDeLaVentana(pose: Pose): number {
  const [sx, sy] = enPantalla(pose, CENTRO_DEL_ASTA);
  const medioAncho = 35 * pose.kpx;
  const medioAlto = 119 * pose.kpx;
  const necesaria = Math.max(
    Math.max(sx, pose.ancho - sx) / medioAncho,
    Math.max(sy, pose.alto - sy) / medioAlto,
  );
  return Math.max(44, necesaria * 1.15);
}

/**
 * Lo que sobra la capa del fondo por cada lado. Mientras la K se encoge a 0,88
 * el fondo se encoge con ella y no puede dejar ver la app por las esquinas.
 */
export function margenDelFondo(pose: Pose): number {
  return Math.max(200, Math.ceil(0.2 * Math.max(pose.ancho, pose.alto)));
}
