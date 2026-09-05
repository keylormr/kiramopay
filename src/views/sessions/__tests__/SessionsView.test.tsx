import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SessionsView } from '../SessionsView';
import type { DeviceSession } from '@/api/repositories/sessions.repository';

const mockApi = vi.hoisted(() => ({
  sessions: {
    listar: vi.fn(),
    cerrar: vi.fn(),
    cerrarLasDemas: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const esta: DeviceSession = {
  id: 's-actual',
  deviceName: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  ipMasked: '190.7.0.0',
  createdAt: '2026-09-03T18:04:12Z',
  expiresAt: '2026-10-03T18:04:12Z',
  current: true,
};

const otra: DeviceSession = {
  id: 's-otra',
  deviceName: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  ipMasked: '201.196.0.0',
  createdAt: '2026-08-28T09:15:00Z',
  expiresAt: '2026-09-27T09:15:00Z',
  current: false,
};

const tercera: DeviceSession = {
  ...otra,
  id: 's-tercera',
  deviceName: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function setup() {
  return render(
    <LanguageProvider>
      <SessionsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

// Dos toques seguidos ANTES de que React vuelva a pintar: es el doble envio
// real de un dedo rapido. Van dentro de un solo act a proposito — si se
// esperara entre uno y otro, el `disabled` del boton ya habria tapado el
// segundo y la prueba no diria nada sobre la guarda.
async function dobleToque(boton: HTMLElement) {
  await act(async () => {
    boton.click();
    boton.click();
  });
}

function filaDe(nombre: string): HTMLElement {
  const fila = screen.getByText(nombre).closest('li');
  if (!fila) throw new Error(`no hay fila para ${nombre}`);
  return fila;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mockApi.sessions).forEach((fn) => fn.mockReset());
});

describe('SessionsView', () => {
  it('marca la sesion actual y no le pone boton de cerrar en su fila', async () => {
    mockApi.sessions.listar.mockResolvedValue({ success: true, data: [esta, otra] });
    setup();
    await screen.findByText('Chrome en Windows');

    const filaActual = filaDe('Chrome en Windows');
    expect(within(filaActual).getByText('En uso')).toBeInTheDocument();
    expect(within(filaActual).queryByRole('button')).toBeNull();
    expect(
      within(filaActual).getByText('Es la sesión que estás usando ahora. Para cerrarla, sal de tu cuenta desde el perfil.'),
    ).toBeInTheDocument();

    // La otra si se puede cerrar, y sus fechas salen en el idioma activo, no en
    // crudo: la de la API es un ISO-8601 que nadie deberia ver.
    const filaOtra = filaDe('Chrome en Android');
    expect(within(filaOtra).getByRole('button', { name: 'Cerrar: Chrome en Android' })).toBeInTheDocument();
    expect(within(filaOtra).queryByText(otra.createdAt)).toBeNull();
    const legible = new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(otra.createdAt));
    expect(within(filaOtra).getByText(legible)).toBeInTheDocument();
  });

  it('cierra una sesion una sola vez con dos clics y la quita de la lista', async () => {
    mockApi.sessions.listar.mockResolvedValue({ success: true, data: [esta, otra] });
    const pendiente = deferred<{ success: boolean }>();
    mockApi.sessions.cerrar.mockReturnValue(pendiente.promise);
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Cerrar: Chrome en Android' }));
    const confirmar = await screen.findByRole('button', { name: 'Sí, cerrar' });
    await dobleToque(confirmar);

    expect(mockApi.sessions.cerrar).toHaveBeenCalledTimes(1);
    expect(mockApi.sessions.cerrar).toHaveBeenCalledWith('s-otra');

    pendiente.resolve({ success: true });

    await waitFor(() => expect(screen.queryByText('Chrome en Android')).toBeNull());
    expect(screen.getByText('Chrome en Windows')).toBeInTheDocument();
    expect(screen.getByText('Listo. Ese aparato ya salió de tu cuenta.')).toBeInTheDocument();
  });

  it('cerrar las demas pide confirmacion, dice cuantas cierra y llama una sola vez', async () => {
    mockApi.sessions.listar.mockResolvedValue({ success: true, data: [esta, otra, tercera] });
    const pendiente = deferred<{ success: boolean; data: number }>();
    mockApi.sessions.cerrarLasDemas.mockReturnValue(pendiente.promise);
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Cerrar las demás sesiones' }));

    // Sin confirmar todavia no se llama a nada.
    expect(
      await screen.findByText('Vas a cerrar 2 sesiones. La de este dispositivo se queda abierta.'),
    ).toBeInTheDocument();
    expect(mockApi.sessions.cerrarLasDemas).not.toHaveBeenCalled();

    const confirmar = screen.getByRole('button', { name: 'Sí, cerrar las demás' });
    await dobleToque(confirmar);

    expect(mockApi.sessions.cerrarLasDemas).toHaveBeenCalledTimes(1);

    pendiente.resolve({ success: true, data: 2 });

    await waitFor(() => expect(screen.queryByText('Chrome en Android')).toBeNull());
    expect(screen.queryByText('Safari en iPad')).toBeNull();
    expect(screen.getByText('Chrome en Windows')).toBeInTheDocument();
    expect(screen.getByText('Solo este dispositivo')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando solo existe la sesion actual', async () => {
    mockApi.sessions.listar.mockResolvedValue({ success: true, data: [esta] });
    setup();

    expect(await screen.findByText('Solo este dispositivo')).toBeInTheDocument();
    expect(
      screen.getByText('Nadie más tiene tu cuenta abierta. Si entras desde otro teléfono o computadora, aparecerá aquí.'),
    ).toBeInTheDocument();
    // Sin otras sesiones, la accion masiva no tiene sentido y no se ofrece.
    expect(screen.queryByRole('button', { name: 'Cerrar las demás sesiones' })).toBeNull();
  });
});
