import { fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SplitPayView } from '../SplitPayView';

// El detalle de una division CANCELADA no decia que estaba cancelada y mostraba
// "Tu parte: Pendiente", como si todavia se debiera. Ahora muestra el estado del
// grupo y que las cuotas pendientes ya no se cobran. Y al cancelar una division
// donde alguien ya pago, avisa que cancelar no devuelve lo pagado: CancelSplit
// solo cambia el estado del grupo, el dinero de las cuotas pagadas ya esta en la
// cuenta de quien creo la division.

const mocks = vi.hoisted(() => ({
  listSplits: vi.fn(),
  getSplit: vi.fn(),
  cancelSplit: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    splitPay: {
      listSplits: mocks.listSplits,
      getSplit: mocks.getSplit,
      createSplit: vi.fn(),
      payShare: vi.fn(),
      declineShare: vi.fn(),
      cancelSplit: mocks.cancelSplit,
    },
  }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'yo' } }),
}));

const grupo = (status: 'active' | 'settled' | 'cancelled', creatorId = 'otro') => ({
  id: 'g1', creatorId, title: 'Cena', totalAmount: 3000,
  currency: 'CRC', splitType: 'equal' as const, status,
  createdAt: '2026-09-07T00:00:00Z',
});

const cuota = (id: string, userId: string, userName: string, status: 'pending' | 'paid' | 'declined') => ({
  id, groupId: 'g1', userId, userName, amount: 1500, status,
});

async function abrirElDetalle(g: ReturnType<typeof grupo>, shares: ReturnType<typeof cuota>[]) {
  mocks.listSplits.mockResolvedValue({ success: true, data: [g] });
  mocks.getSplit.mockResolvedValue({ success: true, data: { group: g, shares } });
  render(
    <LanguageProvider>
      <SplitPayView onClose={() => {}} />
    </LanguageProvider>,
  );
  fireEvent.click(await screen.findByText('Cena'));
  const detalle = await screen.findByRole('dialog', { name: 'Detalle de la división' });
  // Que la cuota propia aparezca prueba que el detalle ya se pinto.
  await within(detalle).findByText('Tu parte');
  return detalle;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  vi.clearAllMocks();
});

describe('SplitPayView: detalle de una division cancelada', () => {
  it('dice que esta cancelada y que las cuotas pendientes ya no se cobran', async () => {
    const detalle = await abrirElDetalle(grupo('cancelled'), [
      cuota('s1', 'otro', 'Quien pago', 'paid'),
      cuota('s2', 'yo', 'Yo', 'pending'),
    ]);

    expect(within(detalle).getByText('Cancelada')).toBeInTheDocument();
    expect(
      within(detalle).getByText('Esta división fue cancelada: las cuotas pendientes ya no se cobran.'),
    ).toBeInTheDocument();
  });

  it('"Tu parte" no queda como pendiente', async () => {
    const detalle = await abrirElDetalle(grupo('cancelled'), [
      cuota('s1', 'otro', 'Quien pago', 'paid'),
      cuota('s2', 'yo', 'Yo', 'pending'),
    ]);

    expect(within(detalle).getByText('Ya no se cobra')).toBeInTheDocument();
    expect(within(detalle).queryByText('Pendiente')).toBeNull();
    // La cuota que si se pago sigue diciendolo.
    expect(within(detalle).getByText('Pagada')).toBeInTheDocument();
  });

  it('no ofrece pagar, rechazar ni cancelar otra vez', async () => {
    const detalle = await abrirElDetalle(grupo('cancelled', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'pending'),
    ]);

    expect(within(detalle).queryByRole('button', { name: /pagar mi parte|rechazar mi parte|cancelar división/i })).toBeNull();
  });
});

describe('SplitPayView: el detalle dice el estado del grupo', () => {
  it('activa: la cuota pendiente sigue diciendo Pendiente', async () => {
    const detalle = await abrirElDetalle(grupo('active'), [
      cuota('s1', 'otro', 'Quien pago', 'paid'),
      cuota('s2', 'yo', 'Yo', 'pending'),
    ]);

    expect(within(detalle).getByText('Activa')).toBeInTheDocument();
    expect(within(detalle).getByText('Pendiente')).toBeInTheDocument();
    expect(within(detalle).queryByText(/fue cancelada/)).toBeNull();
  });

  it('liquidada', async () => {
    const detalle = await abrirElDetalle(grupo('settled'), [
      cuota('s1', 'otro', 'Quien pago', 'paid'),
      cuota('s2', 'yo', 'Yo', 'paid'),
    ]);

    expect(within(detalle).getByText('Liquidada')).toBeInTheDocument();
  });
});

describe('SplitPayView: cancelar una division donde alguien ya pago', () => {
  const AVISO =
    'Quien ya pagó su parte no recibe su dinero de vuelta al cancelar: ese pago ya está en tu cuenta. Si corresponde, devuélveselo tú con una transferencia.';

  it('advierte que cancelar no devuelve lo pagado', async () => {
    const detalle = await abrirElDetalle(grupo('active', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'paid'),
      cuota('s3', 'tercero', 'Tercero', 'pending'),
    ]);

    fireEvent.click(within(detalle).getByRole('button', { name: /cancelar división/i }));

    expect(await within(detalle).findByText(AVISO)).toBeInTheDocument();
    // El aviso no cancela por si solo: falta confirmar.
    expect(mocks.cancelSplit).not.toHaveBeenCalled();
  });

  it('la cuota del propio creador no cuenta como "alguien ya pago"', async () => {
    // El creador puso la cuenta: su cuota nace pagada y no mueve dinero.
    const detalle = await abrirElDetalle(grupo('active', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'pending'),
    ]);

    fireEvent.click(within(detalle).getByRole('button', { name: /cancelar división/i }));

    expect(await within(detalle).findByText(/Se cancela para todos los participantes/)).toBeInTheDocument();
    expect(within(detalle).queryByText(AVISO)).toBeNull();
  });
});
