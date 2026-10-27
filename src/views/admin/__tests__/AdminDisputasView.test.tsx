import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useAuthStore } from '@/stores/auth.store';
import type { User } from '@/types';
import { AdminDisputasView } from '../AdminDisputasView';

// Hasta el #183 el arbitro no podia ni listar las disputas: habia un boton
// para resolver un caso que nadie podia encontrar.
const mocks = vi.hoisted(() => ({
  adminList: vi.fn(),
  adminResolve: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    escrow: { adminList: mocks.adminList, adminResolve: mocks.adminResolve },
    admin: { getUser: mocks.getUser },
  }),
}));

const caso = {
  id: 'e1',
  buyerId: 'u-comprador',
  sellerId: 'u-vendedor',
  amountMinor: 1_250_000,
  currency: 'CRC',
  status: 'disputed',
  description: 'Bicicleta',
  disputeReason: 'Nunca llego',
  disputedAt: '2026-09-10T15:00:00.000Z',
  createdAt: '',
  updatedAt: '',
};

const personas: Record<string, { firstName: string; lastName: string; phoneMasked: string }> = {
  'u-comprador': { firstName: 'Ana', lastName: 'Mora', phoneMasked: '****1234' },
  'u-vendedor': { firstName: 'Luis', lastName: 'Rojas', phoneMasked: '****5678' },
};

const pintar = () =>
  render(
    <LanguageProvider>
      <AdminDisputasView onClose={vi.fn()} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.adminList.mockReset();
  mocks.adminResolve.mockReset();
  mocks.getUser.mockReset();
  // Un administrador que no es parte de ningun acuerdo, salvo que la prueba diga otra cosa.
  useAuthStore.setState({ user: { id: 'u-administrador' } as User });
  mocks.getUser.mockImplementation(async (id: string) => ({ success: true, data: { id, ...personas[id] } }));
});

describe('AdminDisputasView', () => {
  it('muestra la cola con el monto, el motivo y quien es quien', async () => {
    mocks.adminList.mockResolvedValue({ success: true, data: { agreements: [caso], total: 1, status: 'disputed' } });
    pintar();

    expect(await screen.findByText('Bicicleta')).toBeInTheDocument();
    expect(screen.getByText('₡12,500.00')).toBeInTheDocument();
    expect(screen.getByText('Nunca llego')).toBeInTheDocument();
    expect(screen.getByText('1 caso abierto')).toBeInTheDocument();
    // Nombres, no UUID.
    expect(await screen.findByText(/Ana Mora/)).toBeInTheDocument();
    expect(screen.getByText(/Luis Rojas/)).toBeInTheDocument();
  });

  it('resolver pide confirmacion diciendo cuanto y a quien, y despues resuelve', async () => {
    mocks.adminList.mockResolvedValue({ success: true, data: { agreements: [caso], total: 1, status: 'disputed' } });
    mocks.adminResolve.mockResolvedValue({ success: true, data: { ...caso, status: 'released' } });
    const user = userEvent.setup();
    pintar();

    await screen.findByText(/Luis Rojas/);
    await user.click(screen.getByText('A favor del vendedor'));

    // Mover plata ajena no se hace de un toque.
    expect(await screen.findByText(/se le pagarán ₡12,500.00 a Luis Rojas/i)).toBeInTheDocument();
    expect(mocks.adminResolve).not.toHaveBeenCalled();

    await user.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(mocks.adminResolve).toHaveBeenCalledWith('e1', 'released'));
    // Y la cola se vuelve a pedir.
    await waitFor(() => expect(mocks.adminList).toHaveBeenCalledTimes(2));
  });

  // Un administrador que es comprador o vendedor del acuerdo no lo arbitra: el
  // servidor responde 403 ADMIN_IS_AFFECTED_PARTY y la pantalla lo dice en el
  // idioma de la app, no con el texto del servidor.
  it('si el administrador es parte del acuerdo lo dice con el texto de la app', async () => {
    mocks.adminList.mockResolvedValue({ success: true, data: { agreements: [caso], total: 1, status: 'disputed' } });
    mocks.adminResolve.mockResolvedValue({
      success: false,
      error: { code: 'ADMIN_IS_AFFECTED_PARTY', message: 'an administrator cannot resolve an agreement they are a party to' },
    });
    const user = userEvent.setup();
    pintar();

    await screen.findByText(/Luis Rojas/);
    await user.click(screen.getByText('A favor del vendedor'));
    await user.click(await screen.findByText('Confirmar'));

    expect(await screen.findByText('Eres parte de este acuerdo: lo tiene que resolver otro administrador.')).toBeInTheDocument();
    expect(screen.queryByText(/cannot resolve/)).not.toBeInTheDocument();
  });

  // "1 casos abiertos": el contador no distinguia el singular.
  it('el contador dice caso en singular y casos en plural', async () => {
    mocks.adminList.mockResolvedValue({
      success: true,
      data: { agreements: [caso, { ...caso, id: 'e2', description: 'Moto' }], total: 2, status: 'disputed' },
    });
    pintar();

    expect(await screen.findByText('2 casos abiertos')).toBeInTheDocument();
    expect(screen.queryByText(/1 caso/)).not.toBeInTheDocument();
  });

  // El administrador es el comprador (o el vendedor) del acuerdo: el servidor
  // lo rechaza recien despues de confirmar. Se dice de entrada, sin ofrecer los
  // botones de un veredicto que no puede dar.
  it.each([
    ['comprador', 'u-comprador'],
    ['vendedor', 'u-vendedor'],
  ])('si el administrador es el %s no ofrece resolver y lo dice de entrada', async (_rol, miId) => {
    useAuthStore.setState({ user: { id: miId } as User });
    mocks.adminList.mockResolvedValue({ success: true, data: { agreements: [caso], total: 1, status: 'disputed' } });
    pintar();

    expect(await screen.findByText('Eres parte de este acuerdo: lo tiene que resolver otro administrador.')).toBeInTheDocument();
    expect(screen.queryByText('A favor del comprador')).not.toBeInTheDocument();
    expect(screen.queryByText('A favor del vendedor')).not.toBeInTheDocument();
    // El caso sigue a la vista: se ve el monto y el motivo.
    expect(screen.getByText('Bicicleta')).toBeInTheDocument();
    expect(screen.getByText('Nunca llego')).toBeInTheDocument();
    expect(mocks.adminResolve).not.toHaveBeenCalled();
  });

  it('en una cola mezclada solo quita los botones de los casos donde es parte', async () => {
    useAuthStore.setState({ user: { id: 'u-comprador' } as User });
    const ajeno = { ...caso, id: 'e2', description: 'Moto', buyerId: 'u-otro', sellerId: 'u-vendedor' };
    mocks.adminList.mockResolvedValue({ success: true, data: { agreements: [caso, ajeno], total: 2, status: 'disputed' } });
    pintar();

    await screen.findByText('Moto');
    expect(screen.getAllByText('Eres parte de este acuerdo: lo tiene que resolver otro administrador.')).toHaveLength(1);
    expect(screen.getAllByText('A favor del comprador')).toHaveLength(1);
    expect(screen.getAllByText('A favor del vendedor')).toHaveLength(1);
  });

  it('una cola que no cargo no se muestra como cola vacia', async () => {
    mocks.adminList.mockResolvedValue({ success: false, error: { code: 'X', message: 'sin red' } });
    pintar();

    expect(await screen.findByText('sin red')).toBeInTheDocument();
    expect(screen.queryByText('No hay disputas abiertas')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });
});
