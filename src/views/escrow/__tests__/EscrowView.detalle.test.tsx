import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { fechaYHora } from '@/utils/fechaPlazo';
import { EscrowView } from '../EscrowView';

// El detalle de un pago protegido no mostraba la contraparte (a quien le pagas
// o quien te paga) ni las fechas (creado, liberado o devuelto), y el formulario
// de crear un acuerdo no decia en que moneda es el monto.

const mockApi = vi.hoisted(() => ({
  escrow: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    fund: vi.fn(),
    release: vi.fn(),
    refund: vi.fn(),
    dispute: vi.fn(),
    cancel: vi.fn(),
    deliver: vi.fn(),
  },
  mfa: { totpVerify: vi.fn() },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mockApi,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

const quien = vi.hoisted(() => ({ id: 'buyer-1' }));
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: { user?: { id: string } }) => unknown) => selector({ user: { id: quien.id } }),
}));

vi.mock('@/services/dataSync', () => ({ refreshAccounts: vi.fn(() => Promise.resolve()) }));
vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({ state: { sinpeContacts: [] }, dispatch: vi.fn() }),
}));

const base = {
  id: 'a1',
  buyerId: 'buyer-1',
  sellerId: 'seller-1',
  amountMinor: 1500000,
  currency: 'CRC',
  description: 'Bicicleta',
  createdAt: '2026-09-01T15:00:00Z',
  updatedAt: '2026-09-05T15:00:00Z',
  counterpartyName: 'Luis Rojas',
};

const liberado = {
  ...base,
  status: 'released',
  fundedAt: '2026-09-02T15:00:00Z',
  releasedAt: '2026-09-05T15:00:00Z',
};

const devuelto = {
  ...base,
  status: 'refunded',
  fundedAt: '2026-09-02T15:00:00Z',
  refundedAt: '2026-09-04T15:00:00Z',
};

const fecha = (iso: string) => fechaYHora(iso, 'es');

async function abrirElDetalle(acuerdo: Record<string, unknown>) {
  mockApi.escrow.list.mockResolvedValue({ success: true, data: [acuerdo] });
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <EscrowView onClose={vi.fn()} />
    </LanguageProvider>,
  );
  await user.click(await screen.findByText(String(acuerdo.description)));
  return { user, detalle: await screen.findByRole('dialog', { name: String(acuerdo.description) }) };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  quien.id = 'buyer-1';
});

describe('EscrowView: la contraparte en el detalle', () => {
  it('el comprador ve quien es el vendedor', async () => {
    const { detalle } = await abrirElDetalle(liberado);

    const fila = within(detalle).getByText('Luis Rojas').closest('div');
    expect(fila).toHaveTextContent('Vendedor');
  });

  it('el vendedor ve quien es el comprador', async () => {
    quien.id = 'seller-1';
    const { detalle } = await abrirElDetalle({ ...liberado, counterpartyName: 'Ana Mora' });

    const fila = within(detalle).getByText('Ana Mora').closest('div');
    expect(fila).toHaveTextContent('Comprador');
  });

  it('si el servidor no manda el nombre, el detalle se pinta igual', async () => {
    const { detalle } = await abrirElDetalle({ ...liberado, counterpartyName: undefined });

    expect(within(detalle).getByText('Eres el comprador')).toBeInTheDocument();
  });
});

describe('EscrowView: las fechas en el detalle', () => {
  it('liberado: creado, fondeado y liberado', async () => {
    const { detalle } = await abrirElDetalle(liberado);

    expect(within(detalle).getByText(fecha(liberado.createdAt)).closest('div')).toHaveTextContent('Creado');
    expect(within(detalle).getByText(fecha(liberado.fundedAt)).closest('div')).toHaveTextContent('Fondeado');
    expect(within(detalle).getByText(fecha(liberado.releasedAt)).closest('div')).toHaveTextContent('Liberado');
  });

  it('devuelto: lleva la fecha de la devolucion', async () => {
    const { detalle } = await abrirElDetalle(devuelto);

    expect(within(detalle).getByText(fecha(devuelto.refundedAt)).closest('div')).toHaveTextContent('Reembolsado');
  });
});

describe('EscrowView: el formulario de crear dice la moneda', () => {
  it('el monto se pide en colones', async () => {
    mockApi.escrow.list.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <EscrowView onClose={vi.fn()} />
      </LanguageProvider>,
    );

    await user.click((await screen.findAllByRole('button', { name: 'Nuevo acuerdo' }))[0]);

    const hoja = await screen.findByRole('dialog', { name: 'Crear acuerdo' });
    expect(within(hoja).getByText('En colones (CRC)')).toBeInTheDocument();
  });
});
