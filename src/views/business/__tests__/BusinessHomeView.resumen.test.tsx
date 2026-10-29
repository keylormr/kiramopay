import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { QRMerchant, QRPayment, ResumenDelComercio } from '@/api/repositories/qrpayment.repository';
import { BusinessHomeView } from '../BusinessHomeView';

// El inicio del negocio ya no suma "los ultimos N cobros", una cifra sin
// periodo que dependia de cuantas ventas habia: muestra las de hoy, de los
// ultimos 7 dias y del mes, que calcula el servidor, con la cantidad de cobros
// rotulada y, con el plan Analitica, la comparacion contra el periodo anterior.

const mocks = vi.hoisted(() => ({
  api: {
    qrPayments: {
      getMerchantBalance: vi.fn(),
      getMerchantSummary: vi.fn(),
      getCatalog: vi.fn(),
      getLocations: vi.fn(),
    },
  },
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  getApiLayer: () => mocks.api,
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC', user: { id: 'u1' } },
    dispatch: vi.fn(),
  }),
}));

const comercio = (extra: Partial<QRMerchant> = {}): QRMerchant => ({
  id: 'm1', name: 'Super La Esquina', description: '', category: 'retail', qrCode: 'MRC-1', active: true,
  cedula: '3101', cedulaType: 'juridica', legalName: 'La Esquina SA', verificationStatus: 'verified',
  commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'base', role: 'owner',
  ...extra,
});

const totales = (gross: number, count: number) => ({ gross, fee: gross * 0.005, net: gross * 0.995, count });

const resumenBase = (): ResumenDelComercio => ({
  plan: 'base',
  periods: [
    { period: 'today', from: '2026-10-29', to: '2026-10-29', currencies: [{ currency: 'CRC', ...totales(1000, 1) }] },
    { period: 'week', from: '2026-10-23', to: '2026-10-29', currencies: [{ currency: 'CRC', ...totales(14000, 12) }] },
    { period: 'month', from: '2026-10-01', to: '2026-10-29', currencies: [{ currency: 'CRC', ...totales(160000, 3) }] },
    { period: 'prev_month', from: '2026-09-01', to: '2026-09-30', currencies: [] },
  ],
});

const resumenAnalitica = (): ResumenDelComercio => ({
  plan: 'analitica',
  periods: [
    {
      period: 'today', from: '2026-10-29', to: '2026-10-29', previousFrom: '2026-10-28', previousTo: '2026-10-28',
      currencies: [{
        currency: 'CRC', ...totales(1000, 1),
        previous: totales(800, 2),
        delta: { gross: 200, fee: 1, net: 199, count: -1, grossPct: 25, netPct: 25, countPct: -50 },
      }],
    },
    {
      period: 'week', from: '2026-10-23', to: '2026-10-29', previousFrom: '2026-10-16', previousTo: '2026-10-22',
      currencies: [{
        currency: 'CRC', ...totales(14000, 12),
        previous: { gross: 0, fee: 0, net: 0, count: 0 },
        delta: { gross: 14000, fee: 70, net: 13930, count: 12, grossPct: null, netPct: null, countPct: null },
      }],
    },
    { period: 'month', from: '2026-10-01', to: '2026-10-29', currencies: [] },
  ],
});

const pagos: QRPayment[] = [];

const pintar = (m: QRMerchant = comercio(), payments: QRPayment[] = pagos, paymentsFailed = false) =>
  render(
    <LanguageProvider>
      <BusinessHomeView merchant={m} payments={payments} paymentsFailed={paymentsFailed} onReload={vi.fn()} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks.api.qrPayments).forEach((fn) => fn.mockReset());
  mocks.api.qrPayments.getMerchantBalance.mockResolvedValue({ success: true, data: 777 });
  mocks.api.qrPayments.getCatalog.mockResolvedValue({ success: true, data: [] });
  mocks.api.qrPayments.getLocations.mockResolvedValue({ success: true, data: [] });
  mocks.api.qrPayments.getMerchantSummary.mockResolvedValue({ success: true, data: resumenBase() });
});

describe('BusinessHomeView: ventas de hoy, de 7 dias y del mes', () => {
  it('muestra los tres periodos con la cantidad de cobros rotulada', async () => {
    pintar();

    const seccion = await screen.findByRole('region', { name: 'Ventas' });
    const hoy = within(seccion).getByRole('group', { name: 'Hoy' });
    const semana = within(seccion).getByRole('group', { name: '7 días' });
    const mes = within(seccion).getByRole('group', { name: 'Este mes' });

    expect(within(hoy).getByText('₡1,000.00')).toBeInTheDocument();
    expect(within(hoy).getByText('1 cobro')).toBeInTheDocument();
    expect(within(semana).getByText('₡14,000.00')).toBeInTheDocument();
    expect(within(semana).getByText('12 cobros')).toBeInTheDocument();
    expect(within(mes).getByText('₡160,000.00')).toBeInTheDocument();
    expect(within(mes).getByText('3 cobros')).toBeInTheDocument();
    expect(mocks.api.qrPayments.getMerchantSummary).toHaveBeenCalledWith('m1');
  });

  it('ya no hay cifras sin periodo: se fue "Ultimos N cobros"', async () => {
    pintar(comercio(), [
      { id: 'a', qrCodeId: 'q', payerId: 'p', receiverId: 'r', amount: 1000, fee: 5, currency: 'CRC', status: 'completed', createdAt: '2026-07-02T10:00:00Z' },
    ]);
    await screen.findByRole('region', { name: 'Ventas' });

    expect(screen.queryByText(/Últimos? \d* ?cobros?/i)).toBeNull();
    expect(screen.queryByText(/Último cobro/i)).toBeNull();
  });

  it('el hero del dueno dice las ventas de hoy con su cantidad de cobros, no con un 1 suelto', async () => {
    pintar();
    expect(await screen.findByText('Ventas de hoy: ₡1,000.00 · 1 cobro')).toBeInTheDocument();
  });

  it('un periodo sin ventas dice cero cobros porque el servidor lo conto', async () => {
    mocks.api.qrPayments.getMerchantSummary.mockResolvedValue({
      success: true,
      data: { plan: 'base', periods: [
        { period: 'today', from: '2026-10-29', to: '2026-10-29', currencies: [] },
        { period: 'week', from: '2026-10-23', to: '2026-10-29', currencies: [] },
        { period: 'month', from: '2026-10-01', to: '2026-10-29', currencies: [] },
      ] },
    });
    pintar();

    const hoy = within(await screen.findByRole('region', { name: 'Ventas' })).getByRole('group', { name: 'Hoy' });
    expect(within(hoy).getByText('₡0.00')).toBeInTheDocument();
    expect(within(hoy).getByText('0 cobros')).toBeInTheDocument();
  });

  it('cada moneda en su linea: los dolares no se suman a los colones', async () => {
    mocks.api.qrPayments.getMerchantSummary.mockResolvedValue({
      success: true,
      data: { plan: 'base', periods: [
        { period: 'today', from: '2026-10-29', to: '2026-10-29', currencies: [
          { currency: 'CRC', ...totales(1000, 1) }, { currency: 'USD', ...totales(50, 2) },
        ] },
        { period: 'week', from: '2026-10-23', to: '2026-10-29', currencies: [] },
        { period: 'month', from: '2026-10-01', to: '2026-10-29', currencies: [] },
      ] },
    });
    pintar();

    const hoy = within(await screen.findByRole('region', { name: 'Ventas' })).getByRole('group', { name: 'Hoy' });
    expect(within(hoy).getByText('₡1,000.00')).toBeInTheDocument();
    expect(within(hoy).getByText('$50.00')).toBeInTheDocument();
    expect(within(hoy).queryByText(/1,050/)).toBeNull();
  });
});

describe('BusinessHomeView: la comparacion con el periodo anterior', () => {
  it('con el plan Analitica compara cada periodo con el anterior, con signo y sin inventar porcentajes', async () => {
    mocks.api.qrPayments.getMerchantSummary.mockResolvedValue({ success: true, data: resumenAnalitica() });
    pintar(comercio({ plan: 'analitica' }));

    const seccion = await screen.findByRole('region', { name: 'Ventas' });
    const hoy = within(seccion).getByRole('group', { name: 'Hoy' });
    expect(within(hoy).getByText('+25%')).toBeInTheDocument();
    expect(within(hoy).getByText(/contra ayer/i)).toBeInTheDocument();

    // Contra una semana anterior sin ventas no hay porcentaje: se dice.
    const semana = within(seccion).getByRole('group', { name: '7 días' });
    expect(within(semana).getByText('Sin cobros antes')).toBeInTheDocument();
    expect(within(semana).queryByText(/%/)).toBeNull();
  });

  it('sin el plan no hay comparacion, y el dueno sabe por que', async () => {
    pintar(comercio({ plan: 'base' }));

    const seccion = await screen.findByRole('region', { name: 'Ventas' });
    expect(within(seccion).queryByText(/%/)).toBeNull();
    expect(within(seccion).getByText('La comparación con el período anterior es parte del plan Analítica.')).toBeInTheDocument();
  });
});

describe('BusinessHomeView: lo que no se pudo traer no se pinta como cero', () => {
  it('si el resumen falla muestra que no se sabe y deja reintentar', async () => {
    const user = userEvent.setup();
    mocks.api.qrPayments.getMerchantSummary
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } })
      .mockResolvedValueOnce({ success: true, data: resumenBase() });
    pintar();

    expect(await screen.findByText('No se pudieron cargar las ventas.')).toBeInTheDocument();
    expect(screen.queryByText('₡0.00')).toBeNull();
    // El hero tampoco inventa un cero.
    expect(screen.queryByText(/Ventas de hoy: ₡0/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getByText('₡14,000.00')).toBeInTheDocument());
  });

  it('mientras llega el resumen no pinta ceros', async () => {
    mocks.api.qrPayments.getMerchantSummary.mockReturnValue(new Promise(() => {}));
    pintar();

    expect(await screen.findByRole('region', { name: 'Ventas' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('₡0.00')).toBeNull();
  });
});

describe('BusinessHomeView: un cajero', () => {
  it('ve las ventas de hoy y nada mas: la semana, el mes y la comparacion no son suyos', async () => {
    mocks.api.qrPayments.getMerchantSummary.mockResolvedValue({
      success: true,
      data: { plan: 'base', periods: [resumenBase().periods[0]] },
    });
    pintar(comercio({ role: 'cashier' }));

    const seccion = await screen.findByRole('region', { name: 'Ventas' });
    expect(within(seccion).getByRole('group', { name: 'Hoy' })).toBeInTheDocument();
    expect(within(seccion).queryByRole('group', { name: '7 días' })).toBeNull();
    expect(within(seccion).queryByRole('group', { name: 'Este mes' })).toBeNull();
    expect(within(seccion).queryByText(/plan Analítica/)).toBeNull();
  });
});

describe('BusinessHomeView: los ultimos movimientos abren su detalle', () => {
  it('tocar un cobro reciente abre el mismo detalle que la pestana de movimientos', async () => {
    const user = userEvent.setup();
    const cobro: QRPayment = {
      id: 'p1', qrCodeId: 'q', payerId: 'u2', receiverId: 'u1', amount: 1000, fee: 5, currency: 'CRC',
      status: 'completed', createdAt: new Date().toISOString(), payerName: 'Ana Mora', txId: 'tx-1',
    };
    pintar(comercio(), [cobro]);

    await user.click(await screen.findByTestId('movimiento'));
    const hoja = await screen.findByRole('dialog', { name: /Detalle del cobro/ });
    expect(within(hoja).getByText('Ana Mora')).toBeInTheDocument();
  });
});
