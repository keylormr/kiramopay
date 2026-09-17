import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { WebhooksSheet } from '../WebhooksSheet';

// Registrar un webhook con una URL que no sirve mostraba "invalid request", en
// ingles y sin decir que corregir. El servidor ahora responde un codigo propio
// y la hoja lo traduce.

const api = vi.hoisted(() => ({
  b2b: {
    listWebhooks: vi.fn(),
    createWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    listDeliveries: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => api }));

const pintar = () =>
  render(
    <LanguageProvider>
      <WebhooksSheet isOpen onClose={() => {}} />
    </LanguageProvider>,
  );

async function intentarRegistrar(
  user: ReturnType<typeof userEvent.setup>,
  url: string,
  textoBoton: RegExp,
  rotuloCampo = 'URL del endpoint',
) {
  await user.click(await screen.findByRole('button', { name: textoBoton }));
  // El rotulo visible nombra el campo: sin esa asociacion no se encontraria.
  const campo = screen.getByRole('textbox', { name: rotuloCampo });
  await user.type(campo, url);
  return campo;
}

describe('WebhooksSheet — URL rechazada', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const fn of Object.values(api.b2b)) fn.mockReset();
    api.b2b.listWebhooks.mockResolvedValue({ success: true, data: [] });
    api.b2b.createWebhook.mockResolvedValue({
      success: false,
      error: { code: 'WEBHOOK_INVALID_URL', message: 'the webhook url must be a full http(s) address of a public server' },
    });
  });
  afterEach(cleanup);

  it('explica que corregir, en el idioma de la app, y marca el campo', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    const user = userEvent.setup();
    pintar();

    const campo = await intentarRegistrar(user, 'esto-no-es-una-url', /Agregar webhook/);
    await user.click(screen.getByRole('button', { name: 'Registrar webhook' }));

    const aviso = await screen.findByRole('alert');
    expect(aviso.textContent).toMatch(/^Revisa la URL: tiene que ser la dirección completa de un servidor público/);
    expect(screen.queryByText(/invalid request|webhook url must be/i)).not.toBeInTheDocument();
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAttribute('aria-describedby', aviso.id);
    expect(api.b2b.createWebhook).toHaveBeenCalledWith('esto-no-es-una-url', '*');

    // Al corregir la URL el aviso se va: ya no describe lo que hay escrito.
    await user.type(campo, 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(campo).not.toHaveAttribute('aria-invalid');
  });

  it('el mismo aviso sale en frances', async () => {
    localStorage.setItem('kiramopay_language', 'fr');
    const user = userEvent.setup();
    pintar();

    await intentarRegistrar(user, 'esto-no-es-una-url', /Ajouter un webhook/, "URL de l'endpoint");
    await user.click(screen.getByRole('button', { name: 'Enregistrer le webhook' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/^Vérifiez l’URL/);
  });

  it('cancelar no deja el aviso de la URL pintado en la lista', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    const user = userEvent.setup();
    pintar();

    await intentarRegistrar(user, 'esto-no-es-una-url', /Agregar webhook/);
    await user.click(screen.getByRole('button', { name: 'Registrar webhook' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByText('No tienes webhooks')).toBeInTheDocument();
    expect(screen.queryByText(/Revisa la URL/)).not.toBeInTheDocument();
  });

  it('otro rechazo conserva su propio mensaje', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    api.b2b.createWebhook.mockResolvedValue({
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'No pudimos conectar con KiramoPay. Revisa tu conexión e intenta de nuevo.' },
    });
    const user = userEvent.setup();
    pintar();

    const campo = await intentarRegistrar(user, 'https://mi-comercio.example/hook', /Agregar webhook/);
    await user.click(screen.getByRole('button', { name: 'Registrar webhook' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'No pudimos conectar con KiramoPay. Revisa tu conexión e intenta de nuevo.',
    );
    // No es un problema de la URL: el campo no se marca.
    expect(campo).not.toHaveAttribute('aria-invalid');
  });
});

// La hoja pintaba `res.error.message` crudo (en ingles) y daba por vacias la
// lista y las entregas cuando la consulta fallaba.
describe('WebhooksSheet — errores de la lista y de las entregas', () => {
  const endpoint = { id: 'w1', url: 'https://mi-comercio.example/hook', events: '*', status: 'active', createdAt: '' };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    for (const fn of Object.values(api.b2b)) fn.mockReset();
  });
  afterEach(cleanup);

  it('una lista que no se pudo leer no se presenta como vacia', async () => {
    api.b2b.listWebhooks.mockResolvedValue({ success: false, error: { code: 'B2B_FAILED', message: 'operation failed' } });
    pintar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar tus webhooks.');
    expect(screen.queryByText('No tienes webhooks')).not.toBeInTheDocument();
    expect(screen.queryByText(/operation failed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('borrar uno que ya no existe se explica en espanol y la lista se relee', async () => {
    api.b2b.listWebhooks
      .mockResolvedValueOnce({ success: true, data: [endpoint] })
      .mockResolvedValueOnce({ success: true, data: [] });
    api.b2b.deleteWebhook.mockResolvedValue({ success: false, error: { code: 'B2B_NOT_FOUND', message: 'resource not found' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ese webhook ya no existe. Actualizamos la lista.');
    expect(screen.queryByText(/resource not found/)).not.toBeInTheDocument();
    expect(await screen.findByText('No tienes webhooks')).toBeInTheDocument();
  });

  it('las entregas que no se pudieron leer no se muestran como "sin entregas"', async () => {
    api.b2b.listWebhooks.mockResolvedValue({ success: true, data: [endpoint] });
    api.b2b.listDeliveries.mockResolvedValue({ success: false, error: { code: 'B2B_FAILED', message: 'x' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Entregas recientes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar las entregas.');
    expect(screen.queryByText('Sin entregas todavía')).not.toBeInTheDocument();
  });
});
