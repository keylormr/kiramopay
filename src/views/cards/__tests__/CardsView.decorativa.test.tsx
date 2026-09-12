import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CardsView } from '../CardsView';

// La tarjeta decia VISA e imprimia un numero con formato de tarjeta real. Es
// una tarjeta de KiramoPay que no pertenece a ninguna red de pago, y se dice.
const mocks = vi.hoisted(() => ({ getCards: vi.fn(), createCard: vi.fn() }));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    cards: {
      getCards: mocks.getCards,
      createCard: mocks.createCard,
      freezeCard: vi.fn(),
      updateLimits: vi.fn(),
      cancelCard: vi.fn(),
    },
  }),
}));

const tarjeta = {
  id: 'c1', last4: '1113', brand: 'kiramopay', status: 'active', type: 'virtual',
  currency: 'CRC', dailyLimit: 500, atmLimit: 100, monthlyLimit: 5000,
  cardholderName: 'Keilor Martinez', expiryMonth: 12, expiryYear: 2030,
};

const pintar = () =>
  render(
    <LanguageProvider>
      <CardsView />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getCards.mockReset();
  mocks.createCard.mockReset();
});

describe('CardsView — la tarjeta no finge ser de una red de pago', () => {
  it('la cara de la tarjeta dice que es solo de KiramoPay, no VISA', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [tarjeta] });
    pintar();

    expect(await screen.findByText('Solo en KiramoPay')).toBeInTheDocument();
    expect(screen.queryByText('VISA')).not.toBeInTheDocument();
  });

  it('al crearla avisa que el numero no sirve fuera de la app', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [] });
    mocks.createCard.mockResolvedValue({
      success: true,
      data: { ...tarjeta, cardNumber: '8111111111111113', cvv: '123' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /crear|create/i }));

    expect(await screen.findByText(/no pertenece a ninguna red de pago/i)).toBeInTheDocument();
  });
});
