import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../HomeView';

// "Agregar cuenta" ofrecia libras, yenes, bitcoin y ether, y al elegir una
// creaba una cuenta SOLO en el telefono: la siguiente sincronizacion la borraba
// sin aviso y la moneda base quedaba apuntando a la nada. El servidor maneja
// colones y dolares, y la hoja ahora lo dice.

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

const dispatch = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      transactions: [],
      baseCurrency: 'CRC',
      accounts: [
        { ccy: 'CRC', balance: 500000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' },
        { ccy: 'USD', balance: 100, symbol: '$', flag: '', iban: '', name: 'Dolares', type: 'fiat', rateToUsd: 1 },
      ],
      sinpeContacts: [],
    },
    dispatch,
  }),
}));

function pintar(onOpenCrypto = vi.fn()) {
  render(
    <LanguageProvider>
      <HomeView onOpenCrypto={onOpenCrypto} />
    </LanguageProvider>,
  );
  return onOpenCrypto;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  dispatch.mockReset();
});

describe('HomeView — Agregar cuenta', () => {
  it('dice que solo hay colones y dolares, y no crea ninguna cuenta', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Agregar' }));

    const hoja = await screen.findByRole('dialog', { name: 'Abrir nueva cuenta' });
    expect(within(hoja).getByText('Por ahora, colones y dólares')).toBeInTheDocument();
    expect(
      within(hoja).getByText('Tu cuenta maneja saldo en colones y en dólares. Abrir cuentas en otras monedas todavía no está disponible.'),
    ).toBeInTheDocument();
    // Ni una moneda para elegir: la lista falsa desaparece.
    expect(within(hoja).queryByText('British Pound')).toBeNull();
    expect(within(hoja).queryByText('Bitcoin')).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('el boton + del saldo abre la misma hoja honesta', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Abrir nueva cuenta' }));

    expect(await screen.findByText('Por ahora, colones y dólares')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a quien busca cripto lo lleva a la seccion donde se compra', async () => {
    const user = userEvent.setup();
    const onOpenCrypto = pintar();

    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    const hoja = await screen.findByRole('dialog', { name: 'Abrir nueva cuenta' });
    expect(
      within(hoja).getByText('Las criptomonedas no necesitan una cuenta aparte: se compran con tu saldo desde Crypto.'),
    ).toBeInTheDocument();

    await user.click(within(hoja).getByRole('button', { name: 'Ir a Crypto' }));
    expect(onOpenCrypto).toHaveBeenCalledTimes(1);
  });
});

describe('HomeView — mosaicos sin promesas ni ingles', () => {
  it('Dividir se titula en espanol, como su pantalla', () => {
    pintar();
    expect(screen.getByText('Dividir cuenta')).toBeInTheDocument();
    expect(screen.queryByText('Split Pay')).toBeNull();
  });

  it('Tarjetas no promete compras que la tarjeta no hace', () => {
    pintar();
    expect(screen.getByText('Vista previa, aún sin compras')).toBeInTheDocument();
    expect(screen.queryByText(/para compras/)).toBeNull();
  });
});
