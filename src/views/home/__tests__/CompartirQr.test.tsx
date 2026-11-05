import { render, screen, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../HomeView';

// Compartir el QR de cobrar como imagen. Lo que se vigila desde Inicio: que el
// boton este en la hoja, que dibuje la tarjeta con el QR que esta en pantalla
// (el codigo permanente o el cobro con monto) y con lo que la persona espera
// leer en ella: su nombre, o el monto.

// Una pantalla completa con varios toques tarda segundos en un runner lento: el
// tope por defecto (5 s) haria fallar por tiempo lo que no esta roto.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });

const mocks = vi.hoisted(() => ({
  getMyCode: vi.fn(),
  createCharge: vi.fn(),
  cancelCharge: vi.fn(),
  dibujar: vi.fn(),
  compartir: vi.fn(),
}));

vi.mock('@/api', () => ({
  MFA_REQUIRED: 'MFA_REQUIRED',
  getApiLayer: () => ({
    qrPayments: {
      getMyCode: mocks.getMyCode,
      createCharge: mocks.createCharge,
      cancelCharge: mocks.cancelCharge,
      resolveQr: vi.fn(),
      scanAndPay: vi.fn(),
    },
    mfa: { totpVerify: vi.fn() },
  }),
}));

vi.mock('@/utils/qrComoImagen', () => ({
  dibujarTarjetaQr: mocks.dibujar,
  compartirImagenDeQr: mocks.compartir,
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/stores/notification.store', () => ({
  useNotificationStore: (selector: (s: unknown) => unknown) =>
    selector({ notifications: [], unreadCount: 0 }),
}));

vi.mock('@/stores/auth.store', () => {
  const hook = () => ({ user: { id: 'user-001', firstName: 'Keilor', lastName: 'Martinez' } });
  hook.getState = hook;
  hook.setState = vi.fn();
  hook.subscribe = vi.fn();
  return { useAuthStore: hook };
});

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      isAuthenticated: true,
      user: { id: 'user-001', firstName: 'Keilor', lastName: 'Martinez', phone: '70265093' },
      baseCurrency: 'CRC',
      accounts: [
        { ccy: 'CRC', balance: 850000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' },
      ],
      transactions: [],
      sinpeContacts: [],
      notifications: [],
      settings: { darkMode: false },
      crypto: { assets: [] },
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <svg data-testid="qr-code" data-value={value} width={size} height={size} />
  ),
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
  createdBy: 'user-001',
  amount: 5000,
  currency: 'CRC',
  channel: 'link' as const,
  status: 'pending' as const,
  qrData: 'KP:p2p_request:chg12345:500000:CRC:xbbbbbbbbbbbbbbbbbbbbbbbb',
  expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
};

const PNG = new Blob(['png'], { type: 'image/png' });

function pintar() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

const boton = () => screen.getByRole('button', { name: 'Compartir como imagen' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getMyCode.mockResolvedValue({ success: true, data: codigo });
  mocks.createCharge.mockResolvedValue({ success: true, data: cobro });
  mocks.cancelCharge.mockResolvedValue({ success: true });
  mocks.dibujar.mockResolvedValue(PNG);
  mocks.compartir.mockResolvedValue('compartido');
});

describe('Cobrar con QR — compartir como imagen', () => {
  it('con el codigo permanente la tarjeta lleva el nombre de quien cobra', async () => {
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
    const qr = await screen.findByTestId('qr-code');

    await user.click(boton());

    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(1));
    const tarjeta = mocks.dibujar.mock.calls[0][0];
    // El mismo QR que esta en pantalla, no uno regenerado.
    expect(tarjeta.svg).toBe(qr);
    expect(tarjeta.svg.getAttribute('data-value')).toBe(codigo.qrData);
    expect(tarjeta.marca).toBe('KiramoPay');
    expect(tarjeta.titulo).toBe('Keilor Martinez');
    expect(tarjeta.subtitulo).toBeUndefined();
    expect(tarjeta.pie).toBe('Escanéalo con KiramoPay para pagar');
    expect(mocks.compartir).toHaveBeenCalledWith(PNG, 'kiramopay-qr.png', 'Keilor Martinez');
  });

  it('con un cobro de monto la tarjeta lleva el monto grande y el nombre debajo', async () => {
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
    await screen.findByTestId('qr-code');
    await user.type(screen.getByPlaceholderText('0.00'), '5000');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));
    await screen.findByText('Vence en 20 min');

    await user.click(boton());

    await waitFor(() => expect(mocks.compartir).toHaveBeenCalledTimes(1));
    const tarjeta = mocks.dibujar.mock.calls[0][0];
    // El QR del cobro, no el del codigo permanente.
    expect(tarjeta.svg.getAttribute('data-value')).toBe(cobro.qrData);
    expect(tarjeta.titulo).toBe('₡5,000.00');
    expect(tarjeta.subtitulo).toBe('Keilor Martinez');
    expect(mocks.compartir).toHaveBeenCalledWith(PNG, 'kiramopay-cobro.png', '₡5,000.00');
  });

  it('el aviso de una imagen ya compartida no se queda bajo un QR distinto', async () => {
    mocks.compartir.mockResolvedValue('listo');
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
    await screen.findByTestId('qr-code');
    await user.type(screen.getByPlaceholderText('0.00'), '5000');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));
    await screen.findByText('Vence en 20 min');
    await user.click(boton());
    expect(await screen.findByText('Imagen descargada. Ya puedes mandarla por chat.')).toBeInTheDocument();

    // Quitar el monto vuelve al codigo permanente: otro QR, otra imagen.
    await user.click(screen.getByRole('button', { name: 'Quitar monto' }));

    await waitFor(() =>
      expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', codigo.qrData),
    );
    expect(screen.queryByText('Imagen descargada. Ya puedes mandarla por chat.')).not.toBeInTheDocument();
  });

  it('mientras el codigo no llega no hay nada que compartir', async () => {
    mocks.getMyCode.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));

    expect(screen.queryByRole('button', { name: 'Compartir como imagen' })).not.toBeInTheDocument();
  });
});
