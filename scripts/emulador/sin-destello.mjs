// Revisa la rafaga de capturas del arranque que toma recorrido.sh: desde que
// aparece el splash (fondo #050B18) hasta la primera pantalla no puede haber un
// cuadro mayormente blanco. Ese destello es el que dejaban el fondo blanco del
// WebView antes de pintar, el ?android:colorBackground del splash con el
// telefono en claro o la ventana nativa clara detras de las barras.
//
// Uso: node scripts/emulador/sin-destello.mjs <carpeta con 01.png, 02.png...>
// Sin dependencias: decodifica los PNG de `adb exec-out screencap -p` (8 bits,
// RGB o RGBA, sin entrelazar) con zlib de Node.
//
// Los cuadros de antes del splash son el lanzador y no cuentan. Se revisa
// desde el splash o, si la rafaga no lo alcanzo a ver, desde el primer cuadro
// mayormente oscuro (la app ya pinta). Falla si un cuadro revisado tiene mas
// de BLANCO_MAXIMO de pixeles casi blancos en toda la pantalla (un dialogo del
// sistema del emulador tapa menos; un destello, casi todo) o en la franja de
// la barra de estado o de la de navegacion (la ventana clara detras de las
// barras). Tambien falla si ningun cuadro es oscuro: la app no aparecio.
//
// Es un muestreo: cada captura del emulador tarda del orden de medio segundo,
// asi que un destello de pocos cuadros puede caer entre dos. Atrapa lo que
// dura (un WebView blanco hasta que pinta, una franja clara fija), no prueba
// que no haya ningun cuadro blanco.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const CARPETA = process.argv[2];
if (!CARPETA) {
  console.error('Uso: node scripts/emulador/sin-destello.mjs <carpeta>');
  process.exit(2);
}
const FONDO = [5, 11, 24]; // #050B18, kiramo_fondo
const TOLERANCIA_FONDO = 14;
const SPLASH_MINIMO = 0.6; // fraccion de pixeles del color del fondo para decir "es el splash"
const BLANCO_MAXIMO = 0.6;
const OSCURO_MINIMO = 0.6; // fraccion de pixeles oscuros para decir "la app ya pinta"
const FRANJA_ARRIBA = 0.03; // alto de la barra de estado, aproximado
const FRANJA_ABAJO = 0.05; // alto de la barra de navegacion, aproximado
const PASO = 4; // se mira uno de cada PASO pixeles por fila y por columna

function decodificarPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es un PNG');
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
  const c = { total: 0, fondo: 0, oscuro: 0, blanco: 0, arriba: 0, blancoArriba: 0, abajo: 0, blancoAbajo: 0 };
  for (let y = 0; y < alto; y += PASO) {
    for (let x = 0; x < ancho; x += PASO) {
      const k = (y * ancho + x) * bpp;
      const [r, g, b] = [pix[k], pix[k + 1], pix[k + 2]];
      const esBlanco = r > 230 && g > 230 && b > 230;
      c.total++;
      if (Math.abs(r - FONDO[0]) <= TOLERANCIA_FONDO && Math.abs(g - FONDO[1]) <= TOLERANCIA_FONDO && Math.abs(b - FONDO[2]) <= TOLERANCIA_FONDO) c.fondo++;
      if (Math.max(r, g, b) < 60) c.oscuro++;
      if (esBlanco) c.blanco++;
      if (y < arriba) {
        c.arriba++;
        if (esBlanco) c.blancoArriba++;
      } else if (y >= abajo) {
        c.abajo++;
        if (esBlanco) c.blancoAbajo++;
      }
    }
  }
  return {
    fondo: c.fondo / c.total,
    oscuro: c.oscuro / c.total,
    blanco: c.blanco / c.total,
    franjaArriba: c.arriba ? c.blancoArriba / c.arriba : 0,
    franjaAbajo: c.abajo ? c.blancoAbajo / c.abajo : 0,
  };
}

const cuadros = readdirSync(CARPETA)
  .filter((n) => /^\d+\.png$/.test(n))
  .sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]));

const resumen = { cuadros: [], splash: null, desde: null, fallas: [] };
let visto = false;
let revisando = false;
for (const nombre of cuadros) {
  let m;
  try {
    m = medir(decodificarPng(readFileSync(path.join(CARPETA, nombre))));
  } catch (e) {
    resumen.cuadros.push({ cuadro: nombre, error: e.message });
    continue;
  }
  const fila = { cuadro: nombre };
  for (const [k, v] of Object.entries(m)) fila[k] = Number(v.toFixed(3));
  resumen.cuadros.push(fila);
  if (!visto && m.fondo >= SPLASH_MINIMO) {
    visto = true;
    resumen.splash = nombre;
  }
  if (!revisando && (visto || m.oscuro >= OSCURO_MINIMO)) {
    revisando = true;
    resumen.desde = nombre;
  }
  if (!revisando) continue;
  if (m.blanco > BLANCO_MAXIMO) resumen.fallas.push(`${nombre}: ${Math.round(m.blanco * 100)} % de la pantalla casi blanca`);
  if (m.franjaArriba > BLANCO_MAXIMO) resumen.fallas.push(`${nombre}: la franja de la barra de estado es casi blanca`);
  if (m.franjaAbajo > BLANCO_MAXIMO) resumen.fallas.push(`${nombre}: la franja de la barra de navegacion es casi blanca`);
}
if (!revisando) resumen.fallas.push('ningun cuadro de la rafaga muestra la app: no aparecio el splash ni una pantalla oscura');

writeFileSync(path.join(CARPETA, 'resumen.json'), JSON.stringify(resumen, null, 2));
for (const f of resumen.cuadros) {
  console.log(`${f.cuadro}: ${f.error ?? `fondo ${f.fondo}, oscuro ${f.oscuro}, blanco ${f.blanco}, barras ${f.franjaArriba}/${f.franjaAbajo}`}`);
}
if (!visto) console.log('::warning::No aparecio el splash en ninguna captura del arranque (la rafaga pudo llegar tarde).');
else console.log(`Splash en ${resumen.splash}.`);
if (resumen.desde) console.log(`Revisado desde ${resumen.desde}.`);
if (resumen.fallas.length) {
  for (const f of resumen.fallas) console.log(`::error::Al arrancar: ${f}`);
  process.exit(1);
}
console.log('Arranque sin destello blanco.');
