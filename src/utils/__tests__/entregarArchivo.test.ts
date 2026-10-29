import { entregarArchivo } from '../entregarArchivo';

// En la app del telefono, exportar no guardaba nada: el enlace <a download> con
// una URL blob: lo ignora el WebView de Android en silencio (el puente de
// Capacitor no registra un DownloadListener) y la pantalla igual decia
// "exportado". Ahora el archivo se escribe en la cache de la app y se abre el
// menu de compartir del sistema con ese archivo.

const nativo = vi.hoisted(() => ({
  esNativo: false,
  plugins: new Set<string>(),
  writeFile: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: {
    isNativePlatform: () => nativo.esNativo,
    isPluginAvailable: (nombre: string) => nativo.plugins.has(nombre),
    getPlatform: () => (nativo.esNativo ? 'android' : 'web'),
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: nativo.writeFile },
  Directory: { Cache: 'CACHE' },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: nativo.share },
}));

const URI = 'file:///data/user/0/com.kiramopay.app/cache/KiramoPay-Transacciones-2026-10-29.csv';
// Con acentos y el BOM del CSV: lo que se escribe tiene que ser el UTF-8 exacto.
const CONTENIDO = '﻿sep=,\n"Título","Monto"\n"Café",-1500.00';

function enElTelefono(plugins: string[] = ['Filesystem', 'Share']) {
  nativo.esNativo = true;
  nativo.plugins = new Set(plugins);
}

beforeEach(() => {
  nativo.esNativo = false;
  nativo.plugins = new Set();
  nativo.writeFile.mockReset().mockResolvedValue({ uri: URI });
  nativo.share.mockReset().mockResolvedValue({ activityType: 'com.google.android.gm' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('entregarArchivo en el telefono', () => {
  it('escribe el archivo en la cache de la app y abre el menu de compartir con ese archivo', async () => {
    enElTelefono();

    const estado = await entregarArchivo(
      new Blob([CONTENIDO], { type: 'text/csv;charset=utf-8;' }),
      'KiramoPay-Transacciones-2026-10-29.csv',
    );

    expect(nativo.writeFile).toHaveBeenCalledWith({
      path: 'KiramoPay-Transacciones-2026-10-29.csv',
      directory: 'CACHE',
      // Sin `encoding`: el plugin decodifica el base64 y escribe los bytes tal cual.
      data: Buffer.from(CONTENIDO, 'utf8').toString('base64'),
    });
    expect(nativo.share).toHaveBeenCalledWith(expect.objectContaining({ files: [URI] }));
    expect(estado).toBe('compartido');
  });

  it('si la persona cierra el menu sin compartir, no dice que esta listo', async () => {
    enElTelefono();
    nativo.share.mockRejectedValue(new Error('Share canceled'));

    const estado = await entregarArchivo(new Blob(['a,b']), 'reporte.csv');

    expect(nativo.share).toHaveBeenCalled();
    expect(estado).toBe('quieto');
  });

  it('si no se pudo escribir el archivo, avisa el error y no abre el menu', async () => {
    enElTelefono();
    nativo.writeFile.mockRejectedValue(new Error('disco lleno'));

    const estado = await entregarArchivo(new Blob(['a,b']), 'reporte.csv');

    expect(nativo.share).not.toHaveBeenCalled();
    expect(estado).toBe('error');
  });

  it('un binario viejo sin los plugins conserva el aviso de que se exporta desde la web', async () => {
    enElTelefono(['Filesystem']);

    const estado = await entregarArchivo(new Blob(['a,b']), 'reporte.csv');

    expect(nativo.writeFile).not.toHaveBeenCalled();
    expect(nativo.share).not.toHaveBeenCalled();
    expect(estado).toBe('solo_web');
  });
});

describe('entregarArchivo en el navegador', () => {
  it('descarga el archivo con un enlace, como siempre', async () => {
    const nombres: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:prueba'), configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      nombres.push(this.download);
    });

    const estado = await entregarArchivo(new Blob(['a,b']), 'reporte.csv');

    expect(nombres).toEqual(['reporte.csv']);
    expect(nativo.writeFile).not.toHaveBeenCalled();
    expect(estado).toBe('listo');
  });
});
