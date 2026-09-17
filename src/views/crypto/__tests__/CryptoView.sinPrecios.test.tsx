import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// La pantalla mostraba el punto verde de "precios al dia" y un total de $0.00
// aunque el backend no devolviera un solo precio: degrada a una cache vacia y
// responde 200 igual. Tener saldo y ningun precio no es una cartera que vale
// cero, es una cartera que no se puede valorar. Estas pruebas fijan las dos
// mitades: se avisa, y no se inventa un numero.
//
// Archivo aparte del CryptoView.test.tsx principal porque necesita variar el
// estado y la respuesta de precios entre casos, y aquel los tiene fijos.
const mocks = vi.hoisted(() => ({
  getPrices: vi.fn(),
  // Expuesto para poder afirmar que NADIE lo llama: CryptoView ya no tiene un
  // fetchPriceHistories() propio (se elimino junto con el arreglo del
  // sparkline), asi que este metodo del servicio -que hace su propia llamada
  // a /crypto/prices- debe quedar mudo mientras la vista este montada.
  getAllPriceHistories: vi.fn().mockResolvedValue({}),
  dispatch: vi.fn(),
  // La cartera cambia por caso. La vista lee `currentPrice` de aqui, no de la
  // respuesta de precios: son dos cosas distintas y hay casos donde difieren.
  activos: [] as Array<Record<string, unknown>>,
  preciosWs: {} as Record<string, unknown>,
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    crypto: {
      convert: vi.fn(),
      stake: vi.fn(),
      unstake: vi.fn(),
      claimYield: vi.fn(),
      getPriceAlerts: vi.fn().mockResolvedValue({ success: true, data: [] }),
    },
  }),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/services/cryptoPrices', () => ({
  cryptoPriceService: {
    getPrices: mocks.getPrices,
    getAllPriceHistories: mocks.getAllPriceHistories,
  },
  // La vista lo lee al cargarse para saber que simbolos no dependen del feed.
  SIMBOLOS_SIN_FEED: ['USDT', 'USDC'],
}));

// El otro camino de precios: el socket, que en produccion llega antes que el
// siguiente sondeo REST -que es cada cinco minutos-.
vi.mock('@/hooks/useCryptoPricesWs', () => ({
  useCryptoPricesWs: () => ({ prices: mocks.preciosWs, lastUpdate: null, connected: true }),
}));

vi.mock('@/services/fxRate', () => ({
  getUsdToCrcRate: vi.fn().mockResolvedValue(510),
  getCachedUsdToCrcRate: () => 510,
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      crypto: {
        assets: mocks.activos,
        transactions: [],
        stakingPositions: [],
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: mocks.dispatch,
  }),
}));

const activo = (symbol: string, balance: number, currentPrice: number) => ({
  id: symbol,
  symbol,
  name: symbol,
  balance,
  currentPrice,
  avgBuyPrice: currentPrice,
  change24h: 0,
  priceChange24h: 0,
  icon: symbol[0],
  color: '#123456',
  priceHistory: [],
});

// Lo que el backend cotiza de verdad: el mapa coinGeckoIDs de
// backend/internal/crypto/prices.go, sin las estables ancladas al dolar.
const SIMBOLOS_CON_FEED = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'AVAX', 'LINK', 'MATIC', 'UNI', 'ATOM'];

const precio = (symbol: string, price: number, priceHistory: number[] = []) => ({
  symbol,
  price,
  change24h: 0,
  volume24h: 0,
  marketCap: 0,
  priceHistory,
});

// La respuesta sana del feed. `omitidos` simula la respuesta a medias: el
// proveedor limita por cuota y el backend devuelve 200 con lo que alcanzo.
const feed = (omitidos: string[] = []) =>
  SIMBOLOS_CON_FEED.filter(s => !omitidos.includes(s)).map(s => precio(s, 1000));

function montar() {
  return render(
    <LanguageProvider>
      <CryptoView />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getPrices.mockReset();
  mocks.getAllPriceHistories.mockClear();
  mocks.dispatch.mockReset();
  mocks.activos = [activo('BTC', 0.5, 0)];
  mocks.preciosWs = {};
});

describe('CryptoView — sin precios lo dice, no inventa un total', () => {
  it('avisa cuando el backend no devuelve ningun precio', async () => {
    mocks.getPrices.mockResolvedValue([]);
    montar();

    expect(await screen.findByText('No se pudieron actualizar los precios')).toBeInTheDocument();
    expect(
      screen.getByText('Los valores pueden estar desactualizados. Se vuelve a intentar solo.'),
    ).toBeInTheDocument();
  });

  it('muestra un guion en vez de un total falso cuando hay saldo y ningun precio', async () => {
    mocks.getPrices.mockResolvedValue([]);
    montar();

    await screen.findByText('No se pudieron actualizar los precios');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('—');
    // El total falso que se estaba mostrando antes del arreglo, en el
    // encabezado y en la fila del activo.
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('no inventa una perdida en la insignia de ganancia', async () => {
    mocks.getPrices.mockResolvedValue([]);
    montar();

    await screen.findByText('No se pudieron actualizar los precios');
    // Con precio 0 la ganancia se calculaba contra el precio de compra y salia
    // una perdida enorme que nadie tuvo. Nada de porcentajes ni de montos.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/-\$/)).not.toBeInTheDocument();
  });

  it('tambien avisa si la consulta de precios falla', async () => {
    mocks.getPrices.mockRejectedValue(new Error('sin red'));
    montar();

    expect(await screen.findByText('No se pudieron actualizar los precios')).toBeInTheDocument();
  });

  it('no avisa ni oculta el total cuando los precios llegan', async () => {
    mocks.activos = [activo('BTC', 0.5, 40000)];
    mocks.getPrices.mockResolvedValue(feed());
    montar();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('—');
    });
    expect(screen.queryByText('No se pudieron actualizar los precios')).not.toBeInTheDocument();
  });

  // Cartera mixta: el total sumaba SOLO los activos con precio y presentaba ese
  // subtotal como el total de la cartera. El criterio viejo -"ningun activo
  // tiene precio"- no se cumplia, asi que el numero incompleto se mostraba como
  // si estuviera completo, y por lo bajo.
  it('muestra guion en el total y avisa cuando solo una parte de la cartera tiene precio', async () => {
    mocks.activos = [activo('BTC', 0.5, 40000), activo('ETH', 2, 0)];
    mocks.getPrices.mockResolvedValue(feed(['ETH']));
    montar();

    expect(await screen.findByText('No se pudieron actualizar los precios')).toBeInTheDocument();
    const total = screen.getByRole('heading', { level: 1 });
    expect(total).toHaveTextContent('—');
    // El guion no se lee en voz alta: sin esto el total queda mudo.
    expect(total).toHaveAttribute('aria-label', 'Valor no disponible');
  });

  // Respuesta parcial: el criterio viejo era "la lista vino vacia". Con un solo
  // precio de vuelta el punto volvia a verde y no se avisaba nada, que es
  // exactamente lo que hace el backend cuando el proveedor lo limita por cuota.
  it('avisa cuando el backend responde a medias, no solo cuando no responde', async () => {
    mocks.activos = [activo('BTC', 0.5, 40000), activo('ETH', 2, 2000)];
    mocks.getPrices.mockResolvedValue([precio('BTC', 40000)]);
    montar();

    expect(await screen.findByText('No se pudieron actualizar los precios')).toBeInTheDocument();
    // La cartera si se puede valorar -los dos activos tienen precio-, asi que
    // el total sigue siendo un numero: lo que falla es el feed, y eso se avisa.
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('—');
  });

  // El socket actualizaba precios y la hora, pero dejaba el error puesto: el
  // punto rojo y el aviso sobrevivian hasta el siguiente sondeo REST -cinco
  // minutos- con la pantalla ya mostrando precios frescos.
  it('apaga el aviso cuando los precios vuelven por el socket', async () => {
    mocks.getPrices.mockResolvedValue([]);
    const { rerender } = montar();

    await screen.findByText('No se pudieron actualizar los precios');

    // El socket manda el mapa completo de una vez, no simbolo por simbolo.
    mocks.preciosWs = Object.fromEntries(
      SIMBOLOS_CON_FEED.map(s => [
        s,
        { symbol: s, price: 1000, change_24h: 0, volume_24h: 0, market_cap: 0 },
      ]),
    );
    rerender(
      <LanguageProvider>
        <CryptoView />
      </LanguageProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText('No se pudieron actualizar los precios')).not.toBeInTheDocument();
    });
  });

  // Sin precio, comprar divide por cero y convertir manda un monto en cero al
  // servidor. Los botones quedaban habilitados y armaban esas ordenes.
  it('no deja comprar sin precio, y dice por que', async () => {
    mocks.getPrices.mockResolvedValue([]);
    const user = userEvent.setup();
    montar();

    await screen.findByText('No se pudieron actualizar los precios');
    await user.click(screen.getByRole('button', { name: 'Comprar' }));
    const hoja = within(await screen.findByRole('dialog'));
    await user.type(hoja.getByPlaceholderText('0.00'), '100');

    expect(hoja.getByText('No se puede operar sin el precio actual.')).toBeInTheDocument();
    expect(hoja.getByRole('button', { name: /Comprar BTC/ })).toBeDisabled();
  });

  it('no deja convertir sin precio de las dos puntas', async () => {
    mocks.activos = [activo('BTC', 0.5, 0), activo('ETH', 2, 0)];
    mocks.getPrices.mockResolvedValue([]);
    const user = userEvent.setup();
    montar();

    await screen.findByText('No se pudieron actualizar los precios');
    await user.click(screen.getByRole('button', { name: 'Convertir' }));
    const hoja = within(await screen.findByRole('dialog'));
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');

    expect(hoja.getByText('No se puede operar sin el precio actual.')).toBeInTheDocument();
    expect(hoja.getByRole('button', { name: 'Convertir' })).toBeDisabled();
  });

  // PR #201: el sparkline real de 7 dias (sparkline_7d, dentro de la misma
  // respuesta de getPrices) se perdia porque el sondeo REST despachaba
  // UPDATE_CRYPTO_PRICES sin priceHistory; el reductor lo tomaba como "no hay
  // historial nuevo" y le cortaba el punto mas viejo al real. Estas dos
  // pruebas fijan que CryptoView de verdad propaga ese campo en cada camino.
  describe('CryptoView — el sparkline real no se pierde en el camino', () => {
    it('fetchPrices() incluye el priceHistory que trajo el backend en el dispatch', async () => {
      mocks.activos = [activo('BTC', 0.5, 40000)];
      const historialReal = [60000, 60500, 61000, 61234.5];
      mocks.getPrices.mockResolvedValue(feed().map(p =>
        p.symbol === 'BTC' ? { ...p, priceHistory: historialReal } : p,
      ));
      montar();

      await waitFor(() => {
        const llamada = mocks.dispatch.mock.calls.find(
          ([accion]) => accion.type === 'UPDATE_CRYPTO_PRICES',
        );
        expect(llamada).toBeDefined();
        const paraBtc = llamada![0].payload.find((u: { symbol: string }) => u.symbol === 'BTC');
        expect(paraBtc.priceHistory).toEqual(historialReal);
      });
    });

    it('un tick de WebSocket reenvia el ultimo priceHistory real en vez de mandarlo vacio', async () => {
      mocks.activos = [activo('BTC', 0.5, 40000)];
      const historialReal = [60000, 60500, 61000, 61234.5];
      mocks.getPrices.mockResolvedValue(feed().map(p =>
        p.symbol === 'BTC' ? { ...p, priceHistory: historialReal } : p,
      ));
      const { rerender } = montar();

      // Esperar el dispatch del sondeo REST inicial (el que guarda el
      // historial real en marketData) antes de disparar el tick de socket.
      await waitFor(() => {
        expect(mocks.dispatch.mock.calls.some(([a]) => a.type === 'UPDATE_CRYPTO_PRICES')).toBe(true);
      });
      mocks.dispatch.mockClear();

      mocks.preciosWs = { BTC: { symbol: 'BTC', price: 61500, change_24h: 1.2, volume_24h: 0, market_cap: 0 } };
      rerender(
        <LanguageProvider>
          <CryptoView />
        </LanguageProvider>,
      );

      await waitFor(() => {
        const llamada = mocks.dispatch.mock.calls.find(
          ([accion]) => accion.type === 'UPDATE_CRYPTO_PRICES',
        );
        expect(llamada).toBeDefined();
        const paraBtc = llamada![0].payload.find((u: { symbol: string }) => u.symbol === 'BTC');
        // Ni vacio (lo que el socket no trae) ni omitido: el ultimo real que
        // guardo el sondeo REST.
        expect(paraBtc.priceHistory).toEqual(historialReal);
      });
    });

    // PR #201, hallazgo MEDIA: fetchPriceHistories() pedia su propio
    // /crypto/prices via getAllPriceHistories() -el mismo dato que
    // fetchPrices() ya trajo en la respuesta de getPrices()-, asi que al
    // montar salian dos fetch en paralelo al mismo endpoint. El arreglo fue
    // borrar esa segunda llamada, no agregarle cache: esta prueba fija que no
    // vuelva.
    it('al montar hace una sola llamada de red (getPrices), no una segunda en paralelo por getAllPriceHistories', async () => {
      mocks.activos = [activo('BTC', 0.5, 40000)];
      mocks.getPrices.mockResolvedValue(feed());
      montar();

      await waitFor(() => {
        expect(mocks.dispatch.mock.calls.some(([a]) => a.type === 'UPDATE_CRYPTO_PRICES')).toBe(true);
      });

      expect(mocks.getPrices).toHaveBeenCalledTimes(1);
      expect(mocks.getAllPriceHistories).not.toHaveBeenCalled();
    });

    // Revision del PR #201, hallazgo ALTA: un sondeo REST que trae MENOS
    // simbolos que el anterior -el backend omite uno sin precio real, ver el
    // comentario de getPrices() en cryptoPrices.ts- reemplazaba por completo
    // marketData en vez de fusionarlo, y ese simbolo perdia su priceHistory
    // real en la cache local. El siguiente tick de WebSocket para ese simbolo
    // entonces reenviaba [] -la misma corrupcion del sparkline que las dos
    // pruebas de arriba ya cierran, reintroducida por un camino mas angosto.
    it('un sondeo REST que omite un simbolo no le borra el priceHistory real de la cache', async () => {
      mocks.activos = [activo('BTC', 0.5, 40000), activo('ETH', 2, 2000)];
      const historialReal = [60000, 60500, 61000, 61234.5];
      mocks.getPrices.mockResolvedValueOnce(
        feed().map(p => (p.symbol === 'BTC' ? { ...p, priceHistory: historialReal } : p)),
      );
      const user = userEvent.setup();
      const { rerender } = montar();

      // Sondeo inicial: BTC llega con su historial real completo.
      await waitFor(() => {
        expect(mocks.dispatch.mock.calls.some(([a]) => a.type === 'UPDATE_CRYPTO_PRICES')).toBe(true);
      });
      mocks.dispatch.mockClear();

      // Segundo sondeo (manual, mismo camino que el automatico de 5 min):
      // el backend omite BTC por completo -degradacion parcial real, no una
      // lista vacia-, y solo trae ETH.
      mocks.getPrices.mockResolvedValueOnce(feed(['BTC']));
      await user.click(screen.getByRole('button', { name: 'Actualizar precios' }));

      await waitFor(() => {
        expect(mocks.getPrices).toHaveBeenCalledTimes(2);
      });

      // Tick de WebSocket para BTC: debe reenviar el ultimo historial real
      // que trajo el primer sondeo, no una lista vacia.
      mocks.preciosWs = { BTC: { symbol: 'BTC', price: 61500, change_24h: 1.2, volume_24h: 0, market_cap: 0 } };
      rerender(
        <LanguageProvider>
          <CryptoView />
        </LanguageProvider>,
      );

      await waitFor(() => {
        const llamada = mocks.dispatch.mock.calls
          .filter(([a]) => a.type === 'UPDATE_CRYPTO_PRICES')
          .find(([a]) => a.payload.some((u: { symbol: string }) => u.symbol === 'BTC'));
        expect(llamada).toBeDefined();
        const paraBtc = llamada![0].payload.find((u: { symbol: string }) => u.symbol === 'BTC');
        expect(paraBtc.priceHistory).toEqual(historialReal);
      });
    });
  });
});
