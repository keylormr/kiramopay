import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../home/HomeView';

// Mock useApp with realistic state data
const mockDispatch = vi.fn();

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      isAuthenticated: true,
      user: {
        id: 'user-001',
        cedula: '702650930',
        phone: '70265093',
        firstName: 'Keilor',
        lastName: 'Martinez',
        kycLevel: 1,
        createdAt: '2024-01-01',
      },
      baseCurrency: 'CRC',
      accounts: [
        {
          ccy: 'CRC',
          balance: 850000,
          symbol: '\u20A1',
          flag: '\uD83C\uDDE8\uD83C\uDDF7',
          iban: 'CR-001',
          name: 'Colones',
          type: 'fiat',
          rateToUsd: 0.0019,
        },
        {
          ccy: 'USD',
          balance: 1250.5,
          symbol: '$',
          flag: '\uD83C\uDDFA\uD83C\uDDF8',
          iban: 'US-001',
          name: 'US Dollar',
          type: 'fiat',
          rateToUsd: 1,
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          title: 'Pago SINPE a Maria',
          amount: -25000,
          ccy: 'CRC',
          date: 'Hoy',
          type: 'debit',
          category: 'SINPE',
          status: 'completed',
        },
        {
          id: 'tx-2',
          title: 'Deposito salario',
          amount: 500000,
          ccy: 'CRC',
          date: 'Ayer',
          type: 'credit',
          category: 'Transfer',
          status: 'completed',
        },
      ],
      passwordHash: '',
      settings: {
        darkMode: false,
        offlineMode: false,
        isLocked: false,
        biometricEnabled: false,
        notificationsEnabled: true,
        language: 'es',
      },
    },
    dispatch: mockDispatch,
  }),
}));

// Mock useAuthStore (in case HomeView or sub-components import it)
vi.mock('@/stores/auth.store', () => {
  const hook = () => ({
    isAuthenticated: true,
    user: {
      id: 'user-001',
      cedula: '702650930',
      firstName: 'Keilor',
      lastName: 'Martinez',
    },
  });
  hook.getState = hook;
  hook.setState = vi.fn();
  hook.subscribe = vi.fn();
  return { useAuthStore: hook };
});

// Mock qrcode.react to avoid canvas-related issues in jsdom
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <svg data-testid="qr-code" data-value={value} width={size} height={size} />
  ),
}));

function renderHomeView() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

describe('HomeView', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    mockDispatch.mockReset();
  });

  it('should render the total balance section', () => {
    renderHomeView();
    expect(screen.getByText('Balance Total')).toBeInTheDocument();
    // The base currency badge — rendered as "CRC · Base" (separator added in
    // the Unified Vision design refactor); match flexibly on the separator.
    expect(screen.getByText(/CRC.*Base/)).toBeInTheDocument();
  });

  it('should display the formatted balance for the base account', () => {
    renderHomeView();
    // ₡850,000.00 — miles con coma (decision del dueno, ver utils/money.ts)
    // — appears in both the main card and account list.
    const matches = screen.getAllByText(/850,000/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('should render the quick actions section with all four buttons', () => {
    renderHomeView();
    expect(screen.getByText('Acciones rápidas')).toBeInTheDocument();
    expect(screen.getByText('Enviar')).toBeInTheDocument();
    expect(screen.getByText('Recibir')).toBeInTheDocument();
    expect(screen.getByText('Escanear QR')).toBeInTheDocument();
    expect(screen.getByText('Cobrar con QR')).toBeInTheDocument();
  });

  it('should render the accounts section with all accounts', () => {
    renderHomeView();
    expect(screen.getByText('Cuentas')).toBeInTheDocument();
    // Account currency codes
    expect(screen.getByText('CRC')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    // Account names
    expect(screen.getByText('Colones')).toBeInTheDocument();
    expect(screen.getByText('US Dollar')).toBeInTheDocument();
  });

  it('should render the recent transactions section', () => {
    renderHomeView();
    expect(screen.getByText('Transacciones recientes')).toBeInTheDocument();
    expect(screen.getByText('Ver todo')).toBeInTheDocument();
  });

  it('should display transaction titles and dates', () => {
    renderHomeView();
    expect(screen.getByText('Pago SINPE a Maria')).toBeInTheDocument();
    expect(screen.getByText('Deposito salario')).toBeInTheDocument();
    expect(screen.getByText('Hoy')).toBeInTheDocument();
    expect(screen.getByText('Ayer')).toBeInTheDocument();
  });

  it('should show the USD total estimate', () => {
    renderHomeView();
    // totalUsdEstimate = 850000 * 0.0019 + 1250.50 * 1 = 1615 + 1250.50 = 2865.50
    expect(screen.getByText(/USD Total/)).toBeInTheDocument();
  });

  it('should render the Add New button in accounts list', () => {
    renderHomeView();
    expect(screen.getByText('Agregar')).toBeInTheDocument();
  });

  it('should render the Add Money button', () => {
    renderHomeView();
    // The button is localized (default test language is Spanish).
    expect(screen.getByText('Agregar dinero')).toBeInTheDocument();
  });

  it('should render in English when language is set to en', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    renderHomeView();
    // English ships as a lazily-loaded chunk; wait for it before asserting.
    expect(await screen.findByText('Total Balance')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('Recent Transactions')).toBeInTheDocument();
    expect(screen.getByText('View All')).toBeInTheDocument();
  });
});

// La ayuda contextual solo servia una vez adentro de cada funcion. En Inicio, el
// "?" permite preguntar QUE es algo antes de entrar, que es justo lo que no se
// podia hacer.
describe('HomeView — ayuda en las tarjetas', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    mockDispatch.mockReset();
  });

  it('ofrece ayuda en cada tarjeta de funcion', () => {
    renderHomeView();
    // Asistente, ahorros, pagos divididos, lealtad, marketplace y tarjetas.
    expect(screen.getAllByLabelText('¿Qué es esto?')).toHaveLength(6);
  });

  // El "?" se dibuja ENCIMA de una tarjeta que ya es un boton. Si abriera
  // ademas la funcion, pedir ayuda te sacaria de la pantalla.
  it('no abre la funcion al pedir ayuda', async () => {
    const user = userEvent.setup();
    const abrirAhorros = vi.fn();
    render(
      <LanguageProvider>
        <HomeView onOpenSavings={abrirAhorros} />
      </LanguageProvider>,
    );

    // El de ahorros es el segundo: asistente, ahorros, divididos, lealtad...
    await user.click(screen.getAllByLabelText('¿Qué es esto?')[1]);

    expect(await screen.findByText('Ahorros')).toBeInTheDocument();
    expect(screen.getByText(/no genera intereses/)).toBeInTheDocument();
    expect(abrirAhorros).not.toHaveBeenCalled();
  });
});
