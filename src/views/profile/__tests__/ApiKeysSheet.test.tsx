import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ApiKeysSheet } from '../ApiKeysSheet';

// La hoja pintaba `res.error.message` tal cual: "resource not found" en ingles
// al revocar una clave que ya no existia, y un vacio "No tienes claves" cuando
// la lista simplemente no se habia podido leer.

const api = vi.hoisted(() => ({
  b2b: {
    listKeys: vi.fn(),
    createKey: vi.fn(),
    revokeKey: vi.fn(),
  },
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => api,
}));

const clave = {
  id: 'k1',
  name: 'Tienda en línea',
  prefix: 'kp_live_abc',
  scopes: 'escrow:read',
  status: 'active',
  createdAt: '2026-09-01T00:00:00Z',
};

const pintar = () =>
  render(
    <LanguageProvider>
      <ApiKeysSheet isOpen onClose={() => {}} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  for (const fn of Object.values(api.b2b)) fn.mockReset();
});
afterEach(cleanup);

describe('ApiKeysSheet — errores traducidos por codigo', () => {
  it('una lista que no se pudo leer lo dice y ofrece reintentar, sin afirmar que no hay claves', async () => {
    api.b2b.listKeys
      .mockResolvedValueOnce({ success: false, error: { code: 'B2B_FAILED', message: 'El servidor tuvo un problema.' } })
      .mockResolvedValueOnce({ success: true, data: [clave] });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar tus claves.');
    expect(screen.queryByText('No tienes claves')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Tienda en línea')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('revocar una clave que ya no existe lo explica en espanol y relee la lista', async () => {
    api.b2b.listKeys.mockResolvedValueOnce({ success: true, data: [clave] }).mockResolvedValueOnce({ success: true, data: [] });
    api.b2b.revokeKey.mockResolvedValue({ success: false, error: { code: 'B2B_NOT_FOUND', message: 'resource not found' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Revocar' }));
    await user.click(screen.getByRole('button', { name: 'Revocar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Esa clave ya no existe. Actualizamos la lista.');
    expect(screen.queryByText(/resource not found/)).toBeNull();
    await waitFor(() => expect(api.b2b.listKeys).toHaveBeenCalledTimes(2));
  });

  it('un rechazo desconocido al crear cae al generico traducido, nunca al texto del servidor', async () => {
    api.b2b.listKeys.mockResolvedValue({ success: true, data: [] });
    api.b2b.createKey.mockResolvedValue({ success: false, error: { code: 'B2B_KEY_CREATE_FAILED', message: 'operation failed' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Crear clave' }));
    await user.type(screen.getByPlaceholderText('Para identificarla (ej. "Tienda en línea")'), 'Caja');
    const botones = screen.getAllByRole('button', { name: 'Crear clave' });
    await user.click(botones[botones.length - 1]);

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo crear la clave. Intenta de nuevo.');
    expect(screen.queryByText(/operation failed/)).toBeNull();
  });

  it('el aviso de red que ya tradujo el cliente se respeta', async () => {
    api.b2b.listKeys.mockResolvedValue({
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'No pudimos conectar con KiramoPay. Revisa tu conexión e intenta de nuevo.' },
    });
    pintar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos conectar con KiramoPay.');
  });

  it('el nombre no deja escribir mas de lo que acepta el servidor', async () => {
    api.b2b.listKeys.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Crear clave' }));
    expect(screen.getByPlaceholderText('Para identificarla (ej. "Tienda en línea")')).toHaveAttribute('maxLength', '100');
  });
});
