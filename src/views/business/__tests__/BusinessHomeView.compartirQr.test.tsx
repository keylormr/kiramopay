import { render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessHomeView } from '../BusinessHomeView';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';

// Compartir como imagen el QR del comercio: es el que mas se imprime o se
// publica (redes, pegatina, WhatsApp de clientes). La tarjeta lleva el nombre
// del COMERCIO —el que ven los clientes—, no el del dueno ni la razon social.

vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });

const mocks = vi.hoisted(() => ({
  getMerchantCode: vi.fn(),
  getLocations: vi.fn(),
  createCharge: vi.fn(),
  getCharge: vi.fn(),
  dibujar: vi.fn(),
  compartir: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    qrPayments: {
      getMerchantBalance: vi.fn().mockResolvedValue({ success: true, data: 0 }),
      getCatalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLocations: mocks.getLocations,
      getMerchantCode: mocks.getMerchantCode,
      createCharge: mocks.createCharge,
      getCharge: mocks.getCharge,
      cancelCharge: vi.fn(),
    },
  }),
}));

vi.mock('@/utils/qrComoImagen', () => ({
  dibujarTarjetaQr: mocks.dibujar,
  compartirImagenDeQr: mocks.compartir,
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <svg data-testid="qr-code" data-value={value} width={size} height={size} />
  ),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

const COMERCIO = {
  id: 'm1', name: 'Soda La Esquina', description: '', category: 'food', qrCode: 'MRC-1',
  active: true, cedula: '3101', cedulaType: 'juridica', legalName: 'Inversiones Esquina SA',
  verificationStatus: 'verified', commissionBps: 50, role: 'owner',
} as unknown as QRMerchant;

const codigo = {
  id: 'code-m1',
  type: 'merchant_dynamic' as const,
  amount: 0,
  currency: 'CRC',
  qrData: 'KP:merchant_dynamic:abcd1234:0:CRC:icccccccccccccccccccccccc',
  singleUse: false,
  used: false,
  status: 'active' as const,
};

const cobro = {
  id: 'charge-m1',
  qrCodeId: 'code-m1',
  createdBy: 'u1',
  amount: 5500,
  currency: 'CRC',
  channel: 'counter' as const,
  status: 'pending' as const,
  qrData: 'KP:p2p_request:chg99999:550000:CRC:xdddddddddddddddddddddddd',
  expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
};

const PNG = new Blob(['png'], { type: 'image/png' });

function pintar() {
  return render(
    <LanguageProvider>
      <BusinessHomeView merchant={COMERCIO} payments={[]} onReload={vi.fn()} />
    </LanguageProvider>,
  );
}

const boton = () => screen.getByRole('button', { name: 'Compartir como imagen' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getMerchantCode.mockResolvedValue({ success: true, data: codigo });
  mocks.getLocations.mockResolvedValue({ success: true, data: [] });
  mocks.createCharge.mockResolvedValue({ success: true, data: cobro });
  mocks.getCharge.mockResolvedValue({ success: true, data: cobro });
  mocks.dibujar.mockResolvedValue(PNG);
  mocks.compartir.mockResolvedValue('compartido');
});

describe('BusinessHomeView — compartir el QR del comercio como imagen', () => {
  it('el rotulo del mostrador lleva el nombre del comercio', async () => {
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));
    const qr = await screen.findByTestId('qr-code');

    await user.click(boton());

    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(1));
    const tarjeta = mocks.dibujar.mock.calls[0][0];
    expect(tarjeta.svg).toBe(qr);
    expect(tarjeta.svg.getAttribute('data-value')).toBe(codigo.qrData);
    // El nombre del comercio, no la razon social ni el del dueno.
    expect(tarjeta.titulo).toBe('Soda La Esquina');
    expect(tarjeta.titulo).not.toContain('Inversiones');
    expect(tarjeta.subtitulo).toBeUndefined();
    expect(tarjeta.pie).toBe('Escanéalo con KiramoPay para pagar');
    expect(mocks.compartir).toHaveBeenCalledWith(PNG, 'kiramopay-comercio.png', 'Soda La Esquina');
  });

  it('con una sede elegida la tarjeta la dice debajo del nombre', async () => {
    mocks.getLocations.mockResolvedValue({
      success: true,
      data: [{ id: 'l1', name: 'Playa del Coco', merchantId: 'm1', address: 'Frente al muelle', active: true }],
    });
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));
    await screen.findByTestId('qr-code');
    await user.selectOptions(await screen.findByRole('combobox'), 'l1');
    await waitFor(() => expect(mocks.getMerchantCode).toHaveBeenCalledTimes(2));
    await screen.findByTestId('qr-code');

    await user.click(boton());

    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(1));
    const tarjeta = mocks.dibujar.mock.calls[0][0];
    expect(tarjeta.titulo).toBe('Soda La Esquina');
    expect(tarjeta.subtitulo).toBe('Playa del Coco');
  });

  it('al cambiar de sede la imagen sigue diciendo la del QR que se ve hasta que llega el nuevo', async () => {
    mocks.getLocations.mockResolvedValue({
      success: true,
      data: [{ id: 'l1', name: 'Playa del Coco', merchantId: 'm1', address: 'Frente al muelle', active: true }],
    });
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));
    await screen.findByTestId('qr-code');
    // El codigo de la sede nueva no llega todavia.
    mocks.getMerchantCode.mockReturnValue(new Promise(() => {}));
    await user.selectOptions(await screen.findByRole('combobox'), 'l1');
    await waitFor(() => expect(mocks.getMerchantCode).toHaveBeenCalledTimes(2));

    await user.click(boton());

    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(1));
    const tarjeta = mocks.dibujar.mock.calls[0][0];
    // El QR en pantalla sigue siendo el del rotulo sin sede: la tarjeta no puede
    // rotularlo con una sede que ese codigo no tiene.
    expect(tarjeta.svg.getAttribute('data-value')).toBe(codigo.qrData);
    expect(tarjeta.subtitulo).toBeUndefined();
  });

  it('el aviso de un intento fallido no se queda en la imagen del cobro siguiente', async () => {
    mocks.compartir.mockResolvedValue('error');
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));
    await screen.findByTestId('qr-code');
    await user.click(boton());
    await screen.findByText('No pudimos preparar la imagen. Intenta de nuevo.');

    await user.type(screen.getByPlaceholderText('0.00'), '5500');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));
    await waitFor(() => expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', cobro.qrData));

    expect(screen.queryByText('No pudimos preparar la imagen. Intenta de nuevo.')).not.toBeInTheDocument();
  });

  it('un cobro con monto lleva el monto grande y el comercio debajo', async () => {
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));
    await screen.findByTestId('qr-code');
    await user.type(screen.getByPlaceholderText('0.00'), '5500');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));
    await waitFor(() => expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', cobro.qrData));

    await user.click(boton());

    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(1));
    const tarjeta = mocks.dibujar.mock.calls[0][0];
    expect(tarjeta.svg.getAttribute('data-value')).toBe(cobro.qrData);
    expect(tarjeta.titulo).toBe('₡5,500.00');
    expect(tarjeta.subtitulo).toBe('Soda La Esquina');
    expect(mocks.compartir).toHaveBeenCalledWith(PNG, 'kiramopay-cobro.png', '₡5,500.00');
  });

  it('un cobro ya pagado no ofrece compartir: ese QR ya no sirve', async () => {
    mocks.createCharge.mockResolvedValue({ success: true, data: { ...cobro, status: 'paid' } });
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));
    await screen.findByTestId('qr-code');
    await user.type(screen.getByPlaceholderText('0.00'), '5500');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));

    await screen.findByRole('button', { name: 'Siguiente cliente' });
    expect(screen.queryByRole('button', { name: 'Compartir como imagen' })).not.toBeInTheDocument();
  });

  it('un cobro vencido tampoco se ofrece: ese QR ya no cobra', async () => {
    mocks.createCharge.mockResolvedValue({ success: true, data: { ...cobro, status: 'expired' } });
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));
    await screen.findByTestId('qr-code');
    await user.type(screen.getByPlaceholderText('0.00'), '5500');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));

    await waitFor(() => expect(mocks.createCharge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', cobro.qrData));
    expect(screen.queryByRole('button', { name: 'Compartir como imagen' })).not.toBeInTheDocument();
  });

  it('mientras el codigo no llega no hay nada que compartir', async () => {
    mocks.getMerchantCode.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));

    expect(screen.queryByRole('button', { name: 'Compartir como imagen' })).not.toBeInTheDocument();
  });
});
