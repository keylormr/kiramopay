// Recorre la app instalada en el emulador por la depuracion del WebView: el
// socket webview_devtools_remote_<pid> llevado a un puerto local con adb forward
// y el protocolo de Chrome DevTools. Sin dependencias: fetch y WebSocket de
// Node 22. Lo llama scripts/emulador/recorrido.sh.
//
// Uso: node scripts/emulador/recorrido.mjs <carpeta de salida>
//
// El APK sale con VITE_API_URL vacio: la app usa los datos simulados de la
// demostracion. El acceso igual pasa por HTTP (src/api/index.ts: el login
// siempre va al servidor), a http://localhost:8080 dentro del emulador, donde
// no hay nada. Este guion intercepta esas llamadas en el WebView (Fetch del
// protocolo) y contesta como el stub de e2e/helpers.ts: ninguna sale del
// emulador, y nunca hacia produccion. Si alguna llamada intentara ir a
// api.kiramopay.com, el recorrido falla.
//
// Pasos: entrar con la cuenta de demostracion, Inicio, Movimientos, Exportar >
// CSV (debe abrirse el menu de compartir de Android; se cierra con Atras y no
// debe aparecer "Exportado exitosamente"), Cripto y Perfil. Una captura por
// paso con adb exec-out screencap.
//
// No toca los avisos: un APK sin google-services.json se cierra al pedirlos, y
// este build no lleva VITE_PUSH_NATIVO, asi que la app ni siquiera los ofrece.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SALIDA = process.argv[2] ?? 'capturas';
const PAQUETE = 'com.kiramopay.app';
const ORIGEN = 'https://app.kiramopay.com';
const API_SIMULADA = 'http://localhost:8080';
const PUERTO = 9222;
// La capa web se compila con el objetivo por defecto de Vite 6 (chrome87). Un
// WebView anterior no puede correrla: la imagen del emulador de Android 7 trae
// el de fabrica, y un telefono real con Android 7 lo actualiza por Play Store.
const WEBVIEW_MINIMO = 87;
const API_LEVEL = Number(process.env.API_LEVEL || 0);

mkdirSync(SALIDA, { recursive: true });
const resumen = { api: API_LEVEL, webview: process.env.WEBVIEW_VERSION || null, pasos: [], red: [] };

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\r/g, '');

let numero = 0;
function captura(nombre) {
  numero += 1;
  const archivo = `${String(numero).padStart(2, '0')}-${nombre}.png`;
  const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(path.join(SALIDA, archivo), png);
  return archivo;
}

function paso(nombre, datos = {}) {
  resumen.pasos.push({ paso: nombre, ...datos });
  console.log(`[ok] ${nombre}${datos.captura ? ` (${datos.captura})` : ''}`);
}

function guardarResumen() {
  writeFileSync(path.join(SALIDA, 'recorrido.json'), JSON.stringify(resumen, null, 2));
}

// ── Protocolo de DevTools ────────────────────────────────────────────────────

class Cdp {
  constructor(url) {
    this.url = url;
    this.siguiente = 1;
    this.pendientes = new Map();
    this.oyentes = new Map();
  }

  conectar() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error(`WebSocket: ${e.message ?? 'error'}`)));
      this.ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
        if (msg.id && this.pendientes.has(msg.id)) {
          const { resolve: ok, reject: mal } = this.pendientes.get(msg.id);
          this.pendientes.delete(msg.id);
          if (msg.error) mal(new Error(`${msg.error.message} (${msg.error.code})`));
          else ok(msg.result);
        } else if (msg.method) {
          for (const fn of this.oyentes.get(msg.method) ?? []) fn(msg.params);
        }
      });
    });
  }

  enviar(method, params = {}) {
    const id = this.siguiente++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pendientes.set(id, { resolve, reject }));
  }

  en(evento, fn) {
    if (!this.oyentes.has(evento)) this.oyentes.set(evento, []);
    this.oyentes.get(evento).push(fn);
  }

  async evaluar(expresion) {
    const r = await this.enviar('Runtime.evaluate', { expression: expresion, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
    return r.result.value;
  }

  cerrar() {
    try {
      this.ws.close();
    } catch {
      /* ya cerrado */
    }
  }
}

async function hasta(descripcion, fn, { ms = 30000, cada = 500 } = {}) {
  const fin = Date.now() + ms;
  let ultimo;
  while (Date.now() < fin) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      ultimo = e;
    }
    await esperar(cada);
  }
  throw new Error(`No paso a tiempo: ${descripcion}${ultimo ? ` (${ultimo.message})` : ''}`);
}

// ── Conexion con el WebView de la app ────────────────────────────────────────

function pidDeLaApp() {
  try {
    return adb('shell', 'pidof', PAQUETE).trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

async function conectarAlWebView() {
  const socket = await hasta(
    'aparece el socket de depuracion del WebView',
    () => {
      const pid = pidDeLaApp();
      const sockets = adb('shell', 'cat', '/proc/net/unix')
        .split('\n')
        .map((l) => l.match(/@(webview_devtools_remote_\d+)/)?.[1])
        .filter(Boolean);
      return (pid && sockets.find((s) => s.endsWith(`_${pid}`))) || sockets[0];
    },
    { ms: 90000, cada: 1000 },
  );
  adb('forward', `tcp:${PUERTO}`, `localabstract:${socket}`);
  const pagina = await hasta(
    'el WebView expone la pagina de la app',
    async () => {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json();
      return lista.find((p) => p.type === 'page' && p.url.startsWith(ORIGEN) && p.webSocketDebuggerUrl);
    },
    { ms: 60000, cada: 1000 },
  );
  const cdp = new Cdp(pagina.webSocketDebuggerUrl);
  await cdp.conectar();
  return { cdp, socket, version: await (await fetch(`http://127.0.0.1:${PUERTO}/json/version`)).json() };
}

// ── El servidor que no hay ───────────────────────────────────────────────────

const USUARIO = {
  id: '00000000-0000-0000-0000-000000000001',
  cedula: '702650930',
  phone: '88880000',
  first_name: 'Demo',
  last_name: 'KiramoPay',
  email: 'demo@example.com',
  username: 'demo',
  kyc_level: 0,
  status: 'active',
};

function cabeceraDe(headers, nombre) {
  const clave = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === nombre);
  return clave ? headers[clave] : undefined;
}

function respuestaSimulada(req) {
  const url = new URL(req.url);
  if (url.pathname === '/api/v1/auth/login') {
    let password = '';
    try {
      password = JSON.parse(req.postData || '{}').password || '';
    } catch {
      password = '';
    }
    // La pantalla sondea primero sin contrasena para saber si la cuenta entra
    // sin ella: como en e2e/helpers.ts, eso pide la contrasena.
    if (!password) {
      return { status: 401, cuerpo: { success: false, error: { code: 'PASSWORD_REQUIRED', message: 'password required' } } };
    }
    return {
      status: 200,
      cuerpo: {
        success: true,
        data: {
          user: USUARIO,
          tokens: { access_token: 'access-token', refresh_token: 'refresh-token', expires_at: Date.now() + 3_600_000 },
        },
      },
    };
  }
  return { status: 200, cuerpo: { success: true, data: [] } };
}

async function simularServidor(cdp) {
  cdp.en('Fetch.requestPaused', async (ev) => {
    const req = ev.request;
    const origen = cabeceraDe(req.headers, 'origin') || ORIGEN;
    const cors = [
      { name: 'Access-Control-Allow-Origin', value: origen },
      { name: 'Access-Control-Allow-Credentials', value: 'true' },
      { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
      { name: 'Access-Control-Allow-Headers', value: cabeceraDe(req.headers, 'access-control-request-headers') || '*' },
      { name: 'Access-Control-Allow-Private-Network', value: 'true' },
    ];
    try {
      if (req.method === 'OPTIONS') {
        await cdp.enviar('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 204, responseHeaders: cors });
        return;
      }
      const { status, cuerpo } = respuestaSimulada(req);
      await cdp.enviar('Fetch.fulfillRequest', {
        requestId: ev.requestId,
        responseCode: status,
        responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(cuerpo)).toString('base64'),
      });
    } catch (e) {
      console.log(`No se pudo contestar ${req.method} ${req.url}: ${e.message}`);
    }
  });
  await cdp.enviar('Fetch.enable', { patterns: [{ urlPattern: `${API_SIMULADA}/*`, requestStage: 'Request' }] });

  // Todo lo que pide la app queda anotado, y nada puede ir a produccion.
  cdp.en('Network.requestWillBeSent', (ev) => {
    resumen.red.push(`${ev.request.method} ${ev.request.url.slice(0, 160)}`);
  });
  await cdp.enviar('Network.enable');
}

// ── Acciones sobre la pantalla ───────────────────────────────────────────────

/** Toca el primer boton visible con ese texto (exacto, o que empiece asi) o esa etiqueta. */
function tocar(cdp, textos) {
  return cdp.evaluar(`(() => {
    const quiero = ${JSON.stringify(textos)};
    const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const candidatos = [...document.querySelectorAll('button, [role="button"], a')].filter(visible);
    const texto = (e) => (e.innerText || '').trim();
    const el =
      candidatos.find((e) => quiero.some((q) => texto(e) === q || e.getAttribute('aria-label') === q)) ||
      candidatos.find((e) => quiero.some((q) => texto(e).startsWith(q)));
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

function hay(cdp, selector) {
  return cdp.evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
}

function textoVisible(cdp) {
  return cdp.evaluar('document.body ? document.body.innerText : ""');
}

async function escribirEn(cdp, selector, texto) {
  const listo = await cdp.evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.focus(); return document.activeElement === e; })()`);
  if (!listo) throw new Error(`no se pudo enfocar ${selector}`);
  await cdp.enviar('Input.insertText', { text: texto });
}

function enviarFormulario(cdp, selector) {
  return cdp.evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || !e.form) return false; e.form.requestSubmit(); return true; })()`);
}

function actividadArriba() {
  const salida = adb('shell', 'dumpsys', 'activity', 'activities');
  const lineas = salida.split('\n').filter((l) => /ResumedActivity|mFocusedActivity/.test(l));
  return lineas.join('\n');
}

// ── El recorrido ─────────────────────────────────────────────────────────────

async function recorrer(cdp) {
  await simularServidor(cdp);
  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Page.enable');

  // Sin el carrusel de bienvenida ni el aviso de la campana, en espanol; y se
  // recarga para que todo lo que pida la app pase por el servidor simulado.
  await cdp.evaluar(`(() => {
    localStorage.setItem('kiramopay_onboarded', '1');
    localStorage.setItem('kiramopay_language', 'es');
    localStorage.setItem('kiramopay-campana-invitar-2026-09-referidos', '1');
    return true;
  })()`);
  await cdp.enviar('Page.reload', { ignoreCache: true });
  await esperar(1500);

  await hasta('aparece el campo del identificador', () => hay(cdp, 'input[type="text"]'), { ms: 60000 });
  paso('login', { captura: captura('login') });

  // La cuenta de demostracion que siembra el backend en desarrollo
  // (CUENTAS_LOCALES de LoginView); aca la contesta el servidor simulado.
  await escribirEn(cdp, 'input[type="text"]', 'demo');
  await esperar(500);
  // El identificador no va en un <form>: se toca Continuar, como una persona.
  await hasta('se envia el identificador', () => tocar(cdp, ['Continuar']));
  await hasta('pide la contrasena', () => hay(cdp, 'input[type="password"]'));
  await escribirEn(cdp, 'input[type="password"]', 'DemoLocal2026!');
  await esperar(500);
  await hasta('se envia la contrasena', () => enviarFormulario(cdp, 'input[type="password"]'));
  await hasta('entra a la app (barra de abajo con Perfil)', () =>
    cdp.evaluar(`[...document.querySelectorAll('nav button')].some((b) => (b.innerText || '').trim() === 'Perfil')`),
  );
  // El inicio pide sus datos despues de entrar, y el teclado que abrio la
  // contrasena achica la pantalla hasta cerrarse: se espera a las dos cosas.
  await cdp.evaluar('document.activeElement && document.activeElement.blur && document.activeElement.blur(), true');
  await hasta('carga el inicio (Ver todo de las transacciones)', () =>
    cdp.evaluar(`[...document.querySelectorAll('button, a')].some((b) => (b.innerText || '').trim().startsWith('Ver todo'))`),
  );
  await esperar(2500);
  paso('inicio', { captura: captura('inicio') });

  await hasta('abre Movimientos (Ver todo)', () => tocar(cdp, ['Ver todo']));
  await hasta('se ve Movimientos', () => hay(cdp, 'button[aria-label="Opciones de exportación"]'));
  await esperar(1500);
  paso('movimientos', { captura: captura('movimientos') });

  await tocar(cdp, ['Opciones de exportación']);
  await hasta('se abre la hoja de exportar', async () => (await textoVisible(cdp)).includes('Excel (CSV)'));
  await esperar(800);
  paso('hoja de exportar', { captura: captura('hoja-exportar') });

  if (!(await tocar(cdp, ['Excel (CSV)']))) throw new Error('no se encontro la opcion Excel (CSV)');
  const arriba = await hasta(
    'se abre el menu de compartir de Android',
    () => {
      const a = actividadArriba();
      return /ChooserActivity|ResolverActivity/.test(a) ? a : false;
    },
    { ms: 20000, cada: 1000 },
  );
  await esperar(1500);
  writeFileSync(path.join(SALIDA, 'menu-compartir.txt'), arriba + '\n');
  let enLaCache = '';
  try {
    enLaCache = adb('shell', 'run-as', PAQUETE, 'ls', '-l', 'cache');
  } catch (e) {
    enLaCache = `run-as no disponible: ${e.message}`;
  }
  writeFileSync(path.join(SALIDA, 'cache-de-la-app.txt'), enLaCache);
  paso('menu de compartir abierto', { captura: captura('menu-compartir'), actividad: arriba.trim(), cache: enLaCache.trim() });
  if (!/KiramoPay-.*\.csv/.test(enLaCache) && !enLaCache.startsWith('run-as no disponible')) {
    throw new Error('el CSV no esta en la cache de la app');
  }

  // Cerrar el menu sin compartir: la app no debe decir que exporto.
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await hasta('se cierra el menu de compartir', () => !/ChooserActivity|ResolverActivity/.test(actividadArriba()), {
    ms: 15000,
    cada: 1000,
  });
  await esperar(800);
  const tras = await textoVisible(cdp);
  const capturaTras = captura('tras-cerrar-el-menu');
  if (tras.includes('Exportado exitosamente')) throw new Error('dijo "Exportado exitosamente" aunque no se compartio nada');
  paso('cerrar el menu no dice exportado', { captura: capturaTras });

  if (!(await tocar(cdp, ['Volver']))) throw new Error('no se encontro el boton Volver de Movimientos');
  await hasta('vuelve al Inicio', () => cdp.evaluar(`!document.querySelector('button[aria-label="Opciones de exportación"]')`));

  await hasta('abre Cripto', () => tocar(cdp, ['Cripto']));
  await esperar(2500);
  paso('cripto', { captura: captura('cripto') });

  await hasta('abre Perfil', () => tocar(cdp, ['Perfil']));
  await esperar(2500);
  paso('perfil', { captura: captura('perfil') });

  const aProduccion = resumen.red.filter((l) => /\/\/(api\.)?kiramopay\.com/.test(l));
  if (aProduccion.length) throw new Error(`la app intento llamar a produccion: ${aProduccion.join(', ')}`);
}

async function principal() {
  const { cdp, socket, version } = await conectarAlWebView();
  resumen.socket = socket;
  resumen.navegador = version.Browser || version['User-Agent'] || null;
  console.log(`WebView: ${resumen.navegador} (socket ${socket})`);
  // La version que dio dumpsys y, si no la dio, la que dice el propio WebView.
  const textoVersion = process.env.WEBVIEW_VERSION || String(resumen.navegador || '').match(/Chrome\/([\d.]+)/)?.[1] || '';
  const mayor = Number(textoVersion.split('.')[0]) || 0;

  if (mayor && mayor < WEBVIEW_MINIMO) {
    // La app arranco y el WebView esta vivo; la capa web no puede correr en un
    // motor tan viejo, asi que no hay pantallas que recorrer.
    resumen.omitido = `WebView ${textoVersion} < ${WEBVIEW_MINIMO}`;
    await esperar(5000);
    // Lo que dijo la consola del WebView al cargar la capa web (el motivo de la
    // pantalla en blanco, si la hay).
    let consola = '';
    try {
      consola = adb('logcat', '-d', '-s', 'Capacitor/Console').trim();
    } catch {
      consola = '';
    }
    paso('arranque (sin recorrido)', { captura: captura('arranque'), consola: consola.split('\n').slice(-10) });
    console.log(`::warning::API ${API_LEVEL}: el WebView de la imagen es ${textoVersion}; la capa web pide ${WEBVIEW_MINIMO}+. Se comprobo solo que la app instala, arranca y no se cae.`);
    cdp.cerrar();
    return;
  }

  try {
    await recorrer(cdp);
  } catch (e) {
    try {
      captura('error');
      writeFileSync(path.join(SALIDA, 'texto-en-pantalla.txt'), await textoVisible(cdp));
    } catch {
      /* la pantalla ya no responde */
    }
    throw e;
  } finally {
    cdp.cerrar();
  }
}

principal()
  .then(() => {
    guardarResumen();
    console.log('Recorrido completo.');
  })
  .catch((e) => {
    resumen.error = e.message;
    guardarResumen();
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
