import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ServicesView } from '../ServicesView';

// La lista de empresas estaba escrita a mano en la pantalla: 11 de las 15 no
// existian en el servidor y respondian INVALID_PROVIDER, que la persona leia
// como "No se pudo completar la accion". Ahora la lista sale del servidor
// (GET /services/providers), y el mismo endpoint dice si el cobro se puede
// entregar: en produccion todavia no hay convenios, y eso se avisa ANTES de que
// la persona llene el formulario, no despues de tocar Pagar.
const mocks = vi.hoisted(() => ({
  api: {
    services: { getCatalog: vi.fn(), payBill: vi.fn(), recharge: vi.fn() },
    mfa: { totpVerify: vi.fn() },
  },
  dispatch: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      user: { id: 'u1' },
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      savedServices: [],
      billHistory: [],
      rechargeHistory: [],
    },
    dispatch: mocks.dispatch,
  }),
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
}));

const CATALOGO = {
  agreementsActive: true,
  providers: [
    { code: 'ice', name: 'ICE — Electricidad', category: 'electricity' },
    { code: 'aya', name: 'AyA — Agua', category: 'water' },
    { code: 'cabletica', name: 'Cabletica — Internet', category: 'internet' },
  ],
  operators: [
    { code: 'kolbi', name: 'Kölbi (ICE)' },
    { code: 'claro', name: 'Claro' },
    { code: 'movistar', name: 'Movistar' },
  ],
};

const AVISO = 'El pago de recibos y las recargas todavía no están disponibles';

function setup() {
  return render(
    <LanguageProvider>
      <ServicesView />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks.api.services).forEach((fn) => fn.mockReset());
  mocks.api.mfa.totpVerify.mockReset();
  mocks.dispatch.mockReset();
  mocks.api.services.getCatalog.mockResolvedValue({ success: true, data: CATALOGO });
});

describe('ServicesView — la lista de empresas sale del servidor', () => {
  it('muestra las empresas que el servidor acepta y ninguna mas', async () => {
    setup();

    expect(await screen.findByText('ICE — Electricidad')).toBeInTheDocument();
    expect(screen.getByText('AyA — Agua')).toBeInTheDocument();
    expect(screen.getByText('Cabletica — Internet')).toBeInTheDocument();
    // Las que estaban escritas a mano y el servidor nunca conocio.
    for (const inventada of ['CNFL', 'Coopelesca', 'Tigo', 'Liberty', 'Marchamo', 'INS Seguros', 'CCSS (Caja)']) {
      expect(screen.queryByText(inventada)).not.toBeInTheDocument();
    }
    expect(mocks.api.services.getCatalog).toHaveBeenCalled();
  });

  it('las categorias ofrecidas son las que tienen empresas', async () => {
    setup();
    await screen.findByText('ICE — Electricidad');

    const categorias = within(screen.getByRole('tablist', { name: 'Servicios' }));
    expect(categorias.getByRole('tab', { name: 'Electricidad' })).toBeInTheDocument();
    expect(categorias.getByRole('tab', { name: 'Agua' })).toBeInTheDocument();
    expect(categorias.getByRole('tab', { name: 'Internet' })).toBeInTheDocument();
    // Sin empresas de cable ni de "otros", esos filtros ofrecian una lista vacia.
    expect(categorias.queryByRole('tab', { name: 'Cable' })).not.toBeInTheDocument();
    expect(categorias.queryByRole('tab', { name: 'Otros' })).not.toBeInTheDocument();
  });

  it('paga con el codigo que dio el servidor, tal cual', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: true,
      data: { id: 'b1', providerId: 'ice', amount: 2500, status: 'paid' },
    });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByText('ICE — Electricidad'));
    await user.type(await screen.findByPlaceholderText('Ej: 1234567'), '123456');
    await user.type(screen.getByPlaceholderText('0'), '2500');
    await user.click(screen.getByRole('button', { name: /^Pagar/ }));

    await waitFor(() =>
      expect(mocks.api.services.payBill).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'ice', providerName: 'ICE — Electricidad' }),
      ),
    );
  });

  it('los operadores de recarga tambien salen del servidor', async () => {
    const user = userEvent.setup();
    mocks.api.services.getCatalog.mockResolvedValue({
      success: true,
      data: { ...CATALOGO, operators: [{ code: 'kolbi', name: 'Kölbi (ICE)' }] },
    });
    setup();
    await screen.findByText('ICE — Electricidad');

    await user.click(screen.getByRole('tab', { name: /Recarga/ }));

    expect(await screen.findByText('Kölbi (ICE)')).toBeInTheDocument();
    expect(screen.queryByText('Claro')).not.toBeInTheDocument();
    expect(screen.queryByText('Movistar')).not.toBeInTheDocument();
  });

  it('si la lista no se pudo traer, lo dice y deja reintentar (no inventa una)', async () => {
    mocks.api.services.getCatalog
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'sin red' } })
      .mockResolvedValue({ success: true, data: CATALOGO });
    const user = userEvent.setup();
    setup();

    expect(await screen.findByText('No pudimos cargar la lista de empresas.')).toBeInTheDocument();
    expect(screen.queryByText('ICE — Electricidad')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('ICE — Electricidad')).toBeInTheDocument();
    expect(screen.queryByText('No pudimos cargar la lista de empresas.')).not.toBeInTheDocument();
  });
});

describe('ServicesView — sin convenios, el aviso va antes del formulario', () => {
  const SIN_CONVENIOS = { success: true, data: { ...CATALOGO, agreementsActive: false } };

  it('avisa arriba de la lista que recibos y recargas todavia no estan disponibles', async () => {
    mocks.api.services.getCatalog.mockResolvedValue(SIN_CONVENIOS);
    setup();

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
  });

  it('tocar una empresa no abre el formulario: no hay nada que llenar', async () => {
    mocks.api.services.getCatalog.mockResolvedValue(SIN_CONVENIOS);
    const user = userEvent.setup();
    setup();
    await screen.findByText(AVISO);

    await user.click(screen.getByText('ICE — Electricidad'));

    expect(screen.queryByPlaceholderText('Ej: 1234567')).not.toBeInTheDocument();
    expect(mocks.api.services.payBill).not.toHaveBeenCalled();
  });

  it('en Recargas tambien se avisa y no se abre el formulario', async () => {
    mocks.api.services.getCatalog.mockResolvedValue(SIN_CONVENIOS);
    const user = userEvent.setup();
    setup();
    await screen.findByText(AVISO);

    await user.click(screen.getByRole('tab', { name: /Recarga/ }));

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    await user.click(screen.getByText('Claro'));
    expect(screen.queryByPlaceholderText('8888-0000')).not.toBeInTheDocument();
    expect(mocks.api.services.recharge).not.toHaveBeenCalled();
  });

  it('con convenios no hay aviso', async () => {
    setup();
    await screen.findByText('ICE — Electricidad');

    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });

  it('el historial sigue a la vista: no depende de los convenios', async () => {
    mocks.api.services.getCatalog.mockResolvedValue(SIN_CONVENIOS);
    const user = userEvent.setup();
    setup();
    await screen.findByText(AVISO);

    await user.click(screen.getByRole('tab', { name: /Historial/ }));

    expect(await screen.findByText('Pagos de servicios')).toBeInTheDocument();
  });
});

describe('ServicesView — cada rechazo con su propio texto', () => {
  async function pagarIce(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByText('ICE — Electricidad'));
    await user.type(await screen.findByPlaceholderText('Ej: 1234567'), '123456');
    await user.type(screen.getByPlaceholderText('0'), '2500');
    await user.click(screen.getByRole('button', { name: /^Pagar/ }));
  }

  it('INVALID_PROVIDER dice que la empresa ya no esta y no cobra, y refresca la lista', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: false,
      error: { code: 'INVALID_PROVIDER', message: 'invalid provider: cnfl' },
    });
    const user = userEvent.setup();
    setup();

    await pagarIce(user);

    expect(
      await screen.findByText('Esa empresa ya no está disponible. Actualizamos la lista; elige otra. No se cobró nada.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No se pudo completar la acción')).not.toBeInTheDocument();
    expect(screen.queryByText(/invalid provider/)).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.api.services.getCatalog).toHaveBeenCalledTimes(2));
  });

  it('si tras el rechazo la empresa ya no esta en la lista nueva, cierra el formulario y deja el aviso sobre la lista', async () => {
    const AVISO_EMPRESA =
      'Esa empresa ya no está disponible. Actualizamos la lista; elige otra. No se cobró nada.';
    mocks.api.services.payBill.mockResolvedValue({
      success: false,
      error: { code: 'INVALID_PROVIDER', message: 'invalid provider: ice' },
    });
    mocks.api.services.getCatalog
      .mockResolvedValueOnce({ success: true, data: CATALOGO })
      .mockResolvedValue({
        success: true,
        data: { ...CATALOGO, providers: CATALOGO.providers.filter((p) => p.code !== 'ice') },
      });
    const user = userEvent.setup();
    setup();

    await pagarIce(user);

    await waitFor(() => expect(screen.queryByPlaceholderText('Ej: 1234567')).not.toBeInTheDocument());
    expect(await screen.findByText(AVISO_EMPRESA)).toBeInTheDocument();
    expect(screen.queryByText('ICE — Electricidad')).not.toBeInTheDocument();
    expect(screen.getByText('AyA — Agua')).toBeInTheDocument();
  });

  it('un operador que el servidor ya no ofrece: cierra la recarga y avisa sobre la lista', async () => {
    mocks.api.services.recharge.mockResolvedValue({
      success: false,
      error: { code: 'INVALID_OPERATOR', message: 'invalid operator: claro' },
    });
    mocks.api.services.getCatalog
      .mockResolvedValueOnce({ success: true, data: CATALOGO })
      .mockResolvedValue({
        success: true,
        data: { ...CATALOGO, operators: CATALOGO.operators.filter((o) => o.code !== 'claro') },
      });
    const user = userEvent.setup();
    setup();
    await screen.findByText('ICE — Electricidad');

    await user.click(screen.getByRole('tab', { name: /Recarga/ }));
    await user.click(await screen.findByText('Claro'));
    await user.type(await screen.findByPlaceholderText('8888-0000'), '88887777');
    await user.click(screen.getByRole('button', { name: '₡2,000' }));
    await user.click(screen.getByRole('button', { name: /^Recarga ₡2,000(\.00)?$/ }));

    await waitFor(() => expect(screen.queryByPlaceholderText('8888-0000')).not.toBeInTheDocument());
    expect(
      await screen.findByText('Ese operador no está disponible para recargas. No se cobró nada.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Claro')).not.toBeInTheDocument();
    expect(screen.getByText('Movistar')).toBeInTheDocument();
  });

  it('INVALID_OPERATOR dice que el operador no recibe recargas', async () => {
    mocks.api.services.recharge.mockResolvedValue({
      success: false,
      error: { code: 'INVALID_OPERATOR', message: 'invalid operator: tigo' },
    });
    const user = userEvent.setup();
    setup();
    await screen.findByText('ICE — Electricidad');

    await user.click(screen.getByRole('tab', { name: /Recarga/ }));
    await user.click(await screen.findByText('Claro'));
    await user.type(await screen.findByPlaceholderText('8888-0000'), '88887777');
    await user.click(screen.getByRole('button', { name: '₡2,000' }));
    await user.click(screen.getByRole('button', { name: /^Recarga ₡2,000(\.00)?$/ }));

    expect(await screen.findByText('Ese operador no está disponible para recargas. No se cobró nada.')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo completar la acción')).not.toBeInTheDocument();
  });

  it('SIN_CONVENIO (el aviso llego tarde) sigue teniendo su propio texto', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: false,
      error: { code: 'SIN_CONVENIO', message: 'el pago no se puede entregar todavia' },
    });
    const user = userEvent.setup();
    setup();

    await pagarIce(user);

    expect(await screen.findByText(/Todavía no tenemos convenio con esta empresa/)).toBeInTheDocument();
    expect(screen.queryByText('No se pudo completar la acción')).not.toBeInTheDocument();
  });
});
