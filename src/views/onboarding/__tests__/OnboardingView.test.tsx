import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { OnboardingView } from '../OnboardingView';

// La bienvenida de cuatro laminas (fase 5 del rediseno). Es un dialogo modal a
// pantalla completa: el foco entra al boton principal y Tab no sale a la
// pantalla de atras.

function pintar(onComplete = vi.fn()) {
  render(
    <LanguageProvider>
      <button>detras</button>
      <OnboardingView onComplete={onComplete} />
    </LanguageProvider>,
  );
  return onComplete;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('OnboardingView', () => {
  it('abre con el foco en Continuar y Tab no sale del dialogo', async () => {
    const user = userEvent.setup();
    pintar();

    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toHaveFocus();

    // En la primera lamina solo hay Omitir y Continuar: Tab cicla entre los dos.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Omitir' })).toHaveFocus();
    await user.tab();
    expect(continuar).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Omitir' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'detras', hidden: true })).not.toHaveFocus();
  });

  it('avanza con el boton y con las flechas, y anuncia el paso', async () => {
    const user = userEvent.setup();
    pintar();

    expect(screen.getByText('Paso 1 de 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Paso 2 de 4')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByText('Paso 4 de 4')).toBeInTheDocument();
    // En la ultima la flecha no termina: entrar es una decision del boton.
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('Paso 4 de 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByText('Paso 3 de 4')).toBeInTheDocument();
  });

  it('Omitir termina la bienvenida y la recuerda', async () => {
    const user = userEvent.setup();
    const alTerminar = pintar();

    await user.click(screen.getByRole('button', { name: 'Omitir' }));
    expect(alTerminar).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('kiramopay_onboarded')).toBe('true');
  });
});
