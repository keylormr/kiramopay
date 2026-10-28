import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../HomeView';

// "Agregar dinero" sobre el saldo en colones abria "Depositar Crypto / Los
// depositos de cripto llegan pronto": otra cosa que lo que se pidio. La hoja
// dice como entra dinero hoy (recibir de otra cuenta KiramoPay, por numero o por
// QR), lleva a las dos pantallas donde se hace, y avisa que cargar desde el
// banco llega con la conexion a SINPE.

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('@/api', () => ({
  getApiLayer: () => ({}),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <svg data-testid="qr-code" />,
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/stores/notification.store', () => ({
  useNotificationStore: (selector: (s: unknown) => unknown) =>
    selector({ notifications: [], unreadCount: 0 }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      transactions: [],
      baseCurrency: 'CRC',
      accounts: [
        { ccy: 'CRC', balance: 500000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' },
      ],
      sinpeContacts: [],
    },
    dispatch: vi.fn(),
  }),
}));

function pintar(onNavigateToSinpe = vi.fn()) {
  render(
    <LanguageProvider>
      <HomeView onNavigateToSinpe={onNavigateToSinpe} />
    </LanguageProvider>,
  );
  return onNavigateToSinpe;
}

async function abrirLaHoja() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Agregar dinero' }));
  const hoja = await screen.findByRole('dialog', { name: 'Agregar dinero' });
  return { user, hoja };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('HomeView: Agregar dinero', () => {
  it('no ofrece cripto: dice como entra dinero hoy', async () => {
    pintar();
    const { hoja } = await abrirLaHoja();

    expect(within(hoja).getByText('Así entra dinero hoy')).toBeInTheDocument();
    expect(
      within(hoja).getByText(
        'Hoy puedes recibir dinero de otra cuenta de KiramoPay: te transfieren a tu número o te pagan escaneando tu QR.',
      ),
    ).toBeInTheDocument();
    expect(within(hoja).queryByText(/cripto|crypto/i)).toBeNull();
  });

  it('avisa que cargar desde el banco llega con la conexion a SINPE', async () => {
    pintar();
    const { hoja } = await abrirLaHoja();

    expect(
      within(hoja).getByText('Cargar saldo desde tu banco llegará con la conexión a SINPE. Todavía no está disponible.'),
    ).toBeInTheDocument();
  });

  it('Recibir lleva a la pestana de recibir de SINPE y cierra la hoja', async () => {
    const onNavigateToSinpe = pintar();
    const { user, hoja } = await abrirLaHoja();

    await user.click(within(hoja).getByRole('button', { name: 'Recibir' }));

    expect(onNavigateToSinpe).toHaveBeenCalledWith('receive');
    // La hoja tarda 300 ms en irse (animacion de salida).
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar dinero' })).toBeNull());
  });

  it('Mi QR abre el QR con el que te pagan', async () => {
    pintar();
    const { user, hoja } = await abrirLaHoja();

    await user.click(within(hoja).getByRole('button', { name: 'Mi QR' }));

    expect(await screen.findByRole('dialog', { name: 'Cobrar con QR' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar dinero' })).toBeNull());
  });
});
