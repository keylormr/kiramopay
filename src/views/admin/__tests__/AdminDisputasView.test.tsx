import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
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
  mocks.getUser.mockImplementation(async (id: string) => ({ success: true, data: { id, ...personas[id] } }));
});

describe('AdminDisputasView', () => {
  it('muestra la cola con el monto, el motivo y quien es quien', async () => {
    mocks.adminList.mockResolvedValue({ success: true, data: { agreements: [caso], total: 1, status: 'disputed' } });
    pintar();

    expect(await screen.findByText('Bicicleta')).toBeInTheDocument();
    expect(screen.getByText('₡12,500.00')).toBeInTheDocument();
    expect(screen.getByText('Nunca llego')).toBeInTheDocument();
    expect(screen.getByText('1 casos abiertos')).toBeInTheDocument();
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

  it('una cola que no cargo no se muestra como cola vacia', async () => {
    mocks.adminList.mockResolvedValue({ success: false, error: { code: 'X', message: 'sin red' } });
    pintar();

    expect(await screen.findByText('sin red')).toBeInTheDocument();
    expect(screen.queryByText('No hay disputas abiertas')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });
});
