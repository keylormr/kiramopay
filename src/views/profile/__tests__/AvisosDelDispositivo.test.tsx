import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { EstadoAvisos } from '@/utils/avisosPush';

// La fila de Notificaciones era un interruptor que cambiaba una preferencia que
// nada leia. Ahora manda de verdad, y donde no puede (el APK, un navegador sin
// Push API, el permiso bloqueado) lo dice en lugar de ofrecer un interruptor.

const gancho = vi.hoisted(() => ({
  estado: 'inactivo' as EstadoAvisos,
  ocupado: false,
  fallo: false,
  alternar: vi.fn(),
}));

vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: () => gancho,
}));

const { AvisosDelDispositivo } = await import('../AvisosDelDispositivo');

const pintar = () =>
  render(
    <LanguageProvider>
      <AvisosDelDispositivo />
    </LanguageProvider>,
  );

describe('AvisosDelDispositivo', () => {
  beforeEach(() => {
    localStorage.setItem('kiramopay_language', 'es');
    gancho.estado = 'inactivo';
    gancho.ocupado = false;
    gancho.fallo = false;
    gancho.alternar.mockReset();
  });
  afterEach(cleanup);

  it('apagado: un interruptor de verdad, que al tocarlo activa', async () => {
    pintar();
    const interruptor = await screen.findByRole('switch', { name: 'Notificaciones' });
    expect(interruptor.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Toca para recibir avisos aunque la app esté cerrada')).toBeTruthy();
    fireEvent.click(interruptor);
    expect(gancho.alternar).toHaveBeenCalledTimes(1);
  });

  it('encendido: el interruptor lo refleja', async () => {
    gancho.estado = 'activo';
    pintar();
    const interruptor = await screen.findByRole('switch', { name: 'Notificaciones' });
    expect(interruptor.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Activados en este dispositivo')).toBeTruthy();
  });

  it('sin Push API no ofrece interruptor y explica donde verlos', async () => {
    gancho.estado = 'no_soportado';
    pintar();
    expect(
      await screen.findByText('Este dispositivo no admite avisos con la app cerrada. Los ves en la campana.'),
    ).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('con el permiso bloqueado dice como desbloquearlo, sin interruptor', async () => {
    gancho.estado = 'bloqueado';
    pintar();
    expect(
      await screen.findByText('Bloqueados en el navegador. Permítelos en la configuración del sitio.'),
    ).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('un fallo se dice en la misma fila', async () => {
    gancho.fallo = true;
    pintar();
    expect(await screen.findByText('No se pudo cambiar. Revisa tu conexión e intenta de nuevo.')).toBeTruthy();
  });

  it('mientras trabaja no acepta otro toque', async () => {
    gancho.ocupado = true;
    pintar();
    const interruptor = await screen.findByRole('switch', { name: 'Notificaciones' });
    expect((interruptor as HTMLButtonElement).disabled).toBe(true);
  });
});
