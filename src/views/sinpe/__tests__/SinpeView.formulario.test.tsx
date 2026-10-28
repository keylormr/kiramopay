import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SinpeView } from '../SinpeView';

// Dos defectos del formulario de SINPE:
// - Un telefono incompleto no decia nada en el campo: el boton Enviar abria la
//   hoja de revision y solo ahi, ya sin el campo a la vista, salia el aviso.
// - La fila "Contactos SINPE" apretaba tres enlaces junto al titulo; a 390 px
//   "Mi QR", "Escanear QR" y el propio titulo se partian en dos lineas.
const mocks = vi.hoisted(() => ({
  api: { sinpe: { send: vi.fn() }, mfa: { totpVerify: vi.fn() } },
  dispatch: vi.fn(),
  state: {
    accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
    sinpeContacts: [] as Array<{ id: string; name: string; phone: string; bank?: string; isFavorite?: boolean }>,
    sinpeHistory: [] as unknown[],
    user: { phone: '+506 8888-0000' } as { id?: string; phone: string },
  },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve(true)),
  refreshSinpe: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
}));

const AVISO = 'El número está incompleto: debe tener 8 dígitos';

function setup() {
  return render(
    <LanguageProvider>
      <SinpeView />
    </LanguageProvider>,
  );
}

async function abrirEnviar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: 'Enviar' })[0]);
  const dialog = await screen.findByRole('dialog');
  return within(dialog);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.sinpe.send.mockReset();
  mocks.state.sinpeContacts = [];
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => new Promise(() => {}) },
    configurable: true,
  });
});

describe('SinpeView — un telefono incompleto avisa en el campo', () => {
  it('al tocar Enviar con 4 digitos, el aviso sale junto al campo y no se abre la revision', async () => {
    const user = userEvent.setup();
    setup();
    const d = await abrirEnviar(user);

    const campo = d.getByPlaceholderText('8888-0000');
    await user.type(campo, '8888');
    await user.type(d.getByPlaceholderText('0'), '5000');
    await user.click(d.getByRole('button', { name: /Enviar/ }));

    expect(d.getByText(AVISO)).toBeInTheDocument();
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    // Sigue habiendo una sola hoja: la de revision no se abrio.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(mocks.api.sinpe.send).not.toHaveBeenCalled();
  });

  it('al salir del campo con el numero a medias, tambien avisa', async () => {
    const user = userEvent.setup();
    setup();
    const d = await abrirEnviar(user);

    await user.type(d.getByPlaceholderText('8888-0000'), '8888');
    await user.tab();

    expect(d.getByText(AVISO)).toBeInTheDocument();
  });

  it('mientras todavia esta tecleando no le grita: el aviso espera a que salga del campo', async () => {
    const user = userEvent.setup();
    setup();
    const d = await abrirEnviar(user);

    await user.type(d.getByPlaceholderText('8888-0000'), '88');

    expect(d.queryByText(AVISO)).toBeNull();
  });

  it('con los 8 digitos no hay aviso y el envio sigue a la revision', async () => {
    const user = userEvent.setup();
    setup();
    const d = await abrirEnviar(user);

    const campo = d.getByPlaceholderText('8888-0000');
    await user.type(campo, '88887777');
    await user.type(d.getByPlaceholderText('0'), '5000');
    await user.click(d.getByRole('button', { name: /Enviar/ }));

    expect(d.queryByText(AVISO)).toBeNull();
    expect(campo).not.toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findAllByRole('dialog')).toHaveLength(2);
  });

  it('el aviso desaparece al completar el numero', async () => {
    const user = userEvent.setup();
    setup();
    const d = await abrirEnviar(user);

    const campo = d.getByPlaceholderText('8888-0000');
    await user.type(campo, '8888');
    await user.tab();
    expect(d.getByText(AVISO)).toBeInTheDocument();

    await user.type(campo, '7777');
    expect(d.queryByText(AVISO)).toBeNull();
  });
});

describe('SinpeView a 390 px — la fila "Contactos SINPE"', () => {
  it('la fila se parte en dos renglones en vez de apretar los enlaces', () => {
    setup();

    const titulo = screen.getByText('Contactos SINPE');
    const fila = titulo.parentElement as HTMLElement;
    expect(fila.className.split(/\s+/)).toContain('flex-wrap');
    expect(titulo.className.split(/\s+/)).toContain('whitespace-nowrap');
  });

  it.each(['Mi QR', 'Escanear QR', 'Nuevo'])('"%s" no se parte en dos lineas', (texto) => {
    setup();

    const enlace = screen.getByRole('button', { name: texto });
    expect(enlace.className.split(/\s+/)).toContain('whitespace-nowrap');
  });
});
