import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { encodeContactQr } from '@/utils/contactQr';
import { llaveDelIntento } from '@/services/intentoPendiente';
import { HomeView } from '../HomeView';

// La llave del envío al contacto escaneado. Ese envío llama al mismo
// POST /sinpe/send que la pantalla SINPE y tenía el defecto que esa pantalla ya
// no tiene: soltaba la llave ante cualquier error que no fuera el segundo
// factor —el corte de red incluido— y acuñaba otra al volver a escanear. Tras
// un corte el envío pudo haber salido, y reintentar lo mandaba dos veces.

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  totpVerify: vi.fn(),
  dataSync: {
    refreshAccounts: vi.fn(() => Promise.resolve(true)),
    refreshTransactions: vi.fn(() => Promise.resolve()),
    refreshSinpe: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/api', () => ({
  MFA_REQUIRED: 'MFA_REQUIRED',
  getApiLayer: () => ({
    qrPayments: {
      getMyCode: vi.fn().mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED' } }),
    },
    sinpe: { send: mocks.send },
    mfa: { totpVerify: mocks.totpVerify },
  }),
}));

vi.mock('@/services/dataSync', () => mocks.dataSync);

vi.mock('@/stores/notification.store', () => ({
  useNotificationStore: (selector: (s: unknown) => unknown) =>
    selector({ notifications: [], unreadCount: 0 }),
}));

vi.mock('@/stores/auth.store', () => {
  const hook = () => ({ user: { id: 'user-001', firstName: 'Keilor', lastName: 'Martinez' } });
  hook.getState = hook;
  hook.setState = vi.fn();
  hook.subscribe = vi.fn();
  return { useAuthStore: hook };
});

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      isAuthenticated: true,
      user: { id: 'user-001', firstName: 'Keilor', lastName: 'Martinez', phone: '70265093' },
      baseCurrency: 'CRC',
      accounts: [
        { ccy: 'CRC', balance: 5_000_000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' },
      ],
      transactions: [],
      sinpeContacts: [],
      notifications: [],
      settings: { darkMode: false },
      crypto: { assets: [] },
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <svg data-testid="qr-code" data-value={value} width={size} height={size} />
  ),
}));

// El escáner entrega directamente el QR de un contacto: la cámara no existe en
// jsdom y lo que importa es la hoja que se abre después de leerlo.
vi.mock('@/components/QrScannerPanel', () => ({
  QrScannerPanel: ({ active, onDecode }: { active: boolean; onDecode: (s: string) => void }) =>
    active ? (
      <button
        onClick={() => onDecode(encodeContactQr({ name: 'Ana Solís', phone: '+506 8888-7777' }))}
      >
        simular-escaneo
      </button>
    ) : null,
}));

const sinRed = { success: false, error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' } };
const enviado = {
  success: true,
  data: { id: 'tx1', type: 'sent', amount: 5000, phone: '+50688887777', name: 'Ana Solís', status: 'completed' },
};
const llaves = () => mocks.send.mock.calls.map((c) => c[0].idempotencyKey as string);

function pintar() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

// La hoja de arriba: la del envío, o la del segundo factor cuando se abre
// encima.
async function hojaDeArriba() {
  const hojas = await screen.findAllByRole('dialog');
  return hojas[hojas.length - 1];
}

async function escanearYEnviar(user: ReturnType<typeof userEvent.setup>, monto = '5000') {
  await user.click(screen.getByRole('button', { name: 'Escanear QR' }));
  await user.click(await screen.findByText('simular-escaneo'));
  await user.type(await screen.findByPlaceholderText('0'), monto);
  await enviarOtraVez(user);
}

// Con la hoja todavía abierta y el monto puesto, vuelve a tocar Enviar.
async function enviarOtraVez(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(await hojaDeArriba()).getByRole('button', { name: /Enviar dinero/ }));
}

async function cerrarLaHoja(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(await hojaDeArriba()).getByRole('button', { name: 'Cerrar' }));
  await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.send.mockReset();
  mocks.totpVerify.mockReset();
  mocks.dataSync.refreshAccounts.mockClear();
  mocks.dataSync.refreshTransactions.mockClear();
  mocks.dataSync.refreshSinpe.mockClear();
});

describe('HomeView — la llave del envío al contacto escaneado', () => {
  it('tras un corte de red lo explica, y reintentar lleva la misma llave', async () => {
    mocks.send.mockResolvedValueOnce(sinRed).mockResolvedValueOnce(enviado);
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    expect(await screen.findByText(/No pudimos confirmar el envío/)).toBeInTheDocument();
    await enviarOtraVez(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  it('tras un corte de red, cerrar la hoja y volver a escanear para enviar lo mismo lleva la misma llave', async () => {
    mocks.send.mockResolvedValueOnce(sinRed).mockResolvedValueOnce(enviado);
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await cerrarLaHoja(user);
    await escanearYEnviar(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  it('otro monto tras un corte de red es otro envío y lleva otra llave', async () => {
    mocks.send.mockResolvedValueOnce(sinRed).mockResolvedValueOnce(enviado);
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await cerrarLaHoja(user);
    await escanearYEnviar(user, '6000');
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });

  // La repetición: el servidor contestó con un envío que YA estaba hecho bajo
  // esa llave. No es un envío nuevo, y la hoja no puede decir "Pago realizado"
  // como si lo fuera.
  it('si el envío ya se había hecho, lo dice y el siguiente lleva otra llave', async () => {
    mocks.send
      .mockResolvedValueOnce(sinRed)
      .mockResolvedValueOnce({ ...enviado, data: { ...enviado.data, repetida: true } })
      .mockResolvedValueOnce(enviado);
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await enviarOtraVez(user);

    expect(await screen.findByText('Ese envío ya se había hecho')).toBeInTheDocument();
    expect(screen.getByText(/No se envió otra vez/)).toBeInTheDocument();
    expect(screen.queryByText('Pago realizado')).not.toBeInTheDocument();
    // La app no se había enterado del envío: trae el saldo, los movimientos y
    // el historial SINPE.
    expect(mocks.dataSync.refreshAccounts).toHaveBeenCalled();
    expect(mocks.dataSync.refreshTransactions).toHaveBeenCalled();
    expect(mocks.dataSync.refreshSinpe).toHaveBeenCalled();

    await user.click(within(await hojaDeArriba()).getByRole('button', { name: 'Listo' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    await escanearYEnviar(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(3));

    const [, segunda, tercera] = llaves();
    expect(segunda).toMatch(/\S/);
    expect(tercera).not.toBe(segunda);
  });

  it('la llave de otro envío lo explica y el siguiente intento lleva otra llave', async () => {
    mocks.send
      .mockResolvedValueOnce({
        success: false,
        error: { code: 'LLAVE_REUTILIZADA', message: 'the idempotency_key belongs to a different transfer' },
      })
      .mockResolvedValueOnce(enviado);
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    expect(await screen.findByText(/ya se hizo con otros datos/)).toBeInTheDocument();
    expect(screen.queryByText(/idempotency_key/)).not.toBeInTheDocument();

    await enviarOtraVez(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });

  // El servidor pide el segundo factor antes de crear nada: cancelarlo deja el
  // envío sin hacer, y el siguiente es otro intento. Suelta solo su llave: la
  // de otro envío que sigue sin confirmar se queda.
  it('cancelar el segundo factor suelta la llave de ese envío y no la de otro pendiente', async () => {
    const otra = llaveDelIntento('user-001', 'sinpe', '+50677776666|1000', () => 'llave-de-otro-envio');
    mocks.send
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce(enviado);
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    await user.click(within(await hojaDeArriba()).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByText('Verificación requerida')).not.toBeInTheDocument());

    expect(llaveDelIntento('user-001', 'sinpe', '+50677776666|1000', () => 'nueva')).toBe(otra);
    await enviarOtraVez(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).not.toBe(primera);
  });

  // Verificar el segundo factor reintenta el MISMO envío: la misma llave. Y el
  // botón dice lo que hace, como en la pantalla SINPE ("Verificar y activar"
  // es el de activar el segundo factor en el perfil).
  it('el reintento tras verificar el segundo factor lleva la misma llave', async () => {
    mocks.send
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce(enviado);
    mocks.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y enviar'));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  // La X de la hoja respeta el envío en vuelo, como tocar afuera: cerrarla a
  // mitad del envío escondía la respuesta.
  it('con el envío en vuelo, la X de la hoja está deshabilitada y no la cierra', async () => {
    let responder!: (valor: unknown) => void;
    mocks.send.mockReturnValueOnce(
      new Promise((r) => {
        responder = r;
      }),
    );
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    const equis = within(await hojaDeArriba()).getByRole('button', { name: 'Cerrar' });
    expect(equis).toBeDisabled();
    await user.click(equis);
    expect(screen.queryAllByRole('dialog')).toHaveLength(1);

    responder(enviado);
    expect(await screen.findByText('Pago realizado')).toBeInTheDocument();
  });

  it('un envío nuevo, que no es repetición, trae el saldo, las transacciones y el historial SINPE', async () => {
    mocks.send.mockResolvedValue(enviado);
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    expect(await screen.findByText('Pago realizado')).toBeInTheDocument();
    expect(mocks.dataSync.refreshAccounts).toHaveBeenCalled();
    expect(mocks.dataSync.refreshTransactions).toHaveBeenCalled();
    expect(mocks.dataSync.refreshSinpe).toHaveBeenCalled();
  });

  // Las tres entradas de SINPE le dan la misma llave al mismo envío (ámbito
  // 'sinpe', firma teléfono con +506 y monto): el corte en una y el reintento
  // en otra no lo mandan dos veces.
  it('el mismo envío lleva la llave que le dieron las otras entradas de SINPE', async () => {
    llaveDelIntento('user-001', 'sinpe', '+50688887777|5000', () => 'llave-de-otra-entrada');
    mocks.send.mockResolvedValue(enviado);
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));

    expect(llaves()).toEqual(['llave-de-otra-entrada']);
  });

  it('después de un envío que salió, el siguiente lleva otra llave', async () => {
    mocks.send.mockResolvedValue(enviado);
    const user = userEvent.setup();
    pintar();

    await escanearYEnviar(user);
    await user.click(within(await hojaDeArriba()).getByRole('button', { name: 'Listo' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    await escanearYEnviar(user);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });
});
