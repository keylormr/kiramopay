import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { encodeContactQr } from '@/utils/contactQr';
import { HomeView } from '../home/HomeView';
import { precargarIdioma } from '@/test/idiomas';

// Sin esto, el banner de Inicio llama al adaptador mock real (getReferrals)
// y su resolucion asincrona llega despues de que el test ya afirmo, lo que
// React reporta como una actualizacion fuera de act(). Ninguna prueba de
// este archivo depende de loyalty: se apaga entero, como en HomeView.moneda.
vi.mock('@/api', () => ({
  getApiLayer: () => ({}),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

// Mock useApp with realistic state data
const mockDispatch = vi.fn();

// Mutable a proposito: la descripcion de "contacto duplicado o numero propio"
// abajo necesita variar sinpeContacts sin reescribir el mock entero.
const mockState = {
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
  sinpeContacts: [] as Array<{ id: string; name: string; phone: string; bank?: string; isFavorite?: boolean }>,
};

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      isAuthenticated: mockState.isAuthenticated,
      user: mockState.user,
      sinpeContacts: mockState.sinpeContacts,
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

beforeAll(() => precargarIdioma('en'));

describe('HomeView', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    mockDispatch.mockReset();
    mockState.sinpeContacts = [];
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
    // Account names: se resuelven por moneda con el diccionario activo, no con
    // el `name` que trae la cuenta (el adaptador lo fijaba en espanol y con la
    // app en ingles las tarjetas seguian diciendo "Cuenta Colones").
    expect(screen.getByText('Cuenta Colones')).toBeInTheDocument();
    expect(screen.getByText('Cuenta Dólares')).toBeInTheDocument();
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

// El boton "Escanear QR" de las acciones rapidas es una SEGUNDA via, aparte de
// SinpeView, para escanear el QR de un contacto y guardarlo. Tenia que avisar
// igual que la primera en vez de dejar duplicar el alta o guardarse a si mismo.
describe('HomeView — escaneo de contacto: duplicado y numero propio', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    mockDispatch.mockReset();
    mockState.sinpeContacts = [];
    // jsdom no tiene camara; una promesa que nunca resuelve deja el escaner en
    // su estado inicial sin actualizaciones de estado fuera de act().
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => new Promise(() => {}) },
      configurable: true,
    });
  });

  async function abrirEscaner(user: ReturnType<typeof userEvent.setup>) {
    renderHomeView();
    await user.click(screen.getByRole('button', { name: 'Escanear QR' }));
    return within(await screen.findByRole('dialog'));
  }

  function leerCodigo(d: ReturnType<typeof within>, raw: string) {
    fireEvent.change(d.getByPlaceholderText('Código QR'), { target: { value: raw } });
    fireEvent.click(d.getByRole('button', { name: 'Continuar' }));
  }

  it('avisa al escanear el propio QR y no abre la hoja de envio', async () => {
    const user = userEvent.setup();
    const d = await abrirEscaner(user);

    leerCodigo(d, encodeContactQr({ name: 'Keilor Martinez', phone: '+506 7026-5093' }));

    expect(await screen.findByText(/no puedes agregarte como contacto/)).toBeInTheDocument();
    // Sigue en el escaner: nunca se llego a fijar el contacto escaneado, asi
    // que la hoja de "cuanto le envias" (que depende de el) no tiene nada que
    // mostrar.
    expect(screen.queryByText('Keilor Martinez')).not.toBeInTheDocument();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('abre la hoja de envio para un contacto ya guardado, pero no deja tocar "Agregar contacto" sin avisar', async () => {
    mockState.sinpeContacts = [{ id: 'c1', name: 'Diego Mora', phone: '8888-7777', bank: 'BAC' }];
    const user = userEvent.setup();
    const d = await abrirEscaner(user);

    // El QR trae otro nombre/banco a proposito: el gesto de escanear a un
    // conocido para pagarle de nuevo es el caso normal y debe abrir la hoja.
    leerCodigo(d, encodeContactQr({ name: 'Diego (alias)', phone: '+506 8888-7777', bank: 'BCR' }));

    // La hoja del escaner se cierra y la de envio se abre: ambas pueden
    // convivir un instante mientras una se desvanece; la ultima es la vigente.
    const dialogs = await screen.findAllByRole('dialog');
    const sendDialog = within(dialogs[dialogs.length - 1]);
    expect(sendDialog.getByText('Diego (alias)')).toBeInTheDocument();

    // El boton ya refleja que esta guardado, sin necesidad de tocarlo.
    const boton = sendDialog.getByRole('button', { name: 'Contacto guardado' });
    expect(boton).toBeDisabled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('agrega un contacto nuevo sin problema cuando no es duplicado ni el propio numero', async () => {
    const user = userEvent.setup();
    const d = await abrirEscaner(user);

    leerCodigo(d, encodeContactQr({ name: 'Ana Solís', phone: '+506 8888-7777', bank: 'BAC' }));

    const dialogs = await screen.findAllByRole('dialog');
    const sendDialog = within(dialogs[dialogs.length - 1]);
    await user.click(sendDialog.getByRole('button', { name: 'Agregar contacto' }));

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'ADD_SINPE_CONTACT',
      payload: expect.objectContaining({ name: 'Ana Solís', phone: '+506 8888-7777', bank: 'BAC' }),
    });
    expect(await sendDialog.findByRole('button', { name: 'Contacto guardado' })).toBeDisabled();
  });
});
