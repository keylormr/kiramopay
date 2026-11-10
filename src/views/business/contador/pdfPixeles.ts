/**
 * Pasa los pixeles de un canvas a lo que cabe en pocos bytes: gris de 4 bits
 * (16 tonos) y comprimido con Flate. El PDF es blanco, gris y negro, asi que el
 * color no se pierde, y 16 tonos bastan para el borde suave de las letras a 180
 * ppp. Una pagina pesa unas decenas de KB; el mismo canvas en JPEG, cientos.
 */

/**
 * RGBA -> gris de 4 bits, dos pixeles por byte (el primero en el nibble alto).
 * Cada fila empieza en un byte nuevo, como pide PDF; el sobrante de una fila de
 * ancho impar queda en cero. La luminancia ignora el alfa: el canvas del PDF es
 * opaco.
 */
export function empaquetarGris4(rgba: Uint8ClampedArray | Uint8Array, ancho: number, alto: number): Uint8Array {
  const porFila = Math.ceil(ancho / 2);
  const salida = new Uint8Array(porFila * alto);
  for (let y = 0; y < alto; y += 1) {
    const origen = y * ancho * 4;
    const destino = y * porFila;
    for (let x = 0; x < ancho; x += 1) {
      const i = origen + x * 4;
      const luz = (299 * rgba[i] + 587 * rgba[i + 1] + 114 * rgba[i + 2]) / 1000;
      const tono = Math.round((luz * 15) / 255);
      salida[destino + (x >> 1)] |= x & 1 ? tono : tono << 4;
    }
  }
  return salida;
}

/** True si el WebView sabe comprimir (Chrome 80, Safari 16.4); si no, el PDF usa JPEG. */
export function sabeComprimir(): boolean {
  return typeof CompressionStream === 'function';
}

/** Lo que sale de un flujo, junto. */
export async function juntar(flujo: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const lector = flujo.getReader();
  const trozos: Uint8Array[] = [];
  let largo = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(value);
    largo += value.length;
  }
  const todo = new Uint8Array(largo);
  let en = 0;
  for (const t of trozos) {
    todo.set(t, en);
    en += t.length;
  }
  return todo;
}

/** Flate en formato zlib, que es el que PDF espera en un filtro FlateDecode. */
export function comprimir(bytes: Uint8Array): Promise<Uint8Array> {
  const origen = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  return juntar(origen.pipeThrough(new CompressionStream('deflate')));
}
