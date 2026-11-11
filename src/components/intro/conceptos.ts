// Las animaciones de la intro. Cada una arma sus capas (HTML fijo, sin datos de
// nadie) y la lista de cuadros clave de cada capa. Todas animan SOLO transform y
// opacity: el navegador las resuelve en la tarjeta grafica y siguen fluidas
// aunque la app este ocupada cargando por detras. Las curvas son cubic-bezier,
// no linear(): el WebView minimo es Chrome 111 y linear() llego en la 113.
//
// Todas empiezan con la K quieta, identica a la del splash, y la mueven recien
// despues de unos 120 ms.

import {
  CENTRO_DEL_ASTA,
  CENTRO_DE_LA_K,
  FIGURAS,
  enCaja,
  enPantalla,
  escalaFinalDeLaVentana,
  margenDelFondo,
  origenDeCaja,
  puntos,
  type Figura,
  type Pose,
  type Punto,
} from './geometriaK';

export type IdConcepto = 'ventana' | 'cierre' | 'giro' | 'reducido';

export interface PasoDeAnimacion {
  /** Las capas que mueve, dentro de la raiz de la intro. */
  selector: string;
  cuadros: Keyframe[];
}

export interface Concepto {
  id: IdConcepto;
  /** Milisegundos; todas las capas de un concepto duran lo mismo. */
  duracion: number;
  html: string;
  pasos: PasoDeAnimacion[];
}

const MEDIANOCHE = '#050B18';
const G = 'translate(256 256) scale(0.658) translate(-256 -256)';

const n = (v: number) => Number(v.toFixed(3));
const px = (v: number) => `${n(v)}px`;

const poligono = (f: Figura, relleno: string) => `<polygon points="${puntos(f)}" fill="${relleno}"/>`;

const DEGRADES = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<linearGradient id="kpi-cinta" gradientUnits="userSpaceOnUse" x1="220" y1="256" x2="371.7" y2="256"><stop offset="0" stop-color="#EDF2FC"/><stop offset=".5" stop-color="#F8FAFF"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>
<linearGradient id="kpi-asta" gradientUnits="userSpaceOnUse" x1="150" y1="137" x2="220" y2="375"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E6EDFA"/></linearGradient>
<linearGradient id="kpi-punta" gradientUnits="userSpaceOnUse" x1="286.2" y1="197.8" x2="347" y2="137"><stop offset="0" stop-color="#F07518"/><stop offset=".35" stop-color="#FF8A2B"/><stop offset="1" stop-color="#FFA04A"/></linearGradient>
</defs></svg>`;

const RELLENO = {
  cinta: 'url(#kpi-cinta)',
  asta: 'url(#kpi-asta)',
  punta: 'url(#kpi-punta)',
  pliegue: '#DCE6F5',
};

// Las piezas en el orden del splash: la cinta, la punta encima, el pliegue y el asta adelante.
const K_ENTERA =
  poligono(FIGURAS.cinta, RELLENO.cinta) +
  poligono(FIGURAS.punta, RELLENO.punta) +
  poligono(FIGURAS.pliegue, RELLENO.pliegue) +
  poligono(FIGURAS.asta, RELLENO.asta);

/** La caja de 288 px (escalada) en su lugar de la pantalla. */
function estiloDeCaja(pose: Pose, extra = ''): string {
  const [x, y] = origenDeCaja(pose);
  const lado = px(288 * pose.escala);
  return `position:absolute;left:${px(x)};top:${px(y)};width:${lado};height:${lado};${extra}`;
}

function svgDeCaja(pose: Pose, contenido: string, estilo = ''): string {
  const lado = n(288 * pose.escala);
  return `<svg viewBox="0 0 512 512" width="${lado}" height="${lado}" style="position:absolute;left:0;top:0;display:block;${estilo}" aria-hidden="true" focusable="false"><g transform="${G}">${contenido}</g></svg>`;
}

const fondo = (extra = '') =>
  `<div class="kpi-fondo" style="position:absolute;inset:0;background:${MEDIANOCHE};will-change:opacity;${extra}"></div>`;

// Cuadros con offset en milisegundos sobre la duracion total.
type Cuadro = Record<string, string | number>;
function cuadros(total: number, lista: Array<[number, Cuadro, string?]>): Keyframe[] {
  return lista.map(([ms, valores, easing]) => ({ offset: n(ms / total), ...valores, ...(easing ? { easing } : {}) }));
}

// ---------------------------------------------------------------------------
// A. Ventana: la K se encoge un poco y se abre hacia la persona; la app aparece
// dentro de la letra, que crece hasta salir de la pantalla.
// ---------------------------------------------------------------------------
function ventana(pose: Pose): Concepto {
  const T = 1050;
  const { ancho: W, alto: H } = pose;
  const M = margenDelFondo(pose);
  const [sx, sy] = enPantalla(pose, CENTRO_DEL_ASTA);
  const [cx, cy] = enCaja(pose, CENTRO_DEL_ASTA);
  const borde = `M${FIGURAS.silueta.map((p) => enPantalla(pose, p).map(n).join(' ')).join(' L')}Z`;
  const capa = (clase: string, contenido: string, estilo: string) =>
    `<svg class="${clase}" viewBox="${-M} ${-M} ${W + 2 * M} ${H + 2 * M}" width="${W + 2 * M}" height="${H + 2 * M}" style="position:absolute;left:${-M}px;top:${-M}px;transform-origin:${px(sx + M)} ${px(sy + M)};will-change:transform;${estilo}" aria-hidden="true" focusable="false">${contenido}</svg>`;
  const s = pose.escala;
  const mascara = `url('data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="${G}"><polygon points="${puntos(FIGURAS.silueta)}" fill="#000"/></g></svg>`,
  )}')`;

  const html =
    fondo() +
    capa(
      'kpi-hueco',
      `<path fill="${MEDIANOCHE}" fill-rule="evenodd" d="M${-M} ${-M}H${W + M}V${H + M}H${-M}Z ${borde}"/>`,
      '',
    ) +
    capa(
      'kpi-borde',
      `<path fill="none" stroke="#2D7BFF" stroke-opacity=".28" stroke-width="${n(5 * s)}" stroke-linejoin="round" d="${borde}"/><path fill="none" stroke="#7FB0FF" stroke-width="${n(1.4 * s)}" stroke-linejoin="round" d="${borde}"/>`,
      'opacity:0',
    ) +
    `<div class="kpi-grupo" style="${estiloDeCaja(pose, `transform-origin:${px(cx)} ${px(cy)};will-change:transform`)}">` +
    svgDeCaja(pose, K_ENTERA, 'will-change:opacity').replace('<svg ', '<svg class="kpi-k" ') +
    `<div class="kpi-brillo" style="position:absolute;inset:0;overflow:hidden;-webkit-mask-image:${mascara};mask-image:${mascara};-webkit-mask-size:100% 100%;mask-size:100% 100%;will-change:opacity">` +
    `<div class="kpi-banda" style="position:absolute;left:${px(84 * s)};top:${px(-80 * s)};width:${px(110 * s)};height:${px(450 * s)};will-change:transform;background:linear-gradient(90deg,rgba(45,123,255,0) 0%,rgba(45,123,255,.42) 45%,rgba(120,170,255,.55) 52%,rgba(45,123,255,0) 100%)"></div>` +
    `</div></div>`;

  const F = n(escalaFinalDeLaVentana(pose));
  const escala = cuadros(T, [
    [0, { transform: 'scale(1)' }],
    [140, { transform: 'scale(1)' }, 'cubic-bezier(.45,0,.2,1)'],
    [400, { transform: 'scale(.88)' }, 'cubic-bezier(.62,0,.86,.22)'],
    [T, { transform: `scale(${F})` }],
  ]);
  const banda = (x: number) => `translateX(${px(x * s)}) rotate(24deg)`;
  return {
    id: 'ventana',
    duracion: T,
    html,
    pasos: [
      { selector: '.kpi-hueco', cuadros: escala },
      { selector: '.kpi-borde', cuadros: escala },
      { selector: '.kpi-grupo', cuadros: escala },
      {
        selector: '.kpi-borde',
        cuadros: cuadros(T, [[0, { opacity: 0 }], [400, { opacity: 0 }], [470, { opacity: 1 }], [700, { opacity: 1 }], [900, { opacity: 0 }], [T, { opacity: 0 }]]),
      },
      { selector: '.kpi-k', cuadros: cuadros(T, [[0, { opacity: 1 }], [400, { opacity: 1 }], [560, { opacity: 0 }], [T, { opacity: 0 }]]) },
      {
        selector: '.kpi-banda',
        cuadros: cuadros(T, [
          [0, { transform: banda(-230) }],
          [130, { transform: banda(-230) }, 'cubic-bezier(.4,0,.3,1)'],
          [420, { transform: banda(220) }],
          [T, { transform: banda(220) }],
        ]),
      },
      { selector: '.kpi-brillo', cuadros: cuadros(T, [[0, { opacity: 1 }], [410, { opacity: 1 }], [470, { opacity: 0 }], [T, { opacity: 0 }]]) },
      // El fondo de abajo tapa la app hasta que la K deja de cubrir el hueco.
      { selector: '.kpi-fondo', cuadros: cuadros(T, [[0, { opacity: 1 }], [400, { opacity: 1 }], [470, { opacity: 0 }], [T, { opacity: 0 }]]) },
    ],
  };
}

// ---------------------------------------------------------------------------
// B. Cierre: la K se separa en piezas en 3D, la punta naranja sale como una
// llave y todo vuelve a encajar con un destello azul.
// ---------------------------------------------------------------------------
function cierre(pose: Pose): Concepto {
  const T = 1450;
  const s = pose.escala;
  const [bx, by] = origenDeCaja(pose);
  const [ex, ey] = enPantalla(pose, CENTRO_DE_LA_K);
  const pieza = (clase: string, contenido: string, origen = '') =>
    `<div class="kpi-pieza ${clase}" style="position:absolute;inset:0;will-change:transform,opacity;${origen}">${svgDeCaja(pose, contenido)}</div>`;
  const redondo = (clase: string, x: number, y: number, lado: number, estilo: string) =>
    `<div class="${clase}" style="position:absolute;left:${px(bx + x * s)};top:${px(by + y * s)};width:${px(lado * s)};height:${px(lado * s)};border-radius:50%;opacity:0;${estilo}"></div>`;

  const html =
    fondo() +
    `<div class="kpi-contenido" style="position:absolute;inset:0;transform-origin:${px(pose.ancho / 2)} ${px(pose.alto / 2)};will-change:transform,opacity">` +
    `<div class="kpi-destello" style="position:absolute;inset:0;opacity:0;will-change:opacity;background:radial-gradient(60% 40% at 50% 50%,rgba(45,123,255,.45),rgba(45,123,255,0))"></div>` +
    redondo('kpi-halo', 96, 41, 140, 'will-change:opacity;background:radial-gradient(closest-side,rgba(255,138,43,.75),rgba(255,138,43,0))') +
    redondo('kpi-anillo', 70.8, 69, 150, `will-change:transform,opacity;border:${px(2 * s)} solid rgba(77,142,255,.95);box-shadow:0 0 ${px(24 * s)} rgba(45,123,255,.7),inset 0 0 ${px(18 * s)} rgba(45,123,255,.45)`) +
    `<div class="kpi-entera" style="${estiloDeCaja(pose, 'will-change:opacity')}">${svgDeCaja(pose, K_ENTERA)}</div>` +
    `<div class="kpi-escena" style="position:absolute;inset:0;opacity:0;perspective:${px(900 * s)};perspective-origin:${px(ex)} ${px(ey)};will-change:opacity">` +
    `<div class="kpi-k3d" style="${estiloDeCaja(pose, `transform-style:preserve-3d;transform-origin:${px(145.8 * s)} ${px(144 * s)};will-change:transform`)}">` +
    pieza('kpi-p-cuerpo', poligono(FIGURAS.cuerpo, RELLENO.cinta)) +
    pieza('kpi-p-pliegue', poligono(FIGURAS.pliegue, RELLENO.pliegue)) +
    pieza('kpi-p-punta', poligono(FIGURAS.punta, RELLENO.punta), `transform-origin:${px(166.4 * s)} ${px(111.2 * s)};`) +
    pieza('kpi-p-asta', poligono(FIGURAS.asta, RELLENO.asta)) +
    `</div></div></div>`;

  const sale = 'cubic-bezier(.2,.75,.25,1)';
  const resorte = 'cubic-bezier(.3,1.45,.55,1)';
  const t3 = (x: number, y: number, z: number) => `translate3d(${px(x * s)},${px(y * s)},${px(z * s)})`;
  const giro = (rx: number, ry: number, e: number) => `rotateX(${rx}deg) rotateY(${ry}deg) scale(${e})`;
  const mueve = (quieto: string, lejos: string, rebote: string, vuelta: number, finRebote = 780): Keyframe[] =>
    cuadros(T, [
      [0, { transform: quieto }],
      [120, { transform: quieto }, sale],
      [620, { transform: lejos }, 'linear'],
      [finRebote, { transform: rebote }, resorte],
      [vuelta, { transform: quieto }],
      [T, { transform: quieto }],
    ]);

  return {
    id: 'cierre',
    duracion: T,
    html,
    pasos: [
      { selector: '.kpi-k3d', cuadros: mueve(giro(0, 0, 1), giro(16, -38, 1.04), giro(14, -34, 1.04), 1120) },
      { selector: '.kpi-p-asta', cuadros: mueve(t3(0, 0, 1), t3(-18, 0, 66), t3(-20, 0, 70), 1120) },
      { selector: '.kpi-p-cuerpo', cuadros: mueve(t3(0, 0, 0), t3(14, 0, -46), t3(16, 0, -50), 1120) },
      // La cinta que se va hacia atras pierde brillo: da profundidad sin filtros.
      {
        selector: '.kpi-p-cuerpo',
        cuadros: cuadros(T, [[0, { opacity: 1 }], [120, { opacity: 1 }], [620, { opacity: 0.72 }], [780, { opacity: 0.72 }], [1100, { opacity: 1 }], [T, { opacity: 1 }]]),
      },
      {
        selector: '.kpi-p-punta',
        cuadros: mueve(`${t3(0, 0, 0.5)} rotate(0deg)`, `${t3(44, -44, 36)} rotate(-8deg)`, `${t3(48, -48, 38)} rotate(-8deg)`, 1160, 820),
      },
      // Hasta los 120 ms se ve la K del splash tal cual; las piezas aparecen al empezar a moverse.
      { selector: '.kpi-entera', cuadros: cuadros(T, [[0, { opacity: 1 }], [120, { opacity: 1 }], [120, { opacity: 0 }], [T, { opacity: 0 }]]) },
      { selector: '.kpi-escena', cuadros: cuadros(T, [[0, { opacity: 0 }], [120, { opacity: 0 }], [120, { opacity: 1 }], [T, { opacity: 1 }]]) },
      {
        selector: '.kpi-p-pliegue',
        cuadros: cuadros(T, [[0, { opacity: 1 }], [120, { opacity: 1 }], [320, { opacity: 0 }], [1060, { opacity: 0 }], [1160, { opacity: 1 }], [T, { opacity: 1 }]]),
      },
      {
        selector: '.kpi-anillo',
        cuadros: cuadros(T, [
          [0, { opacity: 0, transform: 'scale(.55)' }],
          [1070, { opacity: 0, transform: 'scale(.55)' }],
          [1110, { opacity: 0.9, transform: 'scale(.66)' }, 'cubic-bezier(.1,.7,.3,1)'],
          [1440, { opacity: 0, transform: 'scale(2.7)' }],
          [T, { opacity: 0, transform: 'scale(2.7)' }],
        ]),
      },
      { selector: '.kpi-halo', cuadros: cuadros(T, [[0, { opacity: 0 }], [1100, { opacity: 0 }], [1150, { opacity: 0.95 }], [1420, { opacity: 0 }], [T, { opacity: 0 }]]) },
      { selector: '.kpi-destello', cuadros: cuadros(T, [[0, { opacity: 0 }], [1090, { opacity: 0 }], [1130, { opacity: 0.55 }], [1400, { opacity: 0 }], [T, { opacity: 0 }]]) },
      {
        selector: '.kpi-contenido',
        cuadros: cuadros(T, [
          [0, { opacity: 1, transform: 'scale(1)' }],
          [1170, { opacity: 1, transform: 'scale(1)' }, 'cubic-bezier(.4,0,.2,1)'],
          [1360, { opacity: 0, transform: 'scale(.86)' }],
          [T, { opacity: 0, transform: 'scale(.86)' }],
        ]),
      },
      { selector: '.kpi-fondo', cuadros: cuadros(T, [[0, { opacity: 1 }], [1230, { opacity: 1 }, 'cubic-bezier(.4,0,.2,1)'], [T, { opacity: 0 }]]) },
    ],
  };
}

// ---------------------------------------------------------------------------
// C. K en 3D: la K con grosor da una vuelta completa, como una moneda. Es la
// del prototipo de three.js rehecha con capas del navegador: cada pieza es una
// losa con su cara de adelante, la de atras y una pared por cada borde.
// ---------------------------------------------------------------------------

/** Losas en unidades del lienzo: adelante en z = frente, atras en frente - grosor. */
interface Losa {
  clase: string;
  paredes: Figura;
  tapa: Figura;
  relleno: string;
  canto: readonly [number, number, number];
  frente: number;
  grosor: number;
}

// La cara de adelante del cuerpo es la cinta entera: asi no queda una costura
// contra la punta. La punta va un poco delante y un poco mas honda, y la tapa.
const LOSAS: Losa[] = [
  { clase: 'kpi-l-cuerpo', paredes: FIGURAS.cuerpo, tapa: FIGURAS.cinta, relleno: RELLENO.cinta, canto: [175, 196, 236], frente: -8, grosor: 44 },
  { clase: 'kpi-l-punta', paredes: FIGURAS.punta, tapa: FIGURAS.punta, relleno: RELLENO.punta, canto: [216, 102, 26], frente: -7.7, grosor: 44.6 },
  { clase: 'kpi-l-asta', paredes: FIGURAS.asta, tapa: FIGURAS.asta, relleno: RELLENO.asta, canto: [185, 204, 240], frente: 0, grosor: 44 },
];
// El borde que comparten el cuerpo y la punta queda adentro de la K: sin pared.
const BORDE_INTERNO: readonly [Punto, Punto] = [FIGURAS.cuerpo[1], FIGURAS.cuerpo[2]];

function mismoPunto(a: Punto, b: Punto): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}
function esBordeInterno(a: Punto, b: Punto): boolean {
  const [p, q] = BORDE_INTERNO;
  return (mismoPunto(a, p) && mismoPunto(b, q)) || (mismoPunto(a, q) && mismoPunto(b, p));
}

function dentro(f: Figura, [x, y]: Punto): boolean {
  let adentro = false;
  for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
    const [xi, yi] = f[i];
    const [xj, yj] = f[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) adentro = !adentro;
  }
  return adentro;
}

// Luz fija de arriba a la izquierda y un reflejo azul abajo a la derecha, como
// las luces del prototipo. Las caras de adelante no se iluminan: son las del splash.
const LUZ: Punto = [-0.55, -0.83];
const REFLEJO: Punto = [0.89, 0.45];
function tono([r, g, b]: readonly [number, number, number], normal: Punto): string {
  const luz = 0.84 + 0.16 * (normal[0] * LUZ[0] + normal[1] * LUZ[1]);
  const azul = 0.35 * Math.max(0, normal[0] * REFLEJO[0] + normal[1] * REFLEJO[1]);
  const mezcla = (c: number, a: number) => Math.round(Math.min(255, c * luz * (1 - azul) + a * azul));
  return `rgb(${mezcla(r, 45)},${mezcla(g, 123)},${mezcla(b, 255)})`;
}

/** Las paredes de una losa, cada una puesta en su lugar con una matriz 3D. */
export function paredesDeLosa(pose: Pose, losa: Losa): string[] {
  const f = losa.paredes;
  const hondo = losa.grosor * pose.kpx;
  const z = losa.frente * pose.kpx;
  const lista: string[] = [];
  for (let i = 0; i < f.length; i++) {
    const a = f[i];
    const b = f[(i + 1) % f.length];
    if (esBordeInterno(a, b)) continue;
    const [ax, ay] = enCaja(pose, a);
    const [bx, by] = enCaja(pose, b);
    const largo = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / largo;
    const uy = (by - ay) / largo;
    // La normal que apunta hacia afuera de la figura.
    let normal: Punto = [uy, -ux];
    const medio: Punto = [(a[0] + b[0]) / 2 + normal[0] * 0.5, (a[1] + b[1]) / 2 + normal[1] * 0.5];
    if (dentro(f, medio)) normal = [-uy, ux];
    // Columnas: el ancho del div corre por el borde, el alto va hacia el fondo.
    const m = [ux, uy, 0, 0, 0, 0, -1, 0, normal[0], normal[1], 0, 0, ax, ay, z, 1].map(n).join(',');
    lista.push(
      `<div class="kpi-pared" style="position:absolute;left:0;top:0;width:${px(largo + 0.6)};height:${px(hondo)};transform-origin:0 0;transform:matrix3d(${m});background:${tono(losa.canto, normal)}"></div>`,
    );
  }
  return lista;
}

/** Una cara plana recortada a la caja de su figura, a la profundidad z (unidades). */
function tapa(pose: Pose, f: Figura, relleno: string, z: number): string {
  const xs = f.map((p) => p[0]);
  const ys = f.map((p) => p[1]);
  const m = 2;
  const u0 = Math.min(...xs) - m;
  const v0 = Math.min(...ys) - m;
  const anchoU = Math.max(...xs) + m - u0;
  const altoU = Math.max(...ys) + m - v0;
  const [x, y] = enCaja(pose, [u0, v0]);
  return `<svg class="kpi-tapa" viewBox="${n(u0)} ${n(v0)} ${n(anchoU)} ${n(altoU)}" width="${n(anchoU * pose.kpx)}" height="${n(altoU * pose.kpx)}" style="position:absolute;left:0;top:0;display:block;transform:translate3d(${px(x)},${px(y)},${px(z * pose.kpx)})" aria-hidden="true" focusable="false">${poligono(f, relleno)}</svg>`;
}

/** El "atras y adelante" del prototipo: arranca hacia atras y se pasa un poco al final. */
export function atrasAdelante(x: number): number {
  const c1 = 0.9;
  const c2 = c1 * 1.525;
  return x < 0.5
    ? (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2
    : (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2;
}
const acotar = (x: number) => Math.min(1, Math.max(0, x));
const suave = (x: number) => x * x * (3 - 2 * x);

function giro(pose: Pose): Concepto {
  const T = 1900;
  const s = pose.escala;
  const QUIETA = 150;
  const [pivX, pivY] = enCaja(pose, CENTRO_DE_LA_K);
  // Camara angosta como la del prototipo (18 grados de apertura): de frente la
  // K sale casi plana y del mismo tamano que el splash.
  const perspectiva = pose.alto / 2 / Math.tan((9 * Math.PI) / 180);
  // Gira sobre el medio de su grosor, no sobre la cara de adelante.
  const ejeZ = -26 * pose.kpx;

  const capas3d = LOSAS.flatMap((l) => [
    ...paredesDeLosa(pose, l),
    tapa(pose, l.tapa, l.relleno, l.frente - l.grosor),
    tapa(pose, l.tapa, l.relleno, l.frente),
  ]);
  capas3d.push(tapa(pose, FIGURAS.pliegue, RELLENO.pliegue, -7.5));

  const html =
    fondo() +
    `<div class="kpi-glow" style="position:absolute;left:${px(pose.ancho / 2 - 255 * s)};top:${px(pose.alto / 2 - 250 * s)};width:${px(510 * s)};height:${px(500 * s)};opacity:0;will-change:opacity;background:radial-gradient(closest-side,rgba(45,123,255,.5),rgba(45,123,255,.12) 55%,rgba(45,123,255,0))"></div>` +
    `<div class="kpi-quieta" style="${estiloDeCaja(pose, 'will-change:opacity')}">${svgDeCaja(pose, K_ENTERA)}</div>` +
    `<div class="kpi-escena" style="position:absolute;inset:0;opacity:0;perspective:${px(perspectiva)};perspective-origin:${px(pose.ancho / 2)} ${px(pose.alto / 2)};will-change:opacity">` +
    `<div class="kpi-k3d" style="${estiloDeCaja(pose, `transform-style:preserve-3d;transform-origin:${px(pivX)} ${px(pivY)} ${px(ejeZ)};will-change:transform`)}">` +
    capas3d.join('') +
    `</div></div>`;

  // La vuelta se muestrea cada 25 ms: entre muestras el navegador interpola en
  // linea recta, y asi la curva con rebote corre entera en la tarjeta grafica.
  const giroK: Keyframe[] = [];
  const brillo: Keyframe[] = [];
  const escena: Keyframe[] = [];
  for (let t = 0; t <= T; t += 25) {
    const p = acotar((t - QUIETA) / 1250);
    const vuelta = atrasAdelante(p) * 360;
    const arco = Math.sin(p * Math.PI);
    const q = suave(acotar((t - 1450) / 450));
    const offset = n(t / T);
    giroK.push({ offset, transform: `rotateX(${n(-arco * 17.2)}deg) rotateY(${n(vuelta)}deg) scale(${n((1 + arco * 0.1) * (1 - 0.12 * q))})` });
    brillo.push({ offset, opacity: n(arco * 0.85 * (1 - q)) });
    if (t > QUIETA) escena.push({ offset, opacity: n(1 - q) });
  }

  return {
    id: 'giro',
    duracion: T,
    html,
    pasos: [
      { selector: '.kpi-k3d', cuadros: giroK },
      { selector: '.kpi-glow', cuadros: brillo },
      // La K del splash se ve tal cual hasta que empieza la vuelta.
      { selector: '.kpi-quieta', cuadros: cuadros(T, [[0, { opacity: 1 }], [QUIETA, { opacity: 1 }], [QUIETA, { opacity: 0 }], [T, { opacity: 0 }]]) },
      { selector: '.kpi-escena', cuadros: [{ offset: 0, opacity: 0 }, { offset: n(QUIETA / T), opacity: 0 }, { offset: n(QUIETA / T), opacity: 1 }, ...escena] },
      { selector: '.kpi-fondo', cuadros: cuadros(T, [[0, { opacity: 1 }], [1450, { opacity: 1 }, 'cubic-bezier(.45,0,.55,1)'], [T, { opacity: 0 }]]) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Con "reducir movimiento": la K quieta un instante y un fundido.
// ---------------------------------------------------------------------------
function reducido(pose: Pose): Concepto {
  const T = 500;
  return {
    id: 'reducido',
    duracion: T,
    html:
      `<div class="kpi-todo" style="position:absolute;inset:0;will-change:opacity">` +
      fondo() +
      `<div style="${estiloDeCaja(pose)}">${svgDeCaja(pose, K_ENTERA)}</div></div>`,
    pasos: [{ selector: '.kpi-todo', cuadros: cuadros(T, [[0, { opacity: 1 }], [250, { opacity: 1 }, 'ease-out'], [T, { opacity: 0 }]]) }],
  };
}

const CONCEPTOS: Record<IdConcepto, (pose: Pose) => Concepto> = { ventana, cierre, giro, reducido };

export function armarConcepto(id: IdConcepto, pose: Pose): Concepto {
  const c = CONCEPTOS[id](pose);
  return { ...c, html: DEGRADES + c.html };
}
