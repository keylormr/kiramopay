import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { encodeContactQr } from '@/utils/contactQr';
import { HomeView } from '../HomeView';

// Bug real: el monto de "Enviar a [contacto escaneado]" tenia una caja de
// ancho fijo (w-40) sin autoWidth. Con separador de miles, un monto de
// ₡1.000.000 no cabia y el texto se recortaba mientras la persona escribia,
// sin poder ver cuanto iba a enviar.

vi.mock('@/api', () => ({
  MFA_REQUIRED: 'MFA_REQUIRED',
  getApiLayer: () => ({
    qrPayments: {
      getMyCode: vi.fn().mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED' } }),
    },
    sinpe: { send: vi.fn() },
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
        { ccy: 'CRC', balance: 5_000_000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' },
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

// El escaner se reemplaza por un boton que entrega directamente el QR de un
// contacto: la camara no existe en jsdom y lo que importa es la hoja que se
// abre despues de leerlo.
vi.mock('@/components/QrScannerPanel', () => ({
  QrScannerPanel: ({ active, onDecode }: { active: boolean; onDecode: (s: string) => void }) =>
    active ? (
      <button
        onClick={() => onDecode(encodeContactQr({ name: 'Ana Solís', phone: '+506 8888-7777' }))}
      >
        simular-escaneo
      </button>
    ) : null,
}));

function pintar() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('HomeView — enviar a un contacto escaneado', () => {
  it('el campo de monto crece con la cifra en vez de quedar en una caja de ancho fijo', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Escanear QR' }));
    await user.click(await screen.findByText('simular-escaneo'));

    const monto = await screen.findByPlaceholderText('0');
    await user.type(monto, '1000000');

    expect(monto).toHaveValue('1,000,000');
    // Antes: className fija "w-40" y sin la prop autoWidth, el input no
    // crecia con el texto ya formateado (comas incluidas) y quedaba
    // recortado. Con autoWidth el ancho se deriva del propio texto.
    expect((monto as HTMLInputElement).style.width).not.toBe('');
  });
});
