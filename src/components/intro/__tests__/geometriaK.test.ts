// La intro empieza donde termina el splash nativo: la K en el mismo lugar y del
// mismo tamano. Si alguien regenera el splash con otra escala, estas pruebas lo
// avisan antes de que la K "salte" en el telefono.
import fs from 'fs';
import path from 'path';
import {
  CENTRO_DEL_ASTA,
  KPX_ANDROID,
  enPantalla,
  escalaFinalDeLaVentana,
  margenDelFondo,
  poseDeArranque,
} from '../geometriaK';

const RAIZ = path.resolve(__dirname, '../../../..');

describe('pose de arranque', () => {
  it('en Android coincide con drawable/splash_marca.xml (288 dp, frente a 0,658, centrada)', () => {
    const xml = fs.readFileSync(path.join(RAIZ, 'android/app/src/main/res/drawable/splash_marca.xml'), 'utf-8');
    const lado = Number(/android:width="(\d+(?:\.\d+)?)dp"/.exec(xml)?.[1]);
    const lienzo = Number(/android:viewportWidth="(\d+(?:\.\d+)?)"/.exec(xml)?.[1]);
    const frente = Number(/android:scaleX="([\d.]+)"/.exec(xml)?.[1]);
    expect(xml).toContain('android:pivotX="256"');
    expect(KPX_ANDROID).toBeCloseTo((lado / lienzo) * frente, 9);

    const pose = poseDeArranque('android', 390, 844);
    expect(pose).toMatchObject({ escala: 1, x0: 195, y0: 422 });
    // El alto de la K: de la punta de arriba (112,3) a la de abajo (399,7).
    expect((399.7 - 112.3) * pose.kpx).toBeCloseTo(106.4, 1);
  });

  it('en iOS sigue al cuadrado de 2732 en aspectFill: la K mide el 11,5 % del lado mayor y su caja va al centro', () => {
    const telefono = poseDeArranque('ios', 390, 844);
    const altoK = (399.7 - 112.3) * telefono.kpx;
    expect(altoK).toBeCloseTo((314 / 2732) * 844, 6);
    // Centro de la caja de la K (de 150 a 371,7 de ancho) en el centro de la pantalla.
    const [izq] = enPantalla(telefono, [150, 256]);
    const [der] = enPantalla(telefono, [371.7, 256]);
    expect((izq + der) / 2).toBeCloseTo(195, 6);
    expect(telefono.y0).toBe(422);

    const tableta = poseDeArranque('ios', 1366, 1024);
    expect((399.7 - 112.3) * tableta.kpx).toBeCloseTo((314 / 2732) * 1366, 6);
  });

  it('cualquier otra plataforma usa la pose de Android', () => {
    expect(poseDeArranque('web', 390, 844).kpx).toBe(KPX_ANDROID);
  });
});

const PANTALLAS: Array<[string, number, number]> = [
  ['android', 390, 844],
  ['android', 360, 640],
  ['android', 800, 1280],
  ['android', 1280, 800],
  ['ios', 390, 844],
  ['ios', 375, 667],
  ['ios', 820, 1180],
  ['ios', 1366, 1024],
];

describe('la ventana de la K', () => {
  it.each(PANTALLAS)('en %s %ix%i, el asta agrandada tapa toda la pantalla al final', (plataforma, w, h) => {
    const pose = poseDeArranque(plataforma, w, h);
    const s = escalaFinalDeLaVentana(pose);
    const [sx, sy] = enPantalla(pose, CENTRO_DEL_ASTA);
    expect(35 * pose.kpx * s).toBeGreaterThanOrEqual(Math.max(sx, w - sx));
    expect(119 * pose.kpx * s).toBeGreaterThanOrEqual(Math.max(sy, h - sy));
    expect(s).toBeGreaterThanOrEqual(44);
  });

  it.each(PANTALLAS)('en %s %ix%i, el fondo encogido a 0,88 sigue tapando las esquinas', (plataforma, w, h) => {
    const pose = poseDeArranque(plataforma, w, h);
    const m = margenDelFondo(pose);
    const [sx, sy] = enPantalla(pose, CENTRO_DEL_ASTA);
    const encoge = (v: number, centro: number) => centro + (v - centro) * 0.88;
    expect(encoge(-m, sx)).toBeLessThanOrEqual(0);
    expect(encoge(-m, sy)).toBeLessThanOrEqual(0);
    expect(encoge(w + m, sx)).toBeGreaterThanOrEqual(w);
    expect(encoge(h + m, sy)).toBeGreaterThanOrEqual(h);
  });
});
