import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessHomeView } from '../BusinessHomeView';
import type { QRMerchant, QRPayment } from '@/api/repositories/qrpayment.repository';

// Dos defectos de la misma familia en la pantalla del comercio:
//
// 1. El servidor entrega los ULTIMOS 50 cobros, no el historico, y la pantalla
//    llamaba "total vendido" a la suma de esa ventana. Un comercio con mas de
//    50 ventas veia menos de lo que vendio, sin ninguna senal.
// 2. Si la lista no se podia traer, todo se pintaba en cero: al duenno se le
//    decia que no vendio nada cuando lo cierto es que no se pudo consultar.
vi.mock('@/api', () => ({
  getApiLayer: () => ({
    qrPayments: {
      // Distinto del total de la ventana a proposito: con los dos en 1000, la
      // asercion sobre '₡1000.00' encontraba DOS nodos y pasaba solo porque el
      // saldo del comercio todavia no habia resuelto su microtarea.
      getMerchantBalance: vi.fn().mockResolvedValue({ success: true, data: 777 }),
      getCatalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLocations: vi.fn().mockResolvedValue({ success: true, data: [] }),
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

const cobro = (id: string, amount: number, currency = 'CRC'): QRPayment =>
  ({
    id, qrCodeId: 'q1', payerId: 'p', receiverId: 'r', merchantId: 'm1',
    amount, fee: amount * 0.005, currency, status: 'completed',
    createdAt: new Date().toISOString(),
  }) as unknown as QRPayment;

const pintar = (payments: QRPayment[], paymentsFailed = false) =>
  render(
    <LanguageProvider>
      <BusinessHomeView merchant={COMERCIO} payments={payments} paymentsFailed={paymentsFailed} onReload={vi.fn()} />
    </LanguageProvider>,
  );

describe('BusinessHomeView', () => {
  it('no llama total a la suma de una ventana: dice de cuantos cobros habla', async () => {
    pintar([cobro('1', 1000), cobro('2', 2000)]);
    await waitFor(() =>
      expect(screen.getByText(/(ultimos|últimos|last)\s*2/i)).toBeTruthy(),
    );
  });

  it('con la lista sin cargar no muestra cero vendido, muestra que no se sabe', async () => {
    pintar([], true);
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
    // ₡0.00 seria una afirmacion sobre las ventas del dia que nadie hizo.
    expect(screen.queryByText('₡0.00')).toBeNull();
  });

  it('un comercio que de verdad no vendio hoy si ve cero', async () => {
    pintar([]);
    await waitFor(() => expect(screen.getAllByText(/₡0\.00/).length).toBeGreaterThan(0));
  });

  it('los cobros en otra moneda no se suman con los colones', async () => {
    pintar([cobro('1', 1000, 'CRC'), cobro('2', 500, 'USD')]);
    // El total rotulado en colones incluye solo el cobro en colones.
    //
    // La asercion decia '₡1000.00' y esa cadena CONGELABA el defecto: la
    // pantalla formateaba con un `simbolo + toFixed(2)` propio, sin separador
    // de miles, contra la regla que el dueno pidio para todos los montos. La
    // prueba que deberia haberlo cazado lo estaba protegiendo.
    await waitFor(() => expect(screen.getByText('₡1,000.00')).toBeTruthy());
    // Y los de la otra moneda se declaran en vez de esconderse.
    expect(screen.getByText(/(otras monedas|other currencies)/i)).toBeTruthy();
    // El cobro en dolares se rotula en dolares, no con el simbolo de colones.
    expect(screen.getByText(/\$500\.00/)).toBeTruthy();
  });

  it('los miles llevan coma, como en el resto de la aplicacion', async () => {
    pintar([cobro('1', 125000, 'CRC')]);
    await waitFor(() => expect(screen.getByText('₡125,000.00')).toBeTruthy());
    expect(screen.queryByText('₡125000.00')).toBeNull();
  });
});

// Con un solo cobro la pantalla decia "Ultimos 1 cobros", y junto a las ventas
// de hoy quedaba un "1" suelto sin decir de que era.
describe('BusinessHomeView — singular y plural', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
  });

  it('un solo cobro: "Último cobro", no "Últimos 1 cobros"', async () => {
    pintar([cobro('1', 1000)]);

    expect(await screen.findByText('Último cobro')).toBeTruthy();
    expect(screen.queryByText(/Últimos 1 cobros/)).toBeNull();
  });

  it('varios cobros: "Últimos N cobros"', async () => {
    pintar([cobro('1', 1000), cobro('2', 2000), cobro('3', 500)]);

    expect(await screen.findByText('Últimos 3 cobros')).toBeTruthy();
  });

  it('las ventas de hoy dicen de que es la cuenta: "1 cobro", no un "1" suelto', async () => {
    pintar([cobro('1', 1000)]);

    expect(await screen.findByText('Ventas de hoy: ₡1,000.00 · 1 cobro')).toBeTruthy();
  });

  it('las ventas de hoy con varios cobros: "3 cobros"', async () => {
    pintar([cobro('1', 1000), cobro('2', 2000), cobro('3', 500)]);

    expect(await screen.findByText('Ventas de hoy: ₡3,500.00 · 3 cobros')).toBeTruthy();
  });
});
