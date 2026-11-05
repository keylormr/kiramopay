import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../HomeView';
import { imagenDePrueba, instalarRasterDePrueba, type RegistroDeRaster } from '@/test/rasterDePrueba';

// Pagar un QR que llego por chat, con el mismo telefono: se elige la imagen en
// el escaner y lo leido entra por el MISMO camino que la camara. Aqui el
// escaner es el de verdad (no el boton de "simular-escaneo" de las otras
// pruebas) y las imagenes son QR reales.
//
// Una imagen recibida por chat no es de confianza: lo que se vigila es que
// NUNCA se paga sin que la persona vea a quien y toque Pagar.

// Leer una foto de 12 MP en un runner lento tarda segundos, no milisegundos: el
// tope por defecto (5 s) haria fallar por tiempo lo que no esta roto.
vi.setConfig({ testTimeout: 30_000 });
// Lo mismo para las esperas de findBy/waitFor (1 s por defecto).
configure({ asyncUtilTimeout: 15_000 });

const KP = 'KP:merchant_dynamic:abcd1234:550000:CRC:i0123456789abcdef01234567';
const AJENO = 'https://example.com/promo?ref=chat-2026';

const mocks = vi.hoisted(() => ({
  resolveQr: vi.fn(),
  scanAndPay: vi.fn(),
  getMyCode: vi.fn(),
}));

vi.mock('@/api', () => ({
  MFA_REQUIRED: 'MFA_REQUIRED',
  getApiLayer: () => ({
    qrPayments: {
      getMyCode: mocks.getMyCode,
      resolveQr: mocks.resolveQr,
      scanAndPay: mocks.scanAndPay,
    },
    mfa: { totpVerify: vi.fn() },
  }),
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

let raster: RegistroDeRaster;

beforeEach(() => {
  vi.clearAllMocks();
  // ErrorALaVista llama a scrollIntoView, que jsdom no trae.
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  raster = instalarRasterDePrueba();
  mocks.getMyCode.mockResolvedValue({ success: false, error: { code: 'X' } });
  mocks.resolveQr.mockResolvedValue({
    success: true,
    data: { kind: 'code', merchantName: 'Soda Tica', currency: 'CRC', amount: 0, qrCodeId: 'code-1' },
  });
  mocks.scanAndPay.mockResolvedValue({
    success: true,
    data: { id: 'p1', qrCodeId: 'code-1', payerId: 'u', receiverId: 'o', amount: 5500, fee: 0, currency: 'CRC', status: 'completed', createdAt: '' },
  });
});
afterEach(() => {
  raster.restaurar();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

function pintar() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

async function abrirEscaner(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /escanear/i }));
  return (await screen.findByTestId('qr-image-input')) as HTMLInputElement;
}

describe('Pagar un QR elegido desde una imagen', () => {
  it('la imagen abre la hoja de confirmacion con el nombre de quien cobra y NO paga sola', async () => {
    const user = userEvent.setup();
    pintar();
    const entrada = await abrirEscaner(user);

    await user.upload(entrada, imagenDePrueba('captura-chat.png'));

    // La misma hoja que la camara: a quien se le paga, antes que nada.
    expect(await screen.findByText('Le pagas a')).toBeInTheDocument();
    expect(await screen.findByText('Soda Tica')).toBeInTheDocument();
    expect(mocks.resolveQr).toHaveBeenCalledWith(KP);
    // El codigo trae el monto: se muestra, y todavia no se movio un colon.
    expect(screen.getByText('Te solicitan')).toBeInTheDocument();
    expect(screen.getByText('₡5,500.00')).toBeInTheDocument();
    expect(mocks.scanAndPay).not.toHaveBeenCalled();
  });

  it('solo cuando la persona toca Pagar se paga, una vez, el codigo que leyo la imagen', async () => {
    const user = userEvent.setup();
    pintar();
    const entrada = await abrirEscaner(user);
    await user.upload(entrada, imagenDePrueba('captura-chat.png'));
    await screen.findByText('Soda Tica');
    expect(mocks.scanAndPay).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Pagar' }));

    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(1));
    expect(mocks.scanAndPay).toHaveBeenCalledWith(expect.objectContaining({ qrData: KP }));
  });

  it('cancelar la hoja deja todo sin pagar', async () => {
    const user = userEvent.setup();
    pintar();
    const entrada = await abrirEscaner(user);
    await user.upload(entrada, imagenDePrueba('qr-kiramo.png'));
    await screen.findByText('Soda Tica');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(mocks.scanAndPay).not.toHaveBeenCalled();
  });

  it('una foto de 12 MP llega a la misma confirmacion', async () => {
    const user = userEvent.setup();
    pintar();
    const entrada = await abrirEscaner(user);

    await user.upload(entrada, imagenDePrueba('foto-grande.png'));

    expect(await screen.findByText('Soda Tica')).toBeInTheDocument();
    expect(mocks.scanAndPay).not.toHaveBeenCalled();
  });

  it('un QR de otra cosa recibe el mismo rechazo que con la camara y no se paga', async () => {
    mocks.resolveQr.mockResolvedValue({ success: false, error: { code: 'QR_INVALIDO', message: 'x' } });
    const user = userEvent.setup();
    pintar();
    const entrada = await abrirEscaner(user);

    await user.upload(entrada, imagenDePrueba('qr-ajeno.png'));

    await waitFor(() => expect(mocks.resolveQr).toHaveBeenCalledWith(AJENO));
    // El mensaje que el flujo ya tenia para un codigo que no es de KiramoPay.
    expect(await screen.findByText('Ese código no existe o ya no es válido.')).toBeInTheDocument();
    expect(mocks.scanAndPay).not.toHaveBeenCalled();
  });

  it('una imagen sin QR lo dice en la hoja del escaner y no abre ningun pago', async () => {
    const user = userEvent.setup();
    pintar();
    const entrada = await abrirEscaner(user);

    await user.upload(entrada, imagenDePrueba('sin-qr.png'));

    expect(await screen.findByText(/No encontramos un código QR en esa imagen/)).toBeInTheDocument();
    expect(screen.queryByText('Le pagas a')).not.toBeInTheDocument();
    expect(mocks.resolveQr).not.toHaveBeenCalled();
    expect(mocks.scanAndPay).not.toHaveBeenCalled();
    // El escaner sigue ahi para intentar con otra.
    expect(screen.getByRole('button', { name: 'Elegir una imagen' })).toBeInTheDocument();
  });

  it('un archivo que no se puede leer lo dice con su propio mensaje', async () => {
    const user = userEvent.setup();
    pintar();
    const entrada = await abrirEscaner(user);

    await user.upload(entrada, new File(['no soy una imagen'], 'recibo.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByText(/No pudimos abrir ese archivo/)).toBeInTheDocument();
    expect(mocks.resolveQr).not.toHaveBeenCalled();
  });
});
