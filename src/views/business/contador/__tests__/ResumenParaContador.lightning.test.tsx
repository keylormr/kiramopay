import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ResumenParaContador } from '../ResumenParaContador';
import type { VentaLightning } from '@/api/repositories/qrpayment.repository';

// Los cobros por Lightning del comercio entran al resumen para el contador:
// su seccion con los sats y el precio del bitcoin, el total de ventas y el
// CSV con la columna del medio. Si no se pudieron traer, se dice y el archivo
// no los inventa.
const mocks = vi.hoisted(() => ({ entregar: vi.fn(), pdf: vi.fn(), getLightningSales: vi.fn() }));
vi.mock('@/utils/entregarArchivo', () => ({ entregarArchivo: mocks.entregar }));
vi.mock('../pdfSalida', () => ({ construirPdf: mocks.pdf }));
vi.mock('@/api', () => ({ getApiLayer: () => ({ qrPayments: { getLightningSales: mocks.getLightningSales } }) }));

const archivo = (contenido: string) => {
  const b = new TextEncoder().encode(contenido);
  return { size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

const CSV = [
  'Fecha,Descripcion,Credito,Debito',
  '03/11/2026,SINPE Movil Ana,"10,000.00",',
  '02/10/2026,SINPE Movil Octubre,"700.00",',
].join('\n');

const venta = (p: Partial<VentaLightning> = {}): VentaLightning => ({
  chargeId: 'c1', note: '2x Casado', monto: 5000, currency: 'CRC', sats: 12_500, precioBtc: '40000000',
  paymentHash: '00', paidAt: new Date(2026, 10, 5, 12, 0).toISOString(), chargeStatus: 'paid', ...p,
});

const pintar = (merchantId?: string) =>
  render(
    <LanguageProvider>
      <ResumenParaContador onClose={() => {}} merchantId={merchantId} />
    </LanguageProvider>,
  );

const subir = () => fireEvent.change(screen.getByTestId('contador-archivo'), { target: { files: [archivo(CSV)] } });
const total = () => screen.getByText('Cobros marcados como venta').parentElement as HTMLElement;
const leer = (blob: Blob) =>
  new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsText(blob);
  });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.entregar.mockReset();
  mocks.entregar.mockResolvedValue('listo');
  mocks.pdf.mockReset();
  mocks.pdf.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
  mocks.getLightningSales.mockReset();
});

describe('Resumen para el contador con cobros por Lightning', () => {
  it('pide las del mes, las suma a las ventas, las lista y las lleva al CSV', async () => {
    mocks.getLightningSales.mockResolvedValue({
      success: true,
      data: [venta(), venta({ chargeId: 'u1', currency: 'USD', monto: 10 })],
    });
    pintar('m1');
    subir();
    await screen.findByText('Cobros marcados como venta');
    await waitFor(() => expect(mocks.getLightningSales).toHaveBeenCalledWith('m1', '2026-11'));

    expect(await screen.findByText('Cobros por Lightning')).toBeInTheDocument();
    expect(screen.getByText('2x Casado')).toBeInTheDocument();
    expect(screen.getByText('12,500 sats · 1 BTC = ₡40,000,000.00')).toBeInTheDocument();
    // 10.000 del banco + 5.000 por Lightning; el cobro en dolares es de otro resumen.
    expect(total()).toHaveTextContent('15,000.00');
    expect(total()).toHaveTextContent('2 cobros');
    expect(total()).toHaveTextContent('Por Lightning: ₡5,000.00');
    expect(screen.getByText(/apaga «Es venta» en ese ingreso para no contarlo dos veces/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Compartir con mi contador: CSV' }));
    await waitFor(() => expect(mocks.entregar).toHaveBeenCalledTimes(1));
    const texto = await leer(mocks.entregar.mock.calls[0][0] as Blob);
    expect(texto).toContain('"Medio","Sats","Precio de 1 BTC"');
    expect(texto).toContain('"2x Casado",5000.00,"CRC","No","Sí","Lightning",12500,"40000000"');
    expect(texto).toContain('"Total por Lightning",5000.00');
    expect(texto).not.toContain('10.00,"USD"');
  });

  it('el PDF lleva la seccion, el total y el detalle como en la pantalla', async () => {
    mocks.getLightningSales.mockResolvedValue({ success: true, data: [venta()] });
    pintar('m1');
    subir();
    await screen.findByText('Cobros por Lightning');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Compartir con mi contador: PDF' }));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledTimes(1));
    const contenido = mocks.pdf.mock.calls[0][0] as { total: string; secciones: { titulo: string; filas: { descripcion: string }[] }[]; notas: string[] };
    expect(contenido.total).toBe('₡15,000.00');
    const seccion = contenido.secciones.find((s) => s.titulo === 'Cobros por Lightning');
    expect(seccion?.filas[0].descripcion).toBe('2x Casado · 12,500 sats · 1 BTC = ₡40,000,000.00');
    expect(contenido.notas).toContain('Por Lightning: ₡5,000.00');
  });

  it('cambia de mes y pide las de ese mes', async () => {
    mocks.getLightningSales.mockResolvedValue({ success: true, data: [] });
    pintar('m1');
    subir();
    await screen.findByText('Cobros marcados como venta');
    await userEvent.setup().selectOptions(screen.getByLabelText('Mes'), '2026-10');
    await waitFor(() => expect(mocks.getLightningSales).toHaveBeenCalledWith('m1', '2026-10'));
    // Sin cobros por Lightning no hay seccion ni linea aparte.
    expect(screen.queryByText('Cobros por Lightning')).not.toBeInTheDocument();
    expect(screen.queryByText(/Por Lightning:/)).not.toBeInTheDocument();
  });

  it('si no se pudieron traer lo dice, no deja compartir un archivo corto y deja reintentar', async () => {
    mocks.getLightningSales
      .mockResolvedValueOnce({ success: false, error: { code: 'LIGHTNING_SALES_FAILED', message: '' } })
      .mockResolvedValueOnce({ success: true, data: [venta()] });
    const user = userEvent.setup();
    pintar('m1');
    subir();
    expect(
      await screen.findByText('No se pudieron traer los cobros por Lightning. Reintenta para compartir el archivo completo.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Por Lightning:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compartir con mi contador: CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Compartir con mi contador: PDF' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('2x Casado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compartir con mi contador: CSV' })).toBeEnabled();
  });

  it('mientras llegan, el archivo espera para no salir sin ellas', async () => {
    let soltar: (v: unknown) => void = () => {};
    mocks.getLightningSales.mockImplementation(() => new Promise((r) => { soltar = r; }));
    pintar('m1');
    subir();
    await screen.findByText('Cobros marcados como venta');
    expect(screen.getByRole('button', { name: 'Compartir con mi contador: CSV' })).toBeDisabled();
    soltar({ success: true, data: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compartir con mi contador: CSV' })).toBeEnabled());
  });

  it('sin comercio (un cajero) no pregunta al servidor', async () => {
    pintar();
    subir();
    await screen.findByText('Cobros marcados como venta');
    expect(mocks.getLightningSales).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Compartir con mi contador: CSV' })).toBeEnabled();
  });
});
