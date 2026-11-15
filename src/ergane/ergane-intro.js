// Intro de marca de Ergane para los sitios: la E tejida se arma en 3D, se desteje y vuelve a
// tejerse en la marca del sitio, que termina nitida con su color, su letra y su dominio.
//
//   import { mostrarIntroErgane } from "./ergane-intro.js";
//   mostrarIntroErgane({ destino, marcaErgane });   // devuelve "mostrada" u "omitida"
//
// Reglas que cumple sola, para que ningun sitio tenga que acordarse:
// - Sale una vez por navegador (localStorage); con ?intro-ergane=1 en la URL sale siempre.
// - Se salta con el boton "Saltar", con Esc o tocando la pantalla.
// - Si el equipo pide menos movimiento, si no hay WebGL o si three tarda en cargar, no sale.
// - No inyecta <style> ni usa fuentes ni imagenes externas: funciona con CSP estrictas.
// - three se carga con import() dinamico: no pesa en la carga inicial del sitio.

const CLAVE = "ergane-intro-vista";
const AZUL = [47, 111, 143];
const VERDE = [35, 82, 74];
const ERGANE = { fondo: "#F2F4F0", tinta: "#1B2420", tintaSuave: "#55635C", dominio: "ergane.cr" };

const T = {
  palo: [0.05, 0.07, 0.7],
  brazos: [0.42, 0.13, 0.05, 0.75],
  rotulo: [1.05, 1.4, 1.85, 2.05],
  retejeIni: 2.0,
  retejeVentana: 0.75,
  vuelo: 0.8,
  nitido: [3.55, 4.1],
  fondo: [3.1, 3.95],
  ficha: 3.95,
  firma: 4.2,
  fin: 5.0, // la marca queda quieta un momento antes de irse
};
const SALIDA_MS = 350;
const SALTO_MS = 200;

// ------------------------------------------------------------------ ayudas

function curva(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (sx(m) < x) lo = m; else hi = m;
    }
    return sy((lo + hi) / 2);
  };
}
const salida = curva(0.23, 1, 0.32, 1);
const vaiven = curva(0.77, 0, 0.175, 1);
const tramo = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const mezcla = (a, b, e) => a + (b - a) * e;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function azar(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function leerVista(clave) {
  try { return localStorage.getItem(clave) === "1"; } catch { return false; }
}
function guardarVista(clave) {
  try { localStorage.setItem(clave, "1"); } catch { /* sin almacenamiento: volvera a salir */ }
}

function hayWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

function conTope(promesa, ms) {
  return Promise.race([promesa, new Promise((_, no) => setTimeout(() => no(new Error("tiempo agotado")), ms))]);
}

// ------------------------------------------------------------------ marcas a lienzo

function lienzoDe(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c;
}

async function svgALienzo(url, ladoMax) {
  const texto = await (await fetch(url)).text();
  const doc = new DOMParser().parseFromString(texto, "image/svg+xml");
  const svg = doc.documentElement;
  const vb = (svg.getAttribute("viewBox") || `0 0 ${parseFloat(svg.getAttribute("width")) || 100} ${parseFloat(svg.getAttribute("height")) || 100}`)
    .trim().split(/[\s,]+/).map(Number);
  const aspecto = vb[2] / vb[3];
  const w = aspecto >= 1 ? ladoMax : Math.round(ladoMax * aspecto);
  const h = aspecto >= 1 ? Math.round(ladoMax / aspecto) : ladoMax;
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  // Primero como blob (respeta el tamano pedido); si la CSP no admite blob:, la URL directa.
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
  const u = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = u;
    await img.decode();
    return lienzoDe(img, w, h);
  } catch {
    const img = new Image(w, h);
    img.src = url;
    await img.decode();
    return lienzoDe(img, w, h);
  } finally {
    URL.revokeObjectURL(u);
  }
}

// La fuente puede venir como "700 {px}px var(--mi-fuente)": se resuelve la variable CSS,
// porque el canvas no entiende var() (pasa con next/font, que genera nombres de familia).
function resolverFuente(fuente, px) {
  const raiz = getComputedStyle(document.documentElement);
  return fuente.replace("{px}", px).replace(/var\((--[\w-]+)\)/g, (_, v) => raiz.getPropertyValue(v).trim() || "sans-serif");
}

async function textoALienzo(m) {
  const px = 200;
  const fuente = resolverFuente(m.fuente, px);
  try { await document.fonts.load(fuente, m.texto); } catch { /* se dibuja con la de respaldo */ }
  const c = document.createElement("canvas");
  const preparar = (x) => {
    x.font = fuente;
    x.letterSpacing = `${(m.espaciado || 0) * px}px`;
    x.textBaseline = "alphabetic";
  };
  let x = c.getContext("2d");
  preparar(x);
  const med = x.measureText(m.texto);
  const asc = med.actualBoundingBoxAscent;
  const desc = med.actualBoundingBoxDescent;
  const pad = Math.round(px * 0.1);
  const barraSep = m.barra ? px * 0.2 : 0;
  const barraAlto = m.barra ? px * 0.085 : 0;
  c.width = Math.ceil(med.width + pad * 2);
  c.height = Math.ceil(asc + desc + pad * 2 + barraSep + barraAlto);
  x = c.getContext("2d");
  preparar(x);
  x.fillStyle = m.color;
  x.fillText(m.texto, pad, pad + asc);
  if (m.barra) {
    x.fillStyle = m.barra;
    x.fillRect(pad + px * 0.02, pad + asc + desc + barraSep, px * 2.67, barraAlto);
  }
  return c;
}

function muestrear(c, gw, gh, ancho, alto, esFondo = () => false) {
  const { width: W, height: H } = c;
  const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const celdas = [];
  const N = 6;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = Math.min(W - 1, Math.floor(((i + (sx + 0.5) / N) * W) / gw));
          const y = Math.min(H - 1, Math.floor(((j + (sy + 0.5) / N) * H) / gh));
          const k = (y * W + x) * 4;
          if (esFondo(d[k], d[k + 1], d[k + 2])) continue;
          const al = d[k + 3] / 255;
          r += d[k] * al; g += d[k + 1] * al; b += d[k + 2] * al; a += al;
        }
      }
      if (a / (N * N) < 0.42) continue;
      celdas.push({
        x: ((i + 0.5) / gw - 0.5) * ancho, y: -((j + 0.5) / gh - 0.5) * alto, z: 0,
        w: ancho / gw, h: alto / gh, color: [r / a, g / a, b / a],
        urdimbre: (i + j) % 2 === 0, fila: gh - 1 - j, col: i,
      });
    }
  }
  return celdas;
}

// La E con su geometria real: palo de 3 hilos verticales, tres brazos y el cruce del logo.
function construirE(c) {
  const { width: W, height: H } = c;
  const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const clase = (x, y) => {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 128) return 0;
    const da = (d[i] - AZUL[0]) ** 2 + (d[i + 1] - AZUL[1]) ** 2 + (d[i + 2] - AZUL[2]) ** 2;
    const dv = (d[i] - VERDE[0]) ** 2 + (d[i + 1] - VERDE[1]) ** 2 + (d[i + 2] - VERDE[2]) ** 2;
    if (Math.min(da, dv) > 26 * 26) return 0;
    return da < dv ? 1 : 2;
  };
  const colA = new Array(W).fill(0), colV = new Array(W).fill(0), filA = new Array(H).fill(0), filV = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = clase(x, y);
      if (k === 1) { colA[x]++; filA[y]++; } else if (k === 2) { colV[x]++; filV[y]++; }
    }
  }
  const extremos = (arr) => {
    const max = Math.max(...arr);
    if (max === 0) return [-1, -1];
    const a = arr.findIndex((n) => n >= max * 0.3);
    let b = arr.length - 1;
    while (b > 0 && arr[b] < max * 0.3) b--;
    return [a, b];
  };
  const [bx0, bx1] = extremos(colA);
  const [by0, by1] = extremos(filA);
  const [gx0, gx1] = extremos(colV);
  const [gy0, gy1] = extremos(filV);
  if (bx1 < 0 || gx1 < 0) return null;

  const xs = Math.round((bx1 + gx1) / 2);
  const corridas = [];
  let dentro = false, ini = 0;
  for (let y = 0; y <= H; y++) {
    const v = y < H && clase(xs, y) === 2;
    if (v && !dentro) { dentro = true; ini = y; }
    if (!v && dentro) { dentro = false; if (y - ini > 3) corridas.push([ini, y - 1]); }
  }
  if (corridas.length !== 3) return null;

  const xc = Math.round((bx0 + bx1) / 2);
  const brazos = corridas.map(([y0, y1]) => {
    const yc = Math.round((y0 + y1) / 2);
    let x0 = W, x1 = -1;
    for (let x = 0; x < W; x++) if (clase(x, yc) === 2) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    if (x1 < 0) { x0 = gx0; x1 = gx1; }
    return { y0, y1, x0, x1, encima: clase(xc, yc) === 2 };
  });

  const ux0 = Math.min(bx0, gx0), ux1 = Math.max(bx1, gx1), uy0 = Math.min(by0, gy0), uy1 = Math.max(by1, gy1);
  const ALTO = 1.85;
  const s = ALTO / (uy1 - uy0 + 1);
  const cx = (ux0 + ux1 + 1) / 2, cy = (uy0 + uy1 + 1) / 2;
  const aMundo = (px, py) => [(px - cx) * s, -(py - cy) * s];
  const hilosPalo = 3;
  const uPx = (bx1 - bx0 + 1) / hilosPalo;
  const filasPalo = Math.max(6, Math.round((by1 - by0 + 1) / uPx));
  const wp = (bx1 - bx0 + 1) / hilosPalo, hp = (by1 - by0 + 1) / filasPalo;
  const prof = uPx * s * 0.2;
  const celdas = [];
  for (let col = 0; col < hilosPalo; col++) {
    for (let fila = 0; fila < filasPalo; fila++) {
      const px = bx0 + (col + 0.5) * wp, py = by0 + (fila + 0.5) * hp;
      const b = brazos.find((q) => py >= q.y0 && py <= q.y1);
      const [x, y] = aMundo(px, py);
      celdas.push({ x, y, z: b ? (b.encima ? -prof : prof) : 0, w: wp * s, h: hp * s, color: AZUL, urdimbre: true, parte: "palo", hilo: col, orden: fila });
    }
  }
  brazos.forEach((b, k) => {
    const filas = Math.max(2, Math.round((b.y1 - b.y0 + 1) / uPx));
    const cols = Math.max(6, Math.round((b.x1 - b.x0 + 1) / uPx));
    const hb = (b.y1 - b.y0 + 1) / filas, wb = (b.x1 - b.x0 + 1) / cols;
    for (let fila = 0; fila < filas; fila++) {
      for (let col = 0; col < cols; col++) {
        const px = b.x0 + (col + 0.5) * wb, py = b.y0 + (fila + 0.5) * hb;
        const sobrePalo = px - wb / 2 < bx1 && px + wb / 2 > bx0;
        const [x, y] = aMundo(px, py);
        celdas.push({ x, y, z: sobrePalo ? (b.encima ? prof : -prof) : 0, w: wb * s, h: hb * s, color: VERDE, urdimbre: false, parte: "brazo", brazo: k, hilo: fila, orden: col });
      }
    }
  });
  return { celdas, ancho: (ux1 - ux0 + 1) * s, alto: ALTO, recorte: [ux0, uy0, ux1 - ux0 + 1, uy1 - uy0 + 1] };
}

function eMosaico(c) {
  const esFondo = (r, g, b) => (r - 242) ** 2 + (g - 244) ** 2 + (b - 240) ** 2 < 30 * 30;
  const celdas = muestrear(c, 40, 40, 2.6, 2.6, esFondo).map((q) => ({
    ...q, urdimbre: q.color[2] > q.color[1] + 20, parte: q.color[2] > q.color[1] + 20 ? "palo" : "brazo",
    brazo: 0, hilo: q.col, orden: q.fila,
  }));
  return { celdas, ancho: 2.6, alto: 2.6, recorte: [0, 0, c.width, c.height] };
}

async function construirMarca(destino) {
  const esTexto = destino.marca.tipo === "texto";
  const c = esTexto ? await textoALienzo(destino.marca) : await svgALienzo(destino.marca.url, 1024);
  const aspecto = c.width / c.height;
  let ancho, alto;
  if (esTexto) { ancho = 3.4; alto = ancho / aspecto; }
  else if (aspecto >= 1) { ancho = 1.75; alto = 1.75 / aspecto; }
  else { alto = 1.75; ancho = 1.75 * aspecto; }
  const celdaPx = esTexto ? c.height / 12 : Math.max(c.width, c.height) / 30;
  const gw = Math.max(4, Math.round(c.width / celdaPx));
  const gh = Math.max(4, Math.round(c.height / celdaPx));
  return { celdas: muestrear(c, gw, gh, ancho, alto), ancho, alto, filas: gh, lienzo: c };
}

function prepararVuelos(E, M) {
  const rnd = azar(20261115);
  const nE = E.celdas.map((q) => [q.x / E.ancho, q.y / E.alto]);
  const vuelos = E.celdas.map((q) => ({ desde: q, hacia: null, retraso: 0, extra: false, sobra: false }));
  for (const t of M.celdas) {
    const u = t.x / M.ancho, v = t.y / M.alto;
    let mejor = 0, md = Infinity;
    for (let k = 0; k < nE.length; k++) {
      const dd = (nE[k][0] - u) ** 2 + (nE[k][1] - v) ** 2;
      if (dd < md) { md = dd; mejor = k; }
    }
    const retraso = T.retejeVentana * (t.fila / Math.max(1, M.filas - 1)) + 0.12 * rnd();
    if (!vuelos[mejor].hacia) Object.assign(vuelos[mejor], { hacia: t, retraso });
    else vuelos.push({ desde: E.celdas[mejor], hacia: t, retraso, extra: true, sobra: false });
  }
  for (const v of vuelos) {
    if (v.hacia) continue;
    const u = v.desde.x / E.ancho, w = v.desde.y / E.alto;
    let mejor = M.celdas[0], md = Infinity;
    for (const t of M.celdas) {
      const dd = (t.x / M.ancho - u) ** 2 + (t.y / M.alto - w) ** 2;
      if (dd < md) { md = dd; mejor = t; }
    }
    v.hacia = mejor;
    v.sobra = true;
    v.retraso = T.retejeVentana * (mejor.fila / Math.max(1, M.filas - 1)) + 0.12 * rnd();
  }
  vuelos.forEach((v, i) => {
    v.eje = rnd() < 0.5 ? "x" : "y";
    v.signo = rnd() < 0.5 ? -1 : 1;
    v.alzada = 0.55 + 0.6 * rnd();
    v.capa = v.extra ? 0.004 * ((i % 7) + 1) : 0;
  });
  return vuelos;
}

function medidas(q) {
  const lado = Math.min(q.w, q.h);
  return q.urdimbre ? [q.w * 0.84, q.h * 0.985, lado * 0.42] : [q.w * 0.985, q.h * 0.84, lado * 0.42];
}
function inclinacion(q) {
  const s = ((q.fila ?? 0) + (q.col ?? 0)) % 2 ? 1 : -1;
  return q.urdimbre ? [0.2 * s, 0] : [0, 0.2 * s];
}
function poseE(q, t) {
  let dx = 0, dy = 0, dz = 0;
  if (q.parte === "palo") {
    const [i0, paso, dur] = T.palo;
    const e = salida(tramo(t, i0 + q.hilo * paso, i0 + q.hilo * paso + dur));
    dy = (1 - e) * 3.4;
    dz = (1 - e) * 0.5;
  } else {
    const [i0, entreBrazos, entreHilos, dur] = T.brazos;
    const a = i0 + q.brazo * entreBrazos + q.hilo * entreHilos;
    const e = salida(tramo(t, a, a + dur));
    dx = (1 - e) * 4.8;
    dz = (1 - e) * 0.3;
  }
  return [q.x + dx, q.y + dy, q.z + dz];
}

// ------------------------------------------------------------------ capa en pantalla

function crear(tag, estilos, padre) {
  const el = document.createElement(tag);
  Object.assign(el.style, estilos);
  if (padre) padre.append(el);
  return el;
}

function armarCapa(destino, zIndex) {
  const sistema = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const capa = crear("div", {
    position: "fixed", inset: "0", zIndex: String(zIndex), background: ERGANE.fondo, overflow: "hidden",
    opacity: "1", transition: `opacity ${SALIDA_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`, cursor: "pointer",
    fontFamily: sistema, WebkitFontSmoothing: "antialiased",
  });
  capa.setAttribute("data-ergane-intro", "");
  const lienzo = crear("canvas", { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" }, capa);
  lienzo.setAttribute("aria-hidden", "true");
  const texto = { position: "absolute", left: "16px", right: "16px", textAlign: "center", opacity: "0", pointerEvents: "none" };
  const rotulo = crear("div", { ...texto, fontWeight: "600", fontSize: "15px", letterSpacing: "0.34em", paddingLeft: "0.34em", textTransform: "uppercase", color: ERGANE.tinta }, capa);
  rotulo.textContent = "Ergane";
  rotulo.setAttribute("aria-hidden", "true");
  const ficha = crear("div", { ...texto }, capa);
  const esTexto = destino.marca.tipo === "texto";
  if (!esTexto) {
    const n = crear("div", { fontFamily: destino.fuente || sistema, fontSize: "clamp(22px, 3.2vw, 30px)", fontWeight: "600", letterSpacing: "-0.01em", lineHeight: "1.15", color: destino.tinta }, ficha);
    n.textContent = destino.nombre;
  }
  const linea = crear("div", { fontFamily: destino.fuente || sistema, marginTop: "6px", fontSize: "14px", color: destino.tintaSuave }, ficha);
  linea.append(destino.area || "");
  if (destino.dominio) {
    linea.append(" · ");
    crear("b", { fontWeight: "600", color: destino.tinta }, linea).textContent = destino.dominio;
  }
  const firma = crear("div", {
    ...texto, bottom: "calc(40px + env(safe-area-inset-bottom, 0px))", display: "flex", justifyContent: "center",
    alignItems: "center", gap: "9px", fontSize: "13px", color: destino.tintaSuave,
  }, capa);
  const miniE = crear("canvas", { width: "18px", height: "18px", display: "block" }, firma);
  miniE.width = miniE.height = 54;
  const f1 = crear("span", {}, firma);
  f1.append("Desarrollado por ");
  crear("strong", { fontWeight: "600", color: destino.tinta }, f1).textContent = "Ergane";
  crear("span", {}, firma).textContent = "·";
  crear("span", {}, firma).textContent = ERGANE.dominio;
  const saltar = crear("button", {
    position: "absolute", top: "calc(16px + env(safe-area-inset-top, 0px))", right: "calc(16px + env(safe-area-inset-right, 0px))",
    font: `500 13px ${sistema}`, color: ERGANE.tinta, background: "rgba(255,255,255,0.55)", border: "1px solid rgba(27,36,32,0.14)",
    borderRadius: "999px", padding: "8px 14px", minHeight: "36px", cursor: "pointer",
  }, capa);
  saltar.type = "button";
  saltar.textContent = "Saltar";
  saltar.setAttribute("aria-label", "Saltar la intro");
  return { capa, lienzo, rotulo, ficha, firma, miniE, saltar };
}

// ------------------------------------------------------------------ entrada publica

export async function mostrarIntroErgane(opciones) {
  const {
    destino,
    marcaErgane,
    clave = CLAVE,
    siempre = false,
    forzar = false,
    tiempoFijo = null,
    velocidad = 1,
    esperaMaxima = 2500,
    zIndex = 2147483000,
  } = opciones;
  if (typeof window === "undefined" || !destino || !marcaErgane) return "omitida";

  const params = new URLSearchParams(window.location.search);
  const pedidaEnUrl = params.get("intro-ergane") === "1";
  if (!siempre && !pedidaEnUrl && leerVista(clave)) return "omitida";
  if (!forzar && !pedidaEnUrl && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "omitida";
  if (!hayWebGL()) return "omitida";

  const ui = armarCapa(destino, zIndex);
  const raiz = document.documentElement;
  const overflowPrevio = raiz.style.overflow;
  raiz.style.overflow = "hidden";
  document.body.append(ui.capa);

  // Saltar, Esc y el toque funcionan desde que la capa aparece, tambien mientras carga three.
  let terminado = false;
  let idCuadro = 0;
  let ajustarRef = null;
  let limpiar = () => {};
  let alCerrar = () => {};
  const resultado = new Promise((r) => { alCerrar = r; });
  const cerrar = (ms, como = "mostrada", recordar = true) => {
    if (terminado) return;
    terminado = true;
    cancelAnimationFrame(idCuadro);
    if (recordar) guardarVista(clave);
    window.removeEventListener("keydown", tecla);
    if (ajustarRef) window.removeEventListener("resize", ajustarRef);
    ui.capa.style.transition = `opacity ${ms}ms cubic-bezier(0.23, 1, 0.32, 1)`;
    ui.capa.style.opacity = "0";
    ui.capa.style.pointerEvents = "none";
    raiz.style.overflow = overflowPrevio;
    setTimeout(() => {
      ui.capa.remove();
      limpiar();
      alCerrar(como);
    }, ms + 30);
  };
  const tecla = (ev) => { if (ev.key === "Escape") cerrar(SALTO_MS); };
  window.addEventListener("keydown", tecla);
  ui.capa.addEventListener("click", () => cerrar(SALTO_MS));

  let THREE, E, M, lienzoE;
  const SALTADA = Symbol("saltada");
  const carga = conTope(Promise.all([
    import("three"),
    svgALienzo(marcaErgane, 512),
    construirMarca(destino),
  ]), esperaMaxima);
  carga.catch(() => {}); // si la saltan antes, que un rechazo tardio no quede sin atender
  try {
    // Si la saltan mientras carga, quien llamo no espera a que termine de bajar three.
    const primero = await Promise.race([carga, resultado.then(() => SALTADA)]);
    if (primero === SALTADA) return resultado;
    [THREE, lienzoE, M] = primero;
    E = construirE(lienzoE) || eMosaico(lienzoE);
  } catch {
    // no cargo a tiempo: se retira sin marcarla como vista, para que salga en otra visita
    cerrar(0, "omitida", false);
    return resultado;
  }
  if (terminado) return resultado; // la saltaron mientras cargaba

  // la E chica de la firma, dibujada en un canvas (sin imagenes data: por la CSP)
  {
    const [rx, ry, rw, rh] = E.recorte;
    const lado = Math.max(rw, rh);
    const x = ui.miniE.getContext("2d");
    x.drawImage(lienzoE, rx - (lado - rw) / 2, ry - (lado - rh) / 2, lado, lado, 0, 0, 54, 54);
    const im = x.getImageData(0, 0, 54, 54);
    for (let i = 0; i < im.data.length; i += 4) {
      const d = im.data;
      if ((d[i] - 242) ** 2 + (d[i + 1] - 244) ** 2 + (d[i + 2] - 240) ** 2 < 26 * 26) d[i + 3] = 0;
    }
    x.putImageData(im, 0, 0);
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: ui.lienzo, antialias: true, alpha: true, preserveDrawingBuffer: tiempoFijo !== null });
  } catch {
    cerrar(0, "omitida", false);
    return resultado;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const escena = new THREE.Scene();
  const ALTO_VISIBLE = 3.6, FOV = 28;
  const DISTANCIA = (ALTO_VISIBLE / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const camara = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camara.position.set(0, 0, DISTANCIA);
  escena.add(new THREE.HemisphereLight(0xffffff, 0xd9e1dd, 2.4));
  const sol = new THREE.DirectionalLight(0xffffff, 1.35);
  sol.position.set(-2.5, 3.5, 6);
  escena.add(sol);
  const grupo = new THREE.Group();
  escena.add(grupo);
  const CENTRO_Y = 0.24;

  const vuelos = prepararVuelos(E, M);
  const caja = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, transparent: true });
  const malla = new THREE.InstancedMesh(caja, material, vuelos.length);
  malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  malla.setColorAt(0, new THREE.Color(1, 1, 1));
  malla.frustumCulled = false;
  grupo.add(malla);
  const textura = new THREE.CanvasTexture(M.lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const zPlano = 0.06;
  const corr = (DISTANCIA - zPlano) / DISTANCIA;
  const plano = new THREE.Mesh(
    new THREE.PlaneGeometry(M.ancho * corr, M.alto * corr),
    new THREE.MeshBasicMaterial({ map: textura, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
  );
  plano.position.z = zPlano;
  plano.renderOrder = 2;
  grupo.add(plano);

  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), rot = new THREE.Quaternion();
  const eul = new THREE.Euler(), esc = new THREE.Vector3(), col = new THREE.Color();
  const poner = (i, x, y, z, rx, ry, sx, sy, sz, rgb) => {
    pos.set(x, y, z);
    eul.set(rx, ry, 0);
    rot.setFromEuler(eul);
    esc.set(sx, sy, sz);
    m4.compose(pos, rot, esc);
    malla.setMatrixAt(i, m4);
    col.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
    malla.setColorAt(i, col);
  };
  const fundir = (el, o, dy) => {
    el.style.opacity = o.toFixed(3);
    el.style.transform = `translateY(${dy.toFixed(2)}px)`;
  };
  const f0 = hexRgb(ERGANE.fondo), f1 = hexRgb(destino.fondo);

  const ajustar = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
    const anchoVisible = ALTO_VISIBLE * camara.aspect;
    const escala = Math.min(1, (anchoVisible * 0.84) / Math.max(E.ancho, M.ancho), (ALTO_VISIBLE * 0.6) / Math.max(E.alto, M.alto));
    grupo.scale.setScalar(escala);
    grupo.position.set(0, CENTRO_Y, 0);
    camara.updateMatrixWorld();
    const debajo = (alto) => ((1 - new THREE.Vector3(0, CENTRO_Y - (alto / 2) * escala, 0).project(camara).y) / 2) * h;
    ui.rotulo.style.top = `${Math.round(debajo(E.alto) + 22)}px`;
    ui.ficha.style.top = `${Math.round(debajo(M.alto) + 26)}px`;
  };

  const dibujar = (t) => {
    const e0 = salida(tramo(t, 0, 1.6));
    const r = Math.sin(Math.PI * tramo(t, T.retejeIni, 3.9));
    grupo.rotation.set(mezcla(0.32, 0, e0) - 0.05 * r, mezcla(-0.62, 0, e0) + 0.16 * r, 0);
    const nit = vaiven(tramo(t, ...T.nitido));
    material.opacity = 1 - nit;
    malla.visible = nit < 0.999;
    plano.material.opacity = nit;
    plano.visible = nit > 0.001;
    const aplanar = 1 - nit;
    for (let i = 0; i < vuelos.length; i++) {
      const v = vuelos[i];
      const a = v.desde, b = v.hacia;
      const [aw, ah, ad] = medidas(a);
      const [bw, bh, bd] = medidas(b);
      const [bix, biy] = inclinacion(b);
      if (t < T.retejeIni) {
        if (v.extra) { poner(i, a.x, a.y, a.z, 0, 0, 0, 0, 0, a.color); continue; }
        const [x, y, z] = poseE(a, t);
        poner(i, x, y, z, 0, 0, aw, ah, ad, a.color);
        continue;
      }
      const local = t - T.retejeIni - v.retraso;
      if (local < 0) {
        if (v.extra) { poner(i, a.x, a.y, a.z, 0, 0, 0, 0, 0, a.color); continue; }
        poner(i, a.x, a.y, a.z, 0, 0, aw, ah, ad, a.color);
        continue;
      }
      const p = Math.min(1, local / T.vuelo);
      const e = vaiven(p);
      const z = mezcla(a.z, b.z, e) + v.alzada * Math.sin(Math.PI * e) + v.capa;
      const vuelta = Math.PI * e * v.signo;
      let k = 1;
      if (v.extra) k *= mezcla(0.5, 1, salida(tramo(p, 0, 0.35)));
      if (v.sobra) k *= 1 - salida(tramo(p, 0.35, 1));
      poner(
        i, mezcla(a.x, b.x, e), mezcla(a.y, b.y, e), z * (p < 1 ? 1 : aplanar),
        (v.eje === "x" ? vuelta : 0) + bix * e * aplanar, (v.eje === "y" ? vuelta : 0) + biy * e * aplanar,
        mezcla(aw, bw, e) * k, mezcla(ah, bh, e) * k, mezcla(ad, bd, e) * k,
        [mezcla(a.color[0], b.color[0], e), mezcla(a.color[1], b.color[1], e), mezcla(a.color[2], b.color[2], e)],
      );
    }
    malla.instanceMatrix.needsUpdate = true;
    if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
    const ef = vaiven(tramo(t, ...T.fondo));
    ui.capa.style.background = `rgb(${f0.map((c, i) => Math.round(mezcla(c, f1[i], ef))).join(" ")})`;
    const [r0, r1, r2, r3] = T.rotulo;
    fundir(ui.rotulo, salida(tramo(t, r0, r1)) * (1 - salida(tramo(t, r2, r3))), (1 - salida(tramo(t, r0, r1))) * 8);
    const ef2 = salida(tramo(t, T.ficha, T.ficha + 0.45));
    fundir(ui.ficha, ef2, (1 - ef2) * 8);
    const ef3 = salida(tramo(t, T.firma, T.firma + 0.45));
    fundir(ui.firma, ef3, (1 - ef3) * 6);
    ui.saltar.style.opacity = String(1 - ef3);
    renderer.render(escena, camara);
  };

  limpiar = () => {
    caja.dispose();
    material.dispose();
    textura.dispose();
    plano.geometry.dispose();
    plano.material.dispose();
    malla.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  ajustar();
  ajustarRef = ajustar;
  window.addEventListener("resize", ajustar);

  if (tiempoFijo !== null) { dibujar(tiempoFijo); return resultado; } // capturas: queda quieta en ese cuadro

  // El reloj arranca en el primer cuadro dibujado: si la pestana se abrio en segundo plano,
  // la intro empieza cuando se ve, no a mitad de camino.
  let t0 = null;
  const cuadro = (ahora) => {
    if (terminado) return;
    if (t0 === null) t0 = ahora;
    const t = ((ahora - t0) / 1000) * velocidad;
    dibujar(Math.min(t, T.fin));
    if (t < T.fin) idCuadro = requestAnimationFrame(cuadro);
    else cerrar(SALIDA_MS);
  };
  idCuadro = requestAnimationFrame(cuadro);
  return resultado;
}
