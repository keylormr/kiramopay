import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BannerInicio } from '../BannerInicio';

// Banner de 3 tarjetas cerrables en Inicio (planes, referidos, QR). La de
// referidos es la unica con estado de red: sin codigo del servidor, o con el
// programa apagado (bonusPoints 0), no hay nada verdadero que prometer y la
// tarjeta simplemente no se arma.

const mocks = vi.hoisted(() => ({
  getReferrals: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ loyalty: { getReferrals: mocks.getReferrals } }),
}));

const compartirMocks = vi.hoisted(() => ({
  compartirEnlace: vi.fn(),
}));

vi.mock('@/utils/compartir', () => ({
  enlaceInvitacion: (codigo?: string) => `https://kiramopay.com/?ref=${codigo}`,
  compartirEnlace: compartirMocks.compartirEnlace,
}));

let currentUserId = 'user-001';
vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { user: { id: currentUserId } },
    dispatch: vi.fn(),
  }),
}));

function renderBanner(props: { onAbrirPlanes?: () => void; onCobrarQR?: () => void } = {}) {
  return render(
    <LanguageProvider>
      <BannerInicio {...props} />
    </LanguageProvider>,
  );
}

describe('BannerInicio', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    currentUserId = 'user-001';
    mocks.getReferrals.mockReset();
    mocks.getReferrals.mockResolvedValue({
      success: true,
      data: { referralCode: 'ABCD1234', invitedCount: 0, pointsEarned: 0, bonusPoints: 500 },
    });
    compartirMocks.compartirEnlace.mockReset();
    compartirMocks.compartirEnlace.mockResolvedValue('copiado');
  });

  it('muestra las tres tarjetas cuando el servidor confirma un codigo de referidos', async () => {
    renderBanner();
    expect(screen.getByText('Más asistente, más metas')).toBeInTheDocument();
    expect(screen.getByText('Cobra con QR sin comisión')).toBeInTheDocument();
    expect(await screen.findByText('Invita y gana puntos')).toBeInTheDocument();
    // Region accesible con nombre y rol de carrusel (WAI-ARIA).
    expect(screen.getByRole('region', { name: 'Novedades de KiramoPay' })).toHaveAttribute(
      'aria-roledescription',
      'carousel',
    );
  });

  it('no arma la tarjeta de referidos si la consulta al servidor falla', async () => {
    mocks.getReferrals.mockRejectedValue(new Error('network'));
    renderBanner();
    await waitFor(() => expect(mocks.getReferrals).toHaveBeenCalled());
    expect(screen.queryByText('Invita y gana puntos')).not.toBeInTheDocument();
    // Las otras dos tarjetas, verdaderas, se siguen mostrando.
    expect(screen.getByText('Más asistente, más metas')).toBeInTheDocument();
    expect(screen.getByText('Cobra con QR sin comisión')).toBeInTheDocument();
  });

  it('no arma la tarjeta de referidos si el programa esta apagado (bonusPoints en 0)', async () => {
    mocks.getReferrals.mockResolvedValue({
      success: true,
      data: { referralCode: 'ABCD1234', invitedCount: 0, pointsEarned: 0, bonusPoints: 0 },
    });
    renderBanner();
    await waitFor(() => expect(mocks.getReferrals).toHaveBeenCalled());
    expect(screen.queryByText('Invita y gana puntos')).not.toBeInTheDocument();
  });

  it('cierra una tarjeta y la oculta 30 dias para esa cuenta', async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByLabelText(/Cerrar tarjeta: Más asistente, más metas/));

    expect(screen.queryByText('Más asistente, más metas')).not.toBeInTheDocument();
    const guardado = localStorage.getItem('kiramopay-banner-inicio-cerrado-user-001::plans');
    expect(guardado).not.toBeNull();
    expect(Number(guardado)).toBeGreaterThan(Date.now());
  });

  it('otra cuenta en el mismo navegador NO hereda el cierre de la primera', async () => {
    const user = userEvent.setup();
    const { unmount } = renderBanner();

    await user.click(screen.getByLabelText(/Cerrar tarjeta: Más asistente, más metas/));
    expect(screen.queryByText('Más asistente, más metas')).not.toBeInTheDocument();
    unmount();

    currentUserId = 'user-002';
    renderBanner();
    expect(screen.getByText('Más asistente, más metas')).toBeInTheDocument();
    // Deja que su propia consulta de referidos resuelva antes de terminar el
    // test, para no dejar una actualizacion de estado pendiente fuera de act().
    await screen.findByText('Invita y gana puntos');
  });

  it('no queda ningun hueco cuando se cierran todas las tarjetas visibles', async () => {
    mocks.getReferrals.mockRejectedValue(new Error('sin referidos'));
    const user = userEvent.setup();
    const { container } = renderBanner();
    await waitFor(() => expect(mocks.getReferrals).toHaveBeenCalled());

    await user.click(screen.getByLabelText(/Cerrar tarjeta: Más asistente, más metas/));
    await user.click(screen.getByLabelText(/Cerrar tarjeta: Cobra con QR sin comisión/));

    expect(container.querySelector('section')).toBeNull();
  });

  it('"Ver planes" invoca la accion de abrir planes', async () => {
    const user = userEvent.setup();
    const onAbrirPlanes = vi.fn();
    renderBanner({ onAbrirPlanes });

    await user.click(screen.getByText('Ver planes'));

    expect(onAbrirPlanes).toHaveBeenCalledTimes(1);
  });

  it('"Cobrar ahora" invoca la accion de abrir la hoja de cobro', async () => {
    const user = userEvent.setup();
    const onCobrarQR = vi.fn();
    renderBanner({ onCobrarQR });

    await user.click(screen.getByText('Cobrar ahora'));

    expect(onCobrarQR).toHaveBeenCalledTimes(1);
  });

  it('comparte el enlace de invitacion con el codigo que dio el servidor, nunca uno escrito a mano', async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(await screen.findByText('Compartir mi enlace'));

    expect(compartirMocks.compartirEnlace).toHaveBeenCalledWith(
      expect.any(String),
      'https://kiramopay.com/?ref=ABCD1234',
    );
  });
});
