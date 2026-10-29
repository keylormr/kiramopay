import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SinpeView } from '../SinpeView';

// El historial de SINPE mostraba "+506 8888-0001" y la lista de contactos, en la
// misma pantalla, el mismo numero crudo: "+50688880001". Un solo formato para
// todos los lugares donde se lee un telefono.

const mocks = vi.hoisted(() => ({
  state: {
    accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
    sinpeContacts: [] as Array<{ id: string; name: string; phone: string; bank?: string; isFavorite?: boolean }>,
    sinpeHistory: [] as unknown[],
    user: { phone: '+506 8888-0000' },
  },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ sinpe: { send: vi.fn() }, mfa: { totpVerify: vi.fn() } }),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({ state: mocks.state, dispatch: vi.fn() }),
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve(true)),
  refreshSinpe: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
}));

function setup() {
  return render(
    <LanguageProvider>
      <SinpeView />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.state.sinpeContacts = [
    { id: 'c1', name: 'Diego Mora', phone: '+50688880001', bank: 'BAC' },
    { id: 'c2', name: 'Lucia Vargas', phone: '8888-7777', bank: 'BCR' },
  ];
  mocks.state.sinpeHistory = [];
});

describe('SinpeView: telefonos de los contactos', () => {
  it('la lista los muestra con el formato del historial, sea cual sea como se guardaron', () => {
    setup();

    expect(screen.getByText('+506 8888-0001')).toBeInTheDocument();
    expect(screen.getByText('+506 8888-7777')).toBeInTheDocument();
    expect(screen.queryByText('+50688880001')).not.toBeInTheDocument();
    expect(screen.queryByText('8888-7777')).not.toBeInTheDocument();
  });

  it('el contacto elegido para enviar tambien se lee con ese formato', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: /Diego Mora/ }));
    const hoja = within(await screen.findByRole('dialog'));

    expect(hoja.getByText('+506 8888-0001')).toBeInTheDocument();
    expect(hoja.queryByText('+50688880001')).not.toBeInTheDocument();
  });
});

// "Mi numero SINPE" y el QR de contacto mostraban el telefono como llega de la
// cuenta ("+50688880004"), y el resto de la pantalla lo lee como "+506
// 8888-0004". Un solo formato en todos lados.
describe('SinpeView: el numero propio', () => {
  async function abrirSolicitar(user: ReturnType<typeof userEvent.setup>) {
    // El boton de arriba abre la hoja de pedir dinero; el de la barra de
    // pestanas (el segundo) cambia a la pestana que tiene "Mi numero SINPE".
    await user.click(screen.getAllByRole('button', { name: 'Solicitar' })[1]);
  }

  it('Mi numero SINPE se lee con el formato de los demas numeros', async () => {
    mocks.state.user = { phone: '+50688880004' };
    const user = userEvent.setup();
    setup();
    await abrirSolicitar(user);

    expect(screen.getByText('+506 8888-0004')).toBeInTheDocument();
    expect(screen.queryByText('+50688880004')).not.toBeInTheDocument();
  });

  it('el numero que viene sin prefijo tambien', async () => {
    mocks.state.user = { phone: '88880004' };
    const user = userEvent.setup();
    setup();
    await abrirSolicitar(user);

    expect(screen.getByText('+506 8888-0004')).toBeInTheDocument();
  });

  it('el QR de contacto muestra el numero con formato', async () => {
    mocks.state.user = { phone: '+50688880004' };
    const user = userEvent.setup();
    setup();
    await abrirSolicitar(user);
    await user.click(screen.getByRole('button', { name: 'Mi QR de contacto' }));
    const hoja = within(await screen.findByRole('dialog'));

    expect(hoja.getByText('+506 8888-0004')).toBeInTheDocument();
    expect(hoja.queryByText('+50688880004')).not.toBeInTheDocument();
  });
});
