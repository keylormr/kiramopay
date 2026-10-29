import { render, screen, waitFor, within } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessHomeView } from '../BusinessHomeView';
import type { QRMerchant, QRPayment, ResumenDelComercio, VentasPorMoneda } from '@/api/repositories/qrpayment.repository';

// Las cifras del inicio del negocio salen del servidor, por periodo y por
// moneda. Dos defectos de la familia anterior siguen vigilados:
//
// 1. Una cifra sin periodo: antes se sumaban "los ultimos 50 cobros" y un
//    comercio con mas ventas veia menos de lo que vendio, sin ninguna senal.
// 2. Si la consulta fallaba, todo se pintaba en cero: al dueno se le decia que
//    no vendio nada cuando lo cierto es que no se pudo consultar.
const mocks = vi.hoisted(() => ({ getMerchantSummary: vi.fn() }));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    qrPayments: {
      // Distinto de las ventas a proposito: con los dos en 1000, una asercion
      // sobre '₡1,000.00' encontraba DOS nodos y pasaba solo porque el saldo del
      // comercio todavia no habia resuelto su microtarea.
      getMerchantBalance: vi.fn().mockResolvedValue({ success: true, data: 777 }),
      getCatalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLocations: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getMerchantSummary: mocks.getMerchantSummary,
    },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

const COMERCIO = {
  id: 'm1', name: 'Soda', description: '', category: 'food', qrCode: 'MRC-1',
  active: true, cedula: '3101', cedulaType: 'juridica', legalName: 'Soda SA',
  verificationStatus: 'verified', commissionBps: 50, role: 'owner',
} as unknown as QRMerchant;

const venta = (currency: string, gross: number, count: number): VentasPorMoneda => ({
  currency, gross, fee: gross * 0.005, net: gross * 0.995, count,
});

const resumenDeHoy = (hoy: VentasPorMoneda[]): ResumenDelComercio => ({
  plan: 'base',
  periods: [
    { period: 'today', from: '2026-10-29', to: '2026-10-29', currencies: hoy },
    { period: 'week', from: '2026-10-23', to: '2026-10-29', currencies: [] },
    { period: 'month', from: '2026-10-01', to: '2026-10-29', currencies: [] },
  ],
});

const pintar = (payments: QRPayment[] = [], paymentsFailed = false) =>
  render(
    <LanguageProvider>
      <BusinessHomeView merchant={COMERCIO} payments={payments} paymentsFailed={paymentsFailed} onReload={vi.fn()} />
    </LanguageProvider>,
  );

// La seccion existe desde el primer render y queda ocupada (aria-busy) mientras
// llega el resumen: leer sus periodos antes de eso es una carrera contra la respuesta.
const seccionDeVentas = async () => {
  const seccion = await screen.findByRole('region', { name: 'Ventas' });
  await waitFor(() => expect(seccion).toHaveAttribute('aria-busy', 'false'));
  return seccion;
};

const grupoDeHoy = async () => within(await seccionDeVentas()).getByRole('group', { name: 'Hoy' });

// La respuesta llega despues, como la de un servidor de verdad.
const llegaDespues = <T,>(valor: T, ms = 25) => new Promise<T>((resolver) => setTimeout(() => resolver(valor), ms));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getMerchantSummary.mockReset();
  mocks.getMerchantSummary.mockImplementation(() => llegaDespues({ success: true, data: resumenDeHoy([venta('CRC', 1000, 1)]) }));
});

describe('BusinessHomeView', () => {
  it('cada cifra dice de que periodo es: no hay una ventana de "ultimos N cobros"', async () => {
    pintar();
    await grupoDeHoy();

    expect(screen.queryByText(/[ÚU]ltimos?\s*\d*\s*cobros?/i)).toBeNull();
    const seccion = screen.getByRole('region', { name: 'Ventas' });
    expect(within(seccion).getByRole('group', { name: '7 días' })).toBeInTheDocument();
    expect(within(seccion).getByRole('group', { name: 'Este mes' })).toBeInTheDocument();
  });

  it('con la consulta fallida no muestra cero vendido, muestra que no se sabe', async () => {
    mocks.getMerchantSummary.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } });
    pintar();

    expect(await screen.findByText('No se pudieron cargar las ventas.')).toBeTruthy();
    // ₡0.00 seria una afirmacion sobre las ventas del dia que nadie hizo.
    expect(screen.queryByText('₡0.00')).toBeNull();
    expect(screen.queryByText(/Ventas de hoy/)).toBeNull();
  });

  it('un comercio que de verdad no vendio hoy si ve cero', async () => {
    mocks.getMerchantSummary.mockResolvedValue({ success: true, data: resumenDeHoy([]) });
    pintar();

    const hoy = await grupoDeHoy();
    expect(within(hoy).getByText('₡0.00')).toBeTruthy();
    expect(within(hoy).getByText('0 cobros')).toBeTruthy();
  });

  it('las ventas en otra moneda no se suman con los colones y se rotulan en la suya', async () => {
    mocks.getMerchantSummary.mockResolvedValue({
      success: true,
      data: resumenDeHoy([venta('CRC', 1000, 1), venta('USD', 500, 2)]),
    });
    pintar();

    const hoy = await grupoDeHoy();
    expect(within(hoy).getByText('₡1,000.00')).toBeTruthy();
    // El cobro en dolares se rotula en dolares, no con el simbolo de colones.
    expect(within(hoy).getByText('$500.00')).toBeTruthy();
    expect(within(hoy).queryByText(/1,500/)).toBeNull();
  });

  it('los miles llevan coma, como en el resto de la aplicacion', async () => {
    mocks.getMerchantSummary.mockResolvedValue({ success: true, data: resumenDeHoy([venta('CRC', 125000, 1)]) });
    pintar();

    const hoy = await grupoDeHoy();
    expect(within(hoy).getByText('₡125,000.00')).toBeTruthy();
    expect(screen.queryByText('₡125000.00')).toBeNull();
  });
});

// Con un solo cobro la pantalla decia "Ultimos 1 cobros", y junto a las ventas
// de hoy quedaba un "1" suelto sin decir de que era.
describe('BusinessHomeView: singular y plural', () => {
  it('las ventas de hoy dicen de que es la cuenta: "1 cobro", no un "1" suelto', async () => {
    pintar();

    const hoy = await grupoDeHoy();
    expect(within(hoy).getByText('₡1,000.00')).toBeTruthy();
    expect(within(hoy).getByText('1 cobro')).toBeTruthy();
  });

  it('las ventas de hoy con varios cobros: "3 cobros"', async () => {
    mocks.getMerchantSummary.mockResolvedValue({ success: true, data: resumenDeHoy([venta('CRC', 3500, 3)]) });
    pintar();

    const hoy = await grupoDeHoy();
    expect(within(hoy).getByText('₡3,500.00')).toBeTruthy();
    expect(within(hoy).getByText('3 cobros')).toBeTruthy();
    // Una sola vez: la tarjeta del saldo no las repite.
    expect(screen.queryByText(/Ventas de hoy/)).toBeNull();
  });
});
