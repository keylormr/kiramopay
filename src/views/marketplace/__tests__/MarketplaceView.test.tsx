import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { MarketplaceView } from '../MarketplaceView';

const mocks = vi.hoisted(() => ({
  api: {
    marketplace: {
      createRide: vi.fn(),
      confirmRide: vi.fn(),
      getRide: vi.fn(),
      createFoodOrder: vi.fn(),
      getFoodOrder: vi.fn(),
    },
  },
  dispatch: vi.fn(),
}));

vi.mock('@/api', () => ({ getApiLayer: () => mocks.api }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      baseCurrency: 'CRC',
      connectedPartners: ['uber', 'ubereats'],
    },
    dispatch: mocks.dispatch,
  }),
}));

vi.mock('@/services/dataSync', () => ({ refreshAccounts: vi.fn(() => Promise.resolve()) }));

const VIAJE = {
  id: 'r1',
  partnerId: 'uber',
  pickup: 'Paraíso',
  destination: 'Cartago',
  estimatedPrice: 7800,
  estimatedTime: '9 min',
  distance: '6.2 km',
  status: 'searching',
  minutesRemaining: 9,
  driver: { name: 'Ana Solís', rating: 4.81, car: 'Kia Rio', plate: 'MOT-264', photo: '' },
};

function setup() {
  return render(
    <LanguageProvider>
      <MarketplaceView />
    </LanguageProvider>,
  );
}

/** Abre la hoja de viaje de Uber con origen y destino escritos. */
async function pedirViaje(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByText('Uber')[0]);
  await user.type(await screen.findByPlaceholderText('¿Dónde te recogemos?'), 'Paraíso');
  await user.type(screen.getByPlaceholderText('¿A dónde vas?'), 'Cartago');
}

/** Abre Uber Eats, elige McDonalds, agrega un combo y va al carrito. */
async function llenarCarrito(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByText('Uber Eats')[0]);
  await user.click(await screen.findByText('McDonalds'));
  const fila = screen.getByText('Combo 1').closest('div')?.parentElement as HTMLElement;
  await user.click(within(fila).getByRole('button'));
  await user.click(screen.getByRole('button', { name: /Ver carrito/ }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  for (const fn of Object.values(mocks.api.marketplace)) fn.mockReset();
  mocks.dispatch.mockReset();
  mocks.api.marketplace.getRide.mockResolvedValue({ success: false });
  mocks.api.marketplace.getFoodOrder.mockResolvedValue({ success: false });
});

describe('MarketplaceView — viajes', () => {
  // El precio y el tiempo salian de dos constantes escritas a mano, sin
  // relacion con el origen ni el destino que el usuario acababa de escribir.
  it('no muestra precio ni tiempo antes de la cotización del servidor', async () => {
    const user = userEvent.setup();
    setup();

    await pedirViaje(user);

    expect(screen.queryByText('Precio estimado')).not.toBeInTheDocument();
    expect(screen.queryByText('₡5,500.00')).not.toBeInTheDocument();
    expect(screen.queryByText('12-18 min')).not.toBeInTheDocument();
    expect(
      screen.getByText('El precio y el tiempo aparecen cuando el servicio los cotice.'),
    ).toBeInTheDocument();
  });

  // Antes se pasaba a 'found' aunque createRide fallara, y la pantalla
  // rellenaba conductor, calificación 5.00 y un precio de ₡5.250.
  it('no avanza ni inventa conductor cuando falla la solicitud', async () => {
    mocks.api.marketplace.createRide.mockResolvedValue({
      success: false,
      error: { code: 'RIDE_FAILED', message: 'no se pudo pedir el viaje' },
    });
    const user = userEvent.setup();
    setup();

    await pedirViaje(user);
    await user.click(screen.getByRole('button', { name: 'Pedir Uber' }));

    expect(await screen.findByText('no se pudo pedir el viaje')).toBeInTheDocument();
    expect(screen.queryByText('¡Conductor encontrado!')).not.toBeInTheDocument();
    expect(screen.queryByText('5.00')).not.toBeInTheDocument();
    expect(screen.queryByText('₡5,250.00')).not.toBeInTheDocument();
    // Sigue en la pantalla de origen y destino.
    expect(screen.getByRole('button', { name: 'Pedir Uber' })).toBeInTheDocument();
  });

  it('muestra el precio que cotizó el servidor, no uno propio', async () => {
    mocks.api.marketplace.createRide.mockResolvedValue({ success: true, data: VIAJE });
    const user = userEvent.setup();
    setup();

    await pedirViaje(user);
    await user.click(screen.getByRole('button', { name: 'Pedir Uber' }));

    expect(await screen.findByText('¡Conductor encontrado!')).toBeInTheDocument();
    expect(screen.getByText('₡7,800.00')).toBeInTheDocument();
    expect(screen.getByText('9 min')).toBeInTheDocument();
    expect(screen.queryByText('₡5,250.00')).not.toBeInTheDocument();
  });

  // Confirmar es el paso que cobra: si el servidor lo niega no hay viaje que
  // seguir. Antes se entraba al seguimiento igual.
  it('explica la negativa al confirmar y no entra al seguimiento', async () => {
    mocks.api.marketplace.createRide.mockResolvedValue({ success: true, data: VIAJE });
    mocks.api.marketplace.confirmRide.mockResolvedValue({
      success: false,
      error: { code: 'SIN_INTEGRACION', message: 'el cobro no se puede entregar todavia' },
    });
    const user = userEvent.setup();
    setup();

    await pedirViaje(user);
    await user.click(screen.getByRole('button', { name: 'Pedir Uber' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar viaje' }));

    expect(
      await screen.findByText(/Todavía no tenemos integración con esta aplicación de viajes/),
    ).toBeInTheDocument();
    expect(screen.getByText(/tu saldo sigue igual/)).toBeInTheDocument();
    expect(screen.queryByText('el cobro no se puede entregar todavia')).not.toBeInTheDocument();
    expect(screen.queryByText('Tu conductor viene en camino')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe('MarketplaceView — pedidos', () => {
  // El envío salía de una tabla local (1000-2000) mientras el backend cobra
  // 1500: el usuario confirmaba un total y se le debitaba otro.
  it('no muestra un envío ni un total que el servidor no dio', async () => {
    const user = userEvent.setup();
    setup();

    await llenarCarrito(user);

    const resumen = screen.getByText('Subtotal').parentElement as HTMLElement;
    expect(within(resumen).getByText('₡4,500.00')).toBeInTheDocument();
    expect(screen.queryByText('Envío')).not.toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
    expect(screen.queryByText('₡6,000.00')).not.toBeInTheDocument();
    expect(
      screen.getByText('El costo de envío lo confirma el servicio al hacer el pedido.'),
    ).toBeInTheDocument();
  });

  // Antes el salto al seguimiento vivía en el finally: el pedido no existía y
  // la pantalla lo mostraba en curso igual.
  it('explica la negativa del pedido y no entra al seguimiento', async () => {
    mocks.api.marketplace.createFoodOrder.mockResolvedValue({
      success: false,
      error: { code: 'SIN_INTEGRACION', message: 'el cobro no se puede entregar todavia' },
    });
    const user = userEvent.setup();
    setup();

    await llenarCarrito(user);
    await user.click(screen.getByRole('button', { name: /Pagar con KiramoPay/ }));

    expect(
      await screen.findByText(/Todavía no tenemos integración con este servicio de pedidos/),
    ).toBeInTheDocument();
    expect(screen.getByText(/tu saldo sigue igual/)).toBeInTheDocument();
    expect(screen.queryByText('el cobro no se puede entregar todavia')).not.toBeInTheDocument();
    expect(screen.queryByText('Pedido en curso')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('muestra el total que cobró el servidor cuando el pedido se crea', async () => {
    mocks.api.marketplace.createFoodOrder.mockResolvedValue({
      success: true,
      data: {
        id: 'o1',
        partnerId: 'ubereats',
        restaurantName: 'McDonalds',
        items: [{ name: 'Combo 1', quantity: 1, price: 4500 }],
        subtotal: 4500,
        deliveryFee: 1500,
        total: 6000,
        status: 'preparing',
        estimatedDelivery: '30 min',
        minutesRemaining: 30,
      },
    });
    const user = userEvent.setup();
    setup();

    await llenarCarrito(user);
    await user.click(screen.getByRole('button', { name: /Pagar con KiramoPay/ }));

    expect(await screen.findByText('Pedido en curso')).toBeInTheDocument();
    expect(screen.getByText('Total cobrado')).toBeInTheDocument();
    expect(screen.getByText('₡6,000.00')).toBeInTheDocument();
    expect(screen.getByText('₡1,500.00')).toBeInTheDocument();
  });
});
