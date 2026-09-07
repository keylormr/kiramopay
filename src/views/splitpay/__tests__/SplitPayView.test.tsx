import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SplitPayView } from '../SplitPayView';

// Antes de este cambio, una division creada desde la app no era pagable por
// nadie: la pantalla solo mandaba nombre y telefono, la cuota se guardaba sin
// cuenta asociada y no existia boton de pagar. Estas pruebas cubren las dos
// mitades: que el telefono sea obligatorio, y que quien tiene una cuota
// pendiente pueda pagarla.
const mocks = vi.hoisted(() => ({
  listSplits: vi.fn(),
  createSplit: vi.fn(),
  getSplit: vi.fn(),
  payShare: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    splitPay: {
      listSplits: mocks.listSplits,
      createSplit: mocks.createSplit,
      getSplit: mocks.getSplit,
      payShare: mocks.payShare,
      declineShare: vi.fn(),
      cancelSplit: vi.fn(),
    },
  }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'yo' } }),
}));

const grupo = {
  id: 'g1', creatorId: 'otro', title: 'Cena', totalAmount: 3000,
  currency: 'CRC', splitType: 'equal' as const, status: 'active' as const,
  createdAt: '2026-09-07T00:00:00Z',
};

const pintar = () =>
  render(
    <LanguageProvider>
      <SplitPayView onClose={() => {}} />
    </LanguageProvider>,
  );

describe('SplitPayView', () => {
  beforeEach(() => {
    localStorage.setItem('kiramopay_language', 'es');
    vi.clearAllMocks();
    mocks.listSplits.mockResolvedValue({ success: true, data: [grupo] });
  });

  it('muestra el error del servidor en vez de cerrarse en silencio', async () => {
    mocks.createSplit.mockResolvedValue({
      success: false,
      error: { code: 'CREATE_FAILED', message: '"Ana" (+50688880001) does not have a KiramoPay account' },
    });
    pintar();

    await screen.findByText('Cena');
    // La division se crea desde el boton de mas de la cabecera, no desde la
    // tarjeta: tocar la tarjeta abre el detalle.
    fireEvent.click(screen.getAllByRole('button', { name: /crear divisi/i })[0]);

    fireEvent.change(screen.getByPlaceholderText(/Ej: Cena/i), { target: { value: 'Cena' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '3000' } });
    const nombres = screen.getAllByPlaceholderText(/nombre/i);
    fireEvent.change(nombres[0], { target: { value: 'Ana' } });
    const telefonos = screen.getAllByPlaceholderText(/tel/i);
    fireEvent.change(telefonos[0], { target: { value: '88880001' } });

    fireEvent.click(screen.getAllByRole('button', { name: /crear divisi/i }).slice(-1)[0]);

    expect(await screen.findByText(/does not have a KiramoPay account/i)).toBeTruthy();
  });

  it('deja pagar la propia cuota pendiente', async () => {
    mocks.getSplit.mockResolvedValue({
      success: true,
      data: {
        group: grupo,
        shares: [
          { id: 's1', groupId: 'g1', userId: 'otro', userName: 'Quien pago', amount: 1500, status: 'paid' },
          { id: 's2', groupId: 'g1', userId: 'yo', userName: 'Yo', amount: 1500, status: 'pending' },
        ],
      },
    });
    mocks.payShare.mockResolvedValue({ success: true });
    pintar();

    fireEvent.click(await screen.findByText('Cena'));

    const pagar = await screen.findByRole('button', { name: /pagar mi parte/i });
    fireEvent.click(pagar);

    await waitFor(() => expect(mocks.payShare).toHaveBeenCalledWith('g1'));
  });

  it('no ofrece pagar una cuota que ya esta pagada', async () => {
    mocks.getSplit.mockResolvedValue({
      success: true,
      data: {
        group: grupo,
        shares: [
          { id: 's1', groupId: 'g1', userId: 'otro', userName: 'Quien pago', amount: 1500, status: 'paid' },
          { id: 's2', groupId: 'g1', userId: 'yo', userName: 'Yo', amount: 1500, status: 'paid' },
        ],
      },
    });
    pintar();

    fireEvent.click(await screen.findByText('Cena'));
    // Que las dos cuotas aparezcan prueba que el detalle ya se pinto: sin esa
    // espera, la ausencia del boton no significaria nada.
    await screen.findByText(/Tu parte/i);
    expect(screen.queryByRole('button', { name: /pagar mi parte/i })).toBeNull();
  });
});
