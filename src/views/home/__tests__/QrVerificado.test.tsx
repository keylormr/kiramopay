import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { encodeContactQr } from '@/utils/contactQr';
import type { SinpeContact } from '@/types/sinpe.types';
import { HomeView } from '../HomeView';

// Lo que se verifica ANTES de dejar pagar o enviar lo que llego en un QR, sobre
// todo cuando el QR llego en una imagen por chat y lo mando otra persona:
//   1. un QR que no es de KiramoPay se rechaza en el escaner, no en "Pago detectado";
//   2. un QR de contacto cuyo nombre repite el de uno guardado con OTRO numero avisa;
//   3. Pagar no se habilita hasta saber a quien se le paga.

// Escanear dos veces en una misma prueba, con la pantalla de Inicio completa,
// tarda varios segundos en un runner lento: el tope por defecto (5 s) haria
// fallar por tiempo lo que no esta roto.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });

const KP = 'KP:merchant_dynamic:abcd1234:550000:CRC:i0123456789abcdef01234567';
const AJENO = 'https://example.com/promo?ref=chat-2026';

const mocks = vi.hoisted(() => ({
  resolveQr: vi.fn(),
  scanAndPay: vi.fn(),
  getMyCode: vi.fn(),
  sinpeSend: vi.fn(),
  lookup: vi.fn(),
  contactos: [] as SinpeContact[],
}));

vi.mock('@/api', () => ({
  MFA_REQUIRED: 'MFA_REQUIRED',
  getApiLayer: () => ({
    qrPayments: {
      getMyCode: mocks.getMyCode,
      resolveQr: mocks.resolveQr,
      scanAndPay: mocks.scanAndPay,
    },
    sinpe: { send: mocks.sinpeSend, lookupRecipient: mocks.lookup },
    mfa: { totpVerify: vi.fn() },
  }),
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
  refreshSinpe: vi.fn(() => Promise.resolve()),
}));

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
      sinpeContacts: mocks.contactos,
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

// El escaner se reemplaza por botones que entregan un texto: la camara no
// existe en jsdom y lo que importa es lo que hace la pantalla con lo leido. Se
// pinta el `error` que la vista le pasa, como hace el panel de verdad.
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
        <button onClick={() => onDecode(KP)}>simular-kp</button>
        <button onClick={() => onDecode(`${KP}\n`)}>simular-kp-con-salto</button>
        <button onClick={() => onDecode(encodeContactQr({ name: 'Tienda $& $\' {telefono}', phone: '+506 8888-7777' }))}>
          simular-homonimo-con-simbolos
        </button>
        <button onClick={() => onDecode(AJENO)}>simular-ajeno</button>
        <button onClick={() => onDecode(encodeContactQr({ name: 'Mamá', phone: '+506 8888-7777' }))}>
          simular-homonimo
        </button>
        <button onClick={() => onDecode(encodeContactQr({ name: 'Ana Solís', phone: '+506 8888-7777' }))}>
          simular-desconocido
        </button>
        <button onClick={() => onDecode(encodeContactQr({ name: 'Banco Nacional', phone: '+506 7000-3333' }))}>
          simular-conocido
        </button>
        <p data-testid="aviso-del-escaner">{error}</p>
      </div>
    ) : null,
}));

const contacto = (name: string, phone: string): SinpeContact => ({
  id: name,
  name,
  phone,
  bank: 'BAC',
  isFavorite: false,
});

function pintar() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

async function escanear(user: ReturnType<typeof userEvent.setup>, boton: string) {
  await user.click(screen.getByRole('button', { name: 'Escanear QR' }));
  await user.click(await screen.findByRole('button', { name: boton }));
}

// Cierra la hoja del envio. No se busca "el" boton Cerrar de la pantalla: al
// escanear, la hoja del escaner sigue montada unos 300 ms mientras se va (su
// animacion de salida) y trae su propio "Cerrar"; segun lo lento que corra la
// prueba habia uno o dos y fallaba por tiempo, no por la pantalla.
async function cerrarElEnvio(user: ReturnType<typeof userEvent.setup>) {
  const hoja = await screen.findByRole('dialog', { name: 'Enviar dinero' });
  await user.click(within(hoja).getByRole('button', { name: 'Cerrar' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.contactos.length = 0;
  mocks.getMyCode.mockResolvedValue({ success: false, error: { code: 'X' } });
  // Por defecto la consulta del nombre registrado no contesta nada util: la
  // pantalla se queda como antes ("sin verificar"). Cada prueba de abajo la
  // cambia.
  mocks.lookup.mockResolvedValue({ success: false, error: { code: 'RATE_LIMITED', message: 'x' } });
  mocks.resolveQr.mockResolvedValue({
    success: true,
    data: { kind: 'code', merchantName: 'Soda Tica', currency: 'CRC', amount: 0, qrCodeId: 'code-1' },
  });
  mocks.scanAndPay.mockResolvedValue({
    success: true,
    data: { id: 'p1', qrCodeId: 'code-1', payerId: 'u', receiverId: 'o', amount: 5500, fee: 0, currency: 'CRC', status: 'completed', createdAt: '' },
  });
});
afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe('Un QR que no es de KiramoPay se rechaza en el escaner', () => {
  it('no abre "Pago detectado" ni le pregunta nada al servidor', async () => {
    const user = userEvent.setup();
    pintar();

    await escanear(user, 'simular-ajeno');

    expect(screen.getByTestId('aviso-del-escaner')).toHaveTextContent(
      'Ese QR no es de KiramoPay. Pídele a quien te cobra que te muestre su código de KiramoPay.',
    );
    expect(screen.queryByText('Pago detectado')).not.toBeInTheDocument();
    expect(mocks.resolveQr).not.toHaveBeenCalled();
    expect(mocks.scanAndPay).not.toHaveBeenCalled();
  });

  it('el escaner sigue abierto para probar con otro codigo', async () => {
    const user = userEvent.setup();
    pintar();
    await escanear(user, 'simular-ajeno');

    await user.click(screen.getByRole('button', { name: 'simular-kp' }));

    // Con un codigo valido el escaner se cierra y se abre la hoja de pago.
    expect(await screen.findByText('Pago detectado')).toBeInTheDocument();
    expect(screen.queryByTestId('aviso-del-escaner')).not.toBeInTheDocument();
  });
});

describe('Pagar espera a saber a quien se le paga', () => {
  it('con la verificacion en curso Pagar esta deshabilitado y se habilita cuando llega el nombre', async () => {
    let contestar: (v: unknown) => void = () => {};
    mocks.resolveQr.mockReturnValue(new Promise((r) => { contestar = r; }));
    const user = userEvent.setup();
    pintar();

    await escanear(user, 'simular-kp');

    expect(await screen.findByText('Verificando el código…')).toBeInTheDocument();
    // El monto ya se ve (sale del texto del codigo), pero todavia no hay a quien pagarle.
    expect(screen.getByText('₡5,500.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pagar' })).toBeDisabled();

    contestar({
      success: true,
      data: { kind: 'code', merchantName: 'Soda Tica', currency: 'CRC', amount: 0, qrCodeId: 'code-1' },
    });

    expect(await screen.findByText('Soda Tica')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pagar' })).toBeEnabled());
    expect(mocks.scanAndPay).not.toHaveBeenCalled();
  });

  it('un codigo con un salto de linea al final se le pregunta al servidor sin el salto', async () => {
    // Un QR leido de una imagen puede traer un espacio o salto al final. El
    // servidor compara el texto exacto: sin recortarlo, un codigo bueno
    // llegaria como "no existe".
    const user = userEvent.setup();
    pintar();

    await escanear(user, 'simular-kp-con-salto');

    await screen.findByText('Soda Tica');
    expect(mocks.resolveQr).toHaveBeenCalledWith(KP);
  });

  it('la respuesta tardia de un codigo anterior no pisa al que se escaneo despues', async () => {
    let contestarElViejo: (v: unknown) => void = () => {};
    mocks.resolveQr
      .mockReturnValueOnce(new Promise((r) => { contestarElViejo = r; }))
      .mockResolvedValueOnce({
        success: true,
        data: { kind: 'code', merchantName: 'Soda Nueva', currency: 'CRC', amount: 0, qrCodeId: 'code-2' },
      });
    const user = userEvent.setup();
    pintar();

    await escanear(user, 'simular-kp');
    await screen.findByText('Verificando el código…');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Pago detectado')).not.toBeInTheDocument());

    await escanear(user, 'simular-kp');
    expect(await screen.findByText('Soda Nueva')).toBeInTheDocument();

    // Ahora contesta el primero, con otro comercio: no puede aparecer.
    contestarElViejo({
      success: true,
      data: { kind: 'code', merchantName: 'Soda Vieja', currency: 'CRC', amount: 0, qrCodeId: 'code-1' },
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText('Soda Vieja')).not.toBeInTheDocument();
    expect(screen.getByText('Soda Nueva')).toBeInTheDocument();
  });

  it('un codigo que el servidor rechaza no se puede pagar: solo el motivo y Cerrar', async () => {
    mocks.resolveQr.mockResolvedValue({ success: false, error: { code: 'QR_REVOCADO', message: 'x' } });
    const user = userEvent.setup();
    pintar();

    await escanear(user, 'simular-kp');

    expect(await screen.findByText('Ese código fue retirado por su dueño.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('0.00')).not.toBeInTheDocument();
    // Ni a quien se le pagaria ni cuanto: el codigo no existe, no hay nada que ofrecer.
    expect(screen.queryByText('Le pagas a')).not.toBeInTheDocument();
    expect(screen.queryByText('₡5,500.00')).not.toBeInTheDocument();
    // El boton del pie de la hoja (el otro "Cerrar" es la X de la esquina, solo con aria-label).
    const cerrar = screen.getByText('Cerrar').closest('button');
    expect(cerrar).not.toBeNull();
    await user.click(cerrar!);
    expect(screen.queryByText('Pago detectado')).not.toBeInTheDocument();
    expect(mocks.scanAndPay).not.toHaveBeenCalled();
  });

  it('si no se pudo verificar (sin red) se dice y Pagar sigue disponible, con Reintentar', async () => {
    // Decision que ya existia: una caida del servidor no impide pagar un codigo
    // conocido. Lo que cambia es que ya no se confunde con "todavia verificando".
    mocks.resolveQr.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'sin red' } });
    const user = userEvent.setup();
    pintar();

    await escanear(user, 'simular-kp');

    expect(await screen.findByText('No pudimos verificar el código. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pagar' })).toBeEnabled();
  });
});

describe('Un QR de contacto no verifica el nombre que trae', () => {
  async function abrirContacto(boton: string) {
    const user = userEvent.setup();
    pintar();
    await escanear(user, boton);
    await screen.findByPlaceholderText('0');
    return user;
  }

  it('un contacto desconocido muestra su nombre marcado como sin verificar', async () => {
    await abrirContacto('simular-desconocido');

    expect(screen.getByText('Ana Solís')).toBeInTheDocument();
    expect(screen.getByText('Nombre escrito en el QR, sin verificar')).toBeInTheDocument();
    expect(screen.getByText('+506 8888-7777')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('un nombre que repite el de un contacto guardado con OTRO numero avisa y no deja enviar hasta confirmar', async () => {
    mocks.contactos.push(contacto('Mamá', '+506 7000-1111'));
    const user = await abrirContacto('simular-homonimo');

    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent('Ya tienes un contacto llamado «Mamá» con otro número (+506 7000-1111).');
    await user.type(screen.getByPlaceholderText('0'), '1000');
    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeDisabled();
    // Guardar el numero como contacto tambien es darlo por bueno: espera igual.
    expect(screen.getByRole('button', { name: 'Agregar contacto' })).toBeDisabled();

    await user.click(within(aviso).getByRole('button', { name: 'El número es correcto' }));

    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Agregar contacto' })).toBeEnabled();
    expect(mocks.sinpeSend).not.toHaveBeenCalled();
  });

  it('el aviso muestra tal cual el nombre guardado aunque lleve simbolos de reemplazo', async () => {
    // "$&", "$'" y "{telefono}" no son nombres de verdad, pero el nombre de un
    // contacto lo escribe cualquiera: el aviso no puede alterarse con ellos.
    const nombre = 'Tienda $& $\' {telefono}';
    mocks.contactos.push(contacto(nombre, '+506 7000-1111'));
    await abrirContacto('simular-homonimo-con-simbolos');

    expect(screen.getByRole('alert')).toHaveTextContent(
      `Ya tienes un contacto llamado «${nombre}» con otro número (+506 7000-1111).`,
    );
  });

  it('un numero ya guardado muestra el nombre guardado, no el del QR', async () => {
    mocks.contactos.push(contacto('Pedro', '+506 7000-3333'));
    await abrirContacto('simular-conocido');

    expect(screen.getByText('Pedro')).toBeInTheDocument();
    expect(screen.getByText('Guardado en tus contactos')).toBeInTheDocument();
    expect(screen.queryByText('Banco Nacional')).not.toBeInTheDocument();
    expect(screen.queryByText('Nombre escrito en el QR, sin verificar')).not.toBeInTheDocument();
  });

  it('escanear otro contacto despues no hereda la confirmacion del homonimo anterior', async () => {
    mocks.contactos.push(contacto('Mamá', '+506 7000-1111'));
    const user = await abrirContacto('simular-homonimo');
    await user.click(screen.getByRole('button', { name: 'El número es correcto' }));
    await cerrarElEnvio(user);

    await escanear(user, 'simular-homonimo');
    await screen.findByPlaceholderText('0');
    await user.type(screen.getByPlaceholderText('0'), '1000');

    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeDisabled();
  });
});

describe('El nombre registrado en KiramoPay a un QR de contacto', () => {
  // El QR dice "Ana Solis" con el +506 8888-7777. El servidor contesta como se
  // llama, registrada, la persona de ese telefono (recortado: "Ana S.").
  async function abrirDesconocido() {
    const user = userEvent.setup();
    pintar();
    await escanear(user, 'simular-desconocido');
    await screen.findByPlaceholderText('0');
    return user;
  }

  it('si coincide con el del QR lo dice y deja enviar', async () => {
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: true, displayName: 'Ana S.' } });
    const user = await abrirDesconocido();

    expect(await screen.findByText('En su perfil de KiramoPay: Ana S.')).toBeInTheDocument();
    expect(screen.queryByText('Nombre escrito en el QR, sin verificar')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.lookup).toHaveBeenCalledWith('+506 8888-7777');
    await user.type(screen.getByPlaceholderText('0'), '1000');
    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeEnabled();
  });

  it('confirmar el homonimo no aprueba tambien el nombre que no coincide, y al reves', async () => {
    // Un contacto guardado con el MISMO nombre del QR y otro numero (homonimo) y,
    // ademas, el numero esta registrado a otra persona: dos avisos, dos confirmaciones.
    mocks.contactos.push(contacto('Ana Solís', '+506 7000-1111'));
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: true, displayName: 'Carlos P.' } });
    const user = await abrirDesconocido();
    await screen.findByText('En su perfil de KiramoPay: Carlos P.');
    await user.type(screen.getByPlaceholderText('0'), '1000');
    const avisos = screen.getAllByRole('alert');
    expect(avisos).toHaveLength(2);

    await user.click(within(avisos[0]).getByRole('button', { name: 'El número es correcto' }));
    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeDisabled();

    const segundo = screen.getAllByRole('alert').find((a) => within(a).queryByRole('button'));
    await user.click(within(segundo!).getByRole('button', { name: 'El número es correcto' }));
    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeEnabled();
  });

  it('escanear otro contacto despues no hereda la confirmacion del nombre que no coincidia', async () => {
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: true, displayName: 'Carlos P.' } });
    const user = await abrirDesconocido();
    await user.click(await screen.findByRole('button', { name: 'El número es correcto' }));
    await cerrarElEnvio(user);

    await escanear(user, 'simular-desconocido');
    await screen.findByPlaceholderText('0');
    await screen.findByText('En su perfil de KiramoPay: Carlos P.');
    await user.type(screen.getByPlaceholderText('0'), '1000');

    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeDisabled();
  });

  it('mientras consulta no se envia ni se guarda, y al terminar se habilitan', async () => {
    let responder: (v: unknown) => void = () => {};
    mocks.lookup.mockReturnValue(new Promise((r) => { responder = r; }));
    const user = await abrirDesconocido();
    await user.type(screen.getByPlaceholderText('0'), '1000');

    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Agregar contacto' })).toBeDisabled();

    responder({ success: true, data: { registered: true, displayName: 'Ana S.' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Agregar contacto' })).toBeEnabled();
  });

  it('si la consulta termina en fallo se habilita: un fallo no es un aviso', async () => {
    let responder: (v: unknown) => void = () => {};
    mocks.lookup.mockReturnValue(new Promise((r) => { responder = r; }));
    const user = await abrirDesconocido();
    await user.type(screen.getByPlaceholderText('0'), '1000');
    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeDisabled();

    responder({ success: false, error: { code: 'NETWORK_ERROR', message: 'sin red' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeEnabled());
    expect(screen.getByText('Nombre escrito en el QR, sin verificar')).toBeInTheDocument();
  });

  it('mientras consulta lo dice', async () => {
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    await abrirDesconocido();

    expect(await screen.findByText('Verificando el nombre del perfil…')).toBeInTheDocument();
  });

  it('si el QR dice otro nombre que el registrado avisa y no deja enviar hasta confirmar', async () => {
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: true, displayName: 'Carlos P.' } });
    const user = await abrirDesconocido();

    expect(await screen.findByText('En su perfil de KiramoPay: Carlos P.')).toBeInTheDocument();
    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent('El nombre del QR no coincide con el del perfil de este número.');
    await user.type(screen.getByPlaceholderText('0'), '1000');
    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeDisabled();

    await user.click(within(aviso).getByRole('button', { name: 'El número es correcto' }));

    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeEnabled();
    expect(mocks.sinpeSend).not.toHaveBeenCalled();
  });

  it('un numero sin cuenta de KiramoPay no se puede enviar y no tiene confirmacion', async () => {
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: false } });
    const user = await abrirDesconocido();

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Este número no tiene cuenta de KiramoPay');
    expect(within(aviso).queryByRole('button')).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('0'), '1000');
    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeDisabled();
  });

  it('si la consulta falla NO se bloquea: queda "sin verificar" y se puede enviar', async () => {
    // Un limite de consultas, la red o la base caida no dicen que el numero no
    // tenga cuenta: no se frena un envio por eso.
    const user = await abrirDesconocido();

    await waitFor(() => expect(mocks.lookup).toHaveBeenCalled());
    expect(screen.getByText('Nombre escrito en el QR, sin verificar')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('0'), '1000');
    expect(screen.getByRole('button', { name: 'Enviar dinero' })).toBeEnabled();
  });

  it('un contacto que la persona ya guardo no se consulta', async () => {
    mocks.contactos.push(contacto('Pedro', '+506 7000-3333'));
    const user = userEvent.setup();
    pintar();

    await escanear(user, 'simular-conocido');
    await screen.findByPlaceholderText('0');

    expect(screen.getByText('Guardado en tus contactos')).toBeInTheDocument();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('el nombre registrado se muestra tal cual aunque lleve simbolos de reemplazo', async () => {
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: true, displayName: "Tienda $& $' {nombre} P." } });
    await abrirDesconocido();

    expect(await screen.findByText("En su perfil de KiramoPay: Tienda $& $' {nombre} P.")).toBeInTheDocument();
  });

  it('con un QR de pago (no de contacto) no se consulta ningun nombre', async () => {
    const user = userEvent.setup();
    pintar();

    await escanear(user, 'simular-kp');
    await screen.findByText('Soda Tica');

    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
