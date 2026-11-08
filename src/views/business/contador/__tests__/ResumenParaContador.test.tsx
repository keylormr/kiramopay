import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ResumenParaContador } from '../ResumenParaContador';
import { leerEstadoDeCuenta } from '../lector';
import { extraerIngresos } from '../ingresos';

const mocks = vi.hoisted(() => ({ entregar: vi.fn() }));
vi.mock('@/utils/entregarArchivo', () => ({ entregarArchivo: mocks.entregar }));

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
    await u.click(screen.getByRole('button', { name: 'Compartir con mi contador' }));
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
    await userEvent.setup().click(screen.getByRole('button', { name: 'Compartir con mi contador' }));
    await waitFor(() => expect(mocks.entregar).toHaveBeenCalled());

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
