// @vitest-environment node
import { deflateRawSync } from 'node:zlib';
import { leerEstadoDeCuenta, leerIngresos } from '../lector';
import { detectarColumnas } from '../columnas';
import { leerFecha } from '../fechas';
import { inferirSeparador, leerMonto } from '../montos';
import { extraerIngresos, mesesDe, monedasDe, sumar } from '../ingresos';
import { construirCsv, centimosATexto, type TextosCsv } from '../csvSalida';
import { ErrorDeLectura, LIMITE_BYTES, LIMITE_FILAS, type Ingreso } from '../tipos';

// Un archivo en memoria con la forma que lee el lector.
const archivo = (bytes: Uint8Array | string, size?: number) => {
  const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return {
    size: size ?? b.length,
    arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
  };
};

const leer = async (bytes: Uint8Array | string) => {
  const l = await leerEstadoDeCuenta(archivo(bytes));
  return { l, r: extraerIngresos(l.tabla, l.deteccion.columnas, l.deteccion.filaEncabezado) };
};

const codigo = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return (e as ErrorDeLectura).codigo; }
  return null;
};

// ---- un XLSX real: zip con directorio central y entradas comprimidas ----
function crc32(d: Uint8Array): number {
  let c = ~0;
  for (const b of d) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zip(entradas: Record<string, string>, metodo: 0 | 8 = 8): Uint8Array {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(entradas)) {
    const nom = Buffer.from(nombre);
    const crudo = Buffer.from(contenido);
    const datos = metodo === 8 ? deflateRawSync(crudo) : crudo;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(crc32(crudo), 14); local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(crudo.length, 22); local.writeUInt16LE(nom.length, 26);
    partes.push(local, nom, datos);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(metodo, 10);
    c.writeUInt32LE(crc32(crudo), 16); c.writeUInt32LE(datos.length, 20); c.writeUInt32LE(crudo.length, 24);
    c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nom);
    offset += 30 + nom.length + datos.length;
  }
  const dir = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(entradas).length, 8); fin.writeUInt16LE(Object.keys(entradas).length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...partes, dir, fin]));
}

const HOJA = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c></row>
<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c><c r="D3" t="s"><v>4</v></c></row>
<row r="4"><c r="A4"><v>46333</v></c><c r="B4" t="s"><v>5</v></c><c r="C4"><v>12000.5</v></c><c r="D4"/></row>
<row r="5"><c r="A5"><v>46334</v></c><c r="B5" t="inlineStr"><is><t>Compra &amp; pago</t></is></c><c r="C5"/><c r="D5"><v>800</v></c></row>
<row r="6"><c r="A6" t="inlineStr"><is><t>09/11/2026</t></is></c><c r="B6" t="s"><v>6</v></c><c r="C6"><v>3000</v></c></row>
</sheetData></worksheet>`;

const COMPARTIDOS = `<sst>${['Estado de cuenta', 'Fecha', 'Detalle', 'Credito', 'Debito', 'SINPE MOVIL Ana', 'Deposito']
  .map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;

const xlsx = (hoja = HOJA, metodo: 0 | 8 = 8) => zip({
  '[Content_Types].xml': '<Types/>',
  'xl/workbook.xml': '<workbook><sheets><sheet name="Datos" sheetId="1" r:id="rId7"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId7" Type="x" Target="worksheets/hoja-uno.xml"/></Relationships>',
  'xl/worksheets/hoja-uno.xml': hoja,
  'xl/sharedStrings.xml': COMPARTIDOS,
}, metodo);

describe('XLSX sin dependencias', () => {
  it('lee numero, texto compartido y texto en linea, con la portada antes del encabezado', async () => {
    const { l, r } = await leer(xlsx());
    expect(l.deteccion.filaEncabezado).toBe(1);
    expect(l.deteccion.confiable).toBe(true);
    expect(r.ingresos.map((x) => [x.fecha, x.descripcion, x.centimos, x.esSinpe])).toEqual([
      ['2026-11-07', 'SINPE MOVIL Ana', 1200050, true],
      ['2026-11-09', 'Deposito', 300000, false],
    ]);
  });

  it('lee las entradas sin comprimir (metodo 0)', async () => {
    const { r } = await leer(xlsx(HOJA, 0));
    expect(r.ingresos).toHaveLength(2);
  });

  it('usa la hoja que dice el libro, no una por nombre', async () => {
    const { l } = await leer(xlsx());
    expect(l.tabla[0]).toEqual(['Estado de cuenta']);
  });

  it('un zip roto es ilegible', async () => {
    const roto = xlsx().slice(0, 40);
    expect(await codigo(leerEstadoDeCuenta(archivo(roto)))).toBe('ILEGIBLE');
  });
});

describe('formatos', () => {
  it('HTML disfrazado de xls se rechaza solo si no hay DOMParser (aqui, entorno node)', async () => {
    expect(await codigo(leerEstadoDeCuenta(archivo('<html><table><tr><td>a</td></tr></table></html>')))).toBe('ILEGIBLE');
  });

  it('CSV con coma', async () => {
    const { r } = await leer('Fecha,Descripcion,Credito,Debito\n07/11/2026,SINPE Movil Luis,"1,500.00",\n');
    expect(r.ingresos[0].centimos).toBe(150000);
  });

  it('separador punto y coma con coma decimal', async () => {
    const { r } = await leer('Fecha;Detalle;Abono\n07-11-2026;SINPE;1.234,56\n08-11-2026;Otro;10,5\n');
    expect(r.ingresos.map((x) => x.centimos)).toEqual([123456, 1050]);
  });

  it('separador tabulacion', async () => {
    const { r } = await leer('Fecha\tConcepto\tDeposito\n7/11/26\tSINPE\t2500\n');
    expect(r.ingresos[0]).toMatchObject({ fecha: '2026-11-07', centimos: 250000 });
  });

  it('separador barra vertical y comillas con el separador adentro', async () => {
    const { r } = await leer('Fecha|Detalle|Credito\n2026-11-07|"SINPE | Pedro"|900\n');
    expect(r.ingresos[0].descripcion).toBe('SINPE | Pedro');
    expect(r.ingresos[0].esSinpe).toBe(true);
  });

  it('comillas dobladas y saltos de linea dentro de un campo', async () => {
    const { l } = await leer('Fecha,Detalle,Credito\n07/11/2026,"dijo ""hola""\nlinea",100\n');
    expect(l.tabla[1][1]).toBe('dijo "hola"\nlinea');
  });

  it('UTF-8 estricto con BOM', async () => {
    const bytes = new TextEncoder().encode('﻿Fecha,Descripción,Crédito\n07/11/2026,Cobro SINPE Móvil,100\n');
    const { r } = await leer(bytes);
    expect(r.ingresos[0].descripcion).toBe('Cobro SINPE Móvil');
  });

  it('cae a windows-1252 cuando no es UTF-8', async () => {
    // "Descripción", "Crédito" y "Móvil" con los bytes de windows-1252
    const bytes = Uint8Array.from(Buffer.from('Fecha;Descripci\xf3n;Cr\xe9dito\n07/11/2026;SINPE M\xf3vil;100\n', 'latin1'));
    const { r, l } = await leer(bytes);
    expect(l.deteccion.confiable).toBe(true);
    expect(r.ingresos[0].descripcion).toBe('SINPE Móvil');
  });

  it('PDF y Excel viejo tienen error propio y no se leen', async () => {
    expect(await codigo(leerEstadoDeCuenta(archivo(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2]))))).toBe('PDF');
    expect(await codigo(leerEstadoDeCuenta(archivo(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]))))).toBe('XLS_VIEJO');
  });

  it('un binario cualquiera es ilegible', async () => {
    expect(await codigo(leerEstadoDeCuenta(archivo(new Uint8Array([1, 0, 2, 0, 3, 0, 9]))))).toBe('ILEGIBLE');
  });

  it('un archivo vacio es ilegible', async () => {
    expect(await codigo(leerEstadoDeCuenta(archivo('')))).toBe('ILEGIBLE');
  });
});

describe('limites', () => {
  it('mas de 5 MB: error claro, sin leer el contenido', async () => {
    const f = { size: LIMITE_BYTES + 1, arrayBuffer: vi.fn() };
    expect(await codigo(leerEstadoDeCuenta(f))).toBe('GRANDE');
    expect(f.arrayBuffer).not.toHaveBeenCalled();
  });

  it('mas de 20.000 filas', async () => {
    const filas = ['Fecha,Detalle,Credito'];
    for (let i = 0; i < LIMITE_FILAS + 1; i++) filas.push('07/11/2026,SINPE,1');
    expect(await codigo(leerEstadoDeCuenta(archivo(filas.join('\n'))))).toBe('MUCHAS_FILAS');
  });

  it('justo en el limite de filas se lee', async () => {
    const filas = ['Fecha,Detalle,Credito'];
    for (let i = 0; i < LIMITE_FILAS - 1; i++) filas.push('07/11/2026,SINPE,1');
    const { r } = await leer(filas.join('\n'));
    expect(r.ingresos).toHaveLength(LIMITE_FILAS - 1);
  });
});

describe('columnas', () => {
  it('encuentra el encabezado tras una portada y compara sin tildes ni mayusculas', () => {
    const d = detectarColumnas([
      ['Cliente: X'], ['Cuenta 123'], [''], ['FECHA', 'CONCEPTO', 'IMPORTE', 'MONEDA', 'SALDO'],
    ]);
    expect(d).toMatchObject({ filaEncabezado: 3, confiable: true });
    expect(d.columnas).toMatchObject({ fecha: 0, descripcion: 1, monto: 2, moneda: 3 });
  });

  it('prefiere credito y debito a monto, y el sinonimo exacto a la referencia', () => {
    const d = detectarColumnas([['Fecha', 'Referencia', 'Descripción', 'Débito', 'Crédito']]);
    expect(d.columnas).toMatchObject({ fecha: 0, descripcion: 2, debito: 3, credito: 4 });
  });

  it('sin encabezado reconocible no es confiable', () => {
    const d = detectarColumnas([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(d.confiable).toBe(false);
  });

  it('el encabezado mas alla de la fila 40 no se busca', () => {
    const tabla = Array.from({ length: 45 }, () => ['x']);
    tabla.push(['Fecha', 'Detalle', 'Credito']);
    expect(detectarColumnas(tabla).confiable).toBe(false);
  });
});

describe('montos', () => {
  const m = (v: string, dec: ',' | '.' | null = null) => leerMonto(v, dec)?.centimos;
  it('todos los formatos', () => {
    expect(m('1.234,56', ',')).toBe(123456);
    expect(m('1,234.56', '.')).toBe(123456);
    expect(m('1234.56', '.')).toBe(123456);
    expect(m('1234,56', ',')).toBe(123456);
    expect(m('₡1.234,56', ',')).toBe(123456);
    expect(m('CRC 1,234.56', '.')).toBe(123456);
    expect(m('$ 99.90', '.')).toBe(9990);
    expect(m('USD50', null)).toBe(5000);
    expect(m('(1.234,56)', ',')).toBe(-123456);
    expect(m('1.234,56-', ',')).toBe(-123456);
    expect(m('-12', null)).toBe(-1200);
    expect(m('1 234,56', ',')).toBe(123456);
  });
  it('1,234 o 1.234 solos son miles; con evidencia en la columna cambia', () => {
    expect(inferirSeparador(['1,234', '2,500'])).toBeNull();
    expect(m('1,234', null)).toBe(123400);
    expect(m('1.234', null)).toBe(123400);
    expect(inferirSeparador(['1,234', '10.50'])).toBe('.');
    expect(inferirSeparador(['1.234', '10,50'])).toBe(',');
    expect(m('1.234', ',')).toBe(123400);
    expect(m('1,234', ',')).toBe(123);
  });
  it('la moneda sale del simbolo', () => {
    expect(leerMonto('₡500', null)?.moneda).toBe('CRC');
    expect(leerMonto('$500', null)?.moneda).toBe('USD');
    expect(leerMonto('500', null)?.moneda).toBeNull();
  });
  it('lo que no es monto es null', () => {
    expect(leerMonto('Total', null)).toBeNull();
    expect(leerMonto('', null)).toBeNull();
    expect(leerMonto('1.2.3,4,5', ',')).toBeNull();
  });
  it('el decimal se infiere por la columna completa, no fila por fila', async () => {
    // "1,234" aislado seria miles; con "10.50" en la misma columna es 1,23.
    const { r } = await leer('Fecha,Detalle,Credito\n07/11/2026,A,"1,234"\n07/11/2026,B,"10.50"\n');
    expect(r.ingresos.map((x) => x.centimos)).toEqual([123400, 1050]);
  });
  it('numeros de Excel con ruido de coma flotante', () => {
    expect(leerMonto(1234.5599999999999, null)?.centimos).toBe(123456);
    expect(leerMonto(0.1 + 0.2, null)?.centimos).toBe(30);
  });
});

describe('fechas', () => {
  it('formatos aceptados, dia primero', () => {
    expect(leerFecha('07/11/2026')).toBe('2026-11-07');
    expect(leerFecha('07-11-2026')).toBe('2026-11-07');
    expect(leerFecha('7/11/26')).toBe('2026-11-07');
    expect(leerFecha('2026-11-07')).toBe('2026-11-07');
    expect(leerFecha('07/11/2026 14:35:10')).toBe('2026-11-07');
    expect(leerFecha('2026-11-07T14:35:10')).toBe('2026-11-07');
    expect(leerFecha(46333)).toBe('2026-11-07');
    expect(leerFecha('46333')).toBe('2026-11-07');
    expect(leerFecha('07-NOV-2026')).toBe('2026-11-07');
    expect(leerFecha('7 nov 2026')).toBe('2026-11-07');
    expect(leerFecha('7 de noviembre de 2026')).toBe('2026-11-07');
    expect(leerFecha('1 set 2026')).toBe('2026-09-01');
    expect(leerFecha('05/06/2026')).toBe('2026-06-05'); // dia primero
  });
  it('una fecha imposible se rechaza, no se corre', () => {
    expect(leerFecha('31/02/2026')).toBeNull();
    expect(leerFecha('29/02/2026')).toBeNull();
    expect(leerFecha('29/02/2028')).toBe('2028-02-29');
    expect(leerFecha('13/13/2026')).toBeNull();
    expect(leerFecha('31-ABR-2026')).toBeNull();
    expect(leerFecha('hola')).toBeNull();
  });
  it('una fila con fecha imposible se omite y se cuenta', async () => {
    const { r } = await leer('Fecha,Detalle,Credito\n31/02/2026,SINPE,100\n07/11/2026,SINPE,200\n');
    expect(r.ingresos).toHaveLength(1);
    expect(r.omitidas).toBe(1);
  });
});

describe('ingresos', () => {
  it('solo creditos mayores que cero; el debito y los montos negativos quedan fuera', async () => {
    const a = await leer('Fecha,Detalle,Credito,Debito\n07/11/2026,SINPE,100,\n07/11/2026,Pago,,50\n07/11/2026,Cero,0,\n');
    expect(a.r.ingresos).toHaveLength(1);
    const b = await leer('Fecha,Detalle,Monto\n07/11/2026,SINPE,100\n07/11/2026,Pago,-50\n07/11/2026,Otro,(20)\n');
    expect(b.r.ingresos).toHaveLength(1);
  });

  it('esSinpe por el texto normalizado', async () => {
    const { r } = await leer('Fecha,Detalle,Credito\n07/11/2026,Transf. SiNPé móvil,1\n07/11/2026,Deposito,1\n');
    expect(r.ingresos.map((x) => x.esSinpe)).toEqual([true, false]);
  });

  it('la suma es exacta en centimos', async () => {
    const filas = ['Fecha,Detalle,Credito'];
    for (let i = 0; i < 1000; i++) filas.push('07/11/2026,SINPE,0.10');
    const { r } = await leer(filas.join('\n'));
    expect(sumar(r.ingresos)).toBe(10000);
    expect(centimosATexto(sumar(r.ingresos))).toBe('100.00');
    expect(0.1 * 1000).toBeCloseTo(100); // con flotantes la suma acumulada se desvia
  });

  it('agrupa por mes', async () => {
    const { r } = await leer('Fecha,Detalle,Credito\n07/10/2026,A,1\n07/11/2026,B,1\n20/11/2026,C,1\n');
    expect(mesesDe(r.ingresos)).toEqual(['2026-10', '2026-11']);
  });

  it('monedas mezcladas: se separan y no se suman juntas', async () => {
    const { r } = await leer('Fecha,Detalle,Credito,Moneda\n07/11/2026,A,100,CRC\n07/11/2026,B,5,USD\n07/11/2026,C,"$7",\n');
    expect(monedasDe(r.ingresos)).toEqual(['CRC', 'USD']);
    expect(sumar(r.ingresos.filter((x) => x.moneda === 'USD'))).toBe(1200);
    expect(sumar(r.ingresos.filter((x) => x.moneda === 'CRC'))).toBe(10000);
  });

  it('sin cobros: error propio', async () => {
    const l = await leerEstadoDeCuenta(archivo('Fecha,Detalle,Credito,Debito\n07/11/2026,Pago,,50\n'));
    expect(() => leerIngresos(l, l.deteccion.columnas)).toThrowError(ErrorDeLectura);
  });
});

describe('CSV de salida', () => {
  const tx: TextosCsv = {
    fecha: 'Fecha', descripcion: 'Descripción', monto: 'Monto', moneda: 'Moneda', esSinpe: 'SINPE',
    esVenta: 'Es venta', si: 'Sí', no: 'No', totalVentas: 'Total de ventas', cantidadVentas: 'Cantidad de ventas',
  };
  const ing = (id: string, descripcion: string, centimos: number, esSinpe = true): Ingreso => ({
    id, fecha: '2026-11-07', mes: '2026-11', descripcion, centimos, moneda: 'CRC', esSinpe,
  });

  it('lleva BOM, totales de lo marcado y neutraliza formulas', () => {
    const datos = [ing('1', '=HYPERLINK("http://x","clic")', 150050), ing('2', '+1+1', 100), ing('3', '-2', 100), ing('4', '@SUM(A1)', 100), ing('5', '\tcmd', 100), ing('6', '\rx', 100), ing('7', 'Normal "con comillas", y coma', 25)];
    const csv = construirCsv(datos, (x) => x.id === '1' || x.id === '7', tx);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(csv).toContain(`"'+1+1"`);
    expect(csv).toContain(`"'-2"`);
    expect(csv).toContain(`"'@SUM(A1)"`);
    expect(csv).toContain(`"'\tcmd"`);
    expect(csv).toContain(`"'\rx"`);
    expect(csv).toContain('"Normal ""con comillas"", y coma"');
    expect(csv).toContain('"Total de ventas",1500.75');
    expect(csv).toContain('"Cantidad de ventas",2');
    // Ninguna celda de texto empieza con un caracter de formula sin apostrofo.
    for (const linea of csv.split('\n').slice(2)) {
      expect(linea).not.toMatch(/(^|,)"[=+\-@\t\r]/);
    }
  });
});
