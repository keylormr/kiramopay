// Las reglas que mantienen la intro fluida en un telefono barato y su arranque
// pegado al splash: solo se anima transform y opacity, sin curvas que el
// WebView minimo (Chrome 111) no entienda, y el primer cuadro es la K quieta.
import { armarConcepto, atrasAdelante, paredesDeLosa, type IdConcepto } from '../conceptos';
import { FIGURAS, poseDeArranque } from '../geometriaK';

const IDS: IdConcepto[] = ['ventana', 'cierre', 'giro', 'reducido'];
const POSES = [poseDeArranque('android', 390, 844), poseDeArranque('ios', 820, 1180)];
const PERMITIDAS = new Set(['offset', 'easing', 'transform', 'opacity']);
// cubic-bezier con cuatro numeros o una palabra clave; nunca linear(...) ni steps(...).
const CURVA = /^(linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\))$/;

function montar(html: string): HTMLElement {
  const raiz = document.createElement('div');
  raiz.innerHTML = html;
  return raiz;
}

/** El valor de una propiedad en un instante (ms) segun los cuadros clave, sin curvas. */
function valorEn(cuadros: Keyframe[], prop: 'opacity' | 'transform', offset: number): unknown {
  let ultimo: unknown;
  for (const c of cuadros) {
    if ((c.offset as number) <= offset + 1e-9 && c[prop] !== undefined) ultimo = c[prop];
  }
  return ultimo;
}

describe.each(POSES.map((p) => [`${p.ancho}x${p.alto}`, p] as const))('conceptos en %s', (_nombre, pose) => {
  it.each(IDS)('%s: cada paso mueve capas que existen y solo con transform u opacity', (id) => {
    const c = armarConcepto(id, pose);
    const raiz = montar(c.html);
    expect(c.pasos.length).toBeGreaterThan(0);
    for (const paso of c.pasos) {
      expect(raiz.querySelectorAll(paso.selector).length, paso.selector).toBeGreaterThan(0);
      const offsets = paso.cuadros.map((k) => k.offset as number);
      expect(offsets[0], paso.selector).toBe(0);
      expect(offsets.at(-1), paso.selector).toBe(1);
      offsets.slice(1).forEach((o, i) => expect(o, paso.selector).toBeGreaterThanOrEqual(offsets[i]));
      for (const k of paso.cuadros) {
        Object.keys(k).forEach((prop) => expect(PERMITIDAS.has(prop), `${paso.selector} anima ${prop}`).toBe(true));
        if (k.easing !== undefined) expect(String(k.easing), paso.selector).toMatch(CURVA);
        if (typeof k.opacity === 'number') {
          expect(k.opacity).toBeGreaterThanOrEqual(0);
          expect(k.opacity).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it.each(IDS)('%s: el HTML es fijo, sin scripts ni manejadores', (id) => {
    const { html } = armarConcepto(id, pose);
    expect(html).not.toMatch(/<script|\son\w+=|javascript:/i);
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('las duraciones: Ventana 1,05 s, Cierre 1,45 s, K en 3D 1,9 s y el fundido 0,5 s', () => {
    expect(IDS.map((id) => armarConcepto(id, pose).duracion)).toEqual([1050, 1450, 1900, 500]);
  });

  it('Ventana arranca con la K entera y quieta, y termina con la app a la vista', () => {
    const c = armarConcepto('ventana', pose);
    const paso = (sel: string, prop: 'opacity' | 'transform') => c.pasos.filter((p) => p.selector === sel).find((p) => p.cuadros.some((k) => k[prop] !== undefined))!;
    for (const sel of ['.kpi-hueco', '.kpi-borde', '.kpi-grupo']) {
      expect(valorEn(paso(sel, 'transform').cuadros, 'transform', 0)).toBe('scale(1)');
      expect(valorEn(paso(sel, 'transform').cuadros, 'transform', 130 / 1050)).toBe('scale(1)');
    }
    expect(valorEn(paso('.kpi-k', 'opacity').cuadros, 'opacity', 0)).toBe(1);
    expect(valorEn(paso('.kpi-fondo', 'opacity').cuadros, 'opacity', 1)).toBe(0);
    expect(valorEn(paso('.kpi-borde', 'opacity').cuadros, 'opacity', 1)).toBe(0);
  });

  it('Cierre muestra la K del splash hasta los 120 ms y al final deja ver la app', () => {
    const c = armarConcepto('cierre', pose);
    const entera = c.pasos.find((p) => p.selector === '.kpi-entera')!.cuadros;
    const escena = c.pasos.find((p) => p.selector === '.kpi-escena')!.cuadros;
    expect(valorEn(entera, 'opacity', 0)).toBe(1);
    expect(valorEn(escena, 'opacity', 0)).toBe(0);
    expect(valorEn(entera, 'opacity', 1)).toBe(0);
    expect(valorEn(c.pasos.find((p) => p.selector === '.kpi-fondo')!.cuadros, 'opacity', 1)).toBe(0);
    expect(valorEn(c.pasos.find((p) => p.selector === '.kpi-contenido')!.cuadros, 'opacity', 1)).toBe(0);
  });

  it('K en 3D: quieta y de frente hasta los 150 ms, una vuelta entera, y al final la app a la vista', () => {
    const c = armarConcepto('giro', pose);
    const giro = c.pasos.find((p) => p.selector === '.kpi-k3d')!.cuadros;
    expect(giro[0].transform).toBe('rotateX(0deg) rotateY(0deg) scale(1)');
    expect(String(giro.at(-1)!.transform)).toContain('rotateY(360deg)');
    expect(valorEn(c.pasos.find((p) => p.selector === '.kpi-quieta')!.cuadros, 'opacity', 0.07)).toBe(1);
    expect(valorEn(c.pasos.find((p) => p.selector === '.kpi-escena')!.cuadros, 'opacity', 1)).toBe(0);
    expect(valorEn(c.pasos.find((p) => p.selector === '.kpi-fondo')!.cuadros, 'opacity', 1)).toBe(0);
  });
});

describe('la K en 3D', () => {
  const pose = poseDeArranque('android', 390, 844);

  it('cada losa lleva una pared por borde, salvo el que comparten el cuerpo y la punta', () => {
    const base = { relleno: '#fff', canto: [200, 200, 200] as const, frente: 0, grosor: 44 };
    expect(paredesDeLosa(pose, { ...base, clase: 'a', paredes: FIGURAS.asta, tapa: FIGURAS.asta })).toHaveLength(4);
    expect(paredesDeLosa(pose, { ...base, clase: 'c', paredes: FIGURAS.cuerpo, tapa: FIGURAS.cinta })).toHaveLength(5);
    expect(paredesDeLosa(pose, { ...base, clase: 'p', paredes: FIGURAS.punta, tapa: FIGURAS.punta })).toHaveLength(3);
  });

  it('las paredes de la losa del asta son tan hondas como su grosor', () => {
    const paredes = paredesDeLosa(pose, { clase: 'a', paredes: FIGURAS.asta, tapa: FIGURAS.asta, relleno: '#fff', canto: [200, 200, 200], frente: 0, grosor: 44 });
    const raiz = montar(paredes.join(''));
    raiz.querySelectorAll<HTMLElement>('.kpi-pared').forEach((p) => {
      expect(parseFloat(p.style.height)).toBeCloseTo(44 * pose.kpx, 2);
      expect(p.style.transform).toMatch(/^matrix3d\(/);
    });
  });

  it('la curva de la vuelta empieza en 0, termina en 1 y se pasa un poco antes de asentarse', () => {
    expect(atrasAdelante(0)).toBeCloseTo(0, 9);
    expect(atrasAdelante(1)).toBeCloseTo(1, 9);
    expect(Math.min(...[0.05, 0.1, 0.15].map(atrasAdelante))).toBeLessThan(0);
    expect(Math.max(...[0.85, 0.9, 0.95].map(atrasAdelante))).toBeGreaterThan(1);
  });
});
