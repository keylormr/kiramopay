import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CardsView } from '../CardsView';

// La tarjeta es decorativa (la pagina de planes lo dice: no hay tarjeta fisica
// ni retiros en cajeros), pero la pantalla ofrecia "Ajustes y limites: Compras
// diarias y retiros en ATM" y mostraba "Limite en ATM 100.000". Se quita de la
// interfaz el limite de cajero y toda mencion a cajeros o retiros; el campo
// del servidor puede quedar.
const mocks = vi.hoisted(() => ({
  getCards: vi.fn(),
  createCard: vi.fn(),
  freezeCard: vi.fn(),
  updateLimits: vi.fn(),
  cancelCard: vi.fn(),
}));

vi.mock('@/api', () => ({ getApiLayer: () => ({ cards: mocks }) }));

const tarjeta = {
  id: 'c1', last4: '1113', brand: 'kiramopay', status: 'active', type: 'virtual',
  currency: 'CRC', dailyLimit: 500000, atmLimit: 100000, monthlyLimit: 2000000,
  dailySpent: 0, monthlySpent: 0,
  cardholderName: 'Keilor Martinez', expiryMonth: 12, expiryYear: 2030, cardNumber: '',
};

const CAJERO = /ATM|cajero|retiros/i;

const pintar = () =>
  render(
    <LanguageProvider>
      <CardsView />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks).forEach((fn) => fn.mockReset());
});

describe('CardsView: sin cajeros ni retiros', () => {
  it('la pantalla de la tarjeta no menciona cajeros, ATM ni retiros', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [tarjeta] });
    pintar();

    expect(await screen.findByText('Ajustes y límites')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(CAJERO);
    // El limite diario, que si cuenta, sigue a la vista.
    expect(screen.getByText('Límite diario')).toBeInTheDocument();
  });

  it('la hoja de limites ajusta solo el limite diario', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [tarjeta] });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /Ajustes y límites/ }));

    expect(await screen.findAllByRole('slider')).toHaveLength(1);
    expect(document.body.textContent ?? '').not.toMatch(CAJERO);
  });

  it('guardar los limites no manda el de cajero', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [tarjeta] });
    mocks.updateLimits.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /Ajustes y límites/ }));
    await user.click(await screen.findByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mocks.updateLimits).toHaveBeenCalledTimes(1));
    const [id, cambios] = mocks.updateLimits.mock.calls[0];
    expect(id).toBe('c1');
    expect(cambios).toEqual({ dailyLimit: 500000 });
    expect(cambios).not.toHaveProperty('atmLimit');
  });
});

// CREATE_FAILED devolvia err.Error() crudo y la pantalla lo pintaba tal cual,
// en ingles y con el texto del controlador de la base. Ahora el motivo viaja
// como codigo y el texto lo pone la pantalla.
describe('CardsView: los rechazos al crear se dicen con texto propio', () => {
  it('un fallo inesperado no pinta el texto del servidor', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [] });
    mocks.createCard.mockResolvedValue({
      success: false,
      error: { code: 'CREATE_FAILED', message: 'ERROR: value too long for type character varying(200) (SQLSTATE 22001)' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Crear tarjeta virtual' }));

    expect(await screen.findByText('No se pudo crear la tarjeta. Inténtalo de nuevo.')).toBeInTheDocument();
    expect(screen.queryByText(/SQLSTATE|character varying/)).toBeNull();
  });

  it('CARDHOLDER_NAME_MISSING manda a completar el nombre', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [] });
    mocks.createCard.mockResolvedValue({
      success: false,
      error: { code: 'CARDHOLDER_NAME_MISSING', message: 'cardholder name is missing' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Crear tarjeta virtual' }));

    expect(await screen.findByText('Completa tu nombre en tu perfil para crear la tarjeta.')).toBeInTheDocument();
    expect(screen.queryByText('cardholder name is missing')).toBeNull();
  });

  it('congelar, si falla, tampoco pinta el texto del servidor', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [tarjeta] });
    mocks.freezeCard.mockResolvedValue({ success: false, error: { code: 'FREEZE_FAILED', message: 'card not found' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /Congelar tarjeta/ }));

    expect(await screen.findByText('No se pudo completar la acción')).toBeInTheDocument();
    expect(screen.queryByText('card not found')).toBeNull();
  });
});
