import { render, screen, waitFor, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SinpeView } from '../SinpeView';

// Compartir como imagen los dos QR de SINPE: el de contacto ("agregame") y el de
// una solicitud de dinero. La imagen lleva lo mismo que la pantalla muestra.

// Una pantalla completa con varios toques tarda segundos en un runner lento: el
// tope por defecto (5 s) haria fallar por tiempo lo que no esta roto.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });

const mocks = vi.hoisted(() => ({
  api: {
    sinpe: { send: vi.fn() },
    mfa: { totpVerify: vi.fn() },
    qrPayments: {
      getMyCode: vi.fn(),
      createCharge: vi.fn(),
      cancelCharge: vi.fn(),
      listCharges: vi.fn(),
    },
  },
  dibujar: vi.fn(),
  compartir: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
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
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      sinpeContacts: [],
      sinpeHistory: [],
      user: { id: 'u1', firstName: 'Keilor', lastName: 'Martinez', phone: '+50688880004' },
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve(true)),
  refreshSinpe: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
}));

const codigo = {
  id: 'code-1',
  type: 'p2p_receive' as const,
  amount: 0,
  currency: 'CRC',
  qrData: 'KP:p2p_receive:code1234:0:CRC:iaaaaaaaaaaaaaaaaaaaaaaaa',
  singleUse: false,
  used: false,
  status: 'active' as const,
};

const cobro = {
  id: 'charge-1',
  qrCodeId: 'code-1',
  createdBy: 'u1',
  amount: 5000,
  currency: 'CRC',
  note: 'Almuerzo',
  channel: 'link' as const,
  status: 'pending' as const,
  qrData: 'KP:p2p_request:chg12345:500000:CRC:xbbbbbbbbbbbbbbbbbbbbbbbb',
  expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
};

const PNG = new Blob(['png'], { type: 'image/png' });

function setup() {
  return render(
    <LanguageProvider>
      <SinpeView />
    </LanguageProvider>,
  );
}

const botonImagen = (hoja: ReturnType<typeof within>) => hoja.getByRole('button', { name: 'Compartir como imagen' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.qrPayments.getMyCode.mockReset().mockResolvedValue({ success: true, data: codigo });
  mocks.api.qrPayments.createCharge.mockReset().mockResolvedValue({ success: true, data: cobro });
  mocks.api.qrPayments.cancelCharge.mockReset();
  mocks.api.qrPayments.listCharges.mockReset().mockResolvedValue({ success: true, data: [] });
  mocks.dibujar.mockResolvedValue(PNG);
  mocks.compartir.mockResolvedValue('compartido');
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => new Promise(() => {}) },
    configurable: true,
  });
});

describe('SinpeView — compartir como imagen', () => {
  it('el QR de contacto: nombre y telefono de la persona, y la linea para agregarla', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Solicitar' })[1]);
    await user.click(screen.getByRole('button', { name: 'Mi QR de contacto' }));
    const hoja = within(await screen.findByRole('dialog'));

    await user.click(botonImagen(hoja));

    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(1));
    const tarjeta = mocks.dibujar.mock.calls[0][0];
    // El QR de CONTACTO: los datos de la persona, no un cobro.
    expect(tarjeta.svg.getAttribute('data-value')).toContain('kiramo_contact');
    expect(tarjeta.titulo).toBe('Keilor Martinez');
    expect(tarjeta.subtitulo).toBe('+506 8888-0004');
    expect(tarjeta.pie).toBe('Escanéalo con KiramoPay para agregarme como contacto');
    expect(mocks.compartir).toHaveBeenCalledWith(PNG, 'kiramopay-contacto.png', 'Keilor Martinez');
  });

  it('el QR de una solicitud: el monto grande, el motivo y la linea para pagar', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Solicitar' })[0]);
    const pedir = within(await screen.findByRole('dialog'));
    await user.type(pedir.getByPlaceholderText('0'), '5000');
    await user.click(pedir.getByRole('button', { name: /Generar QR/ }));
    const hoja = within(await screen.findByRole('dialog'));
    await hoja.findByText('Almuerzo');

    await user.click(botonImagen(hoja));

    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(1));
    const tarjeta = mocks.dibujar.mock.calls[0][0];
    // El QR de la SOLICITUD, no el de contacto.
    expect(tarjeta.svg.getAttribute('data-value')).toBe(cobro.qrData);
    expect(tarjeta.titulo).toMatch(/5[.,]000/);
    expect(tarjeta.subtitulo).toBe('Almuerzo');
    expect(tarjeta.pie).toBe('Escanéalo con KiramoPay para pagar');
    expect(mocks.compartir).toHaveBeenCalledWith(PNG, 'kiramopay-cobro.png', tarjeta.titulo);
  });

  it('antes de generar el QR de la solicitud no hay boton de imagen', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Solicitar' })[0]);
    const hoja = within(await screen.findByRole('dialog'));

    expect(hoja.queryByRole('button', { name: 'Compartir como imagen' })).not.toBeInTheDocument();
  });
});
