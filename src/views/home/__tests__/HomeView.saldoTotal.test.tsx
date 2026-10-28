import { render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { precargarIdioma } from '@/test/idiomas';
import { HomeView } from '../HomeView';

// La tarjeta principal rotulaba "Balance total · CRC Base" pero el numero grande
// era SOLO la cuenta en colones (la de dolares quedaba afuera), mientras la
// linea de abajo si sumaba todo. Y una tasa faltante se contaba como 1: los
// colones valian dolares. Ahora el numero grande es el total de verdad, en la
// moneda base, y sin tasa dice que no hay dato en vez de inventarlo.

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('@/api', () => ({
  // El resumen del gasto del mes no es lo que se prueba aqui: nunca contesta.
  getApiLayer: () => ({ transactions: { getSummary: () => new Promise(() => {}) } }),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <svg data-testid="qr-code" />,
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn().mockResolvedValue(undefined),
  refreshTransactions: vi.fn().mockResolvedValue(undefined),
}));

const appState = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      transactions: [],
      baseCurrency: 'CRC',
      sinpeContacts: [],
      accounts: appState.accounts,
    },
    dispatch: vi.fn(),
  }),
}));

const colones = (balance: number, rateToUsd?: number) => ({
  ccy: 'CRC', balance, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat', rateToUsd,
});
const dolares = (balance: number) => ({
  ccy: 'USD', balance, symbol: '$', flag: '', iban: '', name: 'Dolares', type: 'fiat', rateToUsd: 1,
});

function setup() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

// La tarjeta principal: el ancestro con el degradado de marca mas cercano al
// rotulo del saldo.
const tarjetaDelSaldo = (rotulo: string) =>
  within(screen.getByText(rotulo).closest('.uv-gradient-brand') as HTMLElement);

beforeAll(() => precargarIdioma('en'));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  appState.accounts = [colones(500_000, 0.002), dolares(445)];
});

describe('HomeView: saldo total de la tarjeta principal', () => {
  it('el numero grande suma todas las cuentas en la moneda base', () => {
    setup();

    // 500.000 colones + 445 dolares (a 0,002 USD por colon) = 722.500 colones.
    expect(tarjetaDelSaldo('Balance Total').getByText('₡722,500.00')).toBeInTheDocument();
    // La cuenta base sola ya no se presenta como el total.
    expect(tarjetaDelSaldo('Balance Total').queryByText('₡500,000.00')).not.toBeInTheDocument();
  });

  it('la linea en dolares sigue ahi, traducida y con el formato de montos de la app', () => {
    setup();

    expect(tarjetaDelSaldo('Balance Total').getByText('≈ $1,445.00 USD en total')).toBeInTheDocument();
    // El texto fijo en ingles ya no se cuela en la app en espanol.
    expect(tarjetaDelSaldo('Balance Total').queryByText(/USD Total/)).not.toBeInTheDocument();
  });

  it('con la app en ingles la linea en dolares se lee en ingles', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    setup();

    expect(await screen.findByText('Total Balance')).toBeInTheDocument();
    expect(tarjetaDelSaldo('Total Balance').getByText('≈ $1,445.00 USD total')).toBeInTheDocument();
  });

  // Antes: `rateToUsd || 1` contaba 500.000 colones como 500.000 dolares.
  it('una cuenta con saldo y sin tasa no se cuenta 1 a 1: muestra el guion', () => {
    appState.accounts = [colones(500_000, undefined), dolares(445)];
    setup();

    const tarjeta = tarjetaDelSaldo('Balance Total');
    expect(tarjeta.getByText('—')).toBeInTheDocument();
    expect(tarjeta.queryByText('₡500,000.00')).not.toBeInTheDocument();
    expect(tarjeta.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it('una tasa en cero tampoco se toma por 1', () => {
    appState.accounts = [colones(500_000, 0), dolares(445)];
    setup();

    expect(tarjetaDelSaldo('Balance Total').getByText('—')).toBeInTheDocument();
  });
});

// Un guion solo no explica nada: quien lo ve no sabe si cargo mal o si no hay
// dato. Sin tipo de cambio, la tarjeta lo dice con palabras y sin cifra inventada.
describe('HomeView: sin tipo de cambio del dolar', () => {
  it('dice que el total no esta disponible y por que', () => {
    appState.accounts = [colones(500_000, undefined), dolares(445)];
    setup();

    const tarjeta = tarjetaDelSaldo('Balance Total');
    expect(tarjeta.getByText('—')).toBeInTheDocument();
    expect(tarjeta.getByText(/Total no disponible por ahora/)).toBeInTheDocument();
    // Ni el total ni la linea en dolares: ninguna cifra salida de una tasa que nadie dio.
    expect(tarjeta.queryByText(/≈ \$/)).not.toBeInTheDocument();
    expect(tarjeta.queryByText(/722/)).not.toBeInTheDocument();
  });

  it('con tipo de cambio no aparece el aviso', () => {
    setup();

    expect(tarjetaDelSaldo('Balance Total').queryByText(/Total no disponible/)).not.toBeInTheDocument();
  });
});