import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// El envio de cripto a otra persona de KiramoPay. Antes esta hoja pedia una
// direccion de cadena, inventaba una comision de red del 0,01 % y descontaba el
// saldo solo en el telefono. Lo que estas pruebas cuidan es lo contrario: que
// cada numero en pantalla venga del servidor, que no se pueda confirmar sobre
// numeros que ya no corresponden a lo escrito, y que un reintento tras el
// desafio de MFA no sea un segundo envio.
const mocks = vi.hoisted(() => ({
  api: {
    crypto: {
      buy: vi.fn(),
      sell: vi.fn(),
      convert: vi.fn(),
      stake: vi.fn(),
      unstake: vi.fn(),
      claimYield: vi.fn(),
      sendPreview: vi.fn(),
      send: vi.fn(),
    },
  },
  dispatch: vi.fn(),
  activos: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/services/cryptoPrices', () => ({
  cryptoPriceService: {
    getPrices: vi.fn().mockResolvedValue([]),
    getAllPriceHistories: vi.fn().mockResolvedValue({}),
  },
  SIMBOLOS_SIN_FEED: ['USDT', 'USDC'],
}));

vi.mock('@/hooks/useCryptoPricesWs', () => ({
  useCryptoPricesWs: () => ({ prices: {}, lastUpdate: null, connected: false }),
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

// La camara no existe en jsdom. El panel se reemplaza por el mismo camino que
// ya ofrece de verdad —teclear el codigo y darle continuar— y pinta el error
// que la vista le pasa, que es justo lo que se quiere comprobar. Se entrega de
// una sola vez y no tecla por tecla: un prefijo del payload tambien parsea, y
// entonces la hoja avanzaria con medio codigo.
vi.mock('@/components/QrScannerPanel', () => ({
  QrScannerPanel: ({
    active,
    onDecode,
    error,
  }: {
    active: boolean;
    onDecode: (s: string) => boolean | void;
    error?: string;
  }) =>
    active ? (
      <div>
        <input aria-label="codigo-escaneado" id="codigo-escaneado" />
        <button
          onClick={() => {
            const campo = document.getElementById('codigo-escaneado') as HTMLInputElement | null;
            if (campo) onDecode(campo.value);
          }}
        >
          usar-codigo
        </button>
        {error && <p>{error}</p>}
      </div>
    ) : null,
}));

// El desafio de MFA se reduce a su resultado: lo que importa aqui es con que
// llave sale el reintento, no como se teclea el codigo de seis digitos.
vi.mock('@/components/MfaChallengeSheet', () => ({
  MfaChallengeSheet: ({ isOpen, onVerified }: { isOpen: boolean; onVerified: () => void }) =>
    isOpen ? <button onClick={onVerified}>verificar-mfa</button> : null,
}));

const QR_PERSONAL = 'KP:p:1a2b3c4d:0:CRC:iabc123';

const activo = (symbol: string, name: string, balance: number, currentPrice: number) => ({
  id: symbol.toLowerCase(),
  symbol,
  name,
  balance,
  currentPrice,
  avgBuyPrice: currentPrice,
  priceChange24h: 1.5,
  icon: symbol[0],
  color: '#123456',
  priceHistory: [],
});

const vistaPrevia = (amount: number, fee: number) => ({
  recipientName: 'Victor Lobo',
  asset: 'BTC',
  amount,
  fee,
  total: amount + fee,
  feePercent: 0.25,
});

function montar() {
  return render(
    <LanguageProvider>
      <CryptoView />
    </LanguageProvider>,
  );
}

/** Abre la hoja de envio de BTC y deja el codigo ya escaneado. */
async function abrirEnvio(user: ReturnType<typeof userEvent.setup>) {
  montar();
  await user.click(screen.getByRole('button', { name: /Bitcoin/ }));
  await user.click(await screen.findByRole('button', { name: 'Enviar' }));
  const hoja = within(await screen.findByRole('dialog', { name: /Enviar BTC/ }));
  await user.type(hoja.getByLabelText('codigo-escaneado'), QR_PERSONAL);
  await user.click(hoja.getByRole('button', { name: 'usar-codigo' }));
  return hoja;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks.api.crypto).forEach((f) => f.mockReset());
  mocks.dispatch.mockReset();
  mocks.activos = [activo('BTC', 'Bitcoin', 0.5, 40000)];
});

describe('envio de cripto — los numeros son los del servidor', () => {
  it('muestra a quien le llega, cuanto sale del saldo y el porcentaje que devolvio el servidor', async () => {
    mocks.api.crypto.sendPreview.mockResolvedValue({
      success: true,
      data: vistaPrevia(0.005, 0.0000125),
    });
    const user = userEvent.setup();
    const hoja = await abrirEnvio(user);

    await user.type(hoja.getByPlaceholderText('0.00'), '0.005');

    await waitFor(() =>
      expect(mocks.api.crypto.sendPreview).toHaveBeenCalledWith({
        asset: 'BTC',
        amount: 0.005,
        qrData: QR_PERSONAL,
      }),
    );

    // Las tres lineas del patron aprobado, mas la comision como porcentaje.
    expect(await hoja.findByText('Vos enviás')).toBeInTheDocument();
    expect(hoja.getByText('Tu saldo baja')).toBeInTheDocument();
    expect(hoja.getByText('Le llega a Victor Lobo')).toBeInTheDocument();
    expect(hoja.getByText('0.0050125 BTC')).toBeInTheDocument();
    expect(hoja.getByText('0.25%')).toBeInTheDocument();
  });

  it('el nombre del destinatario no se inventa: sale de la vista previa', async () => {
    mocks.api.crypto.sendPreview.mockResolvedValue({
      success: true,
      data: { ...vistaPrevia(0.005, 0.0000125), recipientName: 'Emmanuel Rojas' },
    });
    const user = userEvent.setup();
    const hoja = await abrirEnvio(user);

    await user.type(hoja.getByPlaceholderText('0.00'), '0.005');

    expect(await hoja.findByText('Emmanuel Rojas')).toBeInTheDocument();
  });
});

describe('envio de cripto — cuando no se puede confirmar', () => {
  it('cambiar el monto deja sin efecto la respuesta anterior y bloquea el boton', async () => {
    mocks.api.crypto.sendPreview.mockResolvedValue({
      success: true,
      data: vistaPrevia(0.005, 0.0000125),
    });
    const user = userEvent.setup();
    const hoja = await abrirEnvio(user);

    await user.type(hoja.getByPlaceholderText('0.00'), '0.005');
    const boton = await hoja.findByRole('button', { name: 'Enviar BTC' });
    expect(boton).toBeEnabled();

    // La respuesta que hay en pantalla es la de 0.005; al escribir un digito
    // mas deja de corresponder, y con ella se van los numeros y el boton.
    mocks.api.crypto.sendPreview.mockReturnValue(new Promise(() => {}));
    await user.type(hoja.getByPlaceholderText('0.00'), '5');

    expect(hoja.queryByText('0.0050125 BTC')).not.toBeInTheDocument();
    expect(hoja.getByRole('button', { name: 'Procesando...' })).toBeDisabled();
  });

  it('un total que no cabe en el saldo se avisa antes de ofrecer confirmar', async () => {
    // La vista previa del servidor NO mira el saldo: con la comision adentro,
    // el monto que cabe justo deja de caber. Lo dice la pantalla.
    mocks.api.crypto.sendPreview.mockResolvedValue({
      success: true,
      data: vistaPrevia(0.5, 0.00125),
    });
    const user = userEvent.setup();
    const hoja = await abrirEnvio(user);

    await user.type(hoja.getByPlaceholderText('0.00'), '0.5');

    expect(
      await hoja.findByText('No tienes suficiente de esta cripto para esa operación.'),
    ).toBeInTheDocument();
    expect(hoja.getByRole('button', { name: 'Enviar BTC' })).toBeDisabled();
    expect(mocks.api.crypto.send).not.toHaveBeenCalled();
  });
});

describe('envio de cripto — codigos que no sirven', () => {
  it('un codigo ajeno ni siquiera se le consulta al servidor', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('button', { name: /Bitcoin/ }));
    await user.click(await screen.findByRole('button', { name: 'Enviar' }));
    const hoja = within(await screen.findByRole('dialog', { name: /Enviar BTC/ }));

    await user.type(hoja.getByLabelText('codigo-escaneado'), 'https://otra-billetera.example');
    await user.click(hoja.getByRole('button', { name: 'usar-codigo' }));

    expect(
      await hoja.findByText(
        'Ese código no es de KiramoPay. Pedile a la otra persona el código de su perfil.',
      ),
    ).toBeInTheDocument();
    expect(mocks.api.crypto.sendPreview).not.toHaveBeenCalled();
  });

  it('el rechazo del servidor se explica en espanol, con su propio motivo', async () => {
    mocks.api.crypto.sendPreview.mockResolvedValue({
      success: false,
      error: { code: 'QR_DE_COMERCIO', message: 'merchant qr code' },
    });
    const user = userEvent.setup();
    const hoja = await abrirEnvio(user);

    await user.type(hoja.getByPlaceholderText('0.00'), '0.005');

    expect(
      await hoja.findByText(
        'Ese es el código de un comercio, y un comercio cobra en dinero, no en cripto. Pedile a la persona su código personal.',
      ),
    ).toBeInTheDocument();
    expect(hoja.queryByText(/merchant qr code/)).not.toBeInTheDocument();
  });
});

describe('envio de cripto — confirmacion y reintento', () => {
  it('el envio sale con los datos del servidor y el saldo local se mueve con su comision', async () => {
    mocks.api.crypto.sendPreview.mockResolvedValue({
      success: true,
      data: vistaPrevia(0.005, 0.0000125),
    });
    mocks.api.crypto.send.mockResolvedValue({ success: true, data: { id: 'tx-1' } });
    const user = userEvent.setup();
    const hoja = await abrirEnvio(user);

    await user.type(hoja.getByPlaceholderText('0.00'), '0.005');
    await user.click(await hoja.findByRole('button', { name: 'Enviar BTC' }));

    const confirmacion = within(await screen.findByRole('dialog', { name: 'Confirmar' }));
    expect(confirmacion.getByText('Victor Lobo')).toBeInTheDocument();
    expect(confirmacion.getByText('0.0050125 BTC')).toBeInTheDocument();
    await user.click(confirmacion.getByRole('button', { name: /Enviar BTC/ }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'SEND_CRYPTO',
        payload: {
          asset: 'BTC',
          amount: 0.005,
          fee: 0.0000125,
          price: 40000,
          counterpartyName: 'Victor Lobo',
        },
      }),
    );
  });

  it('el reintento tras el desafio de MFA va con LA MISMA llave', async () => {
    mocks.api.crypto.sendPreview.mockResolvedValue({
      success: true,
      data: vistaPrevia(0.005, 0.0000125),
    });
    mocks.api.crypto.send
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa' } })
      .mockResolvedValueOnce({ success: true, data: { id: 'tx-1' } });
    const user = userEvent.setup();
    const hoja = await abrirEnvio(user);

    await user.type(hoja.getByPlaceholderText('0.00'), '0.005');
    await user.click(await hoja.findByRole('button', { name: 'Enviar BTC' }));
    const confirmacion = within(await screen.findByRole('dialog', { name: 'Confirmar' }));
    await user.click(confirmacion.getByRole('button', { name: /Enviar BTC/ }));

    await user.click(await screen.findByRole('button', { name: 'verificar-mfa' }));

    await waitFor(() => expect(mocks.api.crypto.send).toHaveBeenCalledTimes(2));
    const [primero] = mocks.api.crypto.send.mock.calls[0];
    const [segundo] = mocks.api.crypto.send.mock.calls[1];
    expect(primero.idempotencyKey).toBeTruthy();
    expect(segundo.idempotencyKey).toBe(primero.idempotencyKey);
    expect(segundo).toEqual({
      asset: 'BTC',
      amount: 0.005,
      qrData: QR_PERSONAL,
      price: 40000,
      idempotencyKey: primero.idempotencyKey,
    });
  });
});
