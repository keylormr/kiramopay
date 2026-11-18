import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessHomeView } from '../BusinessHomeView';
import { PanelLightning } from '../CobroLightning';
import type { FacturaLightning, QRCharge, QRMerchant } from '@/api/repositories/qrpayment.repository';

// La hoja de cobro con Lightning: el QR de la factura (una sola a la vez, con
// el de KiramoPay), los sats y el precio que dio el servidor, la cuenta
// regresiva de la cotizacion y "pagado con Lightning" solo cuando el cobro lo
// dice. Y SINPE Movil en texto, sin nunca darlo por pagado.
const mocks = vi.hoisted(() => ({
  createChargeLightning: vi.fn(),
  getPaymentMethods: vi.fn(),
  getCharge: vi.fn(),
  createCharge: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    qrPayments: {
      getMerchantBalance: vi.fn().mockResolvedValue({ success: true, data: 0 }),
      getMerchantSummary: vi.fn().mockResolvedValue({ success: false }),
      getCatalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLocations: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getMerchantCode: vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'q1', type: 'merchant_fixed', amount: 0, currency: 'CRC', qrData: 'KP:merchant_fixed:q1' },
      }),
      createCharge: mocks.createCharge,
      getCharge: mocks.getCharge,
      createChargeLightning: mocks.createChargeLightning,
      getPaymentMethods: mocks.getPaymentMethods,
    },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC', user: { id: 'u1' } },
    dispatch: vi.fn(),
  }),
}));

const FACTURA_TEXTO = 'lnbc125u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu';

const factura = (p: Partial<FacturaLightning> = {}): FacturaLightning => ({
  id: 'f1', chargeId: 'ch1', invoice: FACTURA_TEXTO, paymentHash: '00', sats: 12_500, monto: 5000, currency: 'CRC',
  precioBtc: '40000000', cotizacionVence: new Date(Date.now() + 10 * 60_000).toISOString(),
  facturaVence: new Date(Date.now() + 60 * 60_000).toISOString(), status: 'pending', createdAt: new Date().toISOString(),
  ...p,
});

const cobro = (p: Partial<QRCharge> = {}): QRCharge => ({
  id: 'ch1', qrCodeId: 'q1', merchantId: 'm1', createdBy: 'u1', amount: 5000, currency: 'CRC', channel: 'counter',
  status: 'pending', qrData: 'KP:charge:ch1', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  createdAt: new Date().toISOString(), ...p,
});

const COMERCIO = {
  id: 'm1', name: 'Soda', description: '', category: 'food', qrCode: 'MRC-1', active: true, cedula: '3101',
  cedulaType: 'juridica', legalName: 'Soda SA', verificationStatus: 'verified', commissionBps: 50, role: 'cashier',
} as unknown as QRMerchant;

const valorDelQr = () => screen.getByTestId('qr-lightning').querySelector('svg') !== null;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  for (const m of Object.values(mocks)) m.mockReset();
});


describe('PanelLightning', () => {
  const pintar = (onDesactualizado = vi.fn()) =>
    render(
      <LanguageProvider>
        <PanelLightning cobro={cobro()} onCobroDesactualizado={onDesactualizado} />
      </LanguageProvider>,
    );

  it('pide la factura del cobro y muestra los sats, el precio y la cuenta regresiva', async () => {
    mocks.createChargeLightning.mockResolvedValue({ success: true, data: factura() });
    pintar();
    expect(screen.getByText('Pidiendo la factura a la billetera del comercio…')).toBeInTheDocument();
    expect(await screen.findByText('12,500 sats')).toBeInTheDocument();
    expect(mocks.createChargeLightning).toHaveBeenCalledWith('ch1');
    expect(mocks.createChargeLightning).toHaveBeenCalledTimes(1);
    expect(valorDelQr()).toBe(true);
    expect(screen.getByText(/₡5,000\.00 · 1 BTC = ₡40,000,000/)).toBeInTheDocument();
    expect(screen.getByText(/^Precio válido por (10:00|9:5\d)$/)).toBeInTheDocument();
  });

  it('el QR lleva el esquema lightning y la factura en mayusculas', async () => {
    mocks.createChargeLightning.mockResolvedValue({ success: true, data: factura() });
    const { container } = pintar();
    await screen.findByText('12,500 sats');
    // qrcode.react no expone el texto; se compara con el QR del mismo texto.
    const { QRCodeSVG } = await import('qrcode.react');
    const esperado = render(<QRCodeSVG value={`LIGHTNING:${FACTURA_TEXTO.toUpperCase()}`} size={280} />).container;
    const enMinusculas = render(<QRCodeSVG value={FACTURA_TEXTO} size={280} />).container;
    const dibujo = (c: HTMLElement) => c.querySelector('svg path:last-of-type')?.getAttribute('d');
    const delPanel = dibujo(container.querySelector('[data-testid="qr-lightning"]') as HTMLElement);
    expect(delPanel).toBe(dibujo(esperado));
    expect(delPanel).not.toBe(dibujo(enMinusculas));
  });

  it('cuando vence la cotizacion quita el QR y pide un precio nuevo solo al tocar', async () => {
    mocks.createChargeLightning
      .mockResolvedValueOnce({ success: true, data: factura({ cotizacionVence: new Date(Date.now() + 1500).toISOString() }) })
      .mockResolvedValueOnce({ success: true, data: factura({ id: 'f2', sats: 12_600 }) });
    pintar();
    await screen.findByText('12,500 sats');
    expect(
      await screen.findByText('El precio venció. Pide uno nuevo antes de que el cliente pague.', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('qr-lightning')).not.toBeInTheDocument();
    expect(screen.queryByText(/Precio válido por/)).not.toBeInTheDocument();
    expect(mocks.createChargeLightning).toHaveBeenCalledTimes(1);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Pedir precio nuevo' }));
    expect(await screen.findByText('12,600 sats')).toBeInTheDocument();
    expect(mocks.createChargeLightning).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('qr-lightning')).toBeInTheDocument();
  }, 10_000);

  it.each([
    ['LIGHTNING_NO_ADDRESS', 'El comercio no tiene una billetera Lightning conectada. El dueño la agrega en Ajustes.'],
    ['PRICE_STALE', 'No hay un precio del bitcoin confirmado en este momento. Cobra con KiramoPay o inténtalo en un rato.'],
    ['LIGHTNING_PROVIDER_FAILED', 'La billetera del comercio no respondió. Inténtalo de nuevo en un momento.'],
    ['LIGHTNING_AMOUNT_OUT_OF_RANGE', 'La billetera del comercio no acepta ese monto por Lightning.'],
    ['LIGHTNING_FAILED', 'No se pudo preparar el cobro con Lightning.'],
  ])('%s se dice con su texto y deja reintentar', async (code, texto) => {
    mocks.createChargeLightning.mockResolvedValue({ success: false, error: { code, message: 'server text' } });
    const avisar = vi.fn();
    pintar(avisar);
    expect(await screen.findByText(texto)).toBeInTheDocument();
    expect(screen.queryByText('server text')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(avisar).not.toHaveBeenCalled();
  });

  it('si el cobro ya no esta pendiente lo dice y la hoja lo vuelve a leer', async () => {
    mocks.createChargeLightning.mockResolvedValue({ success: false, error: { code: 'COBRO_YA_PAGADO', message: 'x' } });
    const avisar = vi.fn();
    pintar(avisar);
    await waitFor(() => expect(avisar).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('qr-lightning')).not.toBeInTheDocument();
  });

  it('si el panel se cierra con el pedido en curso, la respuesta no hace nada', async () => {
    let soltar: (v: unknown) => void = () => {};
    mocks.createChargeLightning.mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
    const avisar = vi.fn();
    const { unmount } = pintar(avisar);
    await waitFor(() => expect(mocks.createChargeLightning).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      soltar({ success: false, error: { code: 'COBRO_YA_PAGADO', message: '' } });
    });
    expect(avisar).not.toHaveBeenCalled();
  });

  it('cerrado antes de pedir, no pide nada', async () => {
    const { unmount } = pintar();
    unmount();
    await act(async () => {});
    expect(mocks.createChargeLightning).not.toHaveBeenCalled();
  });
});

describe('la hoja de cobro con Lightning', () => {
  const pintarHoja = async (medios: Record<string, unknown> | null) => {
    mocks.getPaymentMethods.mockResolvedValue(
      medios ? { success: true, data: { lightningHabilitado: true, puedeEditar: false, ...medios } } : { success: false },
    );
    mocks.createCharge.mockResolvedValue({ success: true, data: cobro() });
    mocks.getCharge.mockResolvedValue({ success: true, data: cobro() });
    mocks.createChargeLightning.mockResolvedValue({ success: true, data: factura() });
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <BusinessHomeView merchant={COMERCIO} payments={[]} onReload={vi.fn()} />
      </LanguageProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));
    await screen.findByPlaceholderText('0.00');
    return user;
  };

  const cobrar = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByPlaceholderText('0.00'), '5000');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));
  };

  it('con la billetera conectada ofrece Lightning solo sobre un cobro, y nunca dos QR juntos', async () => {
    const user = await pintarHoja({ lightningAddress: 'soda@breez.tips', sinpeMovil: '88887777' });
    // Sobre el rotulo (sin monto) no hay selector.
    expect(screen.queryByRole('group', { name: 'Cómo paga el cliente' })).not.toBeInTheDocument();
    await cobrar(user);
    const grupo = await screen.findByRole('group', { name: 'Cómo paga el cliente' });
    expect(grupo).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KiramoPay' })).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.createChargeLightning).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Lightning' }));
    expect(await screen.findByText('12,500 sats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lightning' })).toHaveAttribute('aria-pressed', 'true');
    // Un solo QR en pantalla: el de KiramoPay se fue, y con el, compartirlo.
    expect(document.querySelectorAll('svg path').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('qr-lightning')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Compartir como imagen' })).not.toBeInTheDocument();
    // Con Lightning manda el plazo del precio; ni el del cobro ni SINPE compiten con el.
    expect(screen.queryByText(/Vence en/)).not.toBeInTheDocument();
    expect(screen.queryByText(/También por SINPE Móvil/)).not.toBeInTheDocument();
    expect(screen.getByTitle('Código QR de la factura Lightning')).toBeInTheDocument();

    // De vuelta a KiramoPay vuelven el QR de siempre, el plazo y SINPE.
    await user.click(screen.getByRole('button', { name: 'KiramoPay' }));
    expect(screen.queryByTestId('qr-lightning')).not.toBeInTheDocument();
    expect(screen.getByText(/Vence en/)).toBeInTheDocument();
    expect(screen.getByText(/También por SINPE Móvil/)).toBeInTheDocument();
  });

  it('sin billetera conectada no hay selector', async () => {
    const user = await pintarHoja({});
    await cobrar(user);
    await screen.findByText(/Vence en/);
    expect(screen.queryByRole('group', { name: 'Cómo paga el cliente' })).not.toBeInTheDocument();
  });

  it('si los medios no se pudieron leer cobra como siempre: sin selector ni SINPE', async () => {
    const user = await pintarHoja(null);
    await cobrar(user);
    await screen.findByText(/Vence en/);
    expect(screen.queryByRole('group', { name: 'Cómo paga el cliente' })).not.toBeInTheDocument();
    expect(screen.queryByText(/SINPE Móvil/)).not.toBeInTheDocument();
  });

  it('con la bandera cerrada no hay selector aunque haya direccion', async () => {
    const user = await pintarHoja({ lightningHabilitado: false, lightningAddress: 'soda@breez.tips' });
    await cobrar(user);
    await screen.findByText(/Vence en/);
    expect(screen.queryByRole('group', { name: 'Cómo paga el cliente' })).not.toBeInTheDocument();
  });

  it('dice "Pagado con Lightning" solo cuando el cobro llega pagado por Lightning', async () => {
    const user = await pintarHoja({ lightningAddress: 'soda@breez.tips' });
    await cobrar(user);
    await user.click(await screen.findByRole('button', { name: 'Lightning' }));
    await screen.findByText('12,500 sats');
    mocks.getCharge.mockResolvedValue({
      success: true,
      data: cobro({ status: 'paid', paidVia: 'lightning', paidAt: new Date().toISOString() }),
    });
    expect(await screen.findByText('Pagado con Lightning', {}, { timeout: 7000 })).toBeInTheDocument();
    expect(screen.queryByTestId('qr-lightning')).not.toBeInTheDocument();
  }, 10_000);

  it('SINPE Movil va en texto y se confirma en el banco; nunca se da por pagado', async () => {
    const user = await pintarHoja({ sinpeMovil: '88887777' });
    expect(
      await screen.findByText(
        'También por SINPE Móvil al 8888-7777. Ese pago no pasa por KiramoPay: confirma en tu banco que entró antes de entregar.',
      ),
    ).toBeInTheDocument();
    await cobrar(user);
    expect(await screen.findByText(/También por SINPE Móvil al 8888-7777/)).toBeInTheDocument();
    expect(screen.queryByText('Pagado')).not.toBeInTheDocument();
  });
});
