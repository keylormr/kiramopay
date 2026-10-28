import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { precargarIdioma } from '@/test/idiomas';
import { BusinessOnboardingSheet } from '../BusinessOnboardingSheet';

// Registrar un comercio mostraba `res.error.message`: el texto del servidor, en
// ingles, sea cual fuera el idioma de la app. Y para INVALID_CATEGORY (que el
// servidor responde desde que valida la categoria) la app no tenia texto. El
// motivo viaja como codigo y el texto lo pone la pantalla.

const mocks = vi.hoisted(() => ({ registerMerchant: vi.fn() }));

vi.mock('@/api', () => ({ getApiLayer: () => ({ qrPayments: { registerMerchant: mocks.registerMerchant } }) }));

const TEXTO_DEL_SERVIDOR = 'invalid merchant category';

beforeAll(() => precargarIdioma('en'));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.registerMerchant.mockReset();
});

// Recorre los tres pasos y deja el formulario listo para enviar.
async function llenarYRegistrar(user: ReturnType<typeof userEvent.setup>, siguiente = 'Siguiente', registrar = 'Registrar') {
  render(
    <LanguageProvider>
      <BusinessOnboardingSheet isOpen onClose={vi.fn()} onCreated={vi.fn()} />
    </LanguageProvider>,
  );
  await user.click(screen.getByRole('button', { name: siguiente }));
  await user.type(screen.getAllByRole('textbox')[0], 'Soda Tica');
  await user.click(screen.getByRole('button', { name: siguiente }));
  const campos = screen.getAllByRole('textbox');
  await user.type(campos[0], '3-101-123456');
  await user.type(campos[1], 'Soda Tica SA');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: registrar }));
}

describe('BusinessOnboardingSheet: los rechazos al registrar se dicen en el idioma de la app', () => {
  it('INVALID_CATEGORY tiene su texto y no se muestra el del servidor', async () => {
    mocks.registerMerchant.mockResolvedValue({ success: false, error: { code: 'INVALID_CATEGORY', message: TEXTO_DEL_SERVIDOR } });
    const user = userEvent.setup();
    await llenarYRegistrar(user);

    expect(await screen.findByText('Elige una de las categorías de la lista.')).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_DEL_SERVIDOR)).toBeNull();
  });

  it.each([
    ['MERCHANT_NAME_REQUIRED', 'merchant name is required', 'Completa el nombre, la cédula y la razón social del comercio.'],
    ['MERCHANT_CEDULA_REQUIRED', 'cedula is required', 'Completa el nombre, la cédula y la razón social del comercio.'],
    ['MERCHANT_LEGAL_NAME_REQUIRED', 'legal name is required', 'Completa el nombre, la cédula y la razón social del comercio.'],
    ['MERCHANT_CEDULA_TYPE_INVALID', 'invalid cedula type', 'Elige si la cédula es física o jurídica.'],
    ['MERCHANT_FIELD_TOO_LONG', 'a merchant field is too long', 'Alguno de los datos es demasiado largo. Acórtalo e inténtalo de nuevo.'],
    ['MERCHANT_DUPLICATE', 'merchant already exists', 'Ya existe un comercio con esos datos.'],
  ])('%s se dice con su texto', async (code, message, esperado) => {
    mocks.registerMerchant.mockResolvedValue({ success: false, error: { code, message } });
    const user = userEvent.setup();
    await llenarYRegistrar(user);

    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByText(message)).toBeNull();
  });

  // Un fallo del servidor llega con el mensaje generico del cliente HTTP; la
  // pantalla dice lo suyo, que es lo que la persona puede hacer.
  it('un fallo inesperado cae al texto de la pantalla', async () => {
    mocks.registerMerchant.mockResolvedValue({ success: false, error: { code: 'REGISTER_FAILED', message: 'ERROR: relation "qr_merchants" does not exist' } });
    const user = userEvent.setup();
    await llenarYRegistrar(user);

    expect(await screen.findByText('No se pudo registrar el comercio')).toBeInTheDocument();
    expect(screen.queryByText(/qr_merchants/)).toBeNull();
  });

  it('en ingles tampoco sale el texto del servidor', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    mocks.registerMerchant.mockResolvedValue({ success: false, error: { code: 'INVALID_CATEGORY', message: 'categoria invalida del servidor' } });
    const user = userEvent.setup();
    await llenarYRegistrar(user, 'Next', 'Register');

    expect(await screen.findByText('Pick one of the categories in the list.')).toBeInTheDocument();
    expect(screen.queryByText('categoria invalida del servidor')).toBeNull();
  });
});

// El servidor rechaza lo que no cabe en la columna; la pantalla ya no deja
// escribirlo.
describe('BusinessOnboardingSheet: los campos tienen el largo que acepta el servidor', () => {
  it('nombre y razon social 200, cedula 50', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <BusinessOnboardingSheet isOpen onClose={vi.fn()} onCreated={vi.fn()} />
      </LanguageProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getAllByRole('textbox')[0]).toHaveAttribute('maxlength', '200');
    await user.type(screen.getAllByRole('textbox')[0], 'Soda Tica');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));

    const campos = screen.getAllByRole('textbox');
    await waitFor(() => expect(campos).toHaveLength(2));
    expect(campos[0]).toHaveAttribute('maxlength', '50');
    expect(campos[1]).toHaveAttribute('maxlength', '200');
  });
});
