import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CardsView } from '../CardsView';

// La cara de la tarjeta cambia con la red del numero. Hoy el servidor da solo
// los ultimos cuatro (y el numero enmascarado), asi que toda tarjeta real sale
// con la cara de KiramoPay; las otras se prueban con numeros de prueba
// publicos de cada red, como llegarian el dia que haya un numero completo.
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

const base = {
  id: 'c1', last4: '1113', cardNumber: '•••• •••• •••• 1113', brand: 'kiramopay', status: 'active',
  type: 'virtual', currency: 'CRC', dailyLimit: 500, atmLimit: 0, monthlyLimit: 5000, dailySpent: 0,
  monthlySpent: 0, cardholderName: 'Keilor Martinez', expiryMonth: 9, expiryYear: 2029,
};

const pintar = () =>
  render(
    <LanguageProvider>
      <CardsView />
    </LanguageProvider>,
  );

const cara = (container: HTMLElement) => container.querySelector<HTMLElement>('.kp-cara[data-red]');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getCards.mockReset();
  mocks.createCard.mockReset();
});

describe('CardsView — la cara segun la red', () => {
  it('una tarjeta de la lista (enmascarada) sale con la cara de KiramoPay', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [base] });
    const { container } = pintar();

    expect(await screen.findByText('Tarjeta KiramoPay terminada en 1113')).toBeInTheDocument();
    expect(cara(container)).toHaveAttribute('data-red', 'kiramopay');
    expect(screen.getByText('Solo en KiramoPay')).toBeInTheDocument();
    expect(screen.getByText('•••• •••• •••• 1113')).toBeInTheDocument();
    // Vencimiento como lo imprime una tarjeta.
    expect(screen.getByText('Vence')).toBeInTheDocument();
    expect(screen.getByText('09/29')).toBeInTheDocument();
  });

  // Las filas viejas con brand "visa" eran tarjetas de KiramoPay rotuladas
  // VISA. Una vencida todavia llega en la lista: no vuelve a decir VISA.
  it('una fila vieja con brand visa no se pinta de Visa', async () => {
    mocks.getCards.mockResolvedValue({
      success: true,
      data: [{ ...base, brand: 'visa', status: 'expired', last4: '4111', cardNumber: '•••• •••• •••• 4111' }],
    });
    const { container } = pintar();

    expect(await screen.findByText('Solo en KiramoPay')).toBeInTheDocument();
    expect(cara(container)).toHaveAttribute('data-red', 'kiramopay');
    expect(screen.queryByText('VISA')).toBeNull();
  });

  it('con un numero Visa completo, cara de Visa', async () => {
    mocks.getCards.mockResolvedValue({
      success: true,
      data: [{ ...base, last4: '4242', cardNumber: '4242424242424242' }],
    });
    const { container } = pintar();

    expect(await screen.findByText('Tarjeta Visa terminada en 4242')).toBeInTheDocument();
    expect(cara(container)).toHaveAttribute('data-red', 'visa');
    expect(screen.getByText('VISA')).toBeInTheDocument();
    expect(screen.getByText('Virtual')).toBeInTheDocument();
    expect(screen.queryByText('Solo en KiramoPay')).toBeNull();
    // El numero completo nunca se pinta: ni agrupado ni crudo.
    expect(container.textContent).not.toMatch(/4242424242424242|4242 4242/);
    expect(screen.getByText('•••• •••• •••• 4242')).toBeInTheDocument();
  });

  it('con un numero de la serie 2 de Mastercard, cara de Mastercard', async () => {
    mocks.getCards.mockResolvedValue({
      success: true,
      data: [{ ...base, last4: '0009', cardNumber: '2221000000000009', type: 'physical' }],
    });
    const { container } = pintar();

    expect(await screen.findByText('Tarjeta Mastercard terminada en 0009')).toBeInTheDocument();
    expect(cara(container)).toHaveAttribute('data-red', 'mastercard');
    expect(screen.getByText('mastercard')).toBeInTheDocument();
    expect(screen.getByText('Física')).toBeInTheDocument();
  });

  it('American Express agrupa 4-6-5 y lleva el CID al frente', async () => {
    mocks.getCards.mockResolvedValue({
      success: true,
      data: [{ ...base, last4: '0005', cardNumber: '378282246310005' }],
    });
    const { container } = pintar();

    expect(await screen.findByText('Tarjeta American Express terminada en 0005')).toBeInTheDocument();
    expect(cara(container)).toHaveAttribute('data-red', 'amex');
    expect(screen.getByText('•••• •••••• •0005')).toBeInTheDocument();
    expect(screen.getByText('CID ••••')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/378282246310005|3782 822463/);
  });

  // Un numero que no puede ser de la red (falla Luhn) no toma su cara.
  it('un numero que empieza en 4 pero falla Luhn sigue siendo de KiramoPay', async () => {
    mocks.getCards.mockResolvedValue({
      success: true,
      data: [{ ...base, last4: '4241', cardNumber: '4242424242424241' }],
    });
    const { container } = pintar();

    expect(await screen.findByText('Solo en KiramoPay')).toBeInTheDocument();
    expect(cara(container)).toHaveAttribute('data-red', 'kiramopay');
  });

  it('el selector muestra la miniatura de cada red', async () => {
    mocks.getCards.mockResolvedValue({
      success: true,
      data: [base, { ...base, id: 'c2', last4: '4444', cardNumber: '5555555555554444' }],
    });
    pintar();

    // La miniatura es solo color: la red va en el nombre del boton.
    const propia = await screen.findByRole('button', { name: 'KiramoPay •••• 1113' });
    const mc = screen.getByRole('button', { name: 'Mastercard •••• 4444' });
    expect(propia.querySelector('[data-red]')).toHaveAttribute('data-red', 'kiramopay');
    expect(mc.querySelector('[data-red]')).toHaveAttribute('data-red', 'mastercard');

    await userEvent.setup().click(mc);
    expect(await screen.findByText('Tarjeta Mastercard terminada en 4444')).toBeInTheDocument();
  });

  it('en el selector, una congelada lo dice en su nombre', async () => {
    mocks.getCards.mockResolvedValue({
      success: true,
      data: [base, { ...base, id: 'c2', last4: '4242', cardNumber: '4242424242424242', status: 'frozen' }],
    });
    pintar();

    expect(await screen.findByRole('button', { name: 'Visa •••• 4242, TARJETA CONGELADA' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KiramoPay •••• 1113' })).toBeInTheDocument();
  });

  it('congelada, la cara lo dice sobre cualquier red', async () => {
    mocks.getCards.mockResolvedValue({
      success: true,
      data: [{ ...base, status: 'frozen', last4: '4242', cardNumber: '4242424242424242' }],
    });
    const { container } = pintar();

    await screen.findByText('Tarjeta Visa terminada en 4242');
    expect(within(cara(container)!).getByText('TARJETA CONGELADA')).toBeInTheDocument();
  });
});

describe('CardsView — al crear la tarjeta', () => {
  it('la propia se muestra 4-4-4-4 con su CVV', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [] });
    mocks.createCard.mockResolvedValue({
      success: true,
      data: { ...base, cardNumber: '8111111111111113', cvv: '123' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Crear tarjeta virtual' }));

    expect(await screen.findByText('8111 1111 1111 1113')).toBeInTheDocument();
    expect(screen.getByText('CVV')).toBeInTheDocument();
  });

  it('un numero American Express se agrupa 4-6-5 y su codigo se llama CID', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [] });
    mocks.createCard.mockResolvedValue({
      success: true,
      data: { ...base, last4: '0005', cardNumber: '378282246310005', cvv: '1234' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Crear tarjeta virtual' }));

    expect(await screen.findByText('3782 822463 10005')).toBeInTheDocument();
    expect(screen.getByText('CID')).toBeInTheDocument();
    expect(screen.queryByText('CVV')).toBeNull();
  });
});

describe('CardsView — sin tarjetas', () => {
  it('el estado vacio lleva la ilustracion de la tarjeta con un mas', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [] });
    const { container } = pintar();

    await screen.findByText('Aún no tienes tarjetas');
    expect(container.querySelector('img[data-arte3d="sinTarjetas"]')).not.toBeNull();
  });
});
