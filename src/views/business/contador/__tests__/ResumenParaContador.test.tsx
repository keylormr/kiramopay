import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ResumenParaContador } from '../ResumenParaContador';
import { leerEstadoDeCuenta } from '../lector';
import { extraerIngresos } from '../ingresos';

const mocks = vi.hoisted(() => ({ entregar: vi.fn(), pdf: vi.fn() }));
vi.mock('@/utils/entregarArchivo', () => ({ entregarArchivo: mocks.entregar }));
// jsdom no dibuja canvas: el PDF real se prueba por partes (pdfContenido, pdfDiseno,
// pdfArchivo) y de punta a punta en un navegador. Aqui se mira lo que la pantalla le entrega.
vi.mock('../pdfSalida', () => ({ construirPdf: mocks.pdf }));

const archivo = (contenido: string | Uint8Array) => {
  const b = typeof contenido === 'string' ? new TextEncoder().encode(contenido) : contenido;
  return { size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

const CSV = [
  'Estado de cuenta,,',
  'Fecha,Descripcion,Credito,Debito',
  '03/11/2026,SINPE Movil Ana,"10,000.00",',
  '05/11/2026,SINPE Movil Luis,"2,500.50",',
  '06/11/2026,Deposito en ventanilla,"4,000.00",',
  '07/11/2026,Pago de luz,,"9,000.00"',
  '02/10/2026,SINPE Movil Octubre,"700.00",',
].join('\n');

const total = () => screen.getByText('Cobros marcados como venta').parentElement as HTMLElement;

let setItem: ReturnType<typeof vi.spyOn>;
let fetchEspia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.entregar.mockReset();
  mocks.entregar.mockResolvedValue('listo');
  mocks.pdf.mockReset();
  mocks.pdf.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
  fetchEspia = vi.fn();
  vi.stubGlobal('fetch', fetchEspia);
  setItem = vi.spyOn(Storage.prototype, 'setItem');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setItem.mockRestore();
});

const pintar = () =>
  render(
    <LanguageProvider>
      <ResumenParaContador onClose={() => {}} />
    </LanguageProvider>,
  );

const subir = (contenido: string | Uint8Array) => {
  // El espia se arma despues de que el proveedor guardo el idioma.
  setItem.mockClear();
  fireEvent.change(screen.getByTestId('contador-archivo'), { target: { files: [archivo(contenido)] } });
};

describe('Resumen para el contador: inicio', () => {
  it('dice lo que hace, la promesa, el boton, los formatos y la nota de Hacienda', () => {
    pintar();
    expect(screen.getByText('Tu archivo se lee en este teléfono y no se envía a KiramoPay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elegir archivo' })).toBeInTheDocument();
    expect(screen.getByText(/Formatos: Excel \(\.xlsx\)/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Si cobras por SINPE para tu negocio, Hacienda pide anotar ese número en tu registro tributario. Pregúntale a tu contador cómo y cuándo hacerlo.',
      ),
    ).toBeInTheDocument();
  });
});

describe('Resumen para el contador: flujo completo', () => {
  it('lee, muestra el mes y recalcula al desmarcar; comparte el CSV con lo marcado', async () => {
    const u = userEvent.setup();
    pintar();
    subir(CSV);

    // Noviembre: dos cobros SINPE marcados; el deposito va en "Otros ingresos".
    expect(await screen.findByText('Cobros marcados como venta')).toBeInTheDocument();
    expect(total()).toHaveTextContent('12,500.50');
    expect(screen.getByText('2 cobros')).toBeInTheDocument();
    expect(screen.getByText(/No es una declaración de impuestos ni una factura/)).toBeInTheDocument();
    expect(screen.queryByText('Pago de luz')).not.toBeInTheDocument();
    expect(screen.queryByText('SINPE Movil Octubre')).not.toBeInTheDocument();

    // Desmarcar recalcula.
    const ana = screen.getByRole('switch', { name: /SINPE Movil Ana/ });
    expect(ana).toHaveAttribute('aria-checked', 'true');
    await u.click(ana);
    expect(ana).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('1 cobro')).toBeInTheDocument();
    expect(total()).toHaveTextContent('2,500.50');

    // Otros ingresos: plegado, apagado; marcarlo lo suma.
    const otros = screen.getByRole('button', { name: /Otros ingresos \(1\)/ });
    expect(otros).toHaveAttribute('aria-expanded', 'false');
    await u.click(otros);
    const deposito = screen.getByRole('switch', { name: /Deposito en ventanilla/ });
    expect(deposito).toHaveAttribute('aria-checked', 'false');
    await u.click(deposito);
    expect(screen.getByText('2 cobros')).toBeInTheDocument();

    // Cambiar de mes.
    await u.selectOptions(screen.getByLabelText('Mes'), '2026-10');
    expect(screen.getByRole('switch', { name: /SINPE Movil Octubre/ })).toHaveAttribute('aria-checked', 'true');

    // Compartir: el CSV del mes elegido.
    await u.selectOptions(screen.getByLabelText('Mes'), '2026-11');
    await u.click(screen.getByRole('button', { name: 'Compartir con mi contador: CSV' }));
    await waitFor(() => expect(mocks.entregar).toHaveBeenCalledTimes(1));
    const [blob, nombre] = mocks.entregar.mock.calls[0] as [Blob, string];
    expect(nombre).toBe('KiramoPay-resumen-para-contador-2026-11.csv');
    const texto = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsText(blob);
    });
    expect(texto).toContain('SINPE Movil Luis');
    expect(texto).not.toContain('Pago de luz');
    expect(texto).toContain('"Cantidad de ventas",2');
    expect(texto).toContain('"Total de ventas",6500.50');
    expect(await screen.findByText('Resumen guardado en tu dispositivo.')).toBeInTheDocument();
  });

  it('el archivo no sale del telefono: ni fetch ni almacenamiento con sus datos', async () => {
    pintar();
    subir(CSV);
    await screen.findByText('Cobros marcados como venta');
    await userEvent.setup().click(screen.getByRole('switch', { name: /SINPE Movil Ana/ }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Compartir con mi contador: CSV' }));
    await waitFor(() => expect(mocks.entregar).toHaveBeenCalledTimes(1));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Compartir con mi contador: PDF' }));
    await waitFor(() => expect(mocks.entregar).toHaveBeenCalledTimes(2));

    expect(fetchEspia).not.toHaveBeenCalled();
    const escrituras = JSON.stringify(setItem.mock.calls) + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    for (const pista of ['SINPE Movil', 'Ana', 'Luis', '10,000', 'Deposito']) {
      expect(escrituras).not.toContain(pista);
    }
  });

  it('si hay dos monedas pide elegir una y no las suma', async () => {
    const u = userEvent.setup();
    pintar();
    subir('Fecha,Detalle,Credito,Moneda\n03/11/2026,SINPE A,1000,CRC\n04/11/2026,SINPE B,5,USD\n');
    await screen.findByText('Cobros marcados como venta');
    const sel = screen.getByLabelText('Moneda');
    expect(sel).toHaveValue('CRC');
    expect(screen.getByText('1 cobro')).toBeInTheDocument();
    await u.selectOptions(sel, 'USD');
    expect(screen.getByRole('switch', { name: /SINPE B/ })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /SINPE A/ })).not.toBeInTheDocument();
  });

  it('un mes sin SINPE lo dice', async () => {
    pintar();
    subir('Fecha,Detalle,Credito\n03/11/2026,Deposito,1000\n');
    expect(await screen.findByText('No hay cobros por SINPE en este mes.')).toBeInTheDocument();
  });
});

describe('Resumen para el contador: PDF', () => {
  const botonPdf = () => screen.getByRole('button', { name: 'Compartir con mi contador: PDF' });
  const botonCsv = () => screen.getByRole('button', { name: 'Compartir con mi contador: CSV' });

  it('el boton de PDF esta junto al de CSV, en la misma fila', async () => {
    pintar();
    subir(CSV);
    await screen.findByText('Cobros marcados como venta');
    expect(botonPdf().parentElement).toBe(botonCsv().parentElement);
    expect(botonPdf()).toHaveTextContent('PDF');
    expect(botonCsv()).toHaveTextContent('CSV');
    expect(screen.getByText('CSV para abrir en Excel. PDF para leer o imprimir.')).toBeInTheDocument();
  });

  it('entrega un PDF del mes con lo mismo que la pantalla: total, cobros y marcas', async () => {
    const u = userEvent.setup();
    pintar();
    subir(CSV);
    await screen.findByText('Cobros marcados como venta');
    await u.click(screen.getByRole('switch', { name: /SINPE Movil Ana/ }));
    await u.click(botonPdf());

    await waitFor(() => expect(mocks.entregar).toHaveBeenCalledTimes(1));
    const [blob, nombre] = mocks.entregar.mock.calls[0] as [Blob, string];
    expect(nombre).toBe('KiramoPay-resumen-para-contador-2026-11.pdf');
    expect(blob.type).toBe('application/pdf');

    const [contenido, idioma] = mocks.pdf.mock.calls[0];
    expect(idioma).toBe('es');
    expect(contenido).toMatchObject({
      titulo: 'Resumen de cobros por SINPE',
      subtitulo: 'Noviembre de 2026 · Moneda: CRC',
      total: '₡2,500.50',
      cantidad: '1 cobro',
    });
    expect(contenido.total).toBe(total().querySelector('p')!.textContent);
    expect(contenido.aviso).toMatch(/ayuda.*no es un comprobante fiscal/i);
    expect(contenido.secciones[0].filas).toEqual([
      { fecha: '03/11/2026', descripcion: 'SINPE Movil Ana', monto: '₡10,000.00', venta: 'No' },
      { fecha: '05/11/2026', descripcion: 'SINPE Movil Luis', monto: '₡2,500.50', venta: 'Sí' },
    ]);
    expect(contenido.secciones[1]).toMatchObject({
      titulo: 'Otros ingresos (1)',
      filas: [{ descripcion: 'Deposito en ventanilla', venta: 'No' }],
    });
    // Nada de octubre ni la salida de luz.
    expect(JSON.stringify(contenido)).not.toContain('Octubre');
    expect(JSON.stringify(contenido)).not.toContain('Pago de luz');
    expect(await screen.findByText('Resumen guardado en tu dispositivo.')).toBeInTheDocument();
  });

  it('con dos monedas el archivo lleva la moneda en el nombre, como el CSV', async () => {
    const u = userEvent.setup();
    pintar();
    subir('Fecha,Detalle,Credito,Moneda\n03/11/2026,SINPE A,1000,CRC\n04/11/2026,SINPE B,5,USD\n');
    await screen.findByText('Cobros marcados como venta');
    await u.selectOptions(screen.getByLabelText('Moneda'), 'USD');
    await u.click(botonPdf());
    await waitFor(() => expect(mocks.entregar).toHaveBeenCalledTimes(1));
    expect(mocks.entregar.mock.calls[0][1]).toBe('KiramoPay-resumen-para-contador-2026-11-USD.pdf');
    expect(mocks.pdf.mock.calls[0][0]).toMatchObject({ total: '$5.00', subtitulo: 'Noviembre de 2026 · Moneda: USD' });
  });

  it('mientras se arma uno, ninguno de los dos botones deja pedir otro', async () => {
    let terminar: (b: Blob) => void = () => {};
    mocks.pdf.mockReturnValue(new Promise<Blob>((r) => { terminar = r; }));
    const u = userEvent.setup();
    pintar();
    subir(CSV);
    await screen.findByText('Cobros marcados como venta');
    await u.click(botonPdf());
    expect(botonPdf()).toBeDisabled();
    expect(botonCsv()).toBeDisabled();
    expect(mocks.pdf).toHaveBeenCalledTimes(1);
    terminar(new Blob(['x']));
    await waitFor(() => expect(botonPdf()).toBeEnabled());
    expect(mocks.entregar).toHaveBeenCalledTimes(1);
  });

  it('si no se puede armar el PDF lo dice y no entrega nada', async () => {
    mocks.pdf.mockRejectedValue(new Error('SIN_CANVAS'));
    const u = userEvent.setup();
    pintar();
    subir(CSV);
    await screen.findByText('Cobros marcados como venta');
    await u.click(botonPdf());
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos preparar el resumen. Inténtalo de nuevo.');
    expect(mocks.entregar).not.toHaveBeenCalled();
    expect(botonPdf()).toBeEnabled();
  });

  it('el PDF sale en el idioma de la persona', async () => {
    localStorage.setItem('kiramopay_language', 'ja');
    const u = userEvent.setup();
    pintar();
    subir(CSV);
    await screen.findByText('売上として選んだ入金');
    await u.click(screen.getByRole('button', { name: '会計士に共有する: PDF' }));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledTimes(1));
    const [contenido, idioma] = mocks.pdf.mock.calls[0];
    expect(idioma).toBe('ja');
    expect(contenido.titulo).toBe('SINPE入金の集計');
    expect(contenido.aviso).toContain('請求書でも');
    expect(contenido.cantidad).toBe('2件');
  });
});

describe('Resumen para el contador: confirmar columnas', () => {
  it('con encabezados irreconocibles pide las columnas y sigue al confirmar', async () => {
    const u = userEvent.setup();
    pintar();
    subir('Dia,Texto,Entrada\n03/11/2026,SINPE Movil Ana,5000\n04/11/2026,Otro,100\n');
    expect(await screen.findByRole('heading', { name: 'Confirma las columnas' })).toBeInTheDocument();
    expect(screen.getByText('Vista previa')).toBeInTheDocument();
    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();
    await u.selectOptions(screen.getByLabelText('Fecha'), '0');
    await u.selectOptions(screen.getByLabelText('Descripción'), '1');
    await u.selectOptions(screen.getByLabelText('Ingresos (créditos o monto)'), '2');
    await u.click(continuar);
    expect(await screen.findByText('Cobros marcados como venta')).toBeInTheDocument();
    expect(screen.getByText('1 cobro')).toBeInTheDocument();
  });
});

describe('Resumen para el contador: errores', () => {
  const casos: Array<[string, string | Uint8Array, string]> = [
    ['PDF', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), 'Este archivo es un PDF. Descárgalo en Excel o CSV desde tu banco.'],
    ['Excel viejo', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'Este archivo es un Excel antiguo (.xls) que no podemos leer. Ábrelo en Excel y guárdalo como .xlsx o CSV, o vuelve a descargarlo en uno de esos formatos.'],
    ['sin cobros', 'Fecha,Detalle,Credito,Debito\n03/11/2026,Pago,,100\n', 'No encontramos cobros en este archivo. Revisa que sea un estado de cuenta con columna de créditos o depósitos, o elige otro archivo.'],
    ['ilegible', new Uint8Array([1, 0, 2, 0, 3]), 'No pudimos leer este archivo. Descárgalo de nuevo desde tu banco en Excel (.xlsx) o CSV, o elige otro.'],
  ];
  it.each(casos)('%s: dice que paso y que hacer', async (_n, contenido, texto) => {
    pintar();
    subir(contenido);
    expect(await screen.findByRole('alert')).toHaveTextContent(texto);
    expect(screen.getByRole('button', { name: 'Elegir otro archivo' })).toBeInTheDocument();
  });

  it('muy grande', async () => {
    pintar();
    fireEvent.change(screen.getByTestId('contador-archivo'), {
      target: { files: [{ size: 6 * 1024 * 1024, arrayBuffer: vi.fn() }] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('El archivo pesa más de 5 MB.');
  });

  it('ningun texto de la pantalla esta en mayusculas sostenidas', async () => {
    pintar();
    subir(CSV);
    const raiz = await screen.findByText('Cobros marcados como venta');
    const texto = within(raiz.closest('section') as HTMLElement).getAllByText(/./).map((n) => n.textContent ?? '');
    for (const t of texto) expect(/[A-ZÁÉÍÓÚÑ]{6,}/.test(t.replace(/SINPE|CRC|USD/g, ''))).toBe(false);
  });
});

describe('HTML guardado como .xls', () => {
  it('se lee con DOMParser', async () => {
    const html = '<html><body><table><tr><td>Banco</td></tr><tr><th>Fecha</th><th>Detalle</th><th>Crédito</th></tr><tr><td>07/11/2026</td><td>SINPE &amp; cobro</td><td>1.500,00</td></tr></table></body></html>';
    const l = await leerEstadoDeCuenta(archivo(html));
    const r = extraerIngresos(l.tabla, l.deteccion.columnas, l.deteccion.filaEncabezado);
    expect(l.deteccion.filaEncabezado).toBe(1);
    expect(r.ingresos[0]).toMatchObject({ descripcion: 'SINPE & cobro', centimos: 150000, esSinpe: true });
  });

  it('una tabla con script no lo ejecuta', async () => {
    (globalThis as { __x?: number }).__x = 0;
    const html = '<table><tr><td>Fecha</td><td>Detalle</td><td>Credito</td></tr><tr><td>07/11/2026</td><td><script>globalThis.__x=1</script>SINPE</td><td>10</td></tr></table>';
    await leerEstadoDeCuenta(archivo(html));
    expect((globalThis as { __x?: number }).__x).toBe(0);
  });
});

describe('Resumen para el contador: lo que el archivo no dice', () => {
  const SIN_MONEDA = 'Fecha;Detalle;Credito\n01/11/2026;SINPE MOVIL;1500.00\n';
  const SIN_SIGNO = 'Fecha;Detalle;Monto\n01/11/2026;SINPE MOVIL RECIBIDO;1500.00\n02/11/2026;SINPE MOVIL ENVIADO;900.00\n';

  it('sin moneda en el archivo deja confirmarla y cambia el simbolo de todo', async () => {
    const u = userEvent.setup();
    pintar();
    subir(SIN_MONEDA);
    const selector = await screen.findByLabelText(/Moneda de esta cuenta/);
    expect(document.body.textContent).toContain('₡1,500.00');

    await u.selectOptions(selector, 'USD');
    expect(document.body.textContent).toContain('$1,500.00');
    expect(document.body.textContent).not.toContain('₡1,500.00');
  });

  it('con moneda en el archivo no la pregunta', async () => {
    pintar();
    subir('Fecha;Detalle;Credito;Moneda\n01/11/2026;SINPE MOVIL;1500.00;CRC\n');
    await screen.findByText('Cobros marcados como venta');
    expect(screen.queryByLabelText(/Moneda de esta cuenta/)).not.toBeInTheDocument();
  });

  it('avisa cuando el archivo no distingue entradas de salidas', async () => {
    pintar();
    subir(SIN_SIGNO);
    expect(await screen.findByText(/no distingue entradas de salidas/)).toBeInTheDocument();
  });
});
