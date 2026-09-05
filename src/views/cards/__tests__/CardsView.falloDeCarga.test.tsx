import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CardsView } from '../CardsView';

// Si la consulta de tarjetas fallaba, la pantalla pintaba el estado vacio
// -"todavia no tienes tarjetas"- con el boton de crear una. A alguien que SI
// tiene su tarjeta se le decia que no la tiene y se le invitaba a sacar otra.
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

const pintar = () =>
  render(
    <LanguageProvider>
      <CardsView />
    </LanguageProvider>,
  );

describe('CardsView cuando no se pudo consultar', () => {
  beforeEach(() => {
    mocks.getCards.mockReset();
    mocks.createCard.mockReset();
  });

  it('no ofrece crear una tarjeta: dice que no se pudo consultar', async () => {
    mocks.getCards.mockResolvedValue({ success: false, error: { code: 'X', message: 'sin red' } });
    pintar();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reintentar|retry/i })).toBeTruthy(),
    );
    // El boton de crear es justamente el que no debe estar.
    expect(screen.queryByRole('button', { name: /crear|create/i })).toBeNull();
    expect(mocks.createCard).not.toHaveBeenCalled();
  });

  it('sin tarjetas de verdad si ofrece crear una', async () => {
    mocks.getCards.mockResolvedValue({ success: true, data: [] });
    pintar();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /crear|create/i })).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: /reintentar|retry/i })).toBeNull();
  });
});
