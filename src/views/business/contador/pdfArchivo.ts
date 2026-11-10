/**
 * Empaquetado de un PDF a partir de una imagen por pagina.
 *
 * Por que no una libreria ni texto vectorial: el PDF sale en los siete idiomas
 * de la app, incluidos hindi, japones y chino. Una fuente estandar de PDF solo
 * cubre latin (WinAnsi); para esos tres idiomas haria falta incrustar fuentes de
 * varios megabytes y dar forma al devanagari por cuenta propia. En cambio el
 * WebView ya sabe dibujar los siete idiomas con las fuentes del telefono: cada
 * pagina se dibuja en un canvas y aqui solo se envuelve su imagen en un PDF
 * valido (un objeto por pagina, sin dependencias). Cuesta que el texto del PDF
 * no se pueda seleccionar; para copiar cifras esta el CSV.
 */

export interface OpcionesPdf {
  titulo: string;
  /** Codigo del idioma de la app (es, en, zh-cn...). */
  idioma: string;
  /** Cuando se armo el archivo. */
  fecha: Date;
  /** Tamano de pagina en puntos. */
  ancho: number;
  alto: number;
}

/**
 * La imagen de una pagina, ya codificada. `gris4` es gris de 4 bits comprimido
 * con Flate (ver pdfPixeles); `jpeg` es el respaldo de un WebView que no sabe
 * comprimir.
 */
export interface ImagenPdf {
  ancho: number;
  alto: number;
  formato: 'gris4' | 'jpeg';
  datos: Uint8Array;
}

const dos = (n: number) => String(n).padStart(2, '0');

/** D:AAAAMMDDHHmmSSZ, en UTC. */
function fechaPdf(f: Date): string {
  return `D:${f.getUTCFullYear()}${dos(f.getUTCMonth() + 1)}${dos(f.getUTCDate())}${dos(f.getUTCHours())}${dos(f.getUTCMinutes())}${dos(f.getUTCSeconds())}Z`;
}

/** Una cadena de texto de PDF en UTF-16 BE con marca de orden, en hexadecimal: sirve para cualquier idioma. */
export function cadenaPdf(texto: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < texto.length; i += 1) hex += texto.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

/** Idioma de la app como etiqueta de idioma de PDF (solo ASCII). */
function etiquetaDeIdioma(idioma: string): string {
  return idioma === 'zh-cn' ? 'zh-CN' : /^[a-z]{2,3}$/i.test(idioma) ? idioma : 'es';
}

/** Lo que el diccionario de una imagen dice de como leer sus bytes. */
function descripcion(i: ImagenPdf): string {
  return i.formato === 'jpeg'
    ? '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'
    : '/ColorSpace /DeviceGray /BitsPerComponent 4 /Filter /FlateDecode';
}

/**
 * Arma el PDF: una pagina por imagen, cada una a tamano completo. Lanza si no
 * hay paginas o si un "jpeg" no empieza como un JPEG.
 */
export function armarPdf(imagenes: ImagenPdf[], op: OpcionesPdf): Uint8Array {
  if (imagenes.length === 0) throw new Error('SIN_PAGINAS');
  for (const i of imagenes) {
    if (i.formato === 'jpeg' && (i.datos[0] !== 0xff || i.datos[1] !== 0xd8)) throw new Error('JPEG_INVALIDO');
  }
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const posiciones: number[] = [];
  let largo = 0;
  const escribir = (x: string | Uint8Array) => {
    const bytes = typeof x === 'string' ? enc.encode(x) : x;
    partes.push(bytes);
    largo += bytes.length;
  };
  const objeto = (numero: number, cuerpo: string | Uint8Array[]) => {
    posiciones[numero] = largo;
    escribir(`${numero} 0 obj\n`);
    if (typeof cuerpo === 'string') escribir(cuerpo);
    else cuerpo.forEach(escribir);
    escribir('\nendobj\n');
  };

  // Objetos: 1 catalogo, 2 arbol de paginas, 3 informacion; despues, por pagina,
  // la pagina, su contenido y su imagen.
  const primeraPagina = 4;
  const hojas = imagenes.map((_, i) => primeraPagina + i * 3);

  // La segunda linea, con bytes altos, avisa a los programas de que es binario.
  escribir('%PDF-1.4\n');
  escribir(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  objeto(1, `<< /Type /Catalog /Pages 2 0 R /Lang (${etiquetaDeIdioma(op.idioma)}) /ViewerPreferences << /DisplayDocTitle true >> >>`);
  objeto(2, `<< /Type /Pages /Kids [${hojas.map((n) => `${n} 0 R`).join(' ')}] /Count ${imagenes.length} >>`);
  objeto(3, `<< /Title ${cadenaPdf(op.titulo)} /Producer (KiramoPay) /CreationDate (${fechaPdf(op.fecha)}) >>`);

  imagenes.forEach((imagen, i) => {
    const pagina = hojas[i];
    const contenido = `q ${op.ancho} 0 0 ${op.alto} 0 0 cm /Im0 Do Q\n`;
    objeto(
      pagina,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${op.ancho} ${op.alto}] /Resources << /XObject << /Im0 ${pagina + 2} 0 R >> >> /Contents ${pagina + 1} 0 R >>`,
    );
    objeto(pagina + 1, `<< /Length ${enc.encode(contenido).length} >>\nstream\n${contenido}endstream`);
    objeto(pagina + 2, [
      enc.encode(
        `<< /Type /XObject /Subtype /Image /Width ${imagen.ancho} /Height ${imagen.alto} ` +
          `${descripcion(imagen)} /Length ${imagen.datos.length} >>\nstream\n`,
      ),
      imagen.datos,
      enc.encode('\nendstream'),
    ]);
  });

  const total = primeraPagina + imagenes.length * 3;
  const inicioXref = largo;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n += 1) xref += `${String(posiciones[n]).padStart(10, '0')} 00000 n \n`;
  escribir(xref);
  escribir(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);

  const salida = new Uint8Array(largo);
  let en = 0;
  for (const p of partes) {
    salida.set(p, en);
    en += p.length;
  }
  return salida;
}
