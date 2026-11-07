// Revisa el arranque de la app en el emulador: del splash (fondo #050B18 con la
// K al centro) a la primera pantalla no puede haber un cuadro mayormente
// blanco. Ese destello es el que dejaban el fondo blanco del WebView antes de
// pintar, el ?android:colorBackground del splash con el telefono en claro o la
// ventana nativa clara detras de las barras.
//
// Uso:
//   node scripts/emulador/sin-destello.mjs --capturar <carpeta>
//     Toma capturas con `adb exec-out screencap -p` (001.png, 002.png...) desde
//     que se abre la app hasta un rato despues de que el splash da paso a la
//     primera pantalla, y despues las revisa. recorrido.sh lo llama justo
//     despues del `am start`.
//   node scripts/emulador/sin-destello.mjs <carpeta>
//     Solo revisa las capturas que ya estan en la carpeta (por ejemplo, las de
//     un artefacto del CI).
//
// Sin dependencias: decodifica los PNG de screencap (8 bits, RGB o RGBA, sin
// entrelazar) con zlib de Node.
//
// Un cuadro es SPLASH si fuera de la caja central (donde va la K) todo es del
// color del fondo. Sin contar las franjas de las barras, el login tiene un 40 %
// de otros colores fuera de esa caja; la pagina de public/webview-viejo, que
// sale en los emuladores con un WebView viejo, tiene un 98 %. Los cuadros de
// antes del primer splash son el lanzador y no cuentan.
//
// Falla si:
// - ningun cuadro es el splash (no aparecio, o salio de otro color);
// - despues del splash no hay ningun cuadro distinto: la rafaga no alcanzo la
//   primera pantalla y la revision no vio el paso que tiene que vigilar;
// - desde el splash, un cuadro tiene mas de BLANCO_MAXIMO de pixeles casi
//   blancos en toda la pantalla o en la franja de la barra de estado o de la de
//   navegacion (la ventana clara detras de las barras).
//
// El teclado: el login enfoca el campo de usuario al abrir (autoFocus) y el
// teclado del emulador (Gboard en tema claro) ocupa la franja de abajo. En cada
// cuadro despues del splash se pregunta si esta a la vista (`dumpsys
// input_method`, mInputShown=true) y, si lo esta, solo se salta la revision de
// la franja de abajo; la de toda la pantalla y la de la barra de estado siguen.
// Si no se puede saber (adb falla o el campo no aparece) se revisa igual. Se
// pregunta despues de la captura, asi que el cuadro en que aparece el login
// puede salir "con teclado" antes de que el teclado se dibuje: por eso que
// ningun cuadro posterior se haya revisado sin teclado es un aviso, no una
// falla. El resumen dice cuantos fueron. Al capturar se guarda en teclado.json,
// que la revision de una carpeta lee si esta.
//
// Es un muestreo: cada captura del emulador tarda del orden de 0,2 a 0,5 s, asi
// que un destello de pocos cuadros puede caer entre dos. Atrapa lo que dura (un
// WebView blanco hasta que pinta, una franja clara fija), no prueba que no haya
// ningun cuadro blanco.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const FONDO = [5, 11, 24]; // #050B18, kiramo_fondo
const TOLERANCIA_FONDO = 14;
// Caja central, en fraccion del ancho y del alto: la K del splash (288 dp en
// Android 7 a 11, 192 dp desde Android 12) cae adentro con margen.
const CAJA_CENTRAL = { x0: 0.3, x1: 0.7, y0: 0.35, y1: 0.65 };
const SPLASH_MINIMO = 0.98; // fraccion del color del fondo fuera de la caja central
const BLANCO_MAXIMO = 0.6;
const FRANJA_ARRIBA = 0.03; // alto de la barra de estado, aproximado
const FRANJA_ABAJO = 0.05; // alto de la barra de navegacion, aproximado
const PASO = 4; // se mira uno de cada PASO pixeles por fila y por columna

// Captura: el splash dura del orden de 7 s en el emulador (mas en uno lento).
const TOPE_MS = 60_000; // sin primera pantalla en este plazo, se corta y falla
const DESPUES_MS = 3_000; // se sigue capturando este tiempo tras la primera pantalla...
const DESPUES_MINIMO = 3; // ...y por lo menos estos cuadros
const MAXIMO_CUADROS = 300;
const ADB = process.env.ADB || 'adb'; // el del PATH en el CI; otro para probar sin emulador

function decodificarPng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es un PNG');
  let i = 8;
  let ancho = 0;
  let alto = 0;
  let tipo = 0;
  const datos = [];
  while (i < buf.length) {
    const largo = buf.readUInt32BE(i);
    const nombre = buf.toString('ascii', i + 4, i + 8);
    const cuerpo = buf.subarray(i + 8, i + 8 + largo);
    if (nombre === 'IHDR') {
      ancho = cuerpo.readUInt32BE(0);
      alto = cuerpo.readUInt32BE(4);
      const bits = cuerpo[8];
      tipo = cuerpo[9];
      const entrelazado = cuerpo[12];
      if (bits !== 8 || (tipo !== 2 && tipo !== 6) || entrelazado !== 0) {
        throw new Error(`PNG no soportado (bits ${bits}, tipo ${tipo}, entrelazado ${entrelazado})`);
      }
    } else if (nombre === 'IDAT') {
      datos.push(cuerpo);
    } else if (nombre === 'IEND') {
      break;
    }
    i += 12 + largo;
  }
  const bpp = tipo === 6 ? 4 : 3;
  const crudo = inflateSync(Buffer.concat(datos));
  const fila = ancho * bpp;
  const pix = Buffer.alloc(alto * fila);
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (fila + 1)];
    const src = y * (fila + 1) + 1;
    const dst = y * fila;
    for (let x = 0; x < fila; x++) {
      const a = x >= bpp ? pix[dst + x - bpp] : 0;
      const b = y > 0 ? pix[dst - fila + x] : 0;
      const c = x >= bpp && y > 0 ? pix[dst - fila + x - bpp] : 0;
      let v = crudo[src + x];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pix[dst + x] = v & 0xff;
    }
  }
  return { ancho, alto, bpp, pix };
}

function medir({ ancho, alto, bpp, pix }) {
  const arriba = Math.max(1, Math.round(alto * FRANJA_ARRIBA));
  const abajo = alto - Math.max(1, Math.round(alto * FRANJA_ABAJO));
  const caja = {
    x0: ancho * CAJA_CENTRAL.x0,
    x1: ancho * CAJA_CENTRAL.x1,
    y0: alto * CAJA_CENTRAL.y0,
    y1: alto * CAJA_CENTRAL.y1,
  };
  const c = { total: 0, blanco: 0, fuera: 0, fondoFuera: 0, arriba: 0, blancoArriba: 0, abajo: 0, blancoAbajo: 0 };
  for (let y = 0; y < alto; y += PASO) {
    for (let x = 0; x < ancho; x += PASO) {
      const k = (y * ancho + x) * bpp;
      const r = pix[k];
      const g = pix[k + 1];
      const b = pix[k + 2];
      const esBlanco = r > 230 && g > 230 && b > 230;
      c.total++;
      if (esBlanco) c.blanco++;
      if (y < arriba) {
        c.arriba++;
        if (esBlanco) c.blancoArriba++;
      } else if (y >= abajo) {
        c.abajo++;
        if (esBlanco) c.blancoAbajo++;
      } else if (!(x >= caja.x0 && x <= caja.x1 && y >= caja.y0 && y <= caja.y1)) {
        c.fuera++;
        const esFondo =
          Math.abs(r - FONDO[0]) <= TOLERANCIA_FONDO &&
          Math.abs(g - FONDO[1]) <= TOLERANCIA_FONDO &&
          Math.abs(b - FONDO[2]) <= TOLERANCIA_FONDO;
        if (esFondo) c.fondoFuera++;
      }
    }
  }
  return {
    fondoFueraDelCentro: c.fuera ? c.fondoFuera / c.fuera : 0,
    blanco: c.blanco / c.total,
    franjaArriba: c.arriba ? c.blancoArriba / c.arriba : 0,
    franjaAbajo: c.abajo ? c.blancoAbajo / c.abajo : 0,
  };
}

/** Recorre los cuadros en orden y lleva la cuenta; sirve igual al capturar y al revisar una carpeta. */
class Revision {
  constructor() {
    this.cuadros = [];
    this.splash = null;
    this.primeraPantalla = null;
    this.posteriores = 0;
    this.posterioresSinTeclado = 0;
    this.teclados = {};
    this.fallas = [];
  }

  agregarError(nombre, mensaje) {
    this.cuadros.push({ cuadro: nombre, error: mensaje });
  }

  /**
   * leerTeclado: true si el teclado esta a la vista, false si no, null si no se
   * sabe. Solo se llama en los cuadros despues del splash.
   */
  agregar(nombre, m, leerTeclado) {
    const esSplash = m.fondoFueraDelCentro >= SPLASH_MINIMO;
    if (!this.splash && esSplash) this.splash = nombre;
    let fase = 'antes';
    if (this.splash) {
      fase = esSplash ? 'splash' : 'despues';
      if (!esSplash) {
        this.posteriores++;
        if (!this.primeraPantalla) this.primeraPantalla = nombre;
      }
    }
    const fila = { cuadro: nombre, fase };
    for (const [k, v] of Object.entries(m)) fila[k] = Number(v.toFixed(3));
    let teclado = null;
    if (fase === 'despues') {
      teclado = leerTeclado();
      this.teclados[nombre] = teclado;
      fila.teclado = teclado;
      if (teclado !== true) this.posterioresSinTeclado++;
    }
    this.cuadros.push(fila);
    if (fase === 'antes') return;
    if (m.blanco > BLANCO_MAXIMO) this.fallas.push(`${nombre}: ${Math.round(m.blanco * 100)} % de la pantalla casi blanca`);
    if (m.franjaArriba > BLANCO_MAXIMO) this.fallas.push(`${nombre}: la franja de la barra de estado es casi blanca`);
    if (m.franjaAbajo > BLANCO_MAXIMO && teclado !== true) {
      this.fallas.push(`${nombre}: la franja de la barra de navegacion es casi blanca`);
    }
  }

  cerrar() {
    if (!this.splash) {
      this.fallas.push('ningun cuadro muestra el splash (fondo #050B18 con la K al centro)');
    } else if (!this.primeraPantalla) {
      this.fallas.push('la rafaga no alcanzo la primera pantalla: todos los cuadros despues del splash siguen siendo el splash');
    }
  }
}

function dormir(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** mInputShown de `dumpsys input_method` (lo mismo que mira Appium); null si no se puede saber. */
function tecladoEnPantalla() {
  try {
    const salida = execFileSync(ADB, ['shell', 'dumpsys', 'input_method'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const m = /mInputShown=(\w+)/.exec(salida);
    return m ? m[1] === 'true' : null;
  } catch {
    return null;
  }
}

function capturar(carpeta, revision) {
  mkdirSync(carpeta, { recursive: true });
  const inicio = Date.now();
  let desdePrimera = null;
  for (let n = 1; n <= MAXIMO_CUADROS; n++) {
    const nombre = `${String(n).padStart(3, '0')}.png`;
    try {
      const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
      writeFileSync(path.join(carpeta, nombre), png);
      revision.agregar(nombre, medir(decodificarPng(png)), tecladoEnPantalla);
    } catch (e) {
      revision.agregarError(nombre, e.message.split('\n')[0]);
      dormir(200);
    }
    if (revision.primeraPantalla && desdePrimera === null) desdePrimera = Date.now();
    if (desdePrimera !== null && Date.now() - desdePrimera >= DESPUES_MS && revision.posteriores > DESPUES_MINIMO) break;
    if (Date.now() - inicio >= TOPE_MS) {
      console.log(`::warning::Se corto la rafaga a los ${TOPE_MS / 1000} s.`);
      break;
    }
    if (n === MAXIMO_CUADROS) console.log(`::warning::Se corto la rafaga en ${MAXIMO_CUADROS} cuadros.`);
  }
  writeFileSync(path.join(carpeta, 'teclado.json'), JSON.stringify(revision.teclados, null, 2));
}

function revisarCarpeta(carpeta, revision) {
  const archivoTeclado = path.join(carpeta, 'teclado.json');
  const teclados = existsSync(archivoTeclado) ? JSON.parse(readFileSync(archivoTeclado, 'utf8')) : {};
  const nombres = readdirSync(carpeta)
    .filter((n) => /^\d+\.png$/.test(n))
    .sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]));
  for (const nombre of nombres) {
    try {
      const leerTeclado = () => (typeof teclados[nombre] === 'boolean' ? teclados[nombre] : null);
      revision.agregar(nombre, medir(decodificarPng(readFileSync(path.join(carpeta, nombre)))), leerTeclado);
    } catch (e) {
      revision.agregarError(nombre, e.message);
    }
  }
}

const args = process.argv.slice(2);
const conCaptura = args[0] === '--capturar';
const CARPETA = conCaptura ? args[1] : args[0];
if (!CARPETA) {
  console.error('Uso: node scripts/emulador/sin-destello.mjs [--capturar] <carpeta>');
  process.exit(2);
}

const revision = new Revision();
if (conCaptura) capturar(CARPETA, revision);
else revisarCarpeta(CARPETA, revision);
revision.cerrar();

const resumen = {
  splash: revision.splash,
  primeraPantalla: revision.primeraPantalla,
  cuadrosDespuesDelSplash: revision.posteriores,
  cuadrosDespuesDelSplashSinTeclado: revision.posterioresSinTeclado,
  fallas: revision.fallas,
  cuadros: revision.cuadros,
};
writeFileSync(path.join(CARPETA, 'resumen.json'), JSON.stringify(resumen, null, 2));
const TECLADO = { true: ', con teclado', false: ', sin teclado', null: ', teclado sin saber' };
for (const f of revision.cuadros) {
  const teclado = 'teclado' in f ? TECLADO[String(f.teclado)] : '';
  console.log(
    `${f.cuadro}: ${f.error ?? `${f.fase}, fondo fuera del centro ${f.fondoFueraDelCentro}, blanco ${f.blanco}, barras ${f.franjaArriba}/${f.franjaAbajo}${teclado}`}`,
  );
}
if (revision.splash) console.log(`Splash desde ${revision.splash}.`);
if (revision.primeraPantalla) {
  console.log(
    `Primera pantalla en ${revision.primeraPantalla}: ${revision.posteriores} cuadros despues del splash, ${revision.posterioresSinTeclado} sin teclado.`,
  );
  if (revision.posterioresSinTeclado === 0) {
    console.log(
      '::warning::Todos los cuadros despues del splash tienen el teclado a la vista: la franja de la barra de navegacion de la primera pantalla quedo sin revisar.',
    );
  }
}
if (revision.fallas.length) {
  for (const f of revision.fallas) console.log(`::error::Al arrancar: ${f}`);
  process.exit(1);
}
console.log('Arranque sin destello blanco.');
