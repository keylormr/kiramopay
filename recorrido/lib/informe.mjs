// Registro de la corrida: cada flujo tiene pasos, cada paso un resultado y una
// captura. Al final se escribe un informe en JSON, otro en Markdown y, si
// corre en GitHub Actions, se agrega al resumen del job.
import fs from 'node:fs';
import path from 'node:path';
import { SALIDA } from './entorno.mjs';
import { Comprobaciones } from './comprobaciones.mjs';

const plano = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);

const dosDigitos = (n) => String(n).padStart(2, '0');

function mensajeCorto(error) {
  const texto = error instanceof Error ? error.message : String(error);
  // El mensaje de Playwright trae un registro de llamadas muy largo; lo que
  // importa son las primeras lineas.
  return texto.split('\n').slice(0, 14).join('\n').slice(0, 1800);
}

export class Informe {
  constructor() {
    this.flujos = [];
    this.inicio = Date.now();
    fs.mkdirSync(SALIDA, { recursive: true });
  }

  nuevoFlujo(id, nombre, opciones = {}) {
    const flujo = new Flujo(this, id, nombre, opciones);
    this.flujos.push(flujo);
    return flujo;
  }

  /** Resumen en una linea por flujo, y totales. */
  totales() {
    const pasaron = this.flujos.filter((f) => f.estado() === 'ok').length;
    const fallaron = this.flujos.filter((f) => f.estado() === 'fallo').length;
    return { total: this.flujos.length, pasaron, fallaron };
  }

  escribir() {
    const t = this.totales();
    const json = {
      duracion_s: Math.round((Date.now() - this.inicio) / 1000),
      totales: t,
      flujos: this.flujos.map((f) => f.aJson()),
    };
    fs.writeFileSync(path.join(SALIDA, 'informe.json'), JSON.stringify(json, null, 2));

    const md = this.markdown();
    fs.writeFileSync(path.join(SALIDA, 'informe.md'), md);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    }
  }

  markdown() {
    const t = this.totales();
    const lineas = [];
    lineas.push('## Recorrido con el servidor real');
    lineas.push('');
    lineas.push(
      `${t.pasaron} de ${t.total} flujos pasaron, ${t.fallaron} fallaron. Duración: ${Math.round((Date.now() - this.inicio) / 1000)} s.`,
    );
    lineas.push('');
    lineas.push('| Flujo | Resultado | Pasos ok | Pasos con fallo | Omitidos |');
    lineas.push('|---|---|---|---|---|');
    for (const f of this.flujos) {
      const c = f.conteo();
      const est = f.estado() === 'ok' ? 'PASA' : 'FALLA';
      lineas.push(`| ${f.nombre} | ${est} | ${c.ok} | ${c.fallo} | ${c.omitido} |`);
    }
    const fallos = this.flujos.flatMap((f) =>
      f.pasos.filter((p) => p.estado === 'fallo').map((p) => ({ flujo: f, paso: p })),
    );
    if (fallos.length) {
      lineas.push('');
      lineas.push('### Pasos con fallo');
      for (const { flujo, paso } of fallos) {
        lineas.push('');
        lineas.push(`**${flujo.nombre} / ${paso.n}. ${paso.nombre}**`);
        lineas.push('');
        lineas.push('```');
        lineas.push(paso.error);
        lineas.push('```');
        if (paso.captura) lineas.push(`Captura: \`${paso.captura}\``);
      }
    }
    const alertas = this.flujos.flatMap((f) => f.alertas.map((a) => `${f.nombre}: ${a}`));
    if (alertas.length) {
      lineas.push('');
      lineas.push('### Alertas del navegador y del servidor');
      for (const a of [...new Set(alertas)].slice(0, 40)) lineas.push(`- ${a}`);
    }
    return lineas.join('\n');
  }
}

export class Flujo {
  constructor(informe, id, nombre, { telefono = false } = {}) {
    this.informe = informe;
    this.id = id;
    this.nombre = nombre;
    this.telefono = telefono;
    this.pasos = [];
    this.alertas = [];
    this.abortado = false;
    this.ultimaPagina = null;
    this.sesiones = [];
    this.carpeta = path.join(SALIDA, telefono ? 'capturas-telefono' : 'capturas', `${String(informe.flujos.length).padStart(2, '0')}-${id}`);
    fs.mkdirSync(this.carpeta, { recursive: true });
  }

  conteo() {
    const c = { ok: 0, fallo: 0, omitido: 0 };
    for (const p of this.pasos) c[p.estado]++;
    return c;
  }

  estado() {
    const c = this.conteo();
    return c.fallo > 0 || c.omitido > 0 ? 'fallo' : 'ok';
  }

  aJson() {
    return { id: this.id, nombre: this.nombre, estado: this.estado(), pasos: this.pasos, alertas: this.alertas };
  }

  /** Alerta que no detiene nada: un 5xx del servidor, un error de la pagina. */
  alertar(texto) {
    if (!this.alertas.includes(texto)) this.alertas.push(texto);
  }

  /**
   * Anota un paso en rojo que el recorrido detecta al cerrar el flujo, sin que el
   * flujo lo haya pedido (una comprobacion que se hace entre flujos). No detiene
   * nada y no lleva captura: no hay una pantalla a la que apuntar.
   */
  fallarAparte(nombre, error) {
    const n = this.pasos.length + 1;
    this.pasos.push({ n, nombre, estado: 'fallo', error, captura: null });
    console.log(`  [FALLO] ${n}. ${nombre}`);
    for (const l of error.split('\n')) console.log(`      ${l}`);
  }

  /**
   * Ejecuta un paso. `fn` recibe el objeto de comprobaciones. Si falla, el paso
   * queda en rojo y se omiten los siguientes del flujo, salvo `seguir: true`
   * (para pasos que no dependen de los anteriores).
   */
  async paso(nombre, fn, { pagina, seguir = false } = {}) {
    const n = this.pasos.length + 1;
    if (this.abortado) {
      this.pasos.push({ n, nombre, estado: 'omitido' });
      console.log(`  [omitido] ${n}. ${nombre}`);
      return false;
    }
    const c = new Comprobaciones();
    const t0 = Date.now();
    let error = null;
    try {
      await fn(c);
      c.cerrar();
    } catch (e) {
      error = e;
    }
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    const pg = pagina ?? this.ultimaPagina;
    const captura = await this.capturar(pg, n, nombre);
    if (error) {
      const msg = mensajeCorto(error);
      const diag = await this.diagnosticar(pg, n);
      this.pasos.push({ n, nombre, estado: 'fallo', error: msg, captura, diagnostico: diag });
      console.log(`  [FALLO] ${n}. ${nombre} (${seg} s)`);
      for (const l of msg.split('\n')) console.log(`      ${l}`);
      if (diag) console.log(`      pantalla: ${diag.replace(/\s+/g, ' ').slice(0, 500)}`);
      if (!seguir) this.abortado = true;
      return false;
    }
    this.pasos.push({ n, nombre, estado: 'ok', captura });
    console.log(`  [ok] ${n}. ${nombre} (${seg} s)`);
    return true;
  }

  async capturar(pagina, n, nombre) {
    if (!pagina || pagina.isClosed()) return null;
    const archivo = path.join(this.carpeta, `${dosDigitos(n)}-${plano(nombre)}.png`);
    try {
      await pagina.screenshot({ path: archivo, timeout: 8000 });
      return path.relative(SALIDA, archivo).replace(/\\/g, '/');
    } catch {
      return null;
    }
  }

  /** Texto visible de la pantalla al fallar: ayuda a leer el fallo sin abrir la captura. */
  async diagnosticar(pagina, n) {
    if (!pagina || pagina.isClosed()) return null;
    try {
      const texto = await pagina.evaluate(() => {
        const dialogos = [...document.querySelectorAll('[role=dialog]')].map((d) => `[dialogo] ${d.innerText}`);
        return `${location.pathname} | ${dialogos.join(' || ')} || ${document.body.innerText}`;
      });
      const archivo = path.join(this.carpeta, `${dosDigitos(n)}-diagnostico.txt`);
      fs.writeFileSync(archivo, texto);
      return texto.slice(0, 900);
    } catch {
      return null;
    }
  }

  /** Cierra todo lo que el flujo abrio. */
  async cerrar() {
    for (const s of this.sesiones) {
      try {
        await s.ctx.close();
      } catch {
        // ya cerrado
      }
    }
    this.sesiones = [];
  }
}
