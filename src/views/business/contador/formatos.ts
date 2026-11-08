import { ErrorDeLectura, LIMITE_FILAS, type Celda, type Tabla } from './tipos';

// Todo se detecta por el contenido del archivo, nunca por su extension: un
// estado de cuenta "CSV" puede ser un Excel, y un ".xls" suele ser HTML.

const MAX_SIN_COMPRIMIR = 60 * 1024 * 1024;

function empieza(b: Uint8Array, firma: number[]): boolean {
  return firma.every((x, i) => b[i] === x);
}

export type Formato = 'xlsx' | 'html' | 'texto';

/** Reconoce el formato o lanza el error propio de PDF y de Excel viejo. */
export function detectarFormato(bytes: Uint8Array): { formato: Formato; texto?: string } {
  if (empieza(bytes, [0x25, 0x50, 0x44, 0x46])) throw new ErrorDeLectura('PDF');
  if (empieza(bytes, [0xd0, 0xcf, 0x11, 0xe0])) throw new ErrorDeLectura('XLS_VIEJO');
  if (empieza(bytes, [0x50, 0x4b, 0x03, 0x04])) return { formato: 'xlsx' };
  const texto = decodificar(bytes);
  if (/^\s*(<!doctype[^>]*>\s*)?(<\?xml[^>]*>\s*)?<(html|table)/i.test(texto)) {
    return { formato: 'html', texto };
  }
  return { formato: 'texto', texto };
}

/** UTF-8 estricto y, si falla, windows-1252. Un NUL es binario: no se lee. */
function decodificar(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.subarray(0, 4096).includes(0)) throw new ErrorDeLectura('ILEGIBLE');
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    texto = new TextDecoder('windows-1252').decode(bytes);
  }
  return texto.replace(/^\uFEFF/, '');
}

// ---------------------------------------------------------------- CSV / texto

const SEPARADORES = [',', ';', '\t', '|'] as const;

function cuentaFuera(linea: string, sep: string): number {
  let dentro = false;
  let n = 0;
  for (const c of linea) {
    if (c === '"') dentro = !dentro;
    else if (c === sep && !dentro) n += 1;
  }
  return n;
}

/** El separador que mas lineas comparten, mirando las primeras 60. */
export function detectarSeparador(texto: string): string {
  const lineas = texto.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 60);
  let mejor: string = ',';
  let mejorPuntaje = 0;
  for (const sep of SEPARADORES) {
    const cuentas = lineas.map((l) => cuentaFuera(l, sep)).filter((n) => n > 0);
    if (cuentas.length === 0) continue;
    const frecuencia = new Map<number, number>();
    for (const n of cuentas) frecuencia.set(n, (frecuencia.get(n) ?? 0) + 1);
    let moda = 0;
    let veces = 0;
    for (const [n, v] of frecuencia) {
      if (v > veces || (v === veces && n > moda)) { moda = n; veces = v; }
    }
    const puntaje = veces * moda;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = sep; }
  }
  return mejor;
}

export function leerTexto(texto: string): Tabla {
  const sep = detectarSeparador(texto);
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  const cerrarFila = () => {
    fila.push(campo);
    campo = '';
    if (fila.some((c) => c.trim() !== '')) {
      filas.push(fila);
      if (filas.length > LIMITE_FILAS) throw new ErrorDeLectura('MUCHAS_FILAS');
    }
    fila = [];
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"' && campo === '') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n') cerrarFila();
    else if (c === '\r') { if (texto[i + 1] === '\n') i++; cerrarFila(); }
    else campo += c;
  }
  if (campo !== '' || fila.length > 0) cerrarFila();
  return filas.map((f) => f.map((c) => c.trim()));
}

// ----------------------------------------------------------------------- HTML

/** Un ".xls" que es una pagina con una tabla: se lee con DOMParser, que no ejecuta nada. */
export function leerHtml(texto: string): Tabla {
  if (typeof DOMParser === 'undefined') throw new ErrorDeLectura('ILEGIBLE');
  const doc = new DOMParser().parseFromString(texto, 'text/html');
  const tablas = Array.from(doc.querySelectorAll('table'));
  if (tablas.length === 0) throw new ErrorDeLectura('ILEGIBLE');
  let mejor = tablas[0];
  for (const t of tablas) {
    if (t.querySelectorAll('tr').length > mejor.querySelectorAll('tr').length) mejor = t;
  }
  const filas: Celda[][] = [];
  for (const tr of Array.from(mejor.querySelectorAll('tr'))) {
    const celdas = Array.from(tr.querySelectorAll('th,td')).map((c) =>
      (c.textContent ?? '').replace(/[\s\u00a0]+/g, ' ').trim(),
    );
    if (celdas.some((c) => c !== '')) {
      filas.push(celdas);
      if (filas.length > LIMITE_FILAS) throw new ErrorDeLectura('MUCHAS_FILAS');
    }
  }
  return filas;
}

// ----------------------------------------------------------------------- XLSX

interface EntradaZip { metodo: number; tamComprimido: number; tamReal: number; local: number }

function leerDirectorio(b: Uint8Array): Map<string, EntradaZip> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ErrorDeLectura('ILEGIBLE');
  const total = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const entradas = new Map<string, EntradaZip>();
  for (let n = 0; n < total; n++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) throw new ErrorDeLectura('ILEGIBLE');
    const metodo = v.getUint16(p + 10, true);
    const tamComprimido = v.getUint32(p + 20, true);
    const tamReal = v.getUint32(p + 24, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComentario = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(b.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, { metodo, tamComprimido, tamReal, local });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

async function extraer(b: Uint8Array, e: EntradaZip): Promise<Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (e.local + 30 > b.length || v.getUint32(e.local, true) !== 0x04034b50) throw new ErrorDeLectura('ILEGIBLE');
  const inicio = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
  const datos = b.subarray(inicio, inicio + e.tamComprimido);
  if (e.tamReal > MAX_SIN_COMPRIMIR) throw new ErrorDeLectura('GRANDE');
  if (e.metodo === 0) return datos;
  if (e.metodo !== 8 || typeof DecompressionStream === 'undefined') throw new ErrorDeLectura('ILEGIBLE');
  const origen = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(datos); c.close(); },
  });
  const salida = origen.pipeThrough(new DecompressionStream('deflate-raw'));
  const lector = salida.getReader();
  const trozos: Uint8Array[] = [];
  let largo = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    largo += value.length;
    if (largo > MAX_SIN_COMPRIMIR) { void lector.cancel(); throw new ErrorDeLectura('GRANDE'); }
    trozos.push(value);
  }
  const todo = new Uint8Array(largo);
  let off = 0;
  for (const t of trozos) { todo.set(t, off); off += t.length; }
  return todo;
}

function entidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}

/** El texto de todos los <t> de un trozo, sin la pronunciacion fonetica (rPh). */
function textoDe(xml: string): string {
  const limpio = xml.replace(/<rPh[\s>][\s\S]*?<\/rPh>/g, '');
  let s = '';
  for (const m of limpio.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1];
  return entidades(s);
}

function textosCompartidos(xml: string): string[] {
  const lista: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) lista.push(textoDe(m[1]));
  return lista;
}

function columnaDe(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function leerHoja(xml: string, compartidos: string[]): Tabla {
  const filas: Celda[][] = [];
  for (const fm of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const fila: Celda[] = [];
    let siguiente = 0;
    for (const cm of fm[1].matchAll(/<c((?:\s[^>]*?)?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? '';
      const ref = /\sr="([A-Za-z]+\d+)"/.exec(attrs);
      const tipo = /\st="([^"]*)"/.exec(attrs)?.[1] ?? 'n';
      const col = ref ? columnaDe(ref[1]) : siguiente;
      siguiente = col + 1;
      if (col > 2000) continue;
      const cuerpo = cm[2] ?? '';
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      let valor: Celda = '';
      if (tipo === 'inlineStr') valor = textoDe(cuerpo);
      else if (v === undefined) valor = '';
      else if (tipo === 's') valor = compartidos[Number(v)] ?? '';
      else if (tipo === 'str' || tipo === 'e') valor = entidades(v);
      else if (tipo === 'b') valor = v === '1' ? 'VERDADERO' : 'FALSO';
      else {
        const n = Number(v);
        valor = Number.isFinite(n) ? n : entidades(v);
      }
      while (fila.length < col) fila.push('');
      fila[col] = valor;
    }
    if (fila.some((c) => c !== '')) {
      filas.push(fila);
      if (filas.length > LIMITE_FILAS) throw new ErrorDeLectura('MUCHAS_FILAS');
    }
  }
  return filas;
}

export async function leerXlsx(bytes: Uint8Array): Promise<Tabla> {
  const dir = leerDirectorio(bytes);
  const quitar = (n: string) => n.replace(/^\//, '');
  const leerEntrada = async (nombre: string): Promise<string | null> => {
    const e = dir.get(nombre);
    return e ? new TextDecoder().decode(await extraer(bytes, e)) : null;
  };
  const libro = await leerEntrada('xl/workbook.xml');
  if (libro === null) throw new ErrorDeLectura('ILEGIBLE');
  // La primera hoja del libro, por su relacion; sheet1.xml solo como respaldo.
  let ruta = 'xl/worksheets/sheet1.xml';
  const hoja = /<sheet\s[^>]*?r:id="([^"]+)"/.exec(libro) ?? /<sheet\s[^>]*?\sid="([^"]+)"/.exec(libro);
  const rels = await leerEntrada('xl/_rels/workbook.xml.rels');
  if (hoja && rels) {
    for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
      const id = /\sId="([^"]+)"/.exec(m[0])?.[1];
      const destino = /\sTarget="([^"]+)"/.exec(m[0])?.[1];
      if (id === hoja[1] && destino) {
        ruta = destino.startsWith('/') ? quitar(destino) : `xl/${destino.replace(/^\.\//, '')}`;
        break;
      }
    }
  }
  const xmlHoja = await leerEntrada(ruta);
  if (xmlHoja === null) throw new ErrorDeLectura('ILEGIBLE');
  const compartidosXml = await leerEntrada('xl/sharedStrings.xml');
  return leerHoja(xmlHoja, compartidosXml ? textosCompartidos(compartidosXml) : []);
}
