import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { MarketplaceView } from '../MarketplaceView';
import { precargarIdioma } from '@/test/idiomas';

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
  conectados: ['uber', 'ubereats'] as string[],
}));

vi.mock('@/api', () => ({ getApiLayer: () => mocks.api }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      baseCurrency: 'CRC',
      connectedPartners: mocks.conectados,
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
  mocks.conectados = ['uber', 'ubereats'];
  mocks.api.marketplace.getRide.mockResolvedValue({ success: false });
  mocks.api.marketplace.getFoodOrder.mockResolvedValue({ success: false });
});

beforeAll(() => precargarIdioma('en'));

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

// El encabezado, los filtros y los titulos de seccion estaban en espanol fijo:
// con la app en ingles se leia "Todo", "Transporte" o "Apps conectadas".
describe('MarketplaceView — idioma', () => {
  it('traduce el subtitulo, los filtros y los titulos de seccion', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    const user = userEvent.setup();
    setup();

    expect(await screen.findByText('Rides, food and more')).toBeInTheDocument();
    for (const filtro of ['All', 'Transport', 'Food', 'Groceries', 'Movies']) {
      expect(screen.getByRole('button', { name: new RegExp(filtro) })).toBeInTheDocument();
    }
    expect(screen.getByText('Connected apps')).toBeInTheDocument();
    expect(screen.getByText('All services')).toBeInTheDocument();
    for (const fijo of ['Paga con KiramoPay en tus apps favoritas', 'Apps conectadas', 'Todos los servicios', 'Transporte']) {
      expect(screen.queryByText(fijo)).not.toBeInTheDocument();
    }

    // El titulo de la seccion sigue al filtro elegido, en el mismo idioma.
    await user.click(screen.getByRole('button', { name: /Groceries/ }));
    expect(screen.getByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
  });
});

// Los pasos del seguimiento, las descripciones de los socios, los textos de
// las hojas de viaje y de pedido, los marcadores y los botones estaban escritos
// en espanol dentro de la pantalla: con la app en ingles se leia "Preparando",
// "¿A dónde vas?" o "Pagar con KiramoPay".
describe('MarketplaceView — viajes y pedidos en el idioma de la app', () => {
  const EN_CAMINO = { ...VIAJE, status: 'confirmed', minutesRemaining: 9 };
  const PEDIDO = {
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
  };

  beforeEach(() => {
    localStorage.setItem('kiramopay_language', 'en');
  });

  /** Ninguno de estos textos fijos en espanol puede quedar en pantalla. */
  function sinTextos(...textos: Array<string | RegExp>) {
    for (const texto of textos) {
      expect(screen.queryByText(texto)).not.toBeInTheDocument();
    }
  }

  /** Espera a que el idioma cargue y abre la hoja de viaje de Uber. */
  async function abrirViaje(user: ReturnType<typeof userEvent.setup>) {
    expect(await screen.findByText('Rides, food and more')).toBeInTheDocument();
    await user.click(screen.getAllByText('Uber')[0]);
    await screen.findByPlaceholderText('Where should we pick you up?');
  }

  /** Abre el viaje y escribe origen y destino, con la app en ingles. */
  async function escribirViaje(user: ReturnType<typeof userEvent.setup>) {
    await abrirViaje(user);
    await user.type(screen.getByPlaceholderText('Where should we pick you up?'), 'Paraíso');
    await user.type(screen.getByPlaceholderText('Where are you going?'), 'Cartago');
  }

  /** Llega a la pantalla del viaje cotizado: pide y espera al conductor. */
  async function cotizarViaje(user: ReturnType<typeof userEvent.setup>) {
    mocks.api.marketplace.createRide.mockResolvedValue({ success: true, data: VIAJE });
    await escribirViaje(user);
    await user.click(screen.getByRole('button', { name: 'Request Uber' }));
    await screen.findByText('Driver found!');
  }

  /** Confirma el viaje cotizado y entra al seguimiento con el estado dado. */
  async function seguirViaje(
    user: ReturnType<typeof userEvent.setup>,
    viaje: typeof EN_CAMINO,
  ) {
    mocks.api.marketplace.confirmRide.mockResolvedValue({ success: true, data: viaje });
    await cotizarViaje(user);
    await user.click(screen.getByRole('button', { name: 'Confirm ride' }));
  }

  /** Espera el idioma, abre Uber Eats, elige McDonalds y agrega un combo. */
  async function agregarCombo(user: ReturnType<typeof userEvent.setup>) {
    expect(await screen.findByText('Rides, food and more')).toBeInTheDocument();
    await user.click(screen.getAllByText('Uber Eats')[0]);
    await user.click(await screen.findByText('McDonalds'));
    const fila = screen.getByText('Combo 1').closest('div')?.parentElement as HTMLElement;
    await user.click(within(fila).getByRole('button'));
  }

  /** Paga el carrito y entra al seguimiento del pedido con el estado dado. */
  async function seguirPedido(
    user: ReturnType<typeof userEvent.setup>,
    pedido: typeof PEDIDO & { courier?: { name: string; vehicle: string; plate: string } },
  ) {
    mocks.api.marketplace.createFoodOrder.mockResolvedValue({ success: true, data: pedido });
    await agregarCombo(user);
    await user.click(screen.getByRole('button', { name: /View cart \(1\)/ }));
    await user.click(screen.getByRole('button', { name: 'Pay with KiramoPay' }));
  }

  it('traduce la descripcion de cada socio', async () => {
    setup();

    expect(await screen.findByText('Rides, food and more')).toBeInTheDocument();
    for (const descripcion of [
      'Safe and reliable rides',
      'Your ride, your price',
      'Negotiate your fare',
      'Your favorite food, delivered',
      'Order whatever you want',
      'Everything at your door',
      'Premium supermarket',
      'Low prices, always',
      'Your trusted supermarket',
      'Wholesale shopping',
      'The best movie experience',
      'Quality cinema',
    ]) {
      expect(screen.getByText(descripcion)).toBeInTheDocument();
    }
    sinTextos(
      'Viajes seguros y confiables',
      'Tu viaje, tu precio',
      'Negocia tu tarifa',
      'Tu comida favorita a domicilio',
      'Pide lo que quieras',
      'Todo a tu puerta',
      'Supermercado premium',
      'Precios bajos siempre',
      'Tu súper de confianza',
      'Compras al mayoreo',
      'La mejor experiencia de cine',
      'Cine de calidad',
    );
  });

  it('traduce la hoja para conectar una cuenta', async () => {
    const user = userEvent.setup();
    setup();

    expect(await screen.findByText('Rides, food and more')).toBeInTheDocument();
    await user.click(screen.getByText('Walmart'));

    expect(await screen.findByText('Once connected, you can:')).toBeInTheDocument();
    expect(screen.getByText('Pay directly with KiramoPay')).toBeInTheDocument();
    expect(screen.getByText('View transaction history')).toBeInTheDocument();
    expect(screen.getByText('Receive exclusive cashback')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Walmart' })).toBeInTheDocument();
    sinTextos(
      'Al conectar podrás:',
      'Pagar directamente con KiramoPay',
      'Ver historial de transacciones',
      'Recibir cashback exclusivo',
    );
    expect(screen.queryByRole('button', { name: 'Conectar Walmart' })).not.toBeInTheDocument();
  });

  it('traduce la hoja de una cuenta ya conectada', async () => {
    mocks.conectados = ['walmart'];
    const user = userEvent.setup();
    setup();

    expect(await screen.findByText('Rides, food and more')).toBeInTheDocument();
    await user.click(screen.getAllByText('Walmart')[0]);

    expect(await screen.findByText('Account connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Walmart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect account' })).toBeInTheDocument();
    sinTextos('Cuenta conectada');
    expect(screen.queryByRole('button', { name: 'Usar Walmart' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desconectar cuenta' })).not.toBeInTheDocument();
  });

  it('traduce el origen, el destino y el boton de pedir el viaje', async () => {
    const user = userEvent.setup();
    setup();

    await abrirViaje(user);

    expect(screen.getByPlaceholderText('Where are you going?')).toBeInTheDocument();
    expect(screen.getByText('My current location')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request Uber' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('¿Dónde te recogemos?')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('¿A dónde vas?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir Uber' })).not.toBeInTheDocument();
    sinTextos('Mi ubicación actual');

    // El atajo escribe el origen en el idioma de la app.
    await user.click(screen.getByText('My current location'));
    expect(screen.getByPlaceholderText('Where should we pick you up?')).toHaveValue(
      'My current location',
    );
  });

  it('traduce la espera del conductor', async () => {
    mocks.api.marketplace.createRide.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    setup();

    await escribirViaje(user);
    await user.click(screen.getByRole('button', { name: 'Request Uber' }));

    expect(await screen.findByText('Looking for a driver...')).toBeInTheDocument();
    expect(screen.getByText('This may take a few seconds')).toBeInTheDocument();
    sinTextos('Buscando conductor...', 'Esto puede tomar unos segundos');
  });

  it('traduce el viaje cotizado y el boton de confirmar', async () => {
    const user = userEvent.setup();
    setup();

    await cotizarViaje(user);

    expect(screen.getByText('Total to pay')).toBeInTheDocument();
    expect(screen.getByText('Estimated time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm ride' })).toBeInTheDocument();
    sinTextos('¡Conductor encontrado!', 'Total a pagar', 'Tiempo estimado');
    expect(screen.queryByRole('button', { name: 'Confirmar viaje' })).not.toBeInTheDocument();
  });

  it('traduce el seguimiento del viaje con el conductor en camino', async () => {
    const user = userEvent.setup();
    setup();

    await seguirViaje(user, EN_CAMINO);

    expect(await screen.findByText('Your driver is on the way')).toBeInTheDocument();
    expect(screen.getByText('Your driver arrives in')).toBeInTheDocument();
    expect(screen.getByText('9 min')).toBeInTheDocument();
    for (const paso of ['Confirmed', 'On the way to you', 'Trip in progress', 'You arrived']) {
      expect(screen.getByText(paso)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Continue in the background' })).toBeInTheDocument();
    sinTextos(
      'Tu conductor viene en camino',
      'Tu conductor llega en',
      'Confirmado',
      'En camino a ti',
      'Viaje en curso',
      'Llegaste',
    );
    expect(screen.queryByRole('button', { name: 'Seguir en segundo plano' })).not.toBeInTheDocument();
  });

  it('traduce el viaje en curso, el aviso de llegada inminente y el fin del viaje', async () => {
    const user = userEvent.setup();
    setup();

    await seguirViaje(user, { ...EN_CAMINO, status: 'in_progress', minutesRemaining: 0 });

    // El titulo y el paso del seguimiento dicen lo mismo: dos textos.
    expect(await screen.findAllByText('Trip in progress')).toHaveLength(2);
    expect(screen.getByText('You arrive in')).toBeInTheDocument();
    expect(screen.getByText('Very soon')).toBeInTheDocument();
    sinTextos('Viaje en curso', 'Llegas en', 'Muy pronto');
  });

  it('traduce la llegada al destino y el boton de cerrar', async () => {
    const user = userEvent.setup();
    setup();

    await seguirViaje(user, { ...EN_CAMINO, status: 'completed', minutesRemaining: 0 });

    expect(await screen.findByText('You arrived at your destination!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    sinTextos('¡Llegaste a tu destino!', 'Llegaste');
    expect(screen.queryByRole('button', { name: 'Listo' })).not.toBeInTheDocument();
  });

  it('traduce el buscador de restaurantes y el menu', async () => {
    const user = userEvent.setup();
    setup();

    expect(await screen.findByText('Rides, food and more')).toBeInTheDocument();
    await user.click(screen.getAllByText('Uber Eats')[0]);

    expect(await screen.findByPlaceholderText('Search restaurants...')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Buscar restaurantes...')).not.toBeInTheDocument();

    await user.click(screen.getByText('McDonalds'));

    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByText('Large Fries')).toBeInTheDocument();
    expect(screen.getByText('Drink')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeInTheDocument();
    sinTextos('Menú', 'Papas Grandes', 'Bebida');
  });

  it('traduce el carrito', async () => {
    const user = userEvent.setup();
    setup();

    await agregarCombo(user);

    expect(screen.getByRole('button', { name: /View cart \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver carrito/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /View cart \(1\)/ }));

    expect(screen.getByText('Your order')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay with KiramoPay' })).toBeInTheDocument();
    sinTextos('Tu pedido');
    expect(screen.queryByRole('button', { name: 'Pagar con KiramoPay' })).not.toBeInTheDocument();
  });

  it('traduce el seguimiento del pedido', async () => {
    const user = userEvent.setup();
    setup();

    await seguirPedido(user, PEDIDO);

    expect(await screen.findByText('Order in progress')).toBeInTheDocument();
    expect(screen.getByText('Arrives in')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
    for (const paso of ['Preparing', 'Ready', 'On the way', 'Delivered']) {
      expect(screen.getByText(paso)).toBeInTheDocument();
    }
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByText('Total charged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue in the background' })).toBeInTheDocument();
    sinTextos(
      'Pedido en curso',
      'Llega en',
      'Preparando',
      'Listo',
      'En camino',
      'Entregado',
      'Envío',
      'Total cobrado',
    );
    expect(screen.queryByRole('button', { name: 'Seguir en segundo plano' })).not.toBeInTheDocument();
  });

  it('traduce el pedido a punto de llegar y el pedido entregado', async () => {
    const user = userEvent.setup();
    setup();

    await seguirPedido(user, {
      ...PEDIDO,
      status: 'delivered',
      minutesRemaining: 0,
      courier: { name: 'Luis Mora', vehicle: 'Honda 125', plate: 'MOT-110' },
    });

    expect(await screen.findByText('Order delivered!')).toBeInTheDocument();
    expect(screen.getByText('Your courier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    sinTextos('¡Pedido entregado!', 'Tu repartidor');
    expect(screen.queryByRole('button', { name: 'Listo' })).not.toBeInTheDocument();
  });

  it('traduce el aviso de pedido casi listo', async () => {
    const user = userEvent.setup();
    setup();

    await seguirPedido(user, { ...PEDIDO, minutesRemaining: 0 });

    expect(await screen.findByText('Almost there')).toBeInTheDocument();
    sinTextos('Casi listo');
  });
});
