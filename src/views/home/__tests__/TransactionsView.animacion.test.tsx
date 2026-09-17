import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { TransactionsView } from '../TransactionsView';
import type { Transaction } from '@/types';

// HALLAZGO 77: al tocar "Ver todo" en Inicio, Inicio se quedaba montado detras
// y Movimientos entraba con `animate-onboard-slide`, la UNICA animacion de la
// app que de verdad anima la opacidad (0 a 1 en 0.5s, ver src/index.css). Con
// el fondo de Movimientos transparente durante ese fundido, Inicio se veia A
// TRAVES de el: las dos pantallas superpuestas por unos cientos de
// milisegundos. El resto de las pantallas superpuestas (Ahorros, Analisis,
// etc.) usan `animate-in slide-in-from-right`, que no toca la opacidad, y por
// eso nunca mostraron el problema.
const mockApi = vi.hoisted(() => ({
  transactions: { listTransactions: vi.fn() },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { transactions: [] as Transaction[], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.transactions.listTransactions.mockResolvedValue({
    success: true,
    data: { transactions: [], total: 0 },
  });
});

describe('TransactionsView — la pantalla entra opaca, sin fundido', () => {
  it('no usa la animacion que anima opacidad (dejaria ver Inicio detras)', async () => {
    const { container } = render(
      <LanguageProvider>
        <TransactionsView onClose={vi.fn()} />
      </LanguageProvider>,
    );
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).not.toMatch(/animate-onboard-slide/);
    // Misma convencion que las demas pantallas superpuestas (Ahorros,
    // Analisis, Escrow, ...): solo transforma posicion, nunca opacidad.
    expect(raiz.className).toMatch(/animate-in/);
    expect(raiz.className).toMatch(/slide-in-from-right/);
    // Deja asentar la busqueda inicial (listTransactions) para no dejar un
    // setState pendiente fuera de act() al terminar la prueba.
    await screen.findByText(/no hay transacciones/i);
  });
});
