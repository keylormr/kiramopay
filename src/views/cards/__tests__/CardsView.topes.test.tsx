import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useAuthStore } from '@/stores/auth.store';
import type { User } from '@/types/auth.types';
import { CardsView } from '../CardsView';

// Decision del dueno (2026-09-13): tarjetas activas o congeladas 1 / 3 / 5
// segun el plan. Quien ya tiene mas conserva lo que tiene; solo no crea mas.
const mocks = vi.hoisted(() => ({
  api: {
    cards: {
      getCards: vi.fn(),
      createCard: vi.fn(),
      freezeCard: vi.fn(),
      updateLimits: vi.fn(),
      cancelCard: vi.fn(),
    },
  },
}));

// Un objeto estable: CardsView depende de la identidad del repositorio.
vi.mock('@/api', () => ({ getApiLayer: () => mocks.api }));

const tarjeta = (id: string, last4: string, status = 'active') => ({
  id, last4, brand: 'kiramopay', status, type: 'virtual', currency: 'CRC',
  dailyLimit: 500, atmLimit: 100, monthlyLimit: 5000, dailySpent: 0, monthlySpent: 0,
  cardholderName: 'Keilor Martinez', expiryMonth: 12, expiryYear: 2030, cardNumber: '',
});

function conPlan(plan: User['plan']) {
  useAuthStore.setState({
    user: { id: 'u1', phone: '', firstName: 'Keilor', lastName: 'M', kycLevel: 1, createdAt: '', plan } as User,
  });
}

const pintar = (onOpenPlans = vi.fn()) =>
  render(
    <LanguageProvider>
      <CardsView onOpenPlans={onOpenPlans} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks.api.cards).forEach((fn) => fn.mockReset());
  conPlan('free');
});

describe('CardsView y el tope del plan', () => {
  it('con Gratis y una tarjeta no ofrece otra: explica el tope y lleva a los planes', async () => {
    mocks.api.cards.getCards.mockResolvedValue({ success: true, data: [tarjeta('c1', '1113')] });
    const onOpenPlans = vi.fn();
    const user = userEvent.setup();
    pintar(onOpenPlans);

    expect(await screen.findByText('Tu plan Gratis permite 1 tarjeta activa. Plus permitirá hasta 3, muy pronto.')).toBeInTheDocument();
    expect(screen.getByText('Las tarjetas congeladas también cuentan.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crear otra tarjeta/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Ver planes/ }));
    expect(onOpenPlans).toHaveBeenCalledTimes(1);
    expect(mocks.api.cards.createCard).not.toHaveBeenCalled();
  });

  it('una tarjeta congelada tambien ocupa el lugar', async () => {
    mocks.api.cards.getCards.mockResolvedValue({ success: true, data: [tarjeta('c1', '1113', 'frozen')] });
    pintar();

    expect(await screen.findByText(/Tu plan Gratis permite 1 tarjeta activa/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crear otra tarjeta/ })).toBeNull();
  });

  it('con Plus crea otra tarjeta y deja elegir entre las dos', async () => {
    conPlan('plus');
    mocks.api.cards.getCards
      .mockResolvedValueOnce({ success: true, data: [tarjeta('c1', '1113')] })
      .mockResolvedValue({ success: true, data: [tarjeta('c1', '1113'), tarjeta('c2', '2224')] });
    mocks.api.cards.createCard.mockResolvedValue({
      success: true,
      data: { ...tarjeta('c2', '2224'), cardNumber: '8111111111112224', cvv: '123' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /Crear otra tarjeta/ }));

    expect(mocks.api.cards.createCard).toHaveBeenCalledTimes(1);
    const nueva = await screen.findByRole('button', { name: /•••• 2224/ });
    expect(nueva).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /•••• 1113/ })).toHaveAttribute('aria-pressed', 'false');
  });

  // El tope se veia solo al chocar con el. Ahora se ve antes: cuantas quedan.
  it('con Plus y una tarjeta dice cuantas permite el plan antes de llegar al tope', async () => {
    conPlan('plus');
    mocks.api.cards.getCards.mockResolvedValue({ success: true, data: [tarjeta('c1', '1113')] });
    pintar();

    expect(await screen.findByRole('button', { name: /Crear otra tarjeta/ })).toBeInTheDocument();
    expect(screen.getByText('Tienes 1 de las 3 tarjetas que permite tu plan Plus.')).toBeInTheDocument();
  });

  // Tras un 409 CARD_LIMIT el aviso se quedaba aunque se cancelara una
  // tarjeta: el boton de crear otra no volvia hasta recargar.
  it('cancelar una tarjeta despues de un CARD_LIMIT vuelve a ofrecer crear otra', async () => {
    conPlan('plus');
    mocks.api.cards.getCards
      .mockResolvedValueOnce({ success: true, data: [tarjeta('c1', '1113'), tarjeta('c2', '2224')] })
      .mockResolvedValue({ success: true, data: [tarjeta('c2', '2224')] });
    mocks.api.cards.createCard.mockResolvedValue({
      success: false,
      error: { code: 'CARD_LIMIT', message: 'card limit reached', details: { plan: 'plus', limite: 3, actuales: 3 } },
    });
    mocks.api.cards.cancelCard.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /Crear otra tarjeta/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Tu plan Plus permite 3 tarjetas activas.');

    await user.click(screen.getByRole('button', { name: 'Cancelar tarjeta' }));
    const botones = await screen.findAllByRole('button', { name: 'Cancelar tarjeta' });
    await user.click(botones[botones.length - 1]);

    expect(await screen.findByRole('button', { name: /Crear otra tarjeta/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('cuando el servidor responde CARD_LIMIT lo explica con su detalle, sin error generico', async () => {
    conPlan('plus');
    mocks.api.cards.getCards.mockResolvedValue({ success: true, data: [tarjeta('c1', '1113')] });
    mocks.api.cards.createCard.mockResolvedValue({
      success: false,
      error: { code: 'CARD_LIMIT', message: 'card limit reached', details: { plan: 'plus', limite: 3, actuales: 3 } },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /Crear otra tarjeta/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Tu plan Plus permite 3 tarjetas activas. Pro permitirá hasta 5, muy pronto.',
    );
    expect(screen.queryByText('card limit reached')).toBeNull();
  });

  it('con Pro en su tope dice que es el mas alto', async () => {
    conPlan('pro');
    mocks.api.cards.getCards.mockResolvedValue({
      success: true,
      data: ['1', '2', '3', '4', '5'].map((n) => tarjeta(`c${n}`, `000${n}`)),
    });
    pintar();

    expect(await screen.findByText('Tu plan Pro permite 5 tarjetas activas. Es el tope más alto que hay.')).toBeInTheDocument();
  });

  it('quien ya tiene mas que su tope las conserva todas y se le dice', async () => {
    mocks.api.cards.getCards.mockResolvedValue({ success: true, data: [tarjeta('c1', '1113'), tarjeta('c2', '2224')] });
    pintar();

    expect(await screen.findByText(/Hoy tienes 2 y las conservas todas; solo no puedes crear otra\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /•••• \d{4}/ })).toHaveLength(2));
  });
});
