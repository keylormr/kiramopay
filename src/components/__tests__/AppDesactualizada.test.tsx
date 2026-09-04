import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AppDesactualizada, SEGUNDOS_PARA_RECARGAR } from '../AppDesactualizada';

const recargar = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useGuardiaDeVersion', () => ({
  recargarSaltandoCaches: recargar,
}));

function montar() {
  return render(
    <LanguageProvider>
      <AppDesactualizada version="2.4.0" />
    </LanguageProvider>,
  );
}

describe('AppDesactualizada', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    recargar.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('explica que paso y muestra la version disponible', () => {
    montar();

    expect(screen.getByText('Hay una versión nueva')).toBeInTheDocument();
    expect(screen.getByText(/quedó desactualizada/)).toBeInTheDocument();
    // El numero vive junto a su etiqueta en el mismo parrafo.
    expect(screen.getByText('2.4.0', { exact: false })).toBeInTheDocument();
  });

  it('recarga sola al terminar la cuenta regresiva', () => {
    vi.useFakeTimers();
    montar();

    expect(recargar).not.toHaveBeenCalled();

    // Un segundo antes todavia no.
    act(() => { vi.advanceTimersByTime((SEGUNDOS_PARA_RECARGAR - 1) * 1000); });
    expect(recargar).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('deja recargar de inmediato sin esperar la cuenta', async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole('button', { name: 'Actualizar ahora' }));

    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('es un dialogo que se anuncia como tal', () => {
    montar();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
