import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminMerchantsView } from '../AdminMerchantsView';

// Para asignar el plan de un comercio habia que pegar su identificador (un UUID)
// a mano, y el unico lugar donde se ve es el panel del propio dueno. Ahora el
// administrador busca el comercio por nombre y lo elige de la lista; el
// contrato con el servidor (PATCH /admin/merchants/{id}/plan {plan}) no cambia.

const mockApi = vi.hoisted(() => ({
  qrPayments: {
    listPendingMerchants: vi.fn(),
    listAllMerchants: vi.fn(),
    setMerchantPlan: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const ID_SODA = '5b0e7c1e-2a3f-4d5b-9c8e-1f2a3b4c5d6e';
const ID_CAFE = '0c4d1b9a-7e21-4f3a-8b65-2d9e8f7a6b50';
const ID_CERRADO = 'a1b2c3d4-0000-4000-8000-000000000001';

const base = {
  description: '', category: 'restaurant', qrCode: 'MRC-X', active: true, cedula: '3-101', cedulaType: 'juridica',
  verificationStatus: 'verified', commissionBps: 50, plan: 'base', closedAt: null,
};
const soda = { ...base, id: ID_SODA, name: 'Soda Tica', legalName: 'Sabores Ticos SA', ownerName: 'Keilor' };
const cafe = { ...base, id: ID_CAFE, name: 'Cafe Central', legalName: 'Grano de Oro SA', ownerName: 'Maria' };
const cerrado = { ...base, id: ID_CERRADO, name: 'Local Cerrado', legalName: 'Cierre SA', ownerName: 'Pedro', active: false, closedAt: '2026-10-01T00:00:00Z' };

function setup() {
  return render(
    <LanguageProvider>
      <AdminMerchantsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

async function abrirLaPestana(user: ReturnType<typeof userEvent.setup>) {
  setup();
  await user.click(screen.getByRole('tab', { name: 'Plan de un comercio' }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mockApi.qrPayments).forEach((f) => f.mockReset());
  mockApi.qrPayments.listPendingMerchants.mockResolvedValue({ success: true, data: [] });
  mockApi.qrPayments.listAllMerchants.mockImplementation(async (q?: string) => ({
    success: true,
    data: [soda, cafe, cerrado].filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase())),
  }));
});

describe('AdminMerchantsView - plan de un comercio: se elige por nombre', () => {
  it('ya no pide pegar el identificador', async () => {
    const user = userEvent.setup();
    await abrirLaPestana(user);

    await screen.findByRole('radio', { name: /Soda Tica/ });
    expect(screen.queryByLabelText('Identificador del comercio')).toBeNull();
    expect(screen.queryByPlaceholderText('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('lista los comercios abiertos al entrar, con su dueno y su plan actual', async () => {
    const user = userEvent.setup();
    await abrirLaPestana(user);

    const cuadro = await screen.findByRole('radio', { name: /Soda Tica/ });
    expect(mockApi.qrPayments.listAllMerchants).toHaveBeenCalledWith('');
    expect(cuadro).toHaveAccessibleName(/Sabores Ticos SA/);
    expect(cuadro).toHaveAccessibleName(/Dueño: Keilor/);
    expect(cuadro).toHaveAccessibleName(/Plan actual: Base/);
    expect(screen.getByRole('radio', { name: /Cafe Central/ })).toBeInTheDocument();
  });

  // A un comercio cerrado el servidor no le cambia el plan (MERCHANT_CLOSED):
  // no se ofrece.
  it('no ofrece los comercios cerrados', async () => {
    const user = userEvent.setup();
    await abrirLaPestana(user);

    await screen.findByRole('radio', { name: /Soda Tica/ });
    expect(screen.queryByRole('radio', { name: /Local Cerrado/ })).toBeNull();
  });

  it('buscar por nombre pide la lista filtrada al servidor', async () => {
    const user = userEvent.setup();
    await abrirLaPestana(user);
    await screen.findByRole('radio', { name: /Soda Tica/ });

    await user.type(screen.getByRole('searchbox', { name: 'Buscar un comercio' }), 'cafe');

    await waitFor(() => expect(mockApi.qrPayments.listAllMerchants).toHaveBeenCalledWith('cafe'));
    await waitFor(() => expect(screen.queryByRole('radio', { name: /Soda Tica/ })).toBeNull());
    expect(screen.getByRole('radio', { name: /Cafe Central/ })).toBeInTheDocument();
  });

  it('dice cuando ningun comercio coincide', async () => {
    const user = userEvent.setup();
    await abrirLaPestana(user);
    await screen.findByRole('radio', { name: /Soda Tica/ });

    await user.type(screen.getByRole('searchbox', { name: 'Buscar un comercio' }), 'zzz');

    expect(await screen.findByText('Ningún comercio coincide.')).toBeInTheDocument();
  });

  it('el boton queda apagado mientras no se elija un comercio', async () => {
    const user = userEvent.setup();
    await abrirLaPestana(user);
    await screen.findByRole('radio', { name: /Soda Tica/ });

    expect(screen.getByRole('button', { name: 'Revisar y asignar' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Soda Tica/ }));
    expect(screen.getByRole('button', { name: 'Revisar y asignar' })).toBeEnabled();
  });
});

describe('AdminMerchantsView - plan de un comercio: asignar', () => {
  async function elegirYRevisar(user: ReturnType<typeof userEvent.setup>) {
    await abrirLaPestana(user);
    await user.click(await screen.findByRole('radio', { name: /Cafe Central/ }));
    await user.click(screen.getByRole('radio', { name: /^Analítica/ }));
    await user.click(screen.getByRole('button', { name: 'Revisar y asignar' }));
  }

  it('manda el identificador del comercio elegido solo despues de confirmar', async () => {
    mockApi.qrPayments.setMerchantPlan.mockResolvedValue({
      success: true,
      data: { ...cafe, plan: 'analitica', comisionEfectivaBps: 25 },
    });
    const user = userEvent.setup();
    await elegirYRevisar(user);

    expect(mockApi.qrPayments.setMerchantPlan).not.toHaveBeenCalled();
    // La confirmacion nombra el comercio, no un identificador.
    const hoja = await screen.findByRole('dialog');
    expect(hoja).toHaveTextContent('Cafe Central');
    expect(hoja).not.toHaveTextContent(ID_CAFE);

    await user.click(within(hoja).getByRole('button', { name: 'Sí, asignar Analítica' }));

    await waitFor(() => expect(mockApi.qrPayments.setMerchantPlan).toHaveBeenCalledWith(ID_CAFE, 'analitica'));
    expect(mockApi.qrPayments.setMerchantPlan).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Cafe Central quedó con el plan Analítica.');
    expect(screen.getByRole('status')).toHaveTextContent('0.25%');
  });

  it('despues de asignar la seleccion se limpia y la lista se vuelve a pedir', async () => {
    mockApi.qrPayments.setMerchantPlan.mockResolvedValue({
      success: true,
      data: { ...cafe, plan: 'analitica', comisionEfectivaBps: 25 },
    });
    const user = userEvent.setup();
    await elegirYRevisar(user);
    const llamadasAntes = mockApi.qrPayments.listAllMerchants.mock.calls.length;

    await user.click(await screen.findByRole('button', { name: 'Sí, asignar Analítica' }));

    await screen.findByRole('status');
    await waitFor(() => expect(mockApi.qrPayments.listAllMerchants.mock.calls.length).toBeGreaterThan(llamadasAntes));
    expect(screen.getByRole('radio', { name: /Cafe Central/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Revisar y asignar' })).toBeDisabled();
  });

  it.each([
    ['MERCHANT_NOT_FOUND', 'Ese comercio ya no existe.'],
    ['MERCHANT_CLOSED', 'Este comercio ya estaba cerrado.'],
    ['ADMIN_IS_AFFECTED_PARTY', 'Este comercio es tuyo: de eso se encarga otro administrador.'],
    ['PLAN_UPDATE_FAILED', 'No se pudo cambiar el plan del comercio.'],
  ])('%s se dice en el idioma de la app', async (code, esperado) => {
    mockApi.qrPayments.setMerchantPlan.mockResolvedValue({ success: false, error: { code, message: 'texto del servidor' } });
    const user = userEvent.setup();
    await elegirYRevisar(user);

    await user.click(await screen.findByRole('button', { name: 'Sí, asignar Analítica' }));

    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByText('texto del servidor')).toBeNull();
  });

  it('si la lista no carga, lo dice y no deja asignar', async () => {
    mockApi.qrPayments.listAllMerchants.mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED', message: 'boom' } });
    const user = userEvent.setup();
    await abrirLaPestana(user);

    expect(await screen.findByText('No se pudo completar la acción')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar y asignar' })).toBeDisabled();
  });
});
