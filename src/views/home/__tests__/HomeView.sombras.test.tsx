import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { alcanceDeSombra, px } from '@/test/sombras';
import { HomeView } from '../HomeView';

// El rectangulo palido detras de la cuenta elegida del Inicio. El carrusel de
// Cuentas se desplaza de lado (`overflow-x: auto`), y un contenedor que se
// desplaza recorta TODO lo que sale de su caja, tambien hacia arriba y hacia
// abajo (con overflow-x distinto de visible, overflow-y deja de ser visible). La
// cuenta elegida lleva `--shadow-primary` (0 8px 20px, azul): la sombra se
// extiende 20 px a cada lado, 12 hacia arriba y 28 hacia abajo, y el carrusel la
// cortaba justo en el borde de la tarjeta. Es el mismo defecto que tenia
// BottomSheet (ver BottomSheet.sombras.test.tsx) y se resuelve igual: el
// carrusel deja como relleno lo que la sombra necesita y lo recupera con margen
// negativo, para que el Inicio no se mueva.
//
// jsdom no pinta, asi que se prueba la regla que lo resuelve.

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('@/api', () => ({
  getApiLayer: () => ({}),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <svg data-testid="qr-code" />,
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/stores/notification.store', () => ({
  useNotificationStore: (selector: (s: unknown) => unknown) =>
    selector({ notifications: [], unreadCount: 0 }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      transactions: [],
      baseCurrency: 'CRC',
      accounts: [
        { ccy: 'CRC', balance: 500000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' },
        { ccy: 'USD', balance: 100, symbol: '$', flag: '', iban: '', name: 'Dolares', type: 'fiat', rateToUsd: 1 },
      ],
      sinpeContacts: [],
    },
    dispatch: vi.fn(),
  }),
}));

/** El titulo "Cuentas" deja 12 px (mb-3) entre su texto y el carrusel. */
const HUECO_SOBRE_EL_CARRUSEL = 12;
/** Lo que el carrusel ya dejaba debajo de las tarjetas (pb-2). */
const RELLENO_DE_ANTES_ABAJO = 8;
/** El hueco entre secciones del Inicio (space-y-6). */
const HUECO_ENTRE_SECCIONES = 24;

function carrusel() {
  render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
  return screen.getByRole('tablist');
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('Inicio: la sombra de la cuenta elegida cabe en el carrusel que se desplaza', () => {
  it('la prueba mide una sombra real (si cambia el formato de la variable, avisa)', () => {
    const a = alcanceDeSombra('shadow-primary');
    expect(a.abajo).toBeGreaterThan(0);
    expect(a.arriba).toBeGreaterThan(0);
    expect(a.izquierda).toBeGreaterThan(0);
  });

  it('el carrusel sigue desplazandose de lado', () => {
    expect(carrusel().className).toContain('overflow-x-auto');
  });

  it('la cuenta elegida lleva la sombra principal', () => {
    carrusel();
    const elegida = screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true');
    expect(elegida?.className).toContain('uv-shadow-primary');
  });

  it('deja de relleno, en los cuatro lados, lo que se extiende la sombra', () => {
    const a = alcanceDeSombra('shadow-primary');
    const estilo = carrusel().style;

    expect(px(estilo.paddingLeft)).toBeGreaterThanOrEqual(a.izquierda);
    expect(px(estilo.paddingRight)).toBeGreaterThanOrEqual(a.derecha);
    expect(px(estilo.paddingTop)).toBeGreaterThanOrEqual(a.arriba);
    expect(px(estilo.paddingBottom)).toBeGreaterThanOrEqual(a.abajo);
  });

  // El relleno de arriba y de abajo se mete en el hueco que ya habia: si fuera
  // mayor, el carrusel (transparente, pero con clics) taparia el titulo o la
  // seccion que sigue.
  it('no invade el titulo de arriba ni la seccion de abajo', () => {
    const estilo = carrusel().style;

    expect(px(estilo.paddingTop)).toBeLessThanOrEqual(HUECO_SOBRE_EL_CARRUSEL);
    expect(px(estilo.paddingBottom)).toBeLessThanOrEqual(RELLENO_DE_ANTES_ABAJO + HUECO_ENTRE_SECCIONES);
  });

  it('recupera ese relleno con margen negativo, para que el Inicio no se mueva', () => {
    const estilo = carrusel().style;

    expect(px(estilo.marginLeft)).toBe(-px(estilo.paddingLeft));
    expect(px(estilo.marginRight)).toBe(-px(estilo.paddingRight));
    expect(px(estilo.marginTop)).toBe(-px(estilo.paddingTop));
    // Abajo ya habia 8 px de relleno propio (pb-2): esos se quedan.
    expect(px(estilo.paddingBottom) + px(estilo.marginBottom)).toBe(RELLENO_DE_ANTES_ABAJO);
  });
});
