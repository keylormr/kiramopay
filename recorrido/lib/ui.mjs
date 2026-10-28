// Ayudas del navegador. Cada persona abre su propio contexto (la sesion de la
// pantalla vive en memoria y no sobrevive a una recarga). Las llaves de
// localStorage de abajo saltan el carrusel de bienvenida y la hoja de invitacion
// que a los 2,5 s tapa la pantalla; no cambian nada de lo que se prueba.
import { chromium } from '@playwright/test';
import { APP, API_BASE } from './entorno.mjs';
import { entrar } from './api.mjs';
import { anotar, cupo } from './regulador.mjs';
import { txt, escapar } from './textos.mjs';

let navegador = null;

export async function lanzar() {
  if (!navegador) {
    navegador = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  }
  return navegador;
}

export async function cerrarNavegador() {
  if (navegador) await navegador.close();
  navegador = null;
}

const INICIO_SIN_BIENVENIDA = () => {
  try {
    localStorage.setItem('kiramopay_onboarded', '1');
    localStorage.setItem('kiramopay-campana-invitar-2026-09-referidos', '1');
    localStorage.setItem('kiramopay_language', 'es');
  } catch {
    // almacenamiento no disponible: la pantalla se arregla sola
  }
};

/** Tamanos: escritorio de la pasada principal y telefono de la segunda. */
export const VIEWPORT_ESCRITORIO = { width: 1280, height: 800 };
export const VIEWPORT_TELEFONO = { width: 390, height: 844 };

/**
 * Abre una sesion: contexto + pagina + entrada por la pantalla sin contraseña +
 * un cliente de API propio para las comprobaciones.
 */
export async function abrirSesion(flujo, usuario, { movil = false, entrarPorPantalla = true } = {}) {
  const nav = await lanzar();
  const ctx = await nav.newContext({
    locale: 'es-CR',
    timezoneId: 'America/Costa_Rica',
    viewport: movil ? VIEWPORT_TELEFONO : VIEWPORT_ESCRITORIO,
    isMobile: movil,
    hasTouch: movil,
    deviceScaleFactor: movil ? 2 : 1,
    acceptDownloads: true,
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP }).catch(() => {});
  await ctx.addInitScript(INICIO_SIN_BIENVENIDA);
  // Un arranque completo de la pantalla pide una veintena de datos: se espera si la persona ya va al limite.
  await cupo(usuario, 40);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.usuarioDelRecorrido = usuario;
  page.on('request', (r) => {
    if (r.url().startsWith(API_BASE)) anotar(usuario);
  });
  vigilar(flujo, page, usuario);
  const sesion = { usuario, ctx, page, api: null, movil, flujo };
  flujo.sesiones.push(sesion);
  flujo.ultimaPagina = page;
  if (entrarPorPantalla) await entrarPorLaPantalla(page, usuario);
  sesion.api = await entrar(usuario);
  return sesion;
}

/** Registra como alerta los 5xx del servidor y los errores de la pagina. */
function vigilar(flujo, page, usuario) {
  page.on('response', (r) => {
    const url = r.url();
    if (url.startsWith(API_BASE) && r.status() >= 500) {
      flujo.alertar(`HTTP ${r.status()} en ${r.request().method()} ${url.replace(API_BASE, '')} (sesion de ${usuario})`);
    }
  });
  page.on('pageerror', (e) => flujo.alertar(`Excepcion de JavaScript en la pagina de ${usuario}: ${String(e.message).slice(0, 200)}`));
  page.on('requestfailed', (r) => {
    const url = r.url();
    if (url.startsWith(API_BASE) && !/net::ERR_ABORTED/.test(r.failure()?.errorText ?? '')) {
      flujo.alertar(`Peticion caida ${r.method()} ${url.replace(API_BASE, '')}: ${r.failure()?.errorText}`);
    }
  });
}

/** Entrada sin contraseña por la pantalla: usuario + Continuar. */
export async function entrarPorLaPantalla(page, usuario) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  const campo = page.getByPlaceholder(txt('Usuario, cédula, correo o teléfono'));
  await campo.waitFor({ state: 'visible', timeout: 30000 });
  await campo.fill(usuario);
  await page.getByRole('button', { name: txt('Continuar'), exact: true }).click();
  await barraInferior(page).waitFor({ state: 'visible', timeout: 30000 });
  await reposar(page);
}

export const barraInferior = (page) => page.getByRole('navigation', { name: /Navegaci[oó]n principal/ });

/** Pestana de la barra inferior: Inicio, SINPE, Crypto, Servicios o Perfil. */
export async function ir(page, destino) {
  await cupo(page.usuarioDelRecorrido, 25);
  await barraInferior(page).getByRole('button', { name: destino, exact: true }).click();
  await reposar(page);
}

/** Deja que la pantalla termine de pedir sus datos. */
export async function reposar(page, ms = 800) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/** Ultima hoja abierta (las hojas son role=dialog y se apilan en el DOM). */
export const ultimoDialogo = (page) => page.getByRole('dialog').last();

/** Hoja por su titulo. */
export const dialogo = (page, nombre) => page.getByRole('dialog', { name: nombre });

/** Espera a que no quede ninguna hoja (la hoja cerrada sigue ~300 ms en el DOM). */
export async function sinDialogos(page, timeout = 8000) {
  await page.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 0, null, { timeout });
}

/** Espera a que la pagina muestre un texto (cadena o expresion). */
export async function verTexto(page, texto, timeout = 15000) {
  await page.getByText(texto).first().waitFor({ state: 'visible', timeout });
}

/** Boton por nombre dentro de un ambito. */
export function boton(ambito, nombre, { exacto = false } = {}) {
  return ambito.getByRole('button', { name: nombre, exact: exacto });
}

/**
 * Sale de una pantalla completa (Pagos protegidos, Disputas, Metas...) con su
 * flecha "Volver". Esas pantallas cubren la barra inferior, asi que no se puede
 * salir pulsando una pestana.
 */
export async function volver(page) {
  await page.getByRole('button', { name: txt('Volver'), exact: true }).first().click();
  await reposar(page, 400);
}

/**
 * Cambia el perfil activo desde el boton "Cambiar de perfil" de la barra
 * superior: "Personal" o el nombre de un negocio.
 */
export async function cambiarAPerfil(page, quien) {
  await boton(page, txt('Cambiar de perfil'), { exacto: true }).first().click();
  const fila = quien === 'Personal' ? /^Personal/ : new RegExp(quien.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  await boton(ultimoDialogo(page), fila).click();
  await sinDialogos(page);
  await reposar(page);
}

/** Abre una pantalla desde la lista de Perfil (Pagos fijos, Presupuestos, Pagos salientes...). */
export async function abrirDesdePerfil(page, texto) {
  await ir(page, 'Perfil');
  await boton(page, new RegExp(escapar(texto))).first().click();
  await reposar(page);
}

/** Cierra la sesion de una persona (contexto del navegador). */
export async function cerrarSesion(sesion) {
  try {
    await sesion.ctx.close();
  } catch {
    // ya cerrado
  }
  sesion.flujo.sesiones = sesion.flujo.sesiones.filter((s) => s !== sesion);
}

/**
 * Revisa la pantalla actual para el telefono: sin desplazamiento horizontal y
 * sin controles fuera de la pantalla. Devuelve la lista de problemas.
 */
export async function revisarTelefono(page) {
  return page.evaluate(() => {
    const problemas = [];
    const ancho = window.innerWidth;
    const doc = document.documentElement;
    if (doc.scrollWidth > ancho) {
      problemas.push(`desplazamiento horizontal: scrollWidth ${doc.scrollWidth} > ancho ${ancho}`);
    }
    if (document.body.scrollWidth > ancho + 1 && doc.scrollWidth <= ancho) {
      // el cuerpo se sale pero el documento lo recorta: tambien es un defecto
      problemas.push(`el cuerpo se sale: scrollWidth ${document.body.scrollWidth} > ancho ${ancho}`);
    }
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    // Un control dentro de un contenedor que se desplaza a los lados (carruseles,
    // pestanas) puede salirse a proposito: no cuenta.
    const dentroDeDesplazable = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    const nombre = (el) =>
      (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.tagName)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50);
    const controles = document.querySelectorAll('button, a[href], [role=button], [role=tab], input, select, textarea');
    const fuera = [];
    for (const el of controles) {
      if (!visible(el) || dentroDeDesplazable(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > ancho + 1 || r.left < -1) {
        fuera.push(`${nombre(el)} (izq ${Math.round(r.left)}, der ${Math.round(r.right)})`);
      }
    }
    // Lo fijado a la ventana (barra inferior, botones flotantes) debe caber entera.
    const alto = window.innerHeight;
    for (const el of controles) {
      if (!visible(el)) continue;
      // Dentro de una hoja el contenido se desplaza: no se mide contra la ventana.
      if (el.closest('[role=dialog]')) continue;
      const cs = getComputedStyle(el);
      let fijo = cs.position === 'fixed';
      let desplazable = false;
      for (let p = el.parentElement; p && p !== document.body && !fijo; p = p.parentElement) {
        const pcs = getComputedStyle(p);
        if (pcs.overflowY === 'auto' || pcs.overflowY === 'scroll') desplazable = true;
        if (pcs.position === 'fixed') {
          fijo = true;
          if (pcs.overflowY === 'auto' || pcs.overflowY === 'scroll') desplazable = true;
        }
      }
      if (!fijo || desplazable) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > alto + 1 || r.top < -1) fuera.push(`${nombre(el)} (fijo; arriba ${Math.round(r.top)}, abajo ${Math.round(r.bottom)} de ${alto})`);
    }
    if (fuera.length) problemas.push(`controles fuera de la pantalla: ${[...new Set(fuera)].slice(0, 8).join('; ')}`);
    // Texto que se sale de su caja (un monto largo que pisa el borde del cuadro, por ejemplo).
    // Se ignoran las cajas que recortan o se desplazan a proposito. Solo se mira la capa de arriba:
    // la ultima hoja abierta, o la pantalla completa (fija, del tamano de la ventana y con fondo
    // opaco) que cubre la anterior. Lo que queda debajo se reporta en su propia pantalla.
    const alfaDelFondo = (el) => {
      const color = getComputedStyle(el).backgroundColor.trim();
      const m = /^rgba?\(([^)]*)\)$/.exec(color);
      if (!m) return color === 'transparent' ? 0 : 1; // otro formato de color (color-mix, color()): se toma por opaco
      const partes = m[1].split(/[\s,/]+/).filter(Boolean);
      return partes.length >= 4 ? Number.parseFloat(partes[3]) : 1;
    };
    const capaDeArriba = () => {
      const hojas = [...document.querySelectorAll('[role=dialog]')].filter(visible);
      if (hojas.length) return hojas[hojas.length - 1];
      const completas = [...document.querySelectorAll('body *')].filter((c) => {
        if (getComputedStyle(c).position !== 'fixed' || !visible(c)) return false;
        const r = c.getBoundingClientRect();
        return r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1 && alfaDelFondo(c) >= 0.9;
      });
      return completas.length ? completas[completas.length - 1] : document.body;
    };
    const desbordados = [];
    for (const el of capaDeArriba().querySelectorAll('*')) {
      if (el.closest('svg') || !visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'inline' || cs.overflowX !== 'visible') continue;
      const texto = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('')
        .trim();
      if (!texto || dentroDeDesplazable(el)) continue;
      if (el.scrollWidth > el.clientWidth + 2) desbordados.push(`"${texto.slice(0, 30)}" (${el.scrollWidth} px en una caja de ${el.clientWidth} px)`);
    }
    if (desbordados.length) problemas.push(`texto que se sale de su caja: ${[...new Set(desbordados)].slice(0, 6).join('; ')}`);
    return problemas;
  });
}
